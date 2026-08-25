const fs = require('fs');
const path = require('path');
const { STOP_PROPAGATION } = require('../features/globalBans/application/globalBanService');

/** Compatibility helper. Active runtime discovery is catalog-based. */
function getFiles(dir) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.isDirectory()) files = files.concat(getFiles(path.join(dir, item.name)));
    else if (item.name.endsWith('.js')) files.push(path.join(dir, item.name));
  }
  return files;
}

const CORE_EVENT_MODULES = [
  require('./events/ready'),
  require('./events/interactionCreate'),
  require('./events/guildCreate'),
  require('./events/guildDelete'),
];

function loggerFor(client, registry) {
  return registry?.baseContext?.logger || client.services?.logger || console;
}

function guildIdFromDiscordArguments(args) {
  for (const value of args) {
    if (!value || typeof value !== 'object') continue;
    if (value.guildId) return value.guildId;
    if (value.guild?.id) return value.guild.id;
  }
  return null;
}

function attachEvent(client, event, logger, pluginId = 'core') {
  const listener = (...args) => {
    const run = async () => {
      const guildId = guildIdFromDiscordArguments(args);
      const pluginSettings = client.services?.pluginSettings;
      if (pluginId !== 'core' && guildId && pluginSettings && !pluginSettings.isEnabled(guildId, pluginId)) return;
      await event.execute(...args, client);
    };
    run().catch((error) => logger.error?.('bot', event.name, 'Event handler failed', { pluginId, error }));
  };
  if (event.once) client.once(event.name, listener);
  else client.on(event.name, listener);
  return { eventName: event.name, listener, pluginId };
}

function attachCoreBotEvents(client, registry = null) {
  const logger = loggerFor(client, registry);
  return CORE_EVENT_MODULES.map((event) => attachEvent(client, event, logger));
}

function attachBotContributions(client, contributionRegistry) {
  if (!contributionRegistry) throw new Error('A contribution registry is required to attach plugin bot contributions.');
  const logger = loggerFor(client, contributionRegistry);
  contributionRegistry.syncCommands(client);
  const bindings = [];
  const contributions = contributionRegistry.getDiscordEventContributions();
  const grouped = new Map();
  for (const contribution of contributions) {
    const list = grouped.get(contribution.handler.name) || [];
    list.push(contribution);
    grouped.set(contribution.handler.name, list);
  }
  for (const [eventName, entries] of grouped) {
    const ordered = entries.slice().sort((a, b) => {
      const phaseOrder = { guard: 0, normal: 1, cleanup: 2 };
      return (phaseOrder[a.metadata?.phase] - phaseOrder[b.metadata?.phase]) ||
        ((a.metadata?.priority || 0) - (b.metadata?.priority || 0));
    });
    const listener = (...args) => {
      const run = async () => {
        let stopped = false;
        for (const entry of ordered) {
          if (stopped && entry.metadata?.phase !== 'cleanup') continue;
          const guildId = guildIdFromDiscordArguments(args);
          const settings = client.services?.pluginSettings;
          if (entry.metadata?.runWhenGuildPluginDisabled !== true && entry.pluginId !== 'core' && guildId && settings && !settings.isEnabled(guildId, entry.pluginId)) continue;
          const result = await entry.handler.execute(...args, client);
          if (result === STOP_PROPAGATION || result?.stopPropagation === true || result?.[STOP_PROPAGATION]) stopped = true;
        }
      };
      run().catch((error) => logger.error?.('bot', eventName, 'Event handler failed', { error }));
    };
    client.on(eventName, listener);
    bindings.push({ eventName, listener, pluginId: 'dispatcher' });
    logger.info?.('bot', eventName, 'Attached ordered plugin event dispatcher', { contributions: ordered.length });
  }
  return bindings;
}

function detachBotContributions(client, bindings = []) {
  for (const binding of bindings) client.off?.(binding.eventName, binding.listener);
}

/**
 * Core coordination events are explicit; feature events and commands must be
 * registered by the built-in catalog. The no-registry path is a compatibility
 * convenience for older embedders and still uses only the explicit catalog.
 */
function loadBot(client, contributionRegistry = null) {
  let registry = contributionRegistry;
  if (!registry) {
    const config = require('../config');
    const catalog = require('../plugins/catalog');
    const { ContributionRegistry } = require('../plugins/core/contributionRegistry');
    const { PluginManager } = require('../plugins/core/pluginManager');
    const services = client.services || {};
    registry = new ContributionRegistry({ baseServices: services, serviceTarget: services });
    const manager = new PluginManager({ plugins: catalog, config, logger: console, baseContext: { client, services }, contributions: registry });
    manager.registerAll();
  }
  const coreBindings = attachCoreBotEvents(client, registry);
  const pluginBindings = attachBotContributions(client, registry);
  client.pluginContributions = registry;
  client.mochiBotBindings = { coreBindings, pluginBindings, registry };
  console.log(`[Bot] Initialized ${client.commands?.size || 0} slash commands.`);
  return client.mochiBotBindings;
}

function detachBot(client) {
  const bindings = client?.mochiBotBindings;
  if (!bindings) return;
  detachBotContributions(client, [...bindings.coreBindings, ...bindings.pluginBindings]);
  client.mochiBotBindings = null;
  client.pluginContributions = null;
}

module.exports = {
  loadBot,
  getFiles,
  attachBotContributions,
  detachBotContributions,
  attachCoreBotEvents,
  detachBot,
};
