const pluginSystemMigration = require('../../database/migrations/002-plugin-system');
const { PluginLifecycleError, PluginValidationError } = require('./errors');

function validateMigrations(plugin) {
  const seen = new Set();
  for (const migration of plugin.migrations || []) {
    if (!migration || !Number.isInteger(migration.version) || migration.version <= 0) {
      throw new PluginValidationError('Plugin migration version must be a positive integer.', { pluginId: plugin.manifest.id });
    }
    if (seen.has(migration.version)) {
      throw new PluginValidationError(`Duplicate plugin migration version ${migration.version}.`, { pluginId: plugin.manifest.id });
    }
    if (typeof migration.name !== 'string' || migration.name.trim() === '') {
      throw new PluginValidationError(`Plugin migration ${migration.version} requires a name.`, { pluginId: plugin.manifest.id });
    }
    if (typeof migration.up !== 'function') {
      throw new PluginValidationError(`Plugin migration ${migration.version} requires up(db).`, { pluginId: plugin.manifest.id });
    }
    seen.add(migration.version);
  }
}

function ensurePluginMigrationTable(db) {
  // The application migration registry intentionally remains the immutable
  // baseline registry for compatibility with existing deployments. Migration
  // 002 owns this metadata table and is applied idempotently before any
  // namespaced plugin migration runs.
  pluginSystemMigration.up(db);
}

function runPluginMigrations(db, plugins, { logger = console, silent = false } = {}) {
  ensurePluginMigrationTable(db);
  let applied = 0;

  for (const plugin of plugins) {
    validateMigrations(plugin);
    const pending = (plugin.migrations || [])
      .slice()
      .sort((a, b) => a.version - b.version)
      .filter((migration) => !db.prepare(
        'SELECT 1 FROM plugin_schema_migrations WHERE plugin_id = ? AND version = ?'
      ).get(plugin.manifest.id, migration.version));

    for (const migration of pending) {
      try {
        const tx = db.transaction(() => {
          migration.up(db);
          db.prepare(
            'INSERT INTO plugin_schema_migrations (plugin_id, version, name) VALUES (?, ?, ?)'
          ).run(plugin.manifest.id, migration.version, migration.name);
        });
        tx();
      } catch (error) {
        throw new PluginLifecycleError(
          `Plugin migration ${migration.version} (${migration.name}) failed.`,
          { pluginId: plugin.manifest.id, cause: error }
        );
      }
      applied += 1;
      if (!silent) logger.info?.('plugins', plugin.manifest.id, 'Applied plugin migration', {
        version: migration.version,
        name: migration.name,
      });
    }
  }
  return applied;
}

module.exports = { runPluginMigrations, validateMigrations, ensurePluginMigrationTable };
