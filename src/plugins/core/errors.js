class PluginError extends Error {
  constructor(message, { pluginId = null, code = 'PLUGIN_ERROR', cause = null } = {}) {
    super(pluginId ? `${message} (plugin: ${pluginId})` : message);
    this.name = this.constructor.name;
    this.code = code;
    this.pluginId = pluginId;
    if (cause) this.cause = cause;
  }
}

class PluginValidationError extends PluginError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'PLUGIN_VALIDATION' });
  }
}

class PluginDependencyError extends PluginError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'PLUGIN_DEPENDENCY' });
  }
}

class PluginRegistrationError extends PluginError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'PLUGIN_REGISTRATION' });
  }
}

class PluginLifecycleError extends PluginError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'PLUGIN_LIFECYCLE' });
  }
}

module.exports = {
  PluginError,
  PluginValidationError,
  PluginDependencyError,
  PluginRegistrationError,
  PluginLifecycleError,
};
