/**
 * Durable persistence for the invite-logs feature.
 *
 * Only bot-adder attribution lives here. Human joins/leaves are logged by
 * consuming InviteEvents — the invite ledger (invite_members, invite_events,
 * inviters) remains the single source of truth and is never touched here.
 */
class InviteLogRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Record (or overwrite) who originally added a bot to a guild.
   *
   * bot_user_id can be removed and re-added later, so an UPSERT always
   * replaces the previous record. Callers pass `null` adder when audit-log
   * resolution failed so a stale attribution from an earlier installation is
   * never incorrectly reused as the current one.
   */
  upsertBotAttribution({ guildId, botUserId, addedByUserId = null, addedByUsername = null }) {
    this.db
      .prepare(`
        INSERT INTO bot_attributions
          (guild_id, bot_user_id, added_by_user_id, added_by_username)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id, bot_user_id) DO UPDATE SET
          added_by_user_id = excluded.added_by_user_id,
          added_by_username = excluded.added_by_username,
          added_at = CURRENT_TIMESTAMP
      `)
      .run(guildId, botUserId, addedByUserId, addedByUsername);
    return this.getBotAttribution(guildId, botUserId);
  }

  getBotAttribution(guildId, botUserId) {
    return this.db
      .prepare(`
        SELECT guild_id, bot_user_id, added_by_user_id, added_by_username, added_at
        FROM bot_attributions
        WHERE guild_id = ? AND bot_user_id = ?
      `)
      .get(guildId, botUserId) || null;
  }

  deleteBotAttribution(guildId, botUserId) {
    this.db
      .prepare('DELETE FROM bot_attributions WHERE guild_id = ? AND bot_user_id = ?')
      .run(guildId, botUserId);
    return { success: true };
  }
}

module.exports = { InviteLogRepository };
