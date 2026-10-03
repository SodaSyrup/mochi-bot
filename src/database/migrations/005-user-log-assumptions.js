module.exports = {
  version: 5,
  name: 'user-log-assumptions',
  up(db) {
    db.exec(`ALTER TABLE invite_log_imports ADD COLUMN inviter_assumed INTEGER NOT NULL DEFAULT 0 CHECK (inviter_assumed IN (0, 1));`);
  },
};
