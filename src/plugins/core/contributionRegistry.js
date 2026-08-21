const { PluginRegistrationError } = require('./errors');

function duplicate(kind, id, pluginId) {
  return new PluginRegistrationError(`Duplicate ${kind} contribution "${id}".`, { pluginId });
}

class ContributionRegistry {
  constructor({ baseServices = {}, serviceTarget = baseServices } = {}) {
    this.baseServices = baseServices;
    this.serviceTarget = serviceTarget;
    this.services = new Map();
    this.commands = [];
    this.discordEvents = [];
    this.dashboardApi = [];
    this.pages = [];
    this.realtime = [];
    this._ids = {
      dashboardApi: new Set(),
      pages: new Set(),
      realtime: new Set(),
    };
  }

  contextFor(plugin, baseContext = {}) {
    const pluginId = plugin.manifest.id;
    const scoped = (method) => (...args) => this[method](pluginId, ...args);
    return {
      ...baseContext,
      plugin,
      pluginId,
      services: {
        register: scoped('registerService'),
        get: (name) => this.getService(name),
        has: (name) => this.hasService(name),
      },
      commands: { register: scoped('registerCommand') },
      discordEvents: { register: scoped('registerDiscordEvent') },
      dashboardApi: { register: scoped('registerDashboardApi') },
      dashboardPages: { register: scoped('registerPage') },
      pages: { register: scoped('registerPage') },
      realtime: { register: scoped('registerRealtime') },
      contributions: this,
    };
  }

  registerService(pluginId, name, value) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new PluginRegistrationError('Service name must be a non-empty string.', { pluginId });
    }
    if (this.services.has(name)) throw duplicate('service', name, pluginId);
    if (Object.prototype.hasOwnProperty.call(this.baseServices, name) && this.baseServices[name] !== value) {
      throw new PluginRegistrationError(`Service "${name}" already belongs to core and cannot be replaced.`, { pluginId });
    }
    this.services.set(name, { name, value, pluginId });
    this.serviceTarget[name] = value;
    return value;
  }

  getService(name) {
    return this.services.get(name)?.value ?? this.baseServices[name];
  }

  hasService(name) {
    return this.services.has(name) || Object.prototype.hasOwnProperty.call(this.baseServices, name);
  }

  registerCommand(pluginId, command, metadata = {}) {
    if (!command || !command.data || typeof command.data.name !== 'string' || !command.data.name) {
      throw new PluginRegistrationError('Command data and command.data.name are required.', { pluginId });
    }
    if (typeof command.execute !== 'function') {
      throw new PluginRegistrationError(`Command "/${command.data.name}" must provide execute().`, { pluginId });
    }
    if (this.commands.some((entry) => entry.command.data.name === command.data.name)) {
      throw duplicate('command', command.data.name, pluginId);
    }
    this.commands.push({ command, pluginId, source: metadata.source || null, metadata: { ...metadata } });
  }

  registerDiscordEvent(pluginId, handler, metadata = {}) {
    if (!handler || typeof handler.name !== 'string' || !handler.name) {
      throw new PluginRegistrationError('Discord event handler name is required.', { pluginId });
    }
    if (typeof handler.execute !== 'function') {
      throw new PluginRegistrationError(`Discord event "${handler.name}" must provide execute().`, { pluginId });
    }
    this.discordEvents.push({ handler, pluginId, source: metadata.source || null, metadata: { ...metadata } });
  }

  registerDashboardApi(pluginId, contribution) {
    if (!contribution || typeof contribution !== 'object') {
      throw new PluginRegistrationError('Dashboard API contribution must be an object.', { pluginId });
    }
    const { id, mountPath = '/', install } = contribution;
    if (!id || typeof id !== 'string' || typeof install !== 'function') {
      throw new PluginRegistrationError('Dashboard API contributions require id and install(router, dependencies).', { pluginId });
    }
    if (this._ids.dashboardApi.has(id)) throw duplicate('dashboard API', id, pluginId);
    this._ids.dashboardApi.add(id);
    this.dashboardApi.push({ ...contribution, mountPath, pluginId });
  }

  registerPage(pluginId, page) {
    if (!page || typeof page !== 'object' || typeof page.id !== 'string' || typeof page.path !== 'string' || typeof page.file !== 'string') {
      throw new PluginRegistrationError('Dashboard pages require id, path, and file.', { pluginId });
    }
    if (this._ids.pages.has(page.id)) throw duplicate('dashboard page', page.id, pluginId);
    if (this.pages.some((entry) => entry.path === page.path)) {
      throw new PluginRegistrationError(`Duplicate dashboard page path "${page.path}".`, { pluginId });
    }
    this._ids.pages.add(page.id);
    this.pages.push({ ...page, pluginId });
  }

  registerRealtime(pluginId, contribution) {
    if (!contribution || typeof contribution !== 'object') {
      throw new PluginRegistrationError('Realtime contribution must be an object.', { pluginId });
    }
    const { id, applicationEvent, socketEvent, map } = contribution;
    if (!id || typeof id !== 'string' || !applicationEvent || typeof socketEvent !== 'string' || typeof map !== 'function') {
      throw new PluginRegistrationError('Realtime contributions require id, applicationEvent, socketEvent, and map().', { pluginId });
    }
    if (this._ids.realtime.has(id)) throw duplicate('realtime', id, pluginId);
    this._ids.realtime.add(id);
    this.realtime.push({ ...contribution, pluginId });
  }

  getCommandContributions() { return this.commands.slice(); }
  getCommandContribution(name) {
    return this.commands.find((entry) => entry.command.data.name === name) || null;
  }
  getDiscordEventContributions() { return this.discordEvents.slice(); }
  getDashboardApiContributions() { return this.dashboardApi.slice(); }
  getPageContributions() { return this.pages.slice(); }
  getRealtimeContributions() { return this.realtime.slice(); }

  syncCommands(client) {
    if (!client?.commands || typeof client.commands.set !== 'function') return;
    for (const { command } of this.commands) client.commands.set(command.data.name, command);
  }

  getCounts() {
    return {
      services: this.services.size,
      commands: this.commands.length,
      discordEvents: this.discordEvents.length,
      dashboardApi: this.dashboardApi.length,
      pages: this.pages.length,
      realtime: this.realtime.length,
    };
  }
}

module.exports = { ContributionRegistry };
