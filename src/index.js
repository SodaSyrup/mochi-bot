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
  const { services, dashboard, logger } = application;

  // Discord event handlers and commands resolve their dependencies through the
  // client reference set here. Handlers are thin adapters only.
  client.services = services;

  loadBot(client);

  await dashboard.start(config.dashboard.port);

  // Connect to Discord only when live credentials exist. Demo mode never
  // connects. Production MUST connect — a failure there is fatal.
  if (!config.app.isDemo && config.bot.token) {
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
  } else if (config.app.isDemo) {
    logger.info('bot', 'login', 'Running in explicit demo mode (no Discord connection).');
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const logger = application?.logger || console;
  logger.info?.('app', 'shutdown', `Received ${signal}; shutting down.`);

  try {
    if (client.mochiPresenceInterval) clearInterval(client.mochiPresenceInterval);
    if (client.isReady?.()) client.destroy();
    await application?.dashboard?.stop?.();
    application?.db?.close?.();
  } catch (error) {
    logger.error?.('app', 'shutdown', 'Shutdown encountered an error.', { error });
    process.exitCode = 1;
  }
  process.exit();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

bootstrap().catch(err => {
  console.error('[Fatal] Bootstrap failed:', err);
  process.exit(1);
});
