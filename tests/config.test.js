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

  suite.test('DEMO_MODE=true normalizes to demo', () => {
    const cfg = buildConfig({ APP_MODE: '', DEMO_MODE: 'true' });
    assert.strictEqual(cfg.app.mode, 'demo');
    assert.strictEqual(cfg.app.isDemo, true);
  });

  suite.test('explicit APP_MODE wins over DEMO_MODE', () => {
    const cfg = buildConfig({ APP_MODE: 'development', DEMO_MODE: 'true' });
    assert.strictEqual(cfg.app.mode, 'development');
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
