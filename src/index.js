const config = require('./config');
const client = require('./bot/client');
const { loadBot } = require('./bot/handler');
const { createApplication } = require('./app/createApplication');

let application = null;
let shuttingDown = false;

async function bootstrap() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('             🍡  MOCHI DISCORD BOT & DASHBOARD  🍡          ');
  console.log('═══════════════════════════════════════════════════════════');

  application = await createApplication({ config, client });
  const { services, dashboard, logger, pluginManager, jobManager } = application;

  // Event handlers and commands resolve their dependencies through this client reference.
  client.services = services;

  await loadBot(client, application.contributions);

  await pluginManager.startAll();
  await jobManager.start({ client, services, config });

  await dashboard.start(config.dashboard.port);

  // Connect to Discord when credentials exist; production treats login failure as fatal.
  if (config.bot.token) {
    try {
      logger.info('bot', 'login', 'Connecting to Discord Gateway...');
      await client.login(config.bot.token);
    } catch (err) {
      logger.error('bot', 'login', 'Failed to log in to Discord Gateway', { error: err });
      if (config.app.isProduction) {
        throw err;
      }
      logger.warn('bot', 'login', 'Continuing in development mode without a live Discord connection.');
    }
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const logger = application?.logger || console;
  logger.info?.('app', 'shutdown', `Received ${signal}; shutting down.`);

  const failures = [];
  const attempt = async (label, operation) => {
    try { await operation(); }
    catch (error) {
      failures.push({ label, error });
      logger.error?.('app', 'shutdown', `${label} cleanup failed.`, { error });
    }
  };

  await attempt('plugins', async () => {
    await application?.jobManager?.stop?.({ client, services: application?.services, config });
    const errors = await application?.pluginManager?.stopAll?.();
    if (errors?.length) failures.push(...errors.map((entry) => ({ label: `plugin:${entry.pluginId}`, error: entry.error })));
  });
  await attempt('bot listeners', async () => {
    require('./bot/handler').detachBot(client);
  });
  await attempt('presence', async () => {
    if (client.mochiPresenceInterval) clearInterval(client.mochiPresenceInterval);
  });
  await attempt('Discord client', async () => {
    if (client.isReady?.()) client.destroy();
  });
  await attempt('dashboard', async () => application?.dashboard?.stop?.());
  await attempt('database', async () => application?.db?.close?.());
  if (failures.length > 0) process.exitCode = 1;
  process.exit();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

bootstrap().catch(err => {
  console.error('[Fatal] Bootstrap failed:', err);
  process.exit(1);
});
