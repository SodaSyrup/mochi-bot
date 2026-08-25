import type {
  CommandContribution,
  DashboardApiContribution,
  DashboardPageContribution,
  DiscordEventContribution,
  MochiPlugin,
  PluginContributionRegistry,
  RealtimeContribution,
} from '../api';

const { PluginRegistrationError } = require('./errors');

function duplicate(kind: string, id: string, pluginId: string): Error {
  return new PluginRegistrationError(`Duplicate ${kind} contribution "${id}".`, { pluginId });
}

interface ContributionEntry<T> { pluginId: string; source?: string | null; metadata?: Record<string, unknown>; [key: string]: unknown; value?: T }

export class ContributionRegistry implements PluginContributionRegistry {
  readonly baseServices: Record<string, any>;
  readonly serviceTarget: Record<string, any>;
  readonly services = new Map<string, { name: string; value: unknown; pluginId: string }>();
  readonly commands: Array<ContributionEntry<CommandContribution> & { command: CommandContribution }> = [];
  readonly discordEvents: Array<ContributionEntry<DiscordEventContribution> & { handler: DiscordEventContribution }> = [];
  readonly dashboardApi: Array<ContributionEntry<DashboardApiContribution> & DashboardApiContribution> = [];
  readonly pages: Array<ContributionEntry<DashboardPageContribution> & DashboardPageContribution> = [];
  readonly realtime: Array<ContributionEntry<RealtimeContribution> & RealtimeContribution> = [];
  private readonly _ids = { dashboardApi: new Set<string>(), pages: new Set<string>(), realtime: new Set<string>() };

  constructor({ baseServices = {}, serviceTarget = baseServices }: { baseServices?: Record<string, any>; serviceTarget?: Record<string, any> } = {}) {
    this.baseServices = baseServices;
    this.serviceTarget = serviceTarget;
  }

  contextFor(plugin: MochiPlugin, baseContext: Record<string, any> = {}): Record<string, any> {
    const pluginId = plugin.manifest.id;
    const scoped = (method: keyof ContributionRegistry) => (...args: any[]) => (this[method] as (...values: any[]) => unknown)(pluginId, ...args);
    return {
      ...baseContext,
      plugin,
      pluginId,
      services: { register: scoped('registerService'), get: (name: string) => this.getService(name), has: (name: string) => this.hasService(name) },
      commands: { register: scoped('registerCommand') },
      discordEvents: { register: scoped('registerDiscordEvent') },
      dashboardApi: { register: scoped('registerDashboardApi') },
      dashboardPages: { register: scoped('registerPage') },
      pages: { register: scoped('registerPage') },
      realtime: { register: scoped('registerRealtime') },
      contributions: this,
    };
  }

  registerService(pluginId: string, name: string, value: unknown): unknown {
    if (typeof name !== 'string' || name.trim() === '') throw new PluginRegistrationError('Service name must be a non-empty string.', { pluginId });
    if (this.services.has(name)) throw duplicate('service', name, pluginId);
    if (Object.prototype.hasOwnProperty.call(this.baseServices, name) && this.baseServices[name] !== value) throw new PluginRegistrationError(`Service "${name}" already belongs to core and cannot be replaced.`, { pluginId });
    this.services.set(name, { name, value, pluginId });
    this.serviceTarget[name] = value;
    return value;
  }

  getService<T = unknown>(name: string): T | undefined { return (this.services.get(name)?.value ?? this.baseServices[name]) as T | undefined; }
  hasService(name: string): boolean { return this.services.has(name) || Object.prototype.hasOwnProperty.call(this.baseServices, name); }

  registerCommand(pluginId: string, command: CommandContribution, metadata: Record<string, any> = {}): void {
    if (!command || !command.data || typeof command.data.name !== 'string' || !command.data.name) throw new PluginRegistrationError('Command data and command.data.name are required.', { pluginId });
    if (typeof command.execute !== 'function') throw new PluginRegistrationError(`Command "/${command.data.name}" must provide execute().`, { pluginId });
    if (this.commands.some((entry) => entry.command.data.name === command.data.name)) throw duplicate('command', command.data.name, pluginId);
    this.commands.push({ command, pluginId, source: metadata.source || null, metadata: { ...metadata } });
  }

  registerDiscordEvent(pluginId: string, handler: DiscordEventContribution, metadata: Record<string, any> = {}): void {
    if (!handler || typeof handler.name !== 'string' || !handler.name) throw new PluginRegistrationError('Discord event handler name is required.', { pluginId });
    if (typeof handler.execute !== 'function') throw new PluginRegistrationError(`Discord event "${handler.name}" must provide execute().`, { pluginId });
    const phase = metadata.phase || 'normal';
    if (!['guard', 'normal', 'cleanup'].includes(phase)) throw new PluginRegistrationError(`Discord event "${handler.name}" has an invalid phase.`, { pluginId });
    const priority = Number.isInteger(metadata.priority) ? metadata.priority : 0;
    this.discordEvents.push({ handler, pluginId, source: metadata.source || null, metadata: { ...metadata, phase, priority } });
  }

  registerDashboardApi(pluginId: string, contribution: DashboardApiContribution): void {
    if (!contribution || typeof contribution !== 'object') throw new PluginRegistrationError('Dashboard API contribution must be an object.', { pluginId });
    const { id, mountPath = '/', install } = contribution;
    if (!id || typeof id !== 'string' || typeof install !== 'function') throw new PluginRegistrationError('Dashboard API contributions require id and install(router, dependencies).', { pluginId });
    if (this._ids.dashboardApi.has(id)) throw duplicate('dashboard API', id, pluginId);
    this._ids.dashboardApi.add(id);
    this.dashboardApi.push({ ...contribution, mountPath, pluginId });
  }

  registerPage(pluginId: string, page: DashboardPageContribution): void {
    if (!page || typeof page !== 'object' || typeof page.id !== 'string' || typeof page.path !== 'string' || typeof page.file !== 'string') throw new PluginRegistrationError('Dashboard pages require id, path, and file.', { pluginId });
    if (this._ids.pages.has(page.id)) throw duplicate('dashboard page', page.id, pluginId);
    if (this.pages.some((entry) => entry.path === page.path)) throw new PluginRegistrationError(`Duplicate dashboard page path "${page.path}".`, { pluginId });
    this._ids.pages.add(page.id);
    this.pages.push({ ...page, pluginId });
  }

  registerRealtime(pluginId: string, contribution: RealtimeContribution): void {
    if (!contribution || typeof contribution !== 'object') throw new PluginRegistrationError('Realtime contribution must be an object.', { pluginId });
    const { id, applicationEvent, socketEvent, map } = contribution;
    if (!id || typeof id !== 'string' || !applicationEvent || typeof socketEvent !== 'string' || typeof map !== 'function') throw new PluginRegistrationError('Realtime contributions require id, applicationEvent, socketEvent, and map().', { pluginId });
    if (this._ids.realtime.has(id)) throw duplicate('realtime', id, pluginId);
    this._ids.realtime.add(id);
    this.realtime.push({ ...contribution, pluginId });
  }

  getCommandContributions() { return this.commands.slice(); }
  getCommandContribution(name: string) { return this.commands.find((entry) => entry.command.data.name === name) || null; }
  getDiscordEventContributions() { return this.discordEvents.slice(); }
  getDashboardApiContributions() { return this.dashboardApi.slice(); }
  getPageContributions() { return this.pages.slice(); }
  getRealtimeContributions() { return this.realtime.slice(); }

  syncCommands(client: any): void {
    if (!client?.commands || typeof client.commands.set !== 'function') return;
    for (const { command } of this.commands) client.commands.set(command.data.name, command);
  }

  getCounts() { return { services: this.services.size, commands: this.commands.length, discordEvents: this.discordEvents.length, dashboardApi: this.dashboardApi.length, pages: this.pages.length, realtime: this.realtime.length }; }
}

