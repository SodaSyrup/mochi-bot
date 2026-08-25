CREATE INDEX IF NOT EXISTS idx_global_bans_admin_list
  ON global_bans (state, updated_at DESC, user_id DESC);

CREATE INDEX IF NOT EXISTS idx_global_ban_events_admin_list
  ON global_ban_events (event_id DESC);
