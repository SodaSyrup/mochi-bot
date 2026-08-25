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

export interface ApplicationOverrides {
  logger?: any; eventBus?: any; client?: any; db?: any; services?: any; gatewayOverrides?: any;
  plugins?: any[]; pluginManager?: any; contributions?: any; sessionStore?: any; skipMigrations?: boolean;
}

export async function createApplication({ config, client = null, overrides = {} as ApplicationOverrides }: { config: any; client?: any; overrides?: ApplicationOverrides }): Promise<any> {
  const logger = overrides.logger || createLogger();
  const eventBus = overrides.eventBus || createEventBus();
  const resolvedClient = overrides.client ?? client;
  const dbPath = resolveDatabasePath(config);
  const db = overrides.db || createDatabase({ path: dbPath });
  if (!overrides.skipMigrations) runMigrations(db);
  const services = overrides.services || createServices({ config, db, eventBus, client: resolvedClient, logger, gatewayOverrides: overrides.gatewayOverrides, pluginCatalog: overrides.plugins || pluginCatalog });
  const contributions = overrides.contributions || new ContributionRegistry({ baseServices: services, serviceTarget: services });
  const pluginManager = overrides.pluginManager || new PluginManager({ plugins: overrides.plugins || pluginCatalog, config, logger, baseContext: { client: resolvedClient, services, db, eventBus }, contributions });
  pluginManager.getEnabledPlugins();
  if (!overrides.skipMigrations) pluginManager.runMigrations(db);
  pluginManager.registerAll();
  const dashboard = new DashboardServer({ client: resolvedClient, services, config, logger, sessionStore: overrides.sessionStore, contributions });
  return { config, db, logger, eventBus, services, dashboard, contributions, pluginManager };
}

