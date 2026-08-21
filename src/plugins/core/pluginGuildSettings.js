const { ConflictError, NotFoundError, ValidationError } = require('../../dashboard/errors');

/**
 * Persists per-guild plugin switches. Plugin loading remains process-wide;
 * this service is the guild-scoped capability check used by commands,
 * Discord adapters, dashboard feature routes, and realtime forwarding.
 */
class PluginGuildSettingsService {
  constructor({ db, plugins, globallyDisabled = [], logger = console }) {
    this.db = db;
    this.plugins = plugins.map((plugin) => plugin.manifest ? plugin : { manifest: plugin });
    this.byId = new Map(this.plugins.map((plugin) => [plugin.manifest.id, plugin]));
    this.globallyDisabled = new Set(globallyDisabled);
    this.logger = logger || console;
  }

  getPlugin(pluginId) {
    return this.byId.get(pluginId) || null;
  }

  isGloballyDisabled(pluginId) {
    return this.globallyDisabled.has(pluginId);
  }

  isEnabled(guildId, pluginId, visiting = new Set()) {
    if (!guildId) return true;
    if (this.isGloballyDisabled(pluginId)) return false;
    const plugin = this.getPlugin(pluginId);
    if (!plugin) return false;
    if (visiting.has(pluginId)) return false;
    const row = this.db.prepare(
      'SELECT enabled FROM guild_plugin_settings WHERE guild_id = ? AND plugin_id = ?'
    ).get(guildId, pluginId);
    if (row && !row.enabled) return false;
    visiting.add(pluginId);
    const dependenciesEnabled = (plugin.manifest.requires || []).every((dependency) => (
      this.isEnabled(guildId, dependency, visiting)
    ));
    visiting.delete(pluginId);
    return dependenciesEnabled;
  }

  list(guildId) {
    const rows = new Map(this.db.prepare(
      'SELECT plugin_id, enabled, updated_at FROM guild_plugin_settings WHERE guild_id = ?'
    ).all(guildId).map((row) => [row.plugin_id, row]));

    return this.plugins.map((plugin) => {
      const id = plugin.manifest.id;
      const row = rows.get(id);
      const globallyDisabled = this.isGloballyDisabled(id);
      const blockedBy = globallyDisabled
        ? []
        : (plugin.manifest.requires || []).filter((dependency) => !this.isEnabled(guildId, dependency));
      return {
        id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        description: plugin.manifest.description || '',
        requires: [...(plugin.manifest.requires || [])],
        enabled: globallyDisabled || blockedBy.length > 0 ? false : row ? Boolean(row.enabled) : true,
        globallyDisabled,
        locked: globallyDisabled || blockedBy.length > 0,
        blockedBy,
        updatedAt: row?.updated_at || null,
      };
    });
  }

  setEnabled(guildId, pluginId, enabled) {
    if (!guildId) throw new ValidationError('Missing guild id.');
    if (typeof enabled !== 'boolean') throw new ValidationError('enabled must be a boolean.');
    const plugin = this.getPlugin(pluginId);
    if (!plugin) throw new NotFoundError('Plugin not found.');
    if (this.isGloballyDisabled(pluginId)) {
      throw new ConflictError('This plugin is disabled by the application configuration.');
    }

    if (enabled) {
      const missing = (plugin.manifest.requires || []).filter((dependency) => !this.isEnabled(guildId, dependency));
      if (missing.length > 0) {
        throw new ConflictError(`Enable dependency plugin(s) first: ${missing.join(', ')}.`);
      }
    } else {
      const dependents = this.plugins
        .filter((candidate) => candidate.manifest.requires?.includes(pluginId))
        .filter((candidate) => this.isEnabled(guildId, candidate.manifest.id))
        .map((candidate) => candidate.manifest.id);
      if (dependents.length > 0) {
        throw new ConflictError(`Disable dependent plugin(s) first: ${dependents.join(', ')}.`);
      }
    }

    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO guild_plugin_settings (guild_id, plugin_id, enabled, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(guild_id, plugin_id) DO UPDATE SET
          enabled = excluded.enabled,
          updated_at = CURRENT_TIMESTAMP
      `).run(guildId, pluginId, enabled ? 1 : 0);
    });
    tx();
    this.logger.info?.('plugins', pluginId, 'Updated guild plugin state', { guildId, enabled });
    return this.list(guildId).find((entry) => entry.id === pluginId);
  }
}

module.exports = { PluginGuildSettingsService };
