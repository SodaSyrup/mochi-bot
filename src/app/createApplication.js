const { createDatabase } = require('../database/createDatabase');
const { runMigrations } = require('../database/migrations');
const { createEventBus } = require('./eventBus');
const { createLogger } = require('./logger');
const { createServices } = require('./createServices');
const { resolveDatabasePath } = require('../config');
const DashboardServer = require('../dashboard/server');
const pluginCatalog = require('../plugins/catalog');
const { ContributionRegistry } = require('../plugins/core/contributionRegistry');
const { PluginManager } = require('../plugins/core/pluginManager');

/**
 * Composition root. Builds config, database (migrated), event bus, services,
 * and the dashboard. index.js stays a thin
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

  const services = overrides.services || createServices({
    config,
    db,
    eventBus,
    client: resolvedClient,
    logger,
    gatewayOverrides: overrides.gatewayOverrides,
    pluginCatalog: overrides.plugins || pluginCatalog,
  });

  const contributions = overrides.contributions || new ContributionRegistry({
    baseServices: services,
    serviceTarget: services,
  });
  const pluginManager = overrides.pluginManager || new PluginManager({
    plugins: overrides.plugins || pluginCatalog,
    config,
    logger,
    baseContext: {
      client: resolvedClient,
      services,
      db,
      eventBus,
    },
    contributions,
  });
  pluginManager.getEnabledPlugins();
  if (!overrides.skipMigrations) pluginManager.runMigrations(db);
  pluginManager.registerAll();

  const dashboard = new DashboardServer({
    client: resolvedClient,
    services,
    config,
    logger,
    sessionStore: overrides.sessionStore,
    contributions,
  });

  return { config, db, logger, eventBus, services, dashboard, contributions, pluginManager };
}

module.exports = { createApplication };
