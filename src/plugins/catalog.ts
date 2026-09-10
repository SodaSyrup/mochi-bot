const { discoverPluginCatalog } = require('./core/pluginLoader');

/** Compatibility export for older callers; discovery remains manifest-driven. */
module.exports = Object.freeze(discoverPluginCatalog());
