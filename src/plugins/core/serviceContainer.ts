import type { PluginLogger, ServiceFactoryContext, ServiceProvider } from '../api';
import { PluginRegistrationError } from './errors';

interface RegisteredProvider {
  pluginId: string;
  provider: ServiceProvider;
}

/** Synchronous singleton container for plugin-provided services. */
export class ServiceContainer {
  private readonly providers = new Map<string, RegisteredProvider>();
  private readonly instances = new Map<string, unknown>();
  private readonly resolving: string[] = [];
  private sealed = false;

  constructor(
    private readonly context: {
      config: Record<string, unknown>;
      core: Record<string, unknown>;
      logger: PluginLogger;
    },
  ) {}

  register(pluginId: string, provider: ServiceProvider): void {
    if (this.sealed) throw new PluginRegistrationError('Service container is sealed; providers cannot be registered.', { pluginId });
    if (!provider || typeof provider.key !== 'string' || provider.key.trim() === '') {
      throw new PluginRegistrationError('Service providers require a non-empty key.', { pluginId });
    }
    if (typeof provider.create !== 'function') {
      throw new PluginRegistrationError(`Service provider "${provider.key}" requires create(context).`, { pluginId });
    }
    if (this.providers.has(provider.key)) {
      const owner = this.providers.get(provider.key)?.pluginId;
      throw new PluginRegistrationError(`Duplicate service provider "${provider.key}" already registered by ${owner}.`, { pluginId });
    }
    this.providers.set(provider.key, { pluginId, provider });
  }

  override(key: string, value: unknown): void {
    if (this.sealed) throw new Error('Service container is sealed; overrides are only available during composition.');
    this.instances.set(key, value);
  }

  has(key: string): boolean {
    return this.instances.has(key) || this.providers.has(key) || Object.prototype.hasOwnProperty.call(this.context.core, key);
  }

  get<T = unknown>(key: string): T {
    if (this.instances.has(key)) return this.instances.get(key) as T;
    if (Object.prototype.hasOwnProperty.call(this.context.core, key)) return this.context.core[key] as T;

    const registered = this.providers.get(key);
    if (!registered) throw new PluginRegistrationError(`Unknown service "${key}".`);
    if (this.resolving.includes(key)) {
      const cycle = [...this.resolving.slice(this.resolving.indexOf(key)), key].join(' -> ');
      throw new PluginRegistrationError(`Circular service dependency detected: ${cycle}.`, { pluginId: registered.pluginId });
    }

    this.resolving.push(key);
    try {
      const serviceContext: ServiceFactoryContext = {
        pluginId: registered.pluginId,
        config: this.context.config,
        services: { get: <U = unknown>(dependency: string) => this.get<U>(dependency), has: (dependency: string) => this.has(dependency) },
        core: this.context.core,
        logger: this.context.logger,
      };
      const value = registered.provider.create(serviceContext);
      if (value === undefined) throw new PluginRegistrationError(`Service provider "${key}" returned undefined.`, { pluginId: registered.pluginId });
      this.instances.set(key, value);
      return value as T;
    } catch (error) {
      if (error instanceof PluginRegistrationError) throw error;
      throw new PluginRegistrationError(`Service provider "${key}" failed to initialize.`, { pluginId: registered.pluginId, cause: error });
    } finally {
      this.resolving.pop();
    }
  }

  instantiateEager(): void {
    for (const [key, registered] of this.providers) if (registered.provider.eager) this.get(key);
  }

  getOwner(key: string): string | null { return this.providers.get(key)?.pluginId || null; }
  list(): Array<{ key: string; pluginId: string; eager: boolean; initialized: boolean }> {
    return [...this.providers].map(([key, registered]) => ({ key, pluginId: registered.pluginId, eager: registered.provider.eager === true, initialized: this.instances.has(key) }));
  }
  seal(): void { this.sealed = true; }
  isSealed(): boolean { return this.sealed; }
}
