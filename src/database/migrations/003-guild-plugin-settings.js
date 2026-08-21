// Per-guild plugin switches. An absent row means the plugin is enabled for
// that guild by default, so adding this table never changes existing behavior.
module.exports = {
  version: 3,
  name: 'guild-plugin-settings',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS guild_plugin_settings (
        guild_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, plugin_id)
      );
      CREATE INDEX IF NOT EXISTS idx_guild_plugin_settings_plugin
        ON guild_plugin_settings (plugin_id);
    `);
  },
};
