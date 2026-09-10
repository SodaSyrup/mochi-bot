/** Public contracts exposed to plugins. This module has no runtime dependencies. */

export type PluginId = string;

export type PluginLifecycleState = 'discovered' | 'ordered' | 'configured' | 'migrated' | 'registered' | 'started' | 'stopped' | 'failed';

export interface ServiceFactoryContext {
  pluginId: PluginId;
  config: Record<string, unknown>;
  services: { get<T = unknown>(key: string): T; has(key: string): boolean };
  core: Record<string, unknown>;
  logger: PluginLogger;
}

export interface ServiceProvider<T = unknown> {
  key: string;
  dependencies?: readonly string[];
  eager?: boolean;
  create: (context: ServiceFactoryContext) => T;
}

export interface PluginConfigDefinition<T = unknown> {
  defaults?: unknown;
  parse: (input: { env: Record<string, string | undefined>; configuredValue: unknown }) => T;
  public?: (value: T) => unknown;
}

export type HttpAccessPolicy =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'guild'; permission: 'view' | 'manage'; guildParam?: string; requirePluginEnabled?: boolean }
  | { kind: 'capability'; capability: string };

export interface DashboardNavigationContribution {
  section: string;
  label: string;
  icon: string;
  order?: number;
}

export interface DashboardAssetContribution {
  id: string;
  root: string;
  mountPath?: string;
}

export interface CapabilityContribution {
  id: string;
  resolve: (context: { user: unknown; session: unknown; config: unknown }) => boolean | Promise<boolean>;
}

export interface ManagedJobContribution {
  id: string;
  intervalMs?: number;
  start: (context: Record<string, unknown>) => void | Promise<void>;
  stop?: (context: Record<string, unknown>) => void | Promise<void>;
}

export interface PluginEventResult {
  stopPropagation?: boolean;
  [key: string]: unknown;
}

export function stopPropagation(): PluginEventResult {
  return Object.freeze({ stopPropagation: true });
}

export interface PluginManifest {
  id: PluginId;
  name: string;
  version: string;
  apiVersion: number;
  description?: string;
  requires?: readonly PluginId[];
  entry?: string;
  order?: number;
  defaultEnabled?: boolean;
  guildConfigurable?: boolean;
  capabilities?: readonly string[];
  [key: string]: unknown;
}

export interface PluginMigration {
  id?: string;
  name?: string;
  version?: number;
  description?: string;
  up: (db: unknown) => void | Promise<void>;
  [key: string]: unknown;
}

export interface PluginMigrationContext {
  db: unknown;
  plugin: MochiPlugin;
  logger: PluginLogger;
}

export interface PluginLogger {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  [key: string]: unknown;
}

export interface CommandContribution {
  data: { name: string; [key: string]: unknown };
  execute: (...args: any[]) => unknown;
  [key: string]: unknown;
}

export interface DiscordEventContribution {
  name: string;
  execute: (...args: any[]) => unknown;
  [key: string]: unknown;
}

export interface DashboardApiContribution {
  id: string;
  mountPath?: string;
  scope?: string;
  access?: HttpAccessPolicy;
  install: (router: unknown, dependencies?: unknown) => void;
  [key: string]: unknown;
}

export interface DashboardPageContribution {
  id: string;
  path: string;
  file?: string;
  render?: (request: unknown, response: unknown) => void;
  assets?: DashboardAssetContribution;
  navigation?: DashboardNavigationContribution;
  access?: HttpAccessPolicy;
  [key: string]: unknown;
}

export interface RealtimeContribution {
  id: string;
  applicationEvent: string;
  socketEvent: string;
  map: (...args: any[]) => unknown;
  [key: string]: unknown;
}

export interface PluginContext<BaseServices extends Record<string, any> = Record<string, any>> {
  plugin: MochiPlugin;
  pluginId: PluginId;
  config: Record<string, any>;
  client: unknown;
  baseServices: BaseServices;
  services: {
    register: (name: string, value: unknown) => unknown;
    provide?: (provider: ServiceProvider) => void;
    get: <T = unknown>(name: string) => T | undefined;
    has: (name: string) => boolean;
  };
  commands: { register: (command: CommandContribution, metadata?: Record<string, unknown>) => void };
  discordEvents: { register: (handler: DiscordEventContribution, metadata?: Record<string, unknown>) => void };
  dashboardApi: { register: (contribution: DashboardApiContribution) => void };
  dashboardPages: { register: (page: DashboardPageContribution) => void };
  pages: { register: (page: DashboardPageContribution) => void };
  assets: { register: (asset: DashboardAssetContribution) => void };
  realtime: { register: (contribution: RealtimeContribution) => void };
  capabilities?: { register: (contribution: CapabilityContribution) => void };
  jobs?: { register: (contribution: ManagedJobContribution) => void };
  contributions: PluginContributionRegistry;
  [key: string]: unknown;
}

export interface PluginContributionRegistry {
  registerService(pluginId: PluginId, name: string, value: unknown): unknown;
  registerCommand(pluginId: PluginId, command: CommandContribution, metadata?: Record<string, unknown>): void;
  registerDiscordEvent(pluginId: PluginId, handler: DiscordEventContribution, metadata?: Record<string, unknown>): void;
  registerDashboardApi(pluginId: PluginId, contribution: DashboardApiContribution): void;
  registerPage(pluginId: PluginId, page: DashboardPageContribution): void;
  registerAsset?(pluginId: PluginId, asset: DashboardAssetContribution): void;
  registerRealtime(pluginId: PluginId, contribution: RealtimeContribution): void;
  registerServiceProvider?(pluginId: PluginId, provider: ServiceProvider): void;
  registerCapability?(pluginId: PluginId, contribution: CapabilityContribution): void;
  registerJob?(pluginId: PluginId, contribution: ManagedJobContribution): void;
}

export interface MochiPlugin<BaseServices extends Record<string, any> = Record<string, any>> {
  manifest: PluginManifest;
  migrations?: readonly PluginMigration[];
  config?: PluginConfigDefinition;
  sourceRoot?: string;
  register: (context: PluginContext<BaseServices>) => void | Promise<void>;
  start?: (context: PluginContext<BaseServices>) => void | Promise<void>;
  stop?: (context: PluginContext<BaseServices>) => void | Promise<void>;
  [key: string]: unknown;
}
