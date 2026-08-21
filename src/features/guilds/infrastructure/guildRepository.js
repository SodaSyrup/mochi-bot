class GuildRepository {
  constructor(db, { defaultFakeThresholdDays = 7 } = {}) {
    this.db = db;
    this.defaultFakeThresholdDays = defaultFakeThresholdDays;
  }

  getGuild(guildId, defaultName = 'Unknown Server', defaultIcon = null) {
    let row = this.db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guildId);
    if (!row) {
      this.db
        .prepare('INSERT INTO guilds (guild_id, name, icon, fake_threshold_days) VALUES (?, ?, ?, ?)')
        .run(guildId, defaultName, defaultIcon, this.defaultFakeThresholdDays);
      row = this.db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guildId);
    }
    return row;
  }

  updateGuild(guildId, settings) {
    const allowed = ['name', 'icon', 'fake_threshold_days', 'invite_log_channel_id'];
    const fields = [];
    const values = [];

    for (const key of allowed) {
      if (settings[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(settings[key]);
      }
    }

    if (fields.length === 0) return this.getGuild(guildId);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(guildId);

    this.db.prepare(`UPDATE guilds SET ${fields.join(', ')} WHERE guild_id = ?`).run(...values);
    return this.getGuild(guildId);
  }

  getAllGuilds() {
    return this.db.prepare('SELECT * FROM guilds ORDER BY updated_at DESC').all();
  }
}

module.exports = { GuildRepository };
