// Invite log channel + durable bot attribution.
//
// Adds an optional per-guild invite-log Discord channel (guilds.
// invite_log_channel_id) and a durable table recording who originally added a
// bot to a guild. Bot attribution is deliberately stored OUTSIDE the human
// invite ledger (invite_members / invite_events / inviters) so bots can never
// affect invite statistics. It is also stored as a username snapshot because
// the human who added the bot may leave the guild before the bot is removed.
module.exports = {
  version: 2,
  name: 'invite-logs',
  up(db) {
    db.exec(`
      ALTER TABLE guilds
      ADD COLUMN invite_log_channel_id TEXT;

      CREATE TABLE bot_attributions (
        guild_id TEXT NOT NULL,
        bot_user_id TEXT NOT NULL,
        added_by_user_id TEXT,
        added_by_username TEXT,
        added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, bot_user_id)
      );
    `);
  },
};
