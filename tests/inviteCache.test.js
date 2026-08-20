const { TestSuite, assert } = require('./helpers/harness');
const { createTestDb, createRepos } = require('./helpers/db');
const { createFakeInviteGateway } = require('./helpers/fakes');
const { InviteService } = require('../src/features/invites/application/inviteService');
const { createInvitePolicy } = require('../src/features/invites/domain/invitePolicy');
const { createEventBus } = require('../src/app/eventBus');

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

function makeInvite(code, inviterId = 'u1') {
  return { code, uses: 1, inviterId, maxUses: 0, maxAge: 0, channelId: null, channelName: null, createdAt: null };
}

function buildService({ gateway }) {
  const db = createTestDb();
  const repos = createRepos(db);
  const service = new InviteService({
    inviteRepository: repos.invites,
    guildRepository: repos.guilds,
    inviteGateway: gateway,
    policy: createInvitePolicy(),
    eventBus: createEventBus(),
    logger: silentLogger,
  });
  return { service, repos, db };
}

async function runInviteCacheTests() {
  const suite = new TestSuite('Invite Cache Semantics');

  suite.test('fresh non-empty snapshot replaces the persisted cache', async () => {
    const gateway = createFakeInviteGateway({ invites: [makeInvite('A'), makeInvite('B')] });
    const { service, repos } = buildService({ gateway });

    const first = await service.getActiveInvites('g');
    assert.deepStrictEqual(first.map((i) => i.code).sort(), ['A', 'B']);

    // Discord now returns a different set; the cache must be replaced, not merged.
    gateway.state.invites.clear();
    gateway.state.invites.set('C', makeInvite('C'));
    gateway.state.invites.set('D', makeInvite('D'));

    const second = await service.getActiveInvites('g');
    assert.deepStrictEqual(second.map((i) => i.code).sort(), ['C', 'D']);
    assert.deepStrictEqual(repos.invites.getCachedInvites('g').map((i) => i.code).sort(), ['C', 'D']);
  });

  suite.test('fresh EMPTY snapshot is authoritative: clears stale cache and returns []', async () => {
    const gateway = createFakeInviteGateway({ invites: [makeInvite('A'), makeInvite('B')] });
    const { service, repos } = buildService({ gateway });

    // Populate the cache with a successful non-empty fetch.
    await service.getActiveInvites('g');
    assert.strictEqual(repos.invites.getCachedInvites('g').length, 2);

    // Discord successfully reports zero active invites.
    gateway.state.invites.clear();

    const result = await service.getActiveInvites('g');
    assert.deepStrictEqual(result, [], 'zero active invites must be returned as empty');
    assert.deepStrictEqual(repos.invites.getCachedInvites('g'), [], 'stale cached invites must be cleared');
  });

  suite.test('failed fetch falls back to the last-known persisted cache', async () => {
    const gateway = createFakeInviteGateway({ invites: [makeInvite('A'), makeInvite('B')] });
    const { service, repos } = buildService({ gateway });

    await service.getActiveInvites('g');
    assert.strictEqual(repos.invites.getCachedInvites('g').length, 2);

    // Discord gateway fails entirely.
    gateway.state.fetchGuildInvitesError = new Error('Discord unavailable');
    const result = await service.getActiveInvites('g');
    assert.deepStrictEqual(result.map((i) => i.code).sort(), ['A', 'B']);
  });

  suite.test('gateway returning null (failed) also falls back to cache', async () => {
    const gateway = createFakeInviteGateway({ invites: [makeInvite('A')] });
    const { service, repos } = buildService({ gateway });

    await service.getActiveInvites('g');
    gateway.fetchGuildInvites = async () => null;

    const result = await service.getActiveInvites('g');
    assert.deepStrictEqual(result.map((i) => i.code).sort(), ['A']);
  });

  suite.test('getActiveInvites empty result never resurrects deleted invites afterwards', async () => {
    const gateway = createFakeInviteGateway({ invites: [makeInvite('A')] });
    const { service, repos } = buildService({ gateway });

    await service.getActiveInvites('g');
    gateway.state.invites.clear();

    // Empty fetch clears cache; a subsequent failure must not resurrect A.
    await service.getActiveInvites('g');
    assert.deepStrictEqual(repos.invites.getCachedInvites('g'), []);

    gateway.state.fetchGuildInvitesError = new Error('down');
    const result = await service.getActiveInvites('g');
    assert.deepStrictEqual(result, []);
  });

  return suite.run();
}

module.exports = { runInviteCacheTests };

if (require.main === module) {
  runInviteCacheTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
