CREATE TABLE IF NOT EXISTS global_bans (
  user_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'revoked', 'expired', 'rejected')),
  severity TEXT,
  reason_code TEXT NOT NULL,
  public_reason TEXT NOT NULL,
  evidence_reference TEXT,
  created_by TEXT NOT NULL,
  reviewed_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_global_bans_state ON global_bans (state);
CREATE INDEX IF NOT EXISTS idx_global_bans_user_state ON global_bans (user_id, state);
CREATE INDEX IF NOT EXISTS idx_global_bans_expiry ON global_bans (expires_at);

CREATE TABLE IF NOT EXISTS global_ban_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_uuid TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  record_version INTEGER NOT NULL,
  record_payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_global_ban_events_cursor ON global_ban_events (event_id);
CREATE INDEX IF NOT EXISTS idx_global_ban_events_user ON global_ban_events (user_id, event_id);

CREATE TABLE IF NOT EXISTS api_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  actor_id TEXT,
  operation TEXT NOT NULL,
  target_user_id TEXT,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_global_ban_audit_time ON api_audit_log (created_at);
