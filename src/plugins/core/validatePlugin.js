const { PluginValidationError } = require('./errors');

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireNonEmptyString(value, field, pluginId = null) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PluginValidationError(`${field} is required and must be a non-empty string.`, { pluginId });
  }
}

function validatePlugin(plugin, { apiVersion = 1 } = {}) {
  if (!isPlainObject(plugin)) {
    throw new PluginValidationError('Plugin must be a plain object.');
  }

  const manifest = plugin.manifest;
  if (!isPlainObject(manifest)) {
    throw new PluginValidationError('manifest is required and must be a plain object.');
  }

  const pluginId = manifest.id;
  requireNonEmptyString(pluginId, 'manifest.id', pluginId || null);
  if (!PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new PluginValidationError(`manifest.id "${pluginId}" must match ${PLUGIN_ID_PATTERN}.`, { pluginId });
  }

  requireNonEmptyString(manifest.name, 'manifest.name', pluginId);
  requireNonEmptyString(manifest.version, 'manifest.version', pluginId);
  if (manifest.apiVersion !== apiVersion) {
    throw new PluginValidationError(
      `Plugin API version ${manifest.apiVersion} is not supported; expected ${apiVersion}.`,
      { pluginId }
    );
  }

  const requires = manifest.requires === undefined ? [] : manifest.requires;
  if (!Array.isArray(requires)) {
    throw new PluginValidationError('manifest.requires must be an array.', { pluginId });
  }
  const dependencies = new Set();
  for (const dependency of requires) {
    if (typeof dependency !== 'string' || !PLUGIN_ID_PATTERN.test(dependency)) {
      throw new PluginValidationError(`Dependency "${dependency}" is not a valid plugin ID.`, { pluginId });
    }
    if (dependencies.has(dependency)) {
      throw new PluginValidationError(`manifest.requires contains duplicate dependency "${dependency}".`, { pluginId });
    }
    if (dependency === pluginId) {
      throw new PluginValidationError('A plugin cannot depend on itself.', { pluginId });
    }
    dependencies.add(dependency);
  }

  if (typeof plugin.register !== 'function') {
    throw new PluginValidationError('register(context) is required and must be a function.', { pluginId });
  }
  if (plugin.start !== undefined && typeof plugin.start !== 'function') {
    throw new PluginValidationError('start(context), when present, must be a function.', { pluginId });
  }
  if (plugin.stop !== undefined && typeof plugin.stop !== 'function') {
    throw new PluginValidationError('stop(context), when present, must be a function.', { pluginId });
  }
  if (plugin.migrations !== undefined && !Array.isArray(plugin.migrations)) {
    throw new PluginValidationError('migrations, when present, must be an array.', { pluginId });
  }

  return Object.freeze({
    ...plugin,
    manifest: Object.freeze({ ...manifest, requires: Object.freeze([...requires]) }),
    migrations: Object.freeze([...(plugin.migrations || [])]),
  });
}

module.exports = { PLUGIN_ID_PATTERN, isPlainObject, validatePlugin };
