const { TestSuite, assert } = require('./helpers/harness');
const { createTestDb, createRepos } = require('./helpers/db');
const { createRecordingBus, createFakeInviteGateway, makeMember } = require('./helpers/fakes');
const { InviteService } = require('../src/features/invites/application/inviteService');
const { createInvitePolicy } = require('../src/features/invites/domain/invitePolicy');
const { AttributionType } = require('../src/features/invites/domain/attribution');
const { InviteEvents } = require('../src/app/eventBus');
const { DiscordInviteGateway } = require('../src/platform/discord/discordInviteGateway');

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

function buildService({ db, gateway, policy } = {}) {
  const testDb = db || createTestDb();
  const repos = createRepos(testDb);
  const bus = createRecordingBus();
  const service = new InviteService({
    inviteRepository: repos.invites,
    guildRepository: repos.guilds,
    inviteGateway: gateway || createFakeInviteGateway(),
    policy: policy || createInvitePolicy(),
    eventBus: bus,
    logger: silentLogger,
  });
  return { service, bus, repos, db: testDb };
}

async function runInviteServiceTests() {
  const suite = new TestSuite('Invite Service');

  suite.test('join publishes a canonical memberJoined event with plain data', async () => {
    const { service, bus } = buildService();
    const member = makeMember({ id: 'm1', guildId: 'g', username: 'Newbie' });
    const res = await service.trackMemberJoin(member, { type: AttributionType.INVITE, inviterId: 'inv', inviteCode: 'c' });

    assert.strictEqual(res.result.applied, true);
    const evt = bus.recorded.find((r) => r.event === InviteEvents.MemberJoined);
    assert.ok(evt, 'memberJoined event published');
    assert.strictEqual(evt.payload.guildId, 'g');
    assert.strictEqual(evt.payload.member.id, 'm1');
    assert.strictEqual(evt.payload.attribution.type, AttributionType.INVITE);
    assert.strictEqual(evt.payload.attribution.inviterId, 'inv');
    assert.strictEqual(evt.payload.isFake, false);
    assert.strictEqual(evt.payload.inviterStats.total, 1);
  });

  suite.test('duplicate join does not publish another event', async () => {
    const { service, bus } = buildService();
    const member = makeMember({ id: 'm1', guildId: 'g' });
    const attribution = { type: AttributionType.INVITE, inviterId: 'inv', inviteCode: 'c' };
    await service.trackMemberJoin(member, attribution);
    await service.trackMemberJoin(member, attribution);

    const joins = bus.recorded.filter((r) => r.event === InviteEvents.MemberJoined);
    assert.strictEqual(joins.length, 1);
  });

  suite.test('same-guild joins are attributed sequentially', async () => {
    const gateway = createFakeInviteGateway({ invites: [{ code: 'a', uses: 5, inviterId: 'u1' }] });
    let fetchCount = 0;
    gateway.fetchGuildInvites = async () => {
      fetchCount += 1;
      return { invites: [{ code: 'a', uses: 5 + fetchCount, inviterId: 'u1' }], vanityUses: 0 };
    };

    const { service, repos } = buildService({ gateway });
    // Prime the cache like initializeGuild would in production.
    await service.initializeGuild('g');

    const m1 = makeMember({ id: 'm1', guildId: 'g' });
    const m2 = makeMember({ id: 'm2', guildId: 'g' });

    const [r1, r2] = await Promise.all([service.trackMemberJoin(m1), service.trackMemberJoin(m2)]);

    assert.strictEqual(r1.attribution.inviterId, 'u1');
    assert.strictEqual(r2.attribution.inviterId, 'u1');
    // Serialized snapshot consumption: exactly one +1 use consumed per join.
    assert.strictEqual(repos.invites.getInviter('g', 'u1').regular, 2);
    assert.strictEqual(repos.invites.countInviteEvents('g'), 2);
  });

  suite.test('startup reconciliation runs every time against the authoritative member list', async () => {
    const gateway = createFakeInviteGateway();
    let memberFetches = 0;
    gateway.fetchGuildMembers = async () => {
      memberFetches += 1;
      return [];
    };
    const { service, repos } = buildService({ gateway });

    await service.initializeGuild('g');
    await service.initializeGuild('g');

    assert.strictEqual(memberFetches, 2);
  });

  suite.test('user-enriched leaderboard uses one batch resolution', async () => {
    const gateway = createFakeInviteGateway();
    let batchCalls = 0;
    gateway.resolveUsers = async (ids) => {
      batchCalls += 1;
      return new Map(ids.map((id) => [id, { id, username: `Name_${id}`, avatar: null }]));
    };
    const { service, repos } = buildService({ gateway });
    repos.invites.trackJoin({
      guildId: 'g',
      userId: 'member-1',
      attribution: { type: AttributionType.INVITE, inviterId: 'inv-1', inviteCode: 'c' },
      isFake: false,
    });

    const result = await service.getLeaderboardWithUsers('g');
    assert.strictEqual(batchCalls, 1);
    assert.strictEqual(result.leaderboard[0].username, 'Name_inv-1');
  });

  suite.test('ambiguous multi-invite delta resolves to UNKNOWN, never a guess', async () => {
    const gateway = createFakeInviteGateway({
      invites: [{ code: 'a', uses: 5, inviterId: 'u1' }, { code: 'b', uses: 3, inviterId: 'u2' }],
    });
    let fetchCount = 0;
    gateway.fetchGuildInvites = async () => {
      fetchCount += 1;
      if (fetchCount === 1) return { invites: [{ code: 'a', uses: 5, inviterId: 'u1' }, { code: 'b', uses: 3, inviterId: 'u2' }], vanityUses: 0 };
      if (fetchCount === 2) return { invites: [{ code: 'a', uses: 6, inviterId: 'u1' }, { code: 'b', uses: 4, inviterId: 'u2' }], vanityUses: 0 };
      return { invites: [{ code: 'a', uses: 7, inviterId: 'u1' }, { code: 'b', uses: 4, inviterId: 'u2' }], vanityUses: 0 };
    };

    const { service, repos } = buildService({ gateway });
    await service.initializeGuild('g'); // primes cache with a:5, b:3

    const m1 = makeMember({ id: 'm1', guildId: 'g' });
    const m2 = makeMember({ id: 'm2', guildId: 'g' });

    const [r1, r2] = await Promise.all([service.trackMemberJoin(m1), service.trackMemberJoin(m2)]);

    // Both invites moved on the first fetch -> UNKNOWN (no confident credit).
    assert.strictEqual(r1.attribution.type, AttributionType.UNKNOWN);
    // Second fetch is unambiguous (only 'a' moved).
    assert.strictEqual(r2.attribution.type, AttributionType.INVITE);
    assert.strictEqual(r2.attribution.inviterId, 'u1');
    // No credit for the unknown join.
    assert.strictEqual(repos.invites.getInvitersCount('g'), 1);
  });

  suite.test('different-guild joins run independently', async () => {
    const gateway = createFakeInviteGateway({
      invites: [{ code: 'a', uses: 1, inviterId: 'u1' }, { code: 'a', uses: 1, inviterId: 'u2' }],
    });
    const { service } = buildService({ gateway });
    const [ra, rb] = await Promise.all([
      service.trackMemberJoin(makeMember({ id: 'x', guildId: 'guildA' }), { type: AttributionType.INVITE, inviterId: 'u1', inviteCode: 'a' }),
      service.trackMemberJoin(makeMember({ id: 'y', guildId: 'guildB' }), { type: AttributionType.INVITE, inviterId: 'u2', inviteCode: 'a' }),
    ]);
    assert.strictEqual(ra.result.applied, true);
    assert.strictEqual(rb.result.applied, true);
  });

  suite.test('reconciliation excludes bots via the shared policy', async () => {
    const gateway = createFakeInviteGateway();
    gateway.fetchGuildMembers = async () => [
      { id: 'h1', guildId: 'g', bot: false, joinedAt: '2026-01-01T00:00:00Z', accountCreatedAt: '2025-01-01T00:00:00Z' },
      { id: 'bot1', guildId: 'g', bot: true, joinedAt: '2026-01-01T00:00:00Z', accountCreatedAt: '2026-01-01T00:00:00Z' },
    ];
    const { service, repos } = buildService({ gateway });
    const result = await service.reconcileGuildMembers('g');
    assert.strictEqual(result.joined, 1); // bot excluded
    const member = repos.invites.getCurrentMember('g', 'bot1');
    assert.ok(!member, 'bot member should not be tracked');
    const human = repos.invites.getCurrentMember('g', 'h1');
    assert.strictEqual(human.attribution_type, AttributionType.RECONCILED);
    assert.strictEqual(human.inviter_id, null);
  });

  suite.test('reconciliation is idempotent across calls', async () => {
    const gateway = createFakeInviteGateway();
    gateway.fetchGuildMembers = async () => [
      { id: 'h1', guildId: 'g', bot: false, joinedAt: '2026-01-01T00:00:00Z', accountCreatedAt: '2025-01-01T00:00:00Z' },
    ];
    const { service, repos } = buildService({ gateway });
    await service.reconcileGuildMembers('g');
    await service.reconcileGuildMembers('g');
    assert.strictEqual(repos.invites.countInviteEvents('g'), 1);
  });

  suite.test('failed authoritative member fetch does not mutate the ledger', async () => {
    const gateway = createFakeInviteGateway();
    gateway.fetchGuildMembers = async () => null;
    const { service, repos } = buildService({ gateway });

    const result = await service.reconcileGuildMembers('g');
    assert.deepStrictEqual(result, { available: false, joined: 0, left: 0, unchanged: 0 });
    assert.strictEqual(repos.invites.countInviteEvents('g'), 0);
  });

  suite.test('Discord member reconciliation never falls back to a partial cache', async () => {
    const cachedMember = { id: 'cached', user: { username: 'Cached' } };
    const gateway = new DiscordInviteGateway({
      client: {
        guilds: {
          cache: new Map([['g', {
            members: {
              fetch: async () => { throw new Error('gateway unavailable'); },
              cache: new Map([['cached', cachedMember]]),
            },
          }]]),
        },
      },
      logger: { error: () => {} },
    });

    assert.strictEqual(await gateway.fetchGuildMembers('g'), null);
  });

  suite.test('leave through the service emits memberLeft and updates inviter stats', async () => {
    const { service, bus, repos } = buildService();
    const member = makeMember({ id: 'm1', guildId: 'g' });
    await service.trackMemberJoin(member, { type: AttributionType.INVITE, inviterId: 'inv', inviteCode: 'c' });
    await service.trackMemberLeave({ id: 'm1', guildId: 'g' });

    const evt = bus.recorded.find((r) => r.event === InviteEvents.MemberLeft);
    assert.ok(evt);
    assert.strictEqual(evt.payload.attribution.inviterId, 'inv');
    assert.strictEqual(repos.invites.getInviter('g', 'inv').leaves, 1);
    assert.strictEqual(repos.invites.getInviter('g', 'inv').total, 0);
  });

  suite.test('regression: a suspicious member leaving publishes isFake=true', async () => {
    const { service, bus, repos } = buildService();
    // Record a fake (suspicious) member directly through the repository.
    repos.invites.trackJoin({
      guildId: 'g',
      userId: 'mfake2',
      attribution: { type: AttributionType.INVITE, inviterId: 'inv', inviteCode: 'c' },
      isFake: true,
    });

    await service.trackMemberLeave({ id: 'mfake2', guildId: 'g' });

    const evt = bus.recorded.find((r) => r.event === InviteEvents.MemberLeft && r.payload.member.id === 'mfake2');
    assert.ok(evt, 'memberLeft must be published for the fake member');
    assert.strictEqual(evt.payload.isFake, true, 'isFake must reflect the projection, never default to false');
  });

  suite.test('fetch failure records UNKNOWN attribution instead of crashing', async () => {
    const gateway = createFakeInviteGateway();
    gateway.fetchGuildInvites = async () => null; // unavailable
    const { service } = buildService({ gateway });
    const res = await service.trackMemberJoin(makeMember({ id: 'm', guildId: 'g' }));
    assert.strictEqual(res.attribution.type, AttributionType.UNKNOWN);
    assert.strictEqual(res.result.applied, true);
  });

  suite.test('a throwing invite fetch still records the join as UNKNOWN', async () => {
    const gateway = createFakeInviteGateway();
    gateway.fetchGuildInvites = async () => { throw new Error('Discord gateway down'); };
    const { service, repos } = buildService({ gateway });
    const res = await service.trackMemberJoin(makeMember({ id: 'm', guildId: 'g' }));
    assert.strictEqual(res.result.applied, true);
    assert.strictEqual(res.attribution.type, AttributionType.UNKNOWN);
    assert.strictEqual(repos.invites.countInviteEvents('g'), 1);
  });

  return suite.run();
}

module.exports = { runInviteServiceTests };

if (require.main === module) {
  runInviteServiceTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
