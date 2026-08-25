const config = require('./config');
const client = require('./bot/client');
const { loadBot, detachBot } = require('./bot/handler');
const { createApplication } = require('./app/createApplication');

let application: any = null;
let shuttingDown = false;

async function bootstrap(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('             🍡  MOCHI DISCORD BOT & DASHBOARD  🍡          ');
  console.log('═══════════════════════════════════════════════════════════');

  application = await createApplication({ config, client });
  const { services, dashboard, logger, pluginManager } = application;
  client.services = services;
  loadBot(client, application.contributions);
  await pluginManager.startAll();
  await dashboard.start(config.dashboard.port);

  if (config.bot.token) {
    try {
      logger.info('bot', 'login', 'Connecting to Discord Gateway...');
      await client.login(config.bot.token);
    } catch (err) {
      logger.error('bot', 'login', 'Failed to log in to Discord Gateway', { error: err });
      if (config.app.isProduction) throw err;
      logger.warn('bot', 'login', 'Continuing in development mode without a live Discord connection.');
    }
  }
}

async function shutdown(signal: string): Promise<never> {
  if (shuttingDown) return process.exit();
  shuttingDown = true;
  const logger: { info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void } = application?.logger || console;
  logger.info?.('app', 'shutdown', `Received ${signal}; shutting down.`);
  const failures: Array<{ label: string; error: unknown }> = [];
  const attempt = async (label: string, operation: () => Promise<void> | void): Promise<void> => {
    try { await operation(); } catch (error) {
      failures.push({ label, error });
      logger.error?.('app', 'shutdown', `${label} cleanup failed.`, { error });
    }
  };

  await attempt('plugins', async () => {
    const errors = await application?.pluginManager?.stopAll?.();
    if (errors?.length) failures.push(...errors.map((entry: any) => ({ label: `plugin:${entry.pluginId}`, error: entry.error })));
  });
  await attempt('bot listeners', () => detachBot(client));
  await attempt('presence', () => {
    if (client.mochiPresenceInterval) clearInterval(client.mochiPresenceInterval);
  });
  await attempt('Discord client', () => {
    if (client.isReady?.()) client.destroy();
  });
  await attempt('dashboard', () => application?.dashboard?.stop?.());
  await attempt('database', () => application?.db?.close?.());
  if (failures.length > 0) process.exitCode = 1;
  process.exit();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

bootstrap().catch((err: unknown) => {
  console.error('[Fatal] Bootstrap failed:', err);
  process.exit(1);
});
