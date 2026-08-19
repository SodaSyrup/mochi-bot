const db = require('../db');

class GuildRepository {
  /**
   * Get guild configuration or insert default
   */
  getGuild(guildId, defaultName = 'Unknown Server', defaultIcon = null) {
    let row = db.prepare(`SELECT * FROM guilds WHERE guild_id = ?`).get(guildId);
    if (!row) {
      db.prepare(`
        INSERT INTO guilds (guild_id, name, icon)
        VALUES (?, ?, ?)
      `).run(guildId, defaultName, defaultIcon);
      row = db.prepare(`SELECT * FROM guilds WHERE guild_id = ?`).get(guildId);
    }
    return row;
  }

  /**
   * Update guild settings
   */
  updateGuild(guildId, settings) {
    const fields = [];
    const values = [];

    const allowed = ['name', 'icon', 'fake_threshold_days'];

    for (const key of allowed) {
      if (settings[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(settings[key]);
      }
    }

    if (fields.length === 0) return this.getGuild(guildId);

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(guildId);

    const query = `UPDATE guilds SET ${fields.join(', ')} WHERE guild_id = ?`;
    db.prepare(query).run(...values);

    return this.getGuild(guildId);
  }

  /**
   * Get all registered guilds
   */
  getAllGuilds() {
    return db.prepare(`SELECT * FROM guilds ORDER BY updated_at DESC`).all();
  }
}

module.exports = new GuildRepository();
