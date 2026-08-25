export interface PluginErrorOptions {
  pluginId?: string | null;
  code?: string;
  cause?: unknown;
}

export class PluginError extends Error {
  readonly code: string;
  readonly pluginId: string | null;

  constructor(message: string, { pluginId = null, code = 'PLUGIN_ERROR', cause = null }: PluginErrorOptions = {}) {
    super(pluginId ? `${message} (plugin: ${pluginId})` : message);
    this.name = this.constructor.name;
    this.code = code;
    this.pluginId = pluginId;
    if (cause) this.cause = cause;
  }
}

export class PluginValidationError extends PluginError {
  constructor(message: string, options: PluginErrorOptions = {}) { super(message, { ...options, code: 'PLUGIN_VALIDATION' }); }
}

export class PluginDependencyError extends PluginError {
  constructor(message: string, options: PluginErrorOptions = {}) { super(message, { ...options, code: 'PLUGIN_DEPENDENCY' }); }
}

export class PluginRegistrationError extends PluginError {
  constructor(message: string, options: PluginErrorOptions = {}) { super(message, { ...options, code: 'PLUGIN_REGISTRATION' }); }
}

export class PluginLifecycleError extends PluginError {
  constructor(message: string, options: PluginErrorOptions = {}) { super(message, { ...options, code: 'PLUGIN_LIFECYCLE' }); }
}
