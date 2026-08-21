const { TestSuite, assert } = require('./helpers/harness');
const { buildConfig } = require('../src/config');

async function runConfigTests() {
  const suite = new TestSuite('Config & Application Modes');

  suite.test('development is the default mode', () => {
    const cfg = buildConfig({ APP_MODE: '' });
    assert.strictEqual(cfg.app.mode, 'development');
    assert.strictEqual(cfg.app.isDevelopment, true);
    assert.strictEqual(cfg.app.isDemo, false);
    assert.strictEqual(cfg.app.isProduction, false);
  });

  suite.test('invalid mode throws', () => {
    assert.throws(() => buildConfig({ APP_MODE: 'banana' }), /Invalid APP_MODE/);
  });

  suite.test('production fails startup when required config is missing', () => {
    assert.throws(() => buildConfig({ APP_MODE: 'production', DISCORD_TOKEN: '' }), /DISCORD_TOKEN/);
    assert.throws(
      () => buildConfig({
        APP_MODE: 'production',
        DISCORD_TOKEN: 't',
        CLIENT_ID: 'c',
        CLIENT_SECRET: 's',
        SESSION_SECRET: 'mochi_default_secret_please_change_in_production',
      }),
      /SESSION_SECRET/
    );
  });

  suite.test('production accepts complete config', () => {
    const cfg = buildConfig({
      APP_MODE: 'production',
      DISCORD_TOKEN: 't',
      CLIENT_ID: 'c',
      CLIENT_SECRET: 's',
      SESSION_SECRET: 'a-unique-secret',
      DASHBOARD_URL: 'https://mochi.example.com',
      REDIRECT_URI: 'https://mochi.example.com/auth/callback',
    });
    assert.strictEqual(cfg.app.isProduction, true);
    assert.strictEqual(cfg.dashboard.sessionSecret, 'a-unique-secret');
  });

  suite.test('development with missing secret uses a random ephemeral secret', () => {
    const cfg = buildConfig({ APP_MODE: 'development', SESSION_SECRET: '' });
    assert.ok(cfg.dashboard.sessionSecret.length >= 32);
    assert.notStrictEqual(cfg.dashboard.sessionSecret, 'mochi_default_secret_please_change_in_production');
  });

  suite.test('demo database path is isolated from the live path', () => {
    const cfg = buildConfig({ APP_MODE: 'demo' });
    assert.ok(cfg.database.demoPath.endsWith('mochi-demo.sqlite'));
  });

  suite.test('fake account threshold is validated and configurable', () => {
    assert.strictEqual(
      buildConfig({ APP_MODE: 'development', FAKE_ACCOUNT_THRESHOLD_DAYS: '14' }).inviteTracker.fakeAccountThresholdDays,
      14
    );
    assert.strictEqual(
      buildConfig({ APP_MODE: 'development', FAKE_ACCOUNT_THRESHOLD_DAYS: '0' }).inviteTracker.fakeAccountThresholdDays,
      0
    );
    assert.throws(
      () => buildConfig({ APP_MODE: 'development', FAKE_ACCOUNT_THRESHOLD_DAYS: 'not-a-number' }),
      /FAKE_ACCOUNT_THRESHOLD_DAYS must be an integer/
    );
    assert.throws(
      () => buildConfig({ APP_MODE: 'development', FAKE_ACCOUNT_THRESHOLD_DAYS: '366' }),
      /FAKE_ACCOUNT_THRESHOLD_DAYS must be an integer/
    );
  });

  suite.test('DEV_AUTH_BYPASS defaults to false and is explicit', () => {
    assert.strictEqual(buildConfig({ APP_MODE: 'development' }).app.devAuthBypass, false);
    assert.strictEqual(buildConfig({ APP_MODE: 'development', DEV_AUTH_BYPASS: 'true' }).app.devAuthBypass, true);
    assert.strictEqual(buildConfig({ APP_MODE: 'development', DEV_AUTH_BYPASS: 'false' }).auth.devAuthBypass, false);
  });

  suite.test('production refuses to start with DEV_AUTH_BYPASS=true', () => {
    assert.throws(
      () => buildConfig({
        APP_MODE: 'production',
        DISCORD_TOKEN: 't',
        CLIENT_ID: 'c',
        CLIENT_SECRET: 's',
        SESSION_SECRET: 'a-unique-secret',
        DEV_AUTH_BYPASS: 'true',
      }),
      /DEV_AUTH_BYPASS=.*forbidden in APP_MODE=production/i
    );
  });

  suite.test('demo does not inherit the development bypass flag as a bypass', () => {
    const cfg = buildConfig({ APP_MODE: 'demo', DEV_AUTH_BYPASS: 'true' });
    // Demo keeps its own auth path; the bypass is only meaningful in development.
    assert.strictEqual(cfg.app.isDevelopment, false);
    assert.strictEqual(cfg.app.isDemo, true);
  });

  suite.test('guild permission cache TTL defaults to 600s and is configurable', () => {
    assert.strictEqual(buildConfig({ APP_MODE: 'development' }).auth.permissionTtlSeconds, 600);
    assert.strictEqual(
      buildConfig({ APP_MODE: 'development', GUILD_PERMISSION_CACHE_TTL_SECONDS: '120' }).auth.permissionTtlSeconds,
      120
    );
  });

  suite.testAsync('production Socket.IO CORS is not a wildcard', async () => {
    const { EventEmitter } = require('events');
    const DashboardServer = require('../src/dashboard/server');
    const { silentLogger } = require('./helpers/server');

    const cfg = buildConfig({
      APP_MODE: 'production',
      DISCORD_TOKEN: 't',
      CLIENT_ID: 'c',
      CLIENT_SECRET: 's',
      SESSION_SECRET: 'a-unique-secret',
      DASHBOARD_URL: 'https://mochi.example.com',
      REDIRECT_URI: 'https://mochi.example.com/auth/callback',
      PORT: '0',
    });
    const dashboard = new DashboardServer({
      client: null,
      services: { eventBus: new EventEmitter(), guildAccess: {}, oauthClient: {} },
      config: cfg,
      logger: silentLogger,
    });
    const origin = dashboard.io.engine.opts.cors?.origin;
    assert.deepStrictEqual(origin, ['https://mochi.example.com']);
  });

  return suite.run();
}

module.exports = { runConfigTests };

if (require.main === module) {
  runConfigTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
