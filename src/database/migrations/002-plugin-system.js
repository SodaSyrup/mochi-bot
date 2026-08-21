// Plugin migration metadata. Plugin-specific migrations are applied by
// src/plugins/core/pluginMigrationRunner.js and remain namespaced by plugin.
module.exports = {
  version: 2,
  name: 'plugin-system',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_schema_migrations (
        plugin_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (plugin_id, version)
      );
    `);
  },
};
