const { createDatabase } = require('../database/createDatabase');
const { runMigrations } = require('../database/migrations');
const { createEventBus } = require('./eventBus');
const { createLogger } = require('./logger');
const { createServices } = require('./createServices');
const { resolveDatabasePath } = require('../config');
const DashboardServer = require('../dashboard/server');

/**
 * Composition root. Builds config, database (migrated), event bus, services,
 * demo seed (demo mode only), and the dashboard. index.js stays a thin
 * bootstrap that only wires the Discord client and starts everything.
 *
 * @param {{ config?: object, client?: object, overrides?: object }} options
 */
async function createApplication({ config, client = null, overrides = {} } = {}) {
  const logger = overrides.logger || createLogger();
  const eventBus = overrides.eventBus || createEventBus();
  const resolvedClient = overrides.client ?? client;

  const dbPath = resolveDatabasePath(config);
  const db = overrides.db || createDatabase({ path: dbPath });
  if (!overrides.skipMigrations) {
    runMigrations(db);
  }

  const services = overrides.services || createServices({ config, db, eventBus, client: resolvedClient, logger });

  if (config.app.isDemo && !overrides.skipDemoSeed) {
    const { seedDemoData } = require('../demo/seedDemoData');
    seedDemoData({
      inviteRepository: services.inviteRepository,
      guildRepository: services.guildRepository,
      logger,
    });
  }

  const dashboard = new DashboardServer({ client: resolvedClient, services, config, logger });

  return { config, db, logger, eventBus, services, dashboard };
}

module.exports = { createApplication };
