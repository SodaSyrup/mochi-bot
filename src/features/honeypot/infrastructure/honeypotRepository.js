/**
 * Persistent per-guild honeypot configuration and trigger counter.
 */
const { DEFAULTS } = require('../../../config/defaults');

class HoneypotRepository {
  constructor(db) {
    this.db = db;

    // This keeps already-running development databases usable when the
    // feature is added without requiring a destructive database reset.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS honeypot_settings (
        guild_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        banner_message_id TEXT,
        kicks INTEGER NOT NULL DEFAULT 0 CHECK (kicks >= 0),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_honeypot_settings_channel
        ON honeypot_settings (guild_id, channel_id);
      CREATE TABLE IF NOT EXISTS honeypot_kicks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT,
        occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_honeypot_kicks_guild_channel_time
        ON honeypot_kicks (guild_id, channel_id, occurred_at DESC);
    `);
  }

  get(guildId) {
    return this.db.prepare('SELECT * FROM honeypot_settings WHERE guild_id = ?').get(guildId) || null;
  }

  setChannel({ guildId, channelId, bannerMessageId }) {
    const existing = this.get(guildId);
    const kicks = existing?.channel_id === channelId ? existing.kicks : 0;

    this.db.prepare(`
      INSERT INTO honeypot_settings
        (guild_id, channel_id, banner_message_id, kicks)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        channel_id = excluded.channel_id,
        banner_message_id = excluded.banner_message_id,
        kicks = excluded.kicks,
        updated_at = CURRENT_TIMESTAMP
    `).run(guildId, channelId, bannerMessageId || null, kicks);

    return this.get(guildId);
  }

  recordKick({ guildId, channelId, userId, username, occurredAt }) {
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO honeypot_kicks
          (guild_id, channel_id, user_id, username, occurred_at)
        VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `).run(guildId, channelId, userId, username || null, occurredAt || null);
      this.db.prepare(`
        UPDATE honeypot_settings
        SET kicks = kicks + 1, updated_at = CURRENT_TIMESTAMP
        WHERE guild_id = ? AND channel_id = ?
      `).run(guildId, channelId);
      return this.get(guildId);
    });
    return transaction();
  }

  getRecentKicks(guildId, channelId, limit = DEFAULTS.limits.pagination.recentHoneypotKicks) {
    return this.db.prepare(`
      SELECT id, guild_id, channel_id, user_id, username, occurred_at
      FROM honeypot_kicks
      WHERE guild_id = ? AND channel_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(guildId, channelId, limit);
  }

  disable(guildId) {
    const existing = this.get(guildId);
    this.db.prepare('DELETE FROM honeypot_settings WHERE guild_id = ?').run(guildId);
    return existing;
  }
}

module.exports = { HoneypotRepository };
