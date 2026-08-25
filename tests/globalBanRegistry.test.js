const { TestSuite, assert } = require('./helpers/harness');
const { buildConfig } = require('../src/config');
const { isGlobalBanAdmin } = require('../src/dashboard/auth/requireGlobalBanAdmin');
const { validatePayload, validateUserId } = require('../src/dashboard/routes/globalBanRegistryRoutes');
const { CloudflareGlobalBanAdminClient } = require('../src/features/globalBans/infrastructure/cloudflareGlobalBanAdminClient');
const { GlobalBanRemoteError } = require('../src/features/globalBans/infrastructure/cloudflareGlobalBanClient');
const { GlobalBanRecommendationService } = require('../src/features/globalBans/application/globalBanRecommendationService');
const { DiscordGuildGateway } = require('../src/platform/discord/discordGuildGateway');

async function runGlobalBanRegistryTests() {
  const suite = new TestSuite('Global Ban Registry');

  suite.test('allowlist authorization is exact and fails closed', () => {
    const config = { globalBans: { adminToken: 'secret', adminUserIds: ['123456789'] } };
    assert.strictEqual(isGlobalBanAdmin({ id: '123456789' }, config), true);
    assert.strictEqual(isGlobalBanAdmin({ id: '1234567890' }, config), false);
    assert.strictEqual(isGlobalBanAdmin({ id: '123456789' }, { globalBans: { adminToken: '', adminUserIds: ['123456789'] } }), false);
    assert.strictEqual(isGlobalBanAdmin(null, config), false);
  });

  suite.test('registry payload validation normalizes dates and IDs', () => {
    assert.strictEqual(validateUserId('123456789'), '123456789');
    assert.throws(() => validateUserId('abc'), /valid Discord user ID/);
    const payload = validatePayload({ userId: '123456789', reasonCode: 'raid', publicReason: 'Confirmed raid', expiresAt: '2030-01-01T00:00:00Z' });
    assert.strictEqual(payload.expiresAt, '2030-01-01T00:00:00.000Z');
    assert.throws(() => validatePayload({ reasonCode: 'x', publicReason: 'no' }), /between 3 and 500/);
  });

  suite.testAsync('admin client keeps bearer token and operator headers server-side', async () => {
    let call;
    const client = new CloudflareGlobalBanAdminClient({
      baseUrl: 'https://worker.example',
      token: 'admin-secret',
      fetchImpl: async (url, options) => {
        call = { url, options };
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    await client.activateBan('123456789', { expectedVersion: 1 }, 'operator-1', 'idem-1');
    assert.strictEqual(call.url, 'https://worker.example/v1/admin/bans/123456789/activate');
    assert.strictEqual(call.options.headers.Authorization, 'Bearer admin-secret');
    assert.strictEqual(call.options.headers['X-Operator-Id'], 'operator-1');
    assert.strictEqual(call.options.headers['Idempotency-Key'], 'idem-1');
  });

  suite.testAsync('admin list supports a separate pending queue', async () => {
    let requestedUrl = '';
    const client = new CloudflareGlobalBanAdminClient({
      baseUrl: 'https://worker.example',
      token: 'admin-secret',
      fetchImpl: async (url) => {
        requestedUrl = url;
        return new Response(JSON.stringify({ success: true, records: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    await client.getBans({ excludeState: 'pending', limit: 50 });
    assert.ok(requestedUrl.includes('exclude_state=pending'));
  });

  suite.testAsync('recommendations compare local bans without mutating the registry', async () => {
    const calls = [];
    const service = new GlobalBanRecommendationService({
      guildService: {
        async getGuild() { return { guild: { id: 'guild-1', name: 'Review server' } }; },
        async listBans() {
          return {
            status: 'ok',
            bans: [
              { userId: '111111111', username: 'active-user', reason: 'raid' },
              { userId: '222222222', username: 'new-user', reason: 'spam' },
            ],
            nextCursor: '222222222',
            hasMore: true,
          };
        },
      },
      adminClient: {
        async getBan(userId) {
          calls.push(userId);
          if (userId === '111111111') return { record: { user_id: userId, state: 'active', version: 2 } };
          throw new GlobalBanRemoteError('Not found', { status: 404 });
        },
        async createBan() { throw new Error('must not mutate'); },
      },
    });
    const result = await service.list({ guildId: 'guild-1', limit: 25 });
    assert.strictEqual(result.guild.name, 'Review server');
    assert.strictEqual(result.registryAvailable, true);
    assert.strictEqual(result.recommendations[0].eligible, false);
    assert.strictEqual(result.recommendations[0].registryState, 'active');
    assert.strictEqual(result.recommendations[1].eligible, true);
    assert.deepStrictEqual(calls.sort(), ['111111111', '222222222']);
    assert.strictEqual(result.hasMore, true);
  });

  suite.testAsync('Discord gateway paginates bans and maps only safe user fields', async () => {
    let options;
    const guild = {
      bans: {
        async fetch(input) {
          options = input;
          return new Map([['333333333', {
            user: {
              id: '333333333',
              username: 'banned-user',
              globalName: 'Banned User',
              displayAvatarURL: () => 'https://cdn.example/avatar.png',
            },
            reason: 'abuse',
          }]]);
        },
      },
      members: { me: { permissions: { has: () => true } } },
    };
    const gateway = new DiscordGuildGateway({ client: { guilds: { cache: new Map([['guild-1', guild]]) } } });
    const result = await gateway.fetchBans('guild-1', { after: '222222222', limit: 1 });
    assert.strictEqual(options.after, '222222222');
    assert.strictEqual(options.limit, 1);
    assert.deepStrictEqual(result.bans[0], {
      userId: '333333333',
      username: 'banned-user',
      globalName: 'Banned User',
      avatarUrl: 'https://cdn.example/avatar.png',
      reason: 'abuse',
    });
  });

  return suite.run();
}

module.exports = { runGlobalBanRegistryTests };

if (require.main === module) runGlobalBanRegistryTests().then((failed) => { if (typeof test !== 'function') process.exit(failed ? 1 : 0); });
