module.exports = {
  version: 6,
  name: 'user-log-entries',
  up(db) {
    db.exec(`
      CREATE TABLE invite_log_import_entries (
        guild_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        source_entry_key TEXT NOT NULL DEFAULT 'message',
        channel_id TEXT NOT NULL,
        source_bot_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        membership_cycle INTEGER NOT NULL,
        inviter_id TEXT NOT NULL,
        actor_user_id TEXT,
        imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        inviter_assumed INTEGER NOT NULL DEFAULT 0 CHECK (inviter_assumed IN (0, 1)),
        PRIMARY KEY (guild_id, message_id, source_entry_key)
      );
      INSERT INTO invite_log_import_entries
        (guild_id, message_id, channel_id, source_bot_id, user_id, membership_cycle, inviter_id, actor_user_id, imported_at, inviter_assumed)
      SELECT guild_id, message_id, channel_id, source_bot_id, user_id, membership_cycle, inviter_id, actor_user_id, imported_at, inviter_assumed FROM invite_log_imports;
      DROP TABLE invite_log_imports;
      ALTER TABLE invite_log_import_entries RENAME TO invite_log_imports;
    `);
  },
};
