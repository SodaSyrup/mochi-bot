const { TestSuite, assert } = require('./helpers/harness');
const { startTestServer, silentLogger } = require('./helpers/server');
const { SafetyService } = require('../src/features/safety/safetyService');
const { createTestDb, createRepos } = require('./helpers/db');
const { createEventBus } = require('../src/app/eventBus');
const { DEMO_GUILD_ID } = require('./helpers/demo/fixtures');
const {
  AppError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ExternalServiceError,
} = require('../src/dashboard/errors');

function makeService(gateway) {
  return new SafetyService({ safetyGateway: gateway, eventBus: createEventBus(), logger: silentLogger });
}

async function runSafetyTests() {
  const suite = new TestSuite('Safety Service Error Handling');

  suite.testAsync('NotFoundError stays NotFoundError (404) through updateSettings', async () => {
    const gateway = {
      async updateSafetySettings() {
        throw new NotFoundError('Guild is not available.');
      },
    };
    await assert.rejects(makeService(gateway).updateSettings('g', {}), (err) => err instanceof NotFoundError);
  });

  suite.testAsync('ValidationError is preserved (400), not wrapped as 502', async () => {
    const gateway = {
      async updateSafetySettings() {
        throw new ValidationError('Bad payload.');
      },
    };
    await assert.rejects(makeService(gateway).updateSettings('g', {}), (err) => err instanceof ValidationError);
  });

  suite.testAsync('ForbiddenError is preserved (403), not wrapped', async () => {
    const gateway = {
      async createAutoModRule() {
        throw new ForbiddenError('No permission.');
      },
    };
    await assert.rejects(makeService(gateway).createRule('g', {}), (err) => err instanceof ForbiddenError);
  });

  suite.testAsync('unexpected gateway failure becomes ExternalServiceError (502)', async () => {
    const gateway = {
      async updateSafetySettings() {
        throw new Error('Discord exploded.');
      },
    };
    await assert.rejects(makeService(gateway).updateSettings('g', {}), (err) => err instanceof ExternalServiceError);
  });

  suite.testAsync('gateway returning null maps to NotFoundError, not a wrapped 502', async () => {
    const gateway = {
      async getSafetyOverview() {
        return null;
      },
    };
    await assert.rejects(makeService(gateway).getOverview('g'), (err) => err instanceof NotFoundError);
  });

  suite.testAsync('HTTP layer maps NotFoundError -> 404 and external failure -> 502', async () => {
    const db = createTestDb();
    const { guilds } = createRepos(db);

    const notFoundGateway = {
      async getSafetyOverview() {
        return null; // triggers NotFoundError
      },
    };
    const ctx = await startTestServer({
      mode: 'development',
      seed: false,
      env: { CLIENT_ID: '', CLIENT_SECRET: '', DEV_AUTH_BYPASS: 'true' },
      services: {
        ...(await buildBaseServices(db, guilds)),
        safety: makeService(notFoundGateway),
      },
    });
    const auth = await devBypassLogin(ctx.baseUrl);

    const overview = await fetch(`${ctx.baseUrl}/api/guilds/${DEMO_GUILD_ID}/safety`, auth);
    assert.strictEqual(overview.status, 404);
    const body = await overview.json();
    assert.strictEqual(body.error.code, 'NOT_FOUND');

    await ctx.server.close();
  });

  suite.testAsync('unexpected external Discord failure surfaces as 502, not 500/404', async () => {
    const db = createTestDb();
    const { guilds } = createRepos(db);

    const explodingGateway = {
      async updateSafetySettings() {
        throw new Error('Discord API down');
      },
    };
    const ctx = await startTestServer({
      mode: 'development',
      seed: false,
      env: { CLIENT_ID: '', CLIENT_SECRET: '', DEV_AUTH_BYPASS: 'true' },
      services: {
        ...(await buildBaseServices(db, guilds)),
        safety: makeService(explodingGateway),
      },
    });
    const auth = await devBypassLogin(ctx.baseUrl);

    const res = await fetch(`${ctx.baseUrl}/api/guilds/${DEMO_GUILD_ID}/safety/settings`, {
      method: 'PATCH',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ verificationLevel: 2 }),
    });
    assert.strictEqual(res.status, 502);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'EXTERNAL_SERVICE');
    assert.ok(!body.error.message.includes('Discord API down'), 'external details must not leak raw');

    await ctx.server.close();
  });

  suite.testAsync('unknown errors map to 500 without a stack trace', async () => {
    const db = createTestDb();
    const { guilds } = createRepos(db);
    const boom = new Error('kaboom');
    boom.extraSecret = 'hidden';
    const ctx = await startTestServer({
      mode: 'development',
      seed: false,
      env: { CLIENT_ID: '', CLIENT_SECRET: '', DEV_AUTH_BYPASS: 'true' },
      services: {
        ...(await buildBaseServices(db, guilds)),
        safety: {
          async getOverview() {
            throw boom;
          },
        },
      },
    });
    const auth = await devBypassLogin(ctx.baseUrl);

    const res = await fetch(`${ctx.baseUrl}/api/guilds/${DEMO_GUILD_ID}/safety`, auth);
    assert.strictEqual(res.status, 500);
    const text = await res.text();
    assert.ok(!text.includes('kaboom'), 'internal error message must not leak');
    assert.ok(!text.includes('extraSecret'));

    await ctx.server.close();
  });

  suite.testAsync('service does NOT publish AutoModRuleUpdated after a mutation (Option A: Discord echo is authoritative)', async () => {
    const { createRecordingBus } = require('./helpers/fakes');
    const { SafetyEvents } = require('../src/app/eventBus');
    const bus = createRecordingBus();
    const gateway = {
      async createAutoModRule() {
        return { id: 'r1', guildId: 'g', name: 'X', enabled: true };
      },
      async editAutoModRule() {
        return { id: 'r1', guildId: 'g', name: 'Y', enabled: false };
      },
      async deleteAutoModRule() {
        return { ruleId: 'r1' };
      },
    };
    const service = new SafetyService({ safetyGateway: gateway, eventBus: bus, logger: silentLogger });

    await service.createRule('g', { name: 'X' });
    await service.updateRule('g', 'r1', { enabled: false });
    await service.deleteRule('g', 'r1');

    const ruleEvents = bus.recorded.filter((r) => r.event === SafetyEvents.AutoModRuleUpdated);
    assert.strictEqual(ruleEvents.length, 0, 'service must rely on the Discord echo, not publish a duplicate');
  });

  suite.testAsync('in-memory safety gateway publishes exactly one canonical event per mutation', async () => {
    const { createRecordingBus } = require('./helpers/fakes');
    const { SafetyEvents } = require('../src/app/eventBus');
    const { DemoSafetyGateway } = require('./helpers/demo/demoSafetyGateway');
    const bus = createRecordingBus();
    const gateway = new DemoSafetyGateway({ eventBus: bus });

    const created = await gateway.createAutoModRule(DEMO_GUILD_ID, { name: 'Test Rule', enabled: true });
    await gateway.editAutoModRule(DEMO_GUILD_ID, created.id, { enabled: false });

    const events = bus.recorded.filter((r) => r.event === SafetyEvents.AutoModRuleUpdated);
    assert.strictEqual(events.length, 2, 'one event per mutation, exactly');

    // Canonical flattened shape, not a nested rule object.
    const first = events[0].payload;
    assert.strictEqual(first.action, 'create');
    assert.strictEqual(first.ruleId, created.id);
    assert.strictEqual(first.name, 'Test Rule');
    assert.strictEqual(first.enabled, true);
    assert.strictEqual(first.guildId, DEMO_GUILD_ID);
    assert.ok(!('rule' in first), 'payload must be flattened, never nested rule');
  });

  return suite.run();
}

async function buildBaseServices(db, guilds) {
  const { createServices } = require('../src/app/createServices');
  const { buildConfig } = require('../src/config');
  const config = buildConfig({
    ...process.env,
    APP_MODE: 'development',
    PORT: '0',
    DEV_AUTH_BYPASS: 'true',
    CLIENT_ID: '',
    CLIENT_SECRET: '',
  });
  const services = createServices({
    config,
    db,
    eventBus: createEventBus(),
    client: {
      user: { username: 'MochiMock', tag: 'MochiMock#0000' },
      guilds: {
        cache: new Map([
          [DEMO_GUILD_ID, { id: DEMO_GUILD_ID, name: 'Safety Test Guild', memberCount: 10, ownerId: 'o1' }],
        ]),
      },
      isReady: () => true,
    },
    logger: silentLogger,
  });
  return services;
}

async function devBypassLogin(baseUrl) {
  const login = await fetch(`${baseUrl}/auth/login`, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('dev bypass login did not set a session cookie');
  return { headers: { Cookie: cookie } };
}

module.exports = { runSafetyTests };

if (require.main === module) {
  runSafetyTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
