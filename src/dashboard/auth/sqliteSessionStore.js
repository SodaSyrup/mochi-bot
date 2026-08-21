const session = require('express-session');
const { createDatabase } = require('../../database/createDatabase');
const { DEFAULTS } = require('../../config/defaults');

const DEFAULT_SESSION_TTL_MS = DEFAULTS.dashboard.sessionTtlSeconds * 1000;

/**
 * Small durable express-session store backed by SQLite.
 *
 * The session cookie only contains a signed session id. The session payload
 * (including OAuth refresh material) remains server-side in this database.
 * This avoids losing every login when the dashboard process is restarted.
 */
class SqliteSessionStore extends session.Store {
  constructor({ path, db = null, ttlMs = DEFAULT_SESSION_TTL_MS } = {}) {
    super();
    if (!path && !db) throw new Error('A SQLite session store path or database handle is required.');

    this.db = db || createDatabase({ path });
    this.ownsDatabase = !db;
    this.ttlMs = ttlMs;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dashboard_sessions (
        sid TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_expires_at
        ON dashboard_sessions (expires_at);
    `);
  }

  get(sid, callback) {
    try {
      const now = Date.now();
      const row = this.db
        .prepare(
          'SELECT data FROM dashboard_sessions WHERE sid = ? AND (expires_at IS NULL OR expires_at > ?)'
        )
        .get(sid, now);

      // Expired rows are removed lazily so the store does not need a cleanup
      // timer that could keep the process alive.
      this.db.prepare('DELETE FROM dashboard_sessions WHERE sid = ? AND expires_at IS NOT NULL AND expires_at <= ?').run(sid, now);

      if (!row) return callback(null, null);
      callback(null, JSON.parse(row.data));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sessionData, callback) {
    try {
      const data = JSON.stringify(sessionData);
      const expiresAt = this.#expiresAt(sessionData);
      this.db
        .prepare(
          `INSERT INTO dashboard_sessions (sid, data, expires_at)
           VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`
        )
        .run(sid, data, expiresAt);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  touch(sid, sessionData, callback) {
    try {
      this.db
        .prepare('UPDATE dashboard_sessions SET expires_at = ? WHERE sid = ?')
        .run(this.#expiresAt(sessionData), sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid, callback) {
    try {
      this.db.prepare('DELETE FROM dashboard_sessions WHERE sid = ?').run(sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  clear(callback) {
    try {
      this.db.prepare('DELETE FROM dashboard_sessions').run();
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  length(callback) {
    try {
      const row = this.db
        .prepare('SELECT COUNT(*) AS count FROM dashboard_sessions WHERE expires_at IS NULL OR expires_at > ?')
        .get(Date.now());
      callback(null, Number(row.count));
    } catch (error) {
      callback(error);
    }
  }

  close() {
    if (this.ownsDatabase) this.db.close();
  }

  #expiresAt(sessionData) {
    const cookie = sessionData?.cookie;
    if (!cookie) return Date.now() + this.ttlMs;

    if (cookie.expires) {
      const expiresAt = new Date(cookie.expires).getTime();
      if (Number.isFinite(expiresAt)) return expiresAt;
    }
    if (Number.isFinite(cookie.maxAge)) return Date.now() + Math.max(0, cookie.maxAge);
    return null;
  }
}

module.exports = { SqliteSessionStore, DEFAULT_SESSION_TTL_MS };
