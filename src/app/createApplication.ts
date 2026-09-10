const { createDatabase } = require('../database/createDatabase');
const { runMigrations } = require('../database/migrations');
const { createEventBus } = require('./eventBus');
const { createLogger } = require('./logger');
const { createServices } = require('./createServices');
const { resolveDatabasePath } = require('../config');
const DashboardServer = require('../dashboard/server');
const { discoverPluginCatalog } = require('../plugins/core/pluginLoader');
const { ContributionRegistry } = require('../plugins/core/contributionRegistry');
const { PluginManager } = require('../plugins/core/pluginManager');
const { ServiceContainer } = require('../plugins/core/serviceContainer');
const { CapabilityRegistry } = require('../plugins/core/capabilityRegistry');
const { JobManager } = require('../plugins/core/jobManager');

export interface ApplicationOverrides {
  logger?: any; eventBus?: any; client?: any; db?: any; services?: any; gatewayOverrides?: any;
  plugins?: any[]; pluginManager?: any; contributions?: any; sessionStore?: any; skipMigrations?: boolean;
  serviceContainer?: any;
}

export async function createApplication({ config, client = null, overrides = {} as ApplicationOverrides }: { config: any; client?: any; overrides?: ApplicationOverrides }): Promise<any> {
  const logger = overrides.logger || createLogger();
  const eventBus = overrides.eventBus || createEventBus();
  const resolvedClient = overrides.client ?? client;
  const dbPath = resolveDatabasePath(config);
  const db = overrides.db || createDatabase({ path: dbPath });
  if (!overrides.skipMigrations) runMigrations(db);
  const pluginCatalog = overrides.plugins || discoverPluginCatalog({ configuredPaths: config.plugins?.paths || [] });
  const services = overrides.services || createServices({ config, db, eventBus, client: resolvedClient, logger, gatewayOverrides: overrides.gatewayOverrides, pluginCatalog });
  const serviceContainer = overrides.serviceContainer || new ServiceContainer({ config, core: services, logger });
  const contributions = overrides.contributions || new ContributionRegistry({ baseServices: services, serviceTarget: services });
  const pluginManager = overrides.pluginManager || new PluginManager({ plugins: pluginCatalog, config, logger, baseContext: { client: resolvedClient, services, serviceContainer, db, eventBus }, contributions });
  pluginManager.getEnabledPlugins();
  if (!overrides.skipMigrations) pluginManager.runMigrations(db);
  await pluginManager.registerAll();
  for (const contribution of contributions.getServiceProviders?.() || []) serviceContainer.register(contribution.pluginId, contribution.provider);
  serviceContainer.instantiateEager();
  serviceContainer.seal();
  const capabilities = new CapabilityRegistry(contributions.getCapabilityContributions?.() || [], config);
  const jobManager = new JobManager(contributions.getJobContributions?.() || [], logger);
  const dashboard = new DashboardServer({ client: resolvedClient, services, config, logger, sessionStore: overrides.sessionStore, contributions, capabilities });
  return { config, db, logger, eventBus, services, serviceContainer, capabilities, jobManager, dashboard, contributions, pluginManager };
}
