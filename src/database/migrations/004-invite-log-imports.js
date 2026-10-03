module.exports = {
  version: 4,
  name: 'invite-log-imports',
  up(db) {
    db.exec(`
      CREATE TABLE invite_log_imports (
        guild_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        source_bot_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        membership_cycle INTEGER NOT NULL,
        inviter_id TEXT NOT NULL,
        actor_user_id TEXT,
        imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, message_id)
      );
    `);
  },
};
