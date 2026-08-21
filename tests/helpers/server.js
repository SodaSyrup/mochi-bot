const { buildConfig } = require('../../src/config');
const { createDatabase } = require('../../src/database/createDatabase');
const { createApplication } = require('../../src/app/createApplication');
const { DemoGuildGateway } = require('./demo/demoGuildGateway');
const { DemoInviteGateway } = require('./demo/demoInviteGateway');
const { DemoSafetyGateway } = require('./demo/demoSafetyGateway');
const { DemoInviteLogGateway } = require('./demo/demoInviteLogGateway');
const { DemoHoneypotGateway } = require('./demo/demoHoneypotGateway');
const { seedDemoData } = require('./demo/seedDemoData');

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Start a full application instance for integration tests using an isolated
 * in-memory database. Never touches data/mochi.sqlite.
 *
 * @param {{ mode?: string, seed?: boolean, client?: object, env?: object, services?: object }} options
 *   `env` overrides specific environment variables for the config (e.g. to
 *   force OAuth on/off regardless of the local .env).
 *   `services` replaces the composed services object entirely (used to inject
 *   fakes that fail in controlled ways).
 */
async function startTestServer({ mode = 'development', seed = true, client = null, env = {}, services = null, gatewayOverrides = null } = {}) {
  const testEnv = { CLIENT_ID: '', CLIENT_SECRET: '', DEV_AUTH_BYPASS: 'true', ...env };
  const config = buildConfig({ ...process.env, APP_MODE: mode, PORT: '0', ...testEnv });
  const db = createDatabase({ path: ':memory:' });
  const testGateways = gatewayOverrides || (!client && !services ? {
    guild: new DemoGuildGateway(),
    invite: new DemoInviteGateway(),
    safety: new DemoSafetyGateway(),
    inviteLog: new DemoInviteLogGateway(),
    honeypot: new DemoHoneypotGateway(),
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
