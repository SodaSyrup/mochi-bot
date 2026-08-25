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
