/** Public, versioned contracts exposed to third-party plugins.
 *
 * This module is intentionally type-only at runtime.  Plugin implementations
 * can import these contracts without importing the application composition
 * root, which keeps the extension boundary independent from core internals.
 */

export type PluginId = string;

export interface PluginManifest {
  id: PluginId;
  name: string;
  version: string;
  apiVersion: number;
  description?: string;
  requires?: readonly PluginId[];
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
  install: (router: unknown, dependencies?: unknown) => void;
  [key: string]: unknown;
}

export interface DashboardPageContribution {
  id: string;
  path: string;
  file: string;
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
    get: <T = unknown>(name: string) => T | undefined;
    has: (name: string) => boolean;
  };
  commands: { register: (command: CommandContribution, metadata?: Record<string, unknown>) => void };
  discordEvents: { register: (handler: DiscordEventContribution, metadata?: Record<string, unknown>) => void };
  dashboardApi: { register: (contribution: DashboardApiContribution) => void };
  dashboardPages: { register: (page: DashboardPageContribution) => void };
  pages: { register: (page: DashboardPageContribution) => void };
  realtime: { register: (contribution: RealtimeContribution) => void };
  contributions: PluginContributionRegistry;
  [key: string]: unknown;
}

export interface PluginContributionRegistry {
  registerService(pluginId: PluginId, name: string, value: unknown): unknown;
  registerCommand(pluginId: PluginId, command: CommandContribution, metadata?: Record<string, unknown>): void;
  registerDiscordEvent(pluginId: PluginId, handler: DiscordEventContribution, metadata?: Record<string, unknown>): void;
  registerDashboardApi(pluginId: PluginId, contribution: DashboardApiContribution): void;
  registerPage(pluginId: PluginId, page: DashboardPageContribution): void;
  registerRealtime(pluginId: PluginId, contribution: RealtimeContribution): void;
}

export interface MochiPlugin<BaseServices extends Record<string, any> = Record<string, any>> {
  manifest: PluginManifest;
  migrations?: readonly PluginMigration[];
  register: (context: PluginContext<BaseServices>) => void | Promise<void>;
  start?: (context: PluginContext<BaseServices>) => void | Promise<void>;
  stop?: (context: PluginContext<BaseServices>) => void | Promise<void>;
  [key: string]: unknown;
}
