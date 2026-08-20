const { buildConfig } = require('../../src/config');
const { createDatabase } = require('../../src/database/createDatabase');
const { createApplication } = require('../../src/app/createApplication');

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
async function startTestServer({ mode = 'demo', seed = true, client = null, env = {}, services = null } = {}) {
  const config = buildConfig({ ...process.env, APP_MODE: mode, PORT: '0', ...env });
  const db = createDatabase({ path: ':memory:' });
  const { dashboard, services: composedServices } = await createApplication({
    config,
    overrides: {
      db,
      logger: silentLogger,
      skipDemoSeed: !seed,
      client,
      services,
    },
  });
  const server = await dashboard.start(0);
  const baseUrl = `http://localhost:${server.address().port}`;
  return { config, services: composedServices, db, dashboard, server, baseUrl };
}

/**
 * Perform a demo-mode login and return fetch options carrying the session.
 */
async function demoLogin(baseUrl) {
  const res = await fetch(`${baseUrl}/auth/login`, { redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('demo login did not set a session cookie');
  const cookie = setCookie.split(';')[0];
  return { headers: { Cookie: cookie } };
}

module.exports = { startTestServer, demoLogin, silentLogger };
