const { TestSuite, assert } = require('./helpers/harness');
const { createTestDb, createRepos } = require('./helpers/db');
const { createRecordingBus, createFakeInviteGateway, makeMember } = require('./helpers/fakes');
const { InviteService } = require('../src/features/invites/application/inviteService');
const { InviteLogService } = require('../src/features/inviteLogs/application/inviteLogService');
const { InviteLogRepository } = require('../src/features/inviteLogs/infrastructure/inviteLogRepository');
const { GuildRepository } = require('../src/features/guilds/infrastructure/guildRepository');
const { createInvitePolicy } = require('../src/features/invites/domain/invitePolicy');
const { AttributionType } = require('../src/features/invites/domain/attribution');
const { InviteEvents } = require('../src/app/eventBus');

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

function createFakeInviteLogGateway({ botAdder = null, sendError = null } = {}) {
  const sent = [];
  return {
    sent,
    botAdder,
    sendError,
    async sendMessage(guildId, channelId, content) {
      if (this.sendError) throw this.sendError;
      sent.push({ guildId, channelId, content });
      return true;
    },
    async findRecentBotAdder() {
      return this.botAdder;
    },
  };
}

function recordingLogger() {
  const logs = [];
  const logger = {
    logs,
    info: (...a) => logs.push(['info', ...a]),
    warn: (...a) => logs.push(['warn', ...a]),
    error: (...a) => logs.push(['error', ...a]),
  };
  return logger;
}

function buildInviteLog({ db, gateway, logger, bus } = {}) {
  const testDb = db || createTestDb();
  const guilds = new GuildRepository(testDb);
  const repo = new InviteLogRepository(testDb);
  const gw = gateway || createFakeInviteLogGateway();
  const eventBus = bus || createRecordingBus();
  const service = new InviteLogService({
    guildRepository: guilds,
    inviteLogRepository: repo,
    inviteLogGateway: gw,
    eventBus,
    logger: logger || silentLogger,
  });
  return { service, guilds, repo, gw, eventBus, db: testDb };
}

// updateGuild only UPDATEs existing rows, so the guild row must exist first.
function configureGuild(guilds, guildId, channelId) {
  guilds.getGuild(guildId, `Guild ${guildId}`);
  guilds.updateGuild(guildId, { invite_log_channel_id: channelId });
}

const joinEvent = (guildId, over = {}) => ({
  guildId,
  member: { id: 'm1', username: 'Alice', avatar: null },
  attribution: { type: AttributionType.INVITE, inviterId: 'inv1', inviteCode: 'c' },
  inviter: { id: 'inv1', username: 'Bob', avatar: null },
  inviterStats: { userId: 'inv1', regular: 36, bonus: 0, leaves: 0, fake: 0, total: 36 },
  isFake: false,
  occurredAt: '2026-01-01T10:00:00Z',
  ...over,
});

const leaveEvent = (guildId, over = {}) => ({
  guildId,
  member: { id: 'm1', username: 'Alice', avatar: null },
  attribution: { type: AttributionType.INVITE, inviterId: 'inv1', inviteCode: 'c' },
  inviter: { id: 'inv1', username: 'Bob', avatar: null },
  isFake: false,
  occurredAt: '2026-01-01T11:00:00Z',
  ...over,
});

async function waitUntil(fn, timeout = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return fn();
}

function mockDiscordMember({ id, guildId, username, bot = false }) {
  return {
    id,
    guild: { id: guildId },
    user: {
      username,
      bot,
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
      createdAt: new Date(),
    },
    joinedAt: new Date(),
  };
}

async function runInviteLogTests() {
  const suite = new TestSuite('Invite Logs');

  // ------------------------------------------------------------ human join

  suite.test('INVITE human join logs to the configured channel with inviterStats.total', async () => {
    const { service, guilds, gw } = buildInviteLog();
    configureGuild(guilds, 'g', 'chanA');

    await service.handleMemberJoined(joinEvent('g'));

    assert.strictEqual(gw.sent.length, 1);
    assert.strictEqual(gw.sent[0].guildId, 'g');
    assert.strictEqual(gw.sent[0].channelId, 'chanA');
    assert.strictEqual(
      gw.sent[0].content,
      '**Alice** joined and they were invited by **Bob**. **Bob** now has **36 invites**.'
    );
  });

  suite.test('INVITE human join uses singular grammar for exactly one invite', async () => {
    const { service, guilds, gw } = buildInviteLog();
    configureGuild(guilds, 'g', 'chanA');

    await service.handleMemberJoined(joinEvent('g', { inviterStats: { total: 1 } }));

    assert.strictEqual(
      gw.sent[0].content,
      '**Alice** joined and they were invited by **Bob**. **Bob** now has **1 invite**.'
    );
  });

  suite.test('usernames are escaped so Discord markdown cannot be abused', async () => {
    const { service, guilds, gw } = buildInviteLog();
    configureGuild(guilds, 'g', 'chanA');

    await service.handleMemberJoined(joinEvent('g', {
      member: { id: 'm1', username: 'Al*ce_`~|<>', avatar: null },
      attribution: { type: AttributionType.UNKNOWN, inviterId: null, inviteCode: null },
      inviter: null,
      inviterStats: null,
    }));

    assert.strictEqual(gw.sent[0].content, '**Al\\*ce\\_\\`\\~\\|\\<\\>** joined, but I couldn\'t determine who invited them.');
  });

  // ------------------------------------------------------------ human leave

  suite.test('INVITE human leave identifies the original inviter', async () => {
    const { service, guilds, gw } = buildInviteLog();
    configureGuild(guilds, 'g', 'chanA');

    await service.handleMemberLeft(leaveEvent('g'));

    assert.strictEqual(gw.sent.length, 1);
    assert.strictEqual(gw.sent[0].content, '**Alice** left. They were invited by **Bob**.');
  });

  // ------------------------------------------------------------- UNKNOWN

  suite.test('UNKNOWN join never guesses attribution', async () => {
    const { service, guilds, gw } = buildInviteLog();
    configureGuild(guilds, 'g', 'chanA');

    await service.handleMemberJoined(joinEvent('g', {
      attribution: { type: AttributionType.UNKNOWN, inviterId: null, inviteCode: null },
      inviter: null,
      inviterStats: null,
    }));

    assert.strictEqual(gw.sent[0].content, '**Alice** joined, but I couldn\'t determine who invited them.');
  });

  suite.test('UNKNOWN leave uses the no-recorded-inviter wording', async () => {
    const { service, guilds, gw } = buildInviteLog();
    configureGuild(guilds, 'g', 'chanA');

    await service.handleMemberLeft(leaveEvent('g', {
      attribution: { type: AttributionType.UNKNOWN, inviterId: null, inviteCode: null },
      inviter: null,
    }));

    assert.strictEqual(gw.sent[0].content, '**Alice** left. I don\'t have a recorded inviter for them.');
  });

  // -------------------------------------------------------------- VANITY

  suite.test('VANITY join uses the vanity wording', async () => {
    const { service, guilds, gw } = buildInviteLog();
    configureGuild(guilds, 'g', 'chanA');

    await service.handleMemberJoined(joinEvent('g', {
      attribution: { type: AttributionType.VANITY, inviterId: null, inviteCode: null },
      inviter: null,
      inviterStats: null,
    }));

    assert.strictEqual(gw.sent[0].content, '**Alice** joined via the server vanity URL.');
  });

  suite.test('VANITY leave uses the original-vanity wording', async () => {
    const { service, guilds, gw } = buildInviteLog();
    configureGuild(guilds, 'g', 'chanA');

    await service.handleMemberLeft(leaveEvent('g', {
      attribution: { type: AttributionType.VANITY, inviterId: null, inviteCode: null },
      inviter: null,
    }));

    assert.strictEqual(gw.sent[0].content, '**Alice** left. They originally joined via the server vanity URL.');
  });

  suite.test('PRE_EXISTING joins produce no log (no historical spam)', async () => {
    const { service, guilds, gw } = buildInviteLog();
    configureGuild(guilds, 'g', 'chanA');

    await service.handleMemberJoined(joinEvent('g', {
      attribution: { type: AttributionType.PRE_EXISTING, inviterId: null, inviteCode: null },
    }));

    assert.strictEqual(gw.sent.length, 0);
  });

  // ------------------------------------------------------- disabled / misc

  suite.test('logging disabled: no Discord send is attempted', async () => {
    const { service, gw } = buildInviteLog();

    await service.handleMemberJoined(joinEvent('g'));
    await service.handleMemberLeft(leaveEvent('g'));
    await service.handleBotJoin({ id: 'bot1', guildId: 'g', username: 'SomeBot' });
    await service.handleBotLeave({ id: 'bot1', guildId: 'g', username: 'SomeBot' });

    assert.strictEqual(gw.sent.length, 0);
  });

  suite.test('Discord send failure is handled/logged and never throws into invite tracking', async () => {
    // Realistic gateway contract: expected Discord failures return false without
    // throwing — the invite/member state transition must succeed regardless.
    const failingGateway = createFakeInviteLogGateway();
    failingGateway.sendMessage = async () => false;
    const { service, guilds } = buildInviteLog({ gateway: failingGateway });
    configureGuild(guilds, 'g', 'chanA');

    await service.handleMemberJoined(joinEvent('g')); // must not throw
    assert.strictEqual(failingGateway.sent.length, 0);
  });

  suite.test('a throwing log gateway never escapes the event-bus subscription', async () => {
    const logger = recordingLogger();
    const throwingGateway = {
      sent: [],
      async sendMessage() { throw new Error('channel gone'); },
      async findRecentBotAdder() { return null; },
    };
    const { guilds, eventBus } = buildInviteLog({ gateway: throwingGateway, logger });
    configureGuild(guilds, 'g', 'chanA');

    // Async handler rejection is caught by the subscription wrapper; no
    // unhandled rejection and no crash — the failure is only logged.
    eventBus.emit(InviteEvents.MemberJoined, joinEvent('g'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(logger.logs.some((l) => l[0] === 'error' && l[2] === 'handleMemberJoined'), 'subscription failure must be logged');
  });

  suite.test('different guilds log to their own channels without cross-guild leakage', async () => {
    const { service, guilds, gw } = buildInviteLog();
    configureGuild(guilds, 'A', 'chanA');
    configureGuild(guilds, 'B', 'chanB');

    await service.handleMemberJoined(joinEvent('A'));
    await service.handleMemberJoined(joinEvent('B'));

    assert.strictEqual(gw.sent.length, 2);
    const a = gw.sent.find((s) => s.guildId === 'A');
    const b = gw.sent.find((s) => s.guildId === 'B');
    assert.strictEqual(a.channelId, 'chanA');
    assert.strictEqual(b.channelId, 'chanB');
    assert.notStrictEqual(a.channelId, b.channelId);
  });

  suite.test('event bus subscription forwards MemberJoined to the log handler', async () => {
    const { service, guilds, gw, eventBus } = buildInviteLog();
    configureGuild(guilds, 'g', 'chanA');

    eventBus.emit(InviteEvents.MemberJoined, joinEvent('g'));

    const ok = await waitUntil(() => gw.sent.length >= 1);
    assert.ok(ok, 'subscribed MemberJoined handler must send a message');
    assert.strictEqual(gw.sent[0].content, '**Alice** joined and they were invited by **Bob**. **Bob** now has **36 invites**.');
  });

  suite.test('duplicate human join produces exactly one log because InviteService emits once', async () => {
    const db = createTestDb();
    const repos = createRepos(db);
    const bus = createRecordingBus();
    const gw = createFakeInviteLogGateway();
    configureGuild(repos.guilds, 'g', 'chanA');

    new InviteLogService({
      guildRepository: repos.guilds,
      inviteLogRepository: new InviteLogRepository(db),
      inviteLogGateway: gw,
      eventBus: bus,
      logger: silentLogger,
    });

    const invites = new InviteService({
      inviteRepository: repos.invites,
      guildRepository: repos.guilds,
      inviteGateway: createFakeInviteGateway(),
      policy: createInvitePolicy(),
      eventBus: bus,
      logger: silentLogger,
    });

    const member = makeMember({ id: 'm1', guildId: 'g', username: 'Alice' });
    const attribution = { type: AttributionType.INVITE, inviterId: 'inv1', inviteCode: 'c' };
    await invites.trackMemberJoin(member, attribution);
    await invites.trackMemberJoin(member, attribution); // duplicate

    const ok = await waitUntil(() => gw.sent.length >= 1);
    assert.ok(ok, 'the single MemberJoined event must be logged');
    assert.strictEqual(gw.sent.length, 1, 'a duplicate join must not produce a second log');
    assert.strictEqual(bus.recorded.filter((r) => r.event === InviteEvents.MemberJoined).length, 1);
  });

  // -------------------------------------------------------------- bot join

  suite.test('bot join with audit-log result sends a bot message and persists attribution', async () => {
    const { service, guilds, gw, repo } = buildInviteLog({ gateway: createFakeInviteLogGateway({ botAdder: { id: 'user1', username: 'Bob' } }) });
    configureGuild(guilds, 'g', 'chanA');

    await service.handleBotJoin({ id: 'bot1', guildId: 'g', username: 'SomeBot' });

    assert.strictEqual(gw.sent[0].content, '🤖 **SomeBot** was added to this server by **Bob**.');
    const stored = repo.getBotAttribution('g', 'bot1');
    assert.strictEqual(stored.added_by_user_id, 'user1');
    assert.strictEqual(stored.added_by_username, 'Bob');
  });

  suite.test('bot join without audit-log result sends unknown-adder message and overwrites stale attribution', async () => {
    const gateway = createFakeInviteLogGateway();
    const { service, guilds, gw, repo } = buildInviteLog({ gateway });
    configureGuild(guilds, 'g', 'chanA');

    // Previous installation recorded an adder for this bot user id.
    repo.upsertBotAttribution({ guildId: 'g', botUserId: 'bot1', addedByUserId: 'old', addedByUsername: 'OldAdder' });

    gateway.botAdder = null; // audit-log resolution fails this time
    await service.handleBotJoin({ id: 'bot1', guildId: 'g', username: 'SomeBot' });

    assert.strictEqual(gw.sent[0].content, '🤖 **SomeBot** was added to this server, but I couldn\'t determine who added it.');
    const stored = repo.getBotAttribution('g', 'bot1');
    assert.strictEqual(stored.added_by_user_id, null, 'stale attribution must never be reused');
    assert.strictEqual(stored.added_by_username, null);
  });

  // ------------------------------------------------------------ bot leave

  suite.test('bot leave without stored adder reports no recorded adder', async () => {
    const { service, guilds, gw } = buildInviteLog();
    configureGuild(guilds, 'g', 'chanA');

    await service.handleBotLeave({ id: 'bot9', guildId: 'g', username: 'SomeBot' });

    assert.strictEqual(gw.sent[0].content, '🤖 **SomeBot** has been removed from this server. I don\'t have a recorded adder for it.');
  });

  suite.test('bot leave after restart uses the persisted adder from the same database', async () => {
    const db = createTestDb();

    // Service #1 (first process): resolves adder from audit log, persists it.
    const guilds1 = new GuildRepository(db);
    configureGuild(guilds1, 'g', 'chanA');
    const gw1 = createFakeInviteLogGateway({ botAdder: { id: 'user1', username: 'Bob' } });
    const s1 = new InviteLogService({
      guildRepository: guilds1,
      inviteLogRepository: new InviteLogRepository(db),
      inviteLogGateway: gw1,
      eventBus: createRecordingBus(),
      logger: silentLogger,
    });
    await s1.handleBotJoin({ id: 'bot1', guildId: 'g', username: 'SomeBot' });
    assert.strictEqual(gw1.sent[0].content, '🤖 **SomeBot** was added to this server by **Bob**.');

    // Service #2 (after restart): fresh repositories against the same db; no
    // audit-log access this time.
    const gw2 = createFakeInviteLogGateway();
    const s2 = new InviteLogService({
      guildRepository: new GuildRepository(db),
      inviteLogRepository: new InviteLogRepository(db),
      inviteLogGateway: gw2,
      eventBus: createRecordingBus(),
      logger: silentLogger,
    });
    await s2.handleBotLeave({ id: 'bot1', guildId: 'g', username: 'SomeBot' });

    assert.strictEqual(gw2.sent[0].content, '🤖 **SomeBot** has been removed from this server. It was added by **Bob**.');
  });

  // ------------------------------------------------- bots never touch ledger

  suite.test('bots never alter invite statistics or create ledger records', async () => {
    const db = createTestDb();
    const repos = createRepos(db);
    const { service, guilds } = buildInviteLog({ db, gateway: createFakeInviteLogGateway() });
    configureGuild(guilds, 'g', 'chanA');

    await service.handleBotJoin({ id: 'bot1', guildId: 'g', username: 'SomeBot' });
    await service.handleBotLeave({ id: 'bot1', guildId: 'g', username: 'SomeBot' });

    assert.strictEqual(repos.invites.getInvitersCount('g'), 0, 'no inviters created');
    assert.strictEqual(repos.invites.countInviteEvents('g'), 0, 'no invite_events created');
    const members = db.prepare('SELECT COUNT(*) AS c FROM invite_members WHERE guild_id = ?').get('g');
    assert.strictEqual(members.c, 0, 'no invite_members created');
    const inviters = db.prepare('SELECT COUNT(*) AS c FROM inviters WHERE guild_id = ?').get('g');
    assert.strictEqual(inviters.c, 0, 'no inviter projection rows created');
    const leaderboard = repos.invites.getLeaderboard('g', { limit: 10 });
    assert.deepStrictEqual(leaderboard, [], 'leaderboard is untouched by bots');
  });

  // --------------------------------------------- bot event handler routing

  suite.test('guildMemberAdd: bot routes to handleBotJoin and never calls trackMemberJoin', async () => {
    const guildMemberAdd = require('../src/bot/events/guildMemberAdd');
    const calls = [];
    const services = {
      policy: { shouldTrackMember: () => true },
      invites: { trackMemberJoin: async () => { calls.push('trackMemberJoin'); return { result: { applied: true } }; } },
      inviteLogs: { handleBotJoin: async () => { calls.push('handleBotJoin'); } },
    };

    await guildMemberAdd.execute(mockDiscordMember({ id: 'bot1', guildId: 'g', username: 'SomeBot', bot: true }), { services });

    assert.deepStrictEqual(calls, ['handleBotJoin']);
  });

  suite.test('guildMemberAdd: human routes to trackMemberJoin', async () => {
    const guildMemberAdd = require('../src/bot/events/guildMemberAdd');
    const calls = [];
    const services = {
      policy: { shouldTrackMember: () => true },
      invites: { trackMemberJoin: async () => { calls.push('trackMemberJoin'); return { result: { applied: true } }; } },
      inviteLogs: { handleBotJoin: async () => { calls.push('handleBotJoin'); } },
    };

    await guildMemberAdd.execute(mockDiscordMember({ id: 'm1', guildId: 'g', username: 'Alice', bot: false }), { services });

    assert.deepStrictEqual(calls, ['trackMemberJoin']);
  });

  suite.test('guildMemberRemove: bot routes to handleBotLeave and never calls trackMemberLeave', async () => {
    const guildMemberRemove = require('../src/bot/events/guildMemberRemove');
    const calls = [];
    const services = {
      policy: { shouldTrackMember: () => true },
      invites: { trackMemberLeave: async () => { calls.push('trackMemberLeave'); return { result: { applied: true } }; } },
      inviteLogs: { handleBotLeave: async () => { calls.push('handleBotLeave'); } },
    };

    await guildMemberRemove.execute(mockDiscordMember({ id: 'bot1', guildId: 'g', username: 'SomeBot', bot: true }), { services });

    assert.deepStrictEqual(calls, ['handleBotLeave']);
  });

  suite.test('guildMemberRemove: human routes to trackMemberLeave', async () => {
    const guildMemberRemove = require('../src/bot/events/guildMemberRemove');
    const calls = [];
    const services = {
      policy: { shouldTrackMember: () => true },
      invites: { trackMemberLeave: async () => { calls.push('trackMemberLeave'); return { result: { applied: true } }; } },
      inviteLogs: { handleBotLeave: async () => { calls.push('handleBotLeave'); } },
    };

    await guildMemberRemove.execute(mockDiscordMember({ id: 'm1', guildId: 'g', username: 'Alice', bot: false }), { services });

    assert.deepStrictEqual(calls, ['trackMemberLeave']);
  });

  suite.test('guildMemberAdd: bot with no inviteLogs service still never enters invite tracking', async () => {
    const guildMemberAdd = require('../src/bot/events/guildMemberAdd');
    const calls = [];
    const services = {
      policy: { shouldTrackMember: () => true },
      invites: { trackMemberJoin: async () => { calls.push('trackMemberJoin'); return { result: { applied: true } }; } },
    };

    await guildMemberAdd.execute(mockDiscordMember({ id: 'bot1', guildId: 'g', username: 'SomeBot', bot: true }), { services });

    assert.deepStrictEqual(calls, [], 'bot must not be tracked without an invite-logs service either');
  });

  return suite.run();
}

module.exports = { runInviteLogTests };

if (require.main === module) {
  runInviteLogTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
