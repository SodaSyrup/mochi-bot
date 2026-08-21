const { validatePlugin } = require('./validatePlugin');
const { topologicalSort } = require('./topologicalSort');
const { ContributionRegistry } = require('./contributionRegistry');
const { runPluginMigrations } = require('./pluginMigrationRunner');
const {
  PluginValidationError,
  PluginDependencyError,
  PluginRegistrationError,
  PluginLifecycleError,
} = require('./errors');

const SUPPORTED_PLUGIN_API_VERSION = 1;

class PluginManager {
  constructor({ plugins = [], config = {}, logger = console, baseContext = {}, contributions = null } = {}) {
    this.catalog = plugins;
    this.config = config;
    this.logger = logger || console;
    this.baseContext = baseContext;
    this.contributions = contributions || new ContributionRegistry({
      baseServices: baseContext.services || {},
      serviceTarget: baseContext.services || {},
    });
    this.state = 'discovered';
    this.plugins = [];
    this.orderedPlugins = [];
    this.startedPlugins = [];
    this.pluginStates = new Map();
    this.migrationsRun = false;
    this.registrationContext = new Map();
  }

  #prepare() {
    if (this.state !== 'discovered') return;

    const seen = new Set();
    const validated = [];
    for (const plugin of this.catalog) {
      const id = plugin?.manifest?.id || null;
      if (id && seen.has(id)) {
        throw new PluginValidationError(`Duplicate plugin ID "${id}" in the explicit catalog.`, { pluginId: id });
      }
      const checked = validatePlugin(plugin, { apiVersion: this.config.plugins?.apiVersion || SUPPORTED_PLUGIN_API_VERSION });
      if (seen.has(checked.manifest.id)) {
        throw new PluginValidationError(`Duplicate plugin ID "${checked.manifest.id}" in the explicit catalog.`, { pluginId: checked.manifest.id });
      }
      seen.add(checked.manifest.id);
      validated.push(checked);
    }

    const knownIds = new Set(validated.map((plugin) => plugin.manifest.id));
    const disabled = new Set(this.config.plugins?.disabled || []);
    for (const id of disabled) {
      if (!knownIds.has(id)) {
        throw new PluginValidationError(`Unknown disabled plugin ID "${id}".`, { pluginId: id });
      }
    }

    const enabled = validated.filter((plugin) => !disabled.has(plugin.manifest.id));
    const enabledIds = new Set(enabled.map((plugin) => plugin.manifest.id));
    for (const plugin of enabled) {
      for (const dependency of plugin.manifest.requires) {
        if (!knownIds.has(dependency)) {
          throw new PluginDependencyError(`Plugin "${plugin.manifest.id}" requires missing plugin "${dependency}".`, { pluginId: plugin.manifest.id });
        }
        if (!enabledIds.has(dependency)) {
          throw new PluginDependencyError(`Plugin "${plugin.manifest.id}" requires disabled plugin "${dependency}".`, { pluginId: plugin.manifest.id });
        }
      }
    }

    this.plugins = validated;
    this.orderedPlugins = topologicalSort(enabled);
    this.state = 'ordered';
    for (const plugin of validated) this.pluginStates.set(plugin.manifest.id, disabled.has(plugin.manifest.id) ? 'disabled' : 'validated');
    this.logger.info?.('plugins', 'catalog', 'Resolved plugin order', {
      enabled: this.orderedPlugins.map((plugin) => plugin.manifest.id),
      disabled: [...disabled],
    });
  }

  getEnabledPlugins() {
    this.#prepare();
    return this.orderedPlugins.slice();
  }

  getPlugin(id) {
    this.#prepare();
    return this.plugins.find((plugin) => plugin.manifest.id === id) || null;
  }

  getStatus() {
    this.#prepare();
    return {
      state: this.state,
      order: this.orderedPlugins.map((plugin) => plugin.manifest.id),
      plugins: this.plugins.map((plugin) => ({
        id: plugin.manifest.id,
        version: plugin.manifest.version,
        enabled: this.pluginStates.get(plugin.manifest.id) !== 'disabled',
        state: this.pluginStates.get(plugin.manifest.id),
        requires: [...plugin.manifest.requires],
      })),
      contributions: this.contributions.getCounts(),
    };
  }

  registerAll() {
    this.#prepare();
    if (this.state === 'registered' || this.state === 'started') return this.contributions;
    if (this.state === 'stopped') throw new PluginRegistrationError('Plugin manager is stopped and cannot register again.');
    if (this.state === 'failed') throw new PluginRegistrationError('Plugin manager is failed and cannot register again.');

    try {
      for (const plugin of this.orderedPlugins) {
        const context = this.contributions.contextFor(plugin, {
          ...this.baseContext,
          logger: this.logger,
          config: this.config,
          contributions: this.contributions,
          baseServices: this.baseContext.services || {},
        });
        this.registrationContext.set(plugin.manifest.id, context);
        plugin.register(context);
        this.pluginStates.set(plugin.manifest.id, 'registered');
        this.logger.info?.('plugins', plugin.manifest.id, 'Registered plugin', { version: plugin.manifest.version });
      }
      this.contributions.syncCommands(this.baseContext.client);
      this.state = 'registered';
      return this.contributions;
    } catch (error) {
      this.state = 'failed';
      if (error instanceof PluginRegistrationError) throw error;
      const pluginId = error.pluginId || [...this.registrationContext.keys()].at(-1) || null;
      throw new PluginRegistrationError('Plugin registration failed.', { pluginId, cause: error });
    }
  }

  runMigrations(db) {
    this.#prepare();
    if (this.migrationsRun) return 0;
    try {
      const applied = runPluginMigrations(db, this.orderedPlugins, { logger: this.logger });
      this.migrationsRun = true;
      return applied;
    } catch (error) {
      this.state = 'failed';
      throw error;
    }
  }

  async startAll() {
    this.#prepare();
    if (this.state === 'started') return this.startedPlugins.slice();
    if (this.state === 'stopped') throw new PluginLifecycleError('Plugin manager is stopped and cannot start again.');
    if (this.state === 'failed') throw new PluginLifecycleError('Plugin manager is failed and cannot start.');
    if (this.state !== 'registered') this.registerAll();

    try {
      for (const plugin of this.orderedPlugins) {
        if (typeof plugin.start === 'function') await plugin.start(this.registrationContext.get(plugin.manifest.id));
        this.startedPlugins.push(plugin);
        this.pluginStates.set(plugin.manifest.id, 'started');
        this.logger.info?.('plugins', plugin.manifest.id, 'Started plugin', { version: plugin.manifest.version });
      }
      this.state = 'started';
      return this.startedPlugins.slice();
    } catch (error) {
      const pluginId = error.pluginId || this.orderedPlugins[this.startedPlugins.length]?.manifest.id || null;
      this.state = 'failed';
      await this.#stopStartedPlugins();
      throw new PluginLifecycleError('Plugin startup failed.', { pluginId, cause: error });
    }
  }

  async #stopStartedPlugins() {
    const errors = [];
    for (const plugin of [...this.startedPlugins].reverse()) {
      try {
        if (typeof plugin.stop === 'function') await plugin.stop(this.registrationContext.get(plugin.manifest.id));
        this.pluginStates.set(plugin.manifest.id, 'stopped');
        this.logger.info?.('plugins', plugin.manifest.id, 'Stopped plugin', { version: plugin.manifest.version });
      } catch (error) {
        errors.push({ pluginId: plugin.manifest.id, error });
        this.logger.error?.('plugins', plugin.manifest.id, 'Plugin shutdown failed', { error });
      }
    }
    this.startedPlugins = [];
    return errors;
  }

  async stopAll() {
    if (this.state === 'stopped') return [];
    if (this.state === 'discovered') return [];
    const errors = await this.#stopStartedPlugins();
    if (this.state !== 'failed') this.state = 'stopped';
    return errors;
  }
}

module.exports = { PluginManager, SUPPORTED_PLUGIN_API_VERSION };
