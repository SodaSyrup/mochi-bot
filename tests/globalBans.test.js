const { TestSuite, assert } = require('./helpers/harness');
const { createTestDb } = require('./helpers/db');
const { GlobalBanRepository } = require('../src/features/globalBans/infrastructure/globalBanRepository');
const { GlobalBanService, STOP_PROPAGATION } = require('../src/features/globalBans/application/globalBanService');
const { CloudflareGlobalBanClient } = require('../src/features/globalBans/infrastructure/cloudflareGlobalBanClient');

function makeRepository() {
  return new GlobalBanRepository(createTestDb());
}

function activeEvent(eventId = 1, userId = '123456789') {
  return {
    event_id: eventId,
    user_id: userId,
    action: 'activated',
    record_payload: {
      user_id: userId,
      state: 'active',
      reason_code: 'raid',
      public_reason: 'Confirmed raid account',
      activated_at: new Date().toISOString(),
      version: 2,
    },
  };
}

async function runGlobalBanTests() {
  const suite = new TestSuite('Global Bans');

  suite.test('applies change events transactionally and ignores duplicates', () => {
    const repository = makeRepository();
    const first = repository.applyEvent(activeEvent());
    const duplicate = repository.applyEvent(activeEvent());
    assert.strictEqual(first.applied, true);
    assert.strictEqual(duplicate.applied, false);
    assert.strictEqual(repository.getSyncState().cursor, 1);
    assert.strictEqual(repository.getCache('123456789').state, 'active');
  });

  suite.test('snapshot replacement removes omitted active records without losing state shape', () => {
    const repository = makeRepository();
    repository.applyEvent(activeEvent(1, '123456789'));
    repository.applyEvent(activeEvent(2, '987654321'));
    repository.replaceSnapshot([{ user_id: '123456789', state: 'active', reason_code: 'raid', version: 3 }], 3);
    assert.strictEqual(repository.getCache('123456789').state, 'active');
    assert.strictEqual(repository.getCache('987654321').state, 'revoked');
    assert.strictEqual(repository.getSyncState().cursor, 3);
  });

  suite.test('guild defaults are disabled and enforce settings enqueue active users', () => {
    const repository = makeRepository();
    repository.applyEvent(activeEvent());
    assert.strictEqual(repository.getGuildSettings('guild-a').mode, 'disabled');
    repository.setGuildSettings('guild-a', { mode: 'enforce' });
    assert.strictEqual(repository.enqueueForGuild('guild-a'), 1);
    assert.strictEqual(repository.getJobStats('guild-a')[0].count, 1);
  });

  suite.test('enforcement guard stops normal join processing only after a successful ban', async () => {
    const repository = makeRepository();
    repository.applyEvent(activeEvent());
    repository.setGuildSettings('guild-a', { mode: 'enforce' });
    repository.setSyncSuccess({ cursor: 1 });
    const calls = [];
    const service = new GlobalBanService({
      repository,
      config: { globalBans: { enforcementEnabled: true, maxCacheStalenessSeconds: 60 } },
      gateway: { async getPermissionStatus() { return { guildAvailable: true, banMembers: true }; }, async banUser(input) { calls.push(input); return { outcome: 'banned' }; }, async sendAlert() {} },
      sync: null,
      client: { guilds: { cache: new Map() } },
    });
    const result = await service.evaluateMember({ id: '123456789', guild: { id: 'guild-a' }, user: { username: 'bad-account' } });
    assert.strictEqual(result.outcome, 'banned');
    assert.strictEqual(result[STOP_PROPAGATION], true);
    assert.strictEqual(calls.length, 1);
  });

  suite.test('local exemptions prevent enforcement', async () => {
    const repository = makeRepository();
    repository.applyEvent(activeEvent());
    repository.setGuildSettings('guild-a', { mode: 'enforce' });
    repository.setSyncSuccess({ cursor: 1 });
    repository.setExemption('guild-a', '123456789', { reason: 'Local review', createdBy: 'moderator' });
    let called = false;
    const service = new GlobalBanService({ repository, config: { globalBans: { enforcementEnabled: true, maxCacheStalenessSeconds: 60 } }, gateway: { async banUser() { called = true; }, async sendAlert() {}, async getPermissionStatus() { return {}; } }, client: { guilds: { cache: new Map() } } });
    const result = await service.evaluateMember({ id: '123456789', guild: { id: 'guild-a' }, user: {} });
    assert.strictEqual(result.outcome, 'exempt');
    assert.strictEqual(called, false);
  });

  suite.test('expired exemptions are ignored and deleting one requeues enforcement', () => {
    const repository = makeRepository();
    repository.applyEvent(activeEvent());
    repository.setGuildSettings('guild-a', { mode: 'enforce' });
    repository.setExemption('guild-a', '123456789', { reason: 'Temporary', expiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.strictEqual(repository.getExemption('guild-a', '123456789'), null);
    repository.enqueue({ guildId: 'guild-a', userId: '123456789', sourceEventId: 1, action: 'ban' });
    const job = repository.claimDueJobs(1)[0];
    assert.ok(job.lease_token);
    assert.strictEqual(repository.completeJob(job, { outcome: 'skipped' }), true);
    repository.deleteExemption('guild-a', '123456789');
    repository.enqueueForGuild('guild-a', 0, { force: true });
    assert.strictEqual(repository.getJobStats('guild-a').find((row) => row.status === 'pending').count, 1);
  });

  suite.test('expired running jobs are recovered with a retryable lease', () => {
    const repository = makeRepository();
    repository.enqueue({ guildId: 'guild-a', userId: '123456789', sourceEventId: 1, action: 'ban' });
    const claimed = repository.claimDueJobs(1, { leaseSeconds: 1 })[0];
    repository.db.prepare("UPDATE global_ban_enforcement_jobs SET lease_expires_at = datetime('now', '-1 second') WHERE id = ?").run(claimed.id);
    repository.recoverExpiredJobs();
    assert.strictEqual(repository.db.prepare('SELECT status, last_error_code FROM global_ban_enforcement_jobs WHERE id = ?').get(claimed.id).status, 'failed');
    assert.strictEqual(repository.claimDueJobs(1).length, 1);
  });

  suite.test('terminal retry exhaustion remains visible as dead', () => {
    const repository = makeRepository();
    repository.enqueue({ guildId: 'guild-a', userId: '123456789', sourceEventId: 1, action: 'ban' });
    const job = repository.claimDueJobs(1)[0];
    repository.completeJob(job, { outcome: 'guild_unavailable', terminal: true });
    assert.strictEqual(repository.getJobStats('guild-a').find((row) => row.status === 'dead').count, 1);
  });

  suite.test('alert mode sends a join alert with the member identity and does not ban automatically', async () => {
    const repository = makeRepository();
    repository.applyEvent(activeEvent());
    repository.setGuildSettings('guild-a', { mode: 'alert', logChannelId: 'alerts' });
    repository.setSyncSuccess({ cursor: 1 });
    const alerts = [];
    let banned = false;
    const service = new GlobalBanService({
      repository,
      config: { globalBans: { enforcementEnabled: true, maxCacheStalenessSeconds: 60 } },
      gateway: {
        async sendAlert(input) { alerts.push(input); },
        async banUser() { banned = true; return { outcome: 'banned' }; },
      },
      sync: null,
      client: { guilds: { cache: new Map() } },
    });

    const result = await service.evaluateMember({
      id: '123456789',
      guild: { id: 'guild-a' },
      user: {
        username: 'bad-account',
        globalName: 'Bad Account',
        displayAvatarURL: () => 'https://cdn.example/avatar.png',
      },
    });

    assert.strictEqual(result.outcome, 'alerted');
    assert.strictEqual(banned, false);
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].username, 'bad-account');
    assert.strictEqual(alerts[0].globalName, 'Bad Account');
    assert.strictEqual(alerts[0].avatarUrl, 'https://cdn.example/avatar.png');
  });

  suite.test('revocations cancel jobs without creating alert jobs', async () => {
    const repository = makeRepository();
    repository.applyEvent(activeEvent());
    repository.setGuildSettings('guild-a', { mode: 'alert', logChannelId: 'alerts' });
    const service = new GlobalBanService({
      repository,
      config: { globalBans: { enforcementEnabled: true } },
      gateway: { async sendAlert() {} },
      sync: null,
      client: { guilds: { cache: new Map([['guild-a', { id: 'guild-a' }]]) } },
    });

    await service.onSyncEvent({ state: repository.getCache('123456789') }, activeEvent());
    repository.applyEvent({
      event_id: 2,
      user_id: '123456789',
      action: 'revoked',
      record_payload: { user_id: '123456789', state: 'revoked', version: 3 },
    });
    await service.onSyncEvent({ state: repository.getCache('123456789') }, {
      event_id: 2,
      user_id: '123456789',
      action: 'revoked',
    });

    assert.strictEqual(repository.getJobStats('guild-a').length, 0);
  });

  suite.test('legacy revocation jobs are drained without sending a message', async () => {
    const repository = makeRepository();
    repository.applyEvent(activeEvent());
    repository.setGuildSettings('guild-a', { mode: 'alert', logChannelId: 'alerts' });
    repository.enqueue({ guildId: 'guild-a', userId: '123456789', sourceEventId: 1, action: 'revocation_notice' });
    let alerted = false;
    const service = new GlobalBanService({
      repository,
      config: { globalBans: { enforcementEnabled: true, guildConcurrency: 1 } },
      gateway: { async sendAlert() { alerted = true; } },
      sync: null,
      client: { guilds: { cache: new Map() } },
    });
    service.workerRunning = true;
    await service.processJobs();

    assert.strictEqual(alerted, false);
    assert.strictEqual(repository.getRecentEvents('guild-a')[0].details_code, 'UNSUPPORTED_ACTION');
  });

  suite.test('alert button revalidates policy, bans by ID, and records the moderator', async () => {
    const repository = makeRepository();
    repository.applyEvent(activeEvent());
    repository.setGuildSettings('guild-a', { mode: 'alert', deleteMessageSeconds: 60 });
    repository.setSyncSuccess({ cursor: 1 });
    const calls = [];
    const service = new GlobalBanService({
      repository,
      config: { globalBans: { enforcementEnabled: true, maxCacheStalenessSeconds: 60 } },
      gateway: {
        async banUser(input) { calls.push(input); return { outcome: 'banned' }; },
      },
      sync: null,
      client: { guilds: { cache: new Map() } },
    });

    const result = await service.banFromAlert({ guildId: 'guild-a', userId: '123456789', moderatorId: '987654321' });
    const event = repository.getRecentEvents('guild-a')[0];
    assert.strictEqual(result.outcome, 'banned');
    assert.strictEqual(calls[0].userId, '123456789');
    assert.strictEqual(calls[0].deleteMessageSeconds, 60);
    assert.ok(calls[0].reason.includes('moderator=987654321'));
    assert.strictEqual(event.action, 'moderator_ban');
    assert.strictEqual(event.details_code, 'MODERATOR_987654321');
  });

  suite.test('alert button refuses a revoked entry and local exemption', async () => {
    const repository = makeRepository();
    repository.applyEvent(activeEvent());
    repository.setGuildSettings('guild-a', { mode: 'alert' });
    repository.setSyncSuccess({ cursor: 1 });
    const service = new GlobalBanService({
      repository,
      config: { globalBans: { enforcementEnabled: true, maxCacheStalenessSeconds: 60 } },
      gateway: { async banUser() { throw new Error('must not ban'); } },
      sync: null,
      client: { guilds: { cache: new Map() } },
    });

    repository.setExemption('guild-a', '123456789', { reason: 'Review', createdBy: 'mod' });
    assert.strictEqual((await service.banFromAlert({ guildId: 'guild-a', userId: '123456789', moderatorId: '987654321' })).outcome, 'exempt');
    repository.deleteExemption('guild-a', '123456789');
    repository.applyEvent({ event_id: 2, user_id: '123456789', action: 'revoked', record_payload: { user_id: '123456789', state: 'revoked', version: 3 } });
    assert.strictEqual((await service.banFromAlert({ guildId: 'guild-a', userId: '123456789', moderatorId: '987654321' })).outcome, 'not_listed');
  });

  suite.test('client uses bearer auth and bounded query parameters', async () => {
    const requests = [];
    const client = new CloudflareGlobalBanClient({ baseUrl: 'https://bans.example', token: 'secret', fetchImpl: async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify({ records: [], snapshotCursor: 0, hasMore: false }), { status: 200, headers: { 'content-type': 'application/json' } }); } });
    await client.getSnapshotPage({ limit: 9000 });
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(new URL(requests[0].url).searchParams.get('limit'), '1000');
    assert.strictEqual(requests[0].options.headers.Authorization, 'Bearer secret');
  });

  return suite.run();
}

runGlobalBanTests();
