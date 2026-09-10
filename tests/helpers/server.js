const { buildConfig } = require('../../src/config');
const { createDatabase } = require('../../src/database/createDatabase');
const { createApplication } = require('../../src/app/createApplication');
const { DemoGuildGateway } = require('./demo/demoGuildGateway');
const { DemoInviteGateway } = require('./demo/demoInviteGateway');
const { DemoSafetyGateway } = require('./demo/demoSafetyGateway');
const { DemoInviteLogGateway } = require('./demo/demoInviteLogGateway');
const { DemoHoneypotGateway } = require('./demo/demoHoneypotGateway');
const { DemoPermissionGroupGateway } = require('./demo/demoPermissionGroupGateway');
const { seedDemoData } = require('./demo/seedDemoData');

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** Start an isolated integration-test application. */
async function startTestServer({ mode = 'development', seed = true, client = null, env = {}, services = null, gatewayOverrides = null } = {}) {
  // Keep integration tests isolated from local databases and credentials.
  // Individual tests can still opt into a value explicitly through `env`.
  const testEnv = {
    APP_MODE: mode,
    PORT: '0',
    DASHBOARD_URL: 'http://localhost:0',
    CLIENT_ID: '',
    CLIENT_SECRET: '',
    // Production-mode integration tests need a syntactically present token;
    // no helper ever connects a client to Discord.
    DISCORD_TOKEN: 'test-discord-token',
    SESSION_SECRET: 'test-session-secret',
    DATABASE_PATH: ':memory:',
    SESSION_STORE_PATH: ':memory:',
    GLOBAL_BANS_API_URL: '',
    GLOBAL_BANS_SYNC_TOKEN: '',
    GLOBAL_BANS_ADMIN_TOKEN: '',
    GLOBAL_BANS_ADMIN_USER_IDS: '',
    MOCHI_PLUGIN_PATHS: '',
    DISABLED_PLUGINS: '',
    DEV_AUTH_BYPASS: 'true',
    ...env,
  };
  const config = buildConfig(testEnv);
  const db = createDatabase({ path: ':memory:' });
  const testGateways = gatewayOverrides || (!client && !services ? {
    guild: new DemoGuildGateway(),
    invite: new DemoInviteGateway(),
    safety: new DemoSafetyGateway(),
    inviteLog: new DemoInviteLogGateway(),
    honeypot: new DemoHoneypotGateway(),
    permissionGroups: new DemoPermissionGroupGateway(),
  } : undefined);
  const { dashboard, services: composedServices } = await createApplication({
    config,
    overrides: {
      db,
      logger: silentLogger,
      client,
      services,
      gatewayOverrides: testGateways,
    },
  });
  if (seed && !services) {
    seedDemoData({
      inviteRepository: composedServices.inviteRepository,
      guildRepository: composedServices.guildRepository,
      logger: silentLogger,
    });
  }
  const server = await dashboard.start(0);
  const baseUrl = `http://localhost:${server.address().port}`;
  return { config, services: composedServices, db, dashboard, server, baseUrl };
}

/**
 * Perform an explicit development-bypass login and return fetch options
 * carrying the session.
 */
async function devLogin(baseUrl) {
  const res = await fetch(`${baseUrl}/auth/login`, { redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('development login did not set a session cookie');
  const cookie = setCookie.split(';')[0];
  return { headers: { Cookie: cookie } };
}

module.exports = { startTestServer, devLogin, silentLogger };
