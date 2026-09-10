const session = require('express-session');
const { createDatabase } = require('../../database/createDatabase');
const { DEFAULTS } = require('../../config/defaults');

const DEFAULT_SESSION_TTL_MS = DEFAULTS.dashboard.sessionTtlSeconds * 1000;

/** SQLite-backed express-session store. Session data stays server-side. */
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
      CREATE TABLE IF NOT EXISTS dashboard_session_revocations (
        sid TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dashboard_session_revocations_expires_at
        ON dashboard_session_revocations (expires_at);
    `);
  }

  get(sid, callback) {
    try {
      const now = Date.now();
      this.#purgeRevocations(now);
      const revoked = this.db.prepare('SELECT 1 FROM dashboard_session_revocations WHERE sid = ? AND expires_at > ?').get(sid, now);
      if (revoked) return callback(null, null);
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
      if (this.#isRevoked(sid)) {
        const error = new Error('SESSION_REVOKED');
        callback?.(error);
        return;
      }
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

  /** Persist a socket refresh only while the SID is still live. */
  setIfActive(sid, sessionData, callback) {
    try {
      const now = Date.now();
      this.#purgeRevocations(now);
      const expiresAt = this.#expiresAt(sessionData);
      const result = this.db.prepare(`
        UPDATE dashboard_sessions SET data = ?, expires_at = ?
        WHERE sid = ? AND (expires_at IS NULL OR expires_at > ?)
          AND NOT EXISTS (SELECT 1 FROM dashboard_session_revocations WHERE sid = ? AND expires_at > ?)
      `).run(JSON.stringify(sessionData), expiresAt, sid, now, sid, now);
      if (result.changes !== 1) {
        const error = new Error('SESSION_REVOKED');
        callback?.(error);
        return;
      }
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  touch(sid, sessionData, callback) {
    try {
      if (this.#isRevoked(sid)) {
        const error = new Error('SESSION_REVOKED');
        callback?.(error);
        return;
      }
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

  /**
   * Invalidate a session before deleting its row. The tombstone closes the
   * race where an in-flight Express or Socket.IO request tries to save an old
   * in-memory session after logout. Tombstones are bounded by the session TTL.
   */
  invalidate(sid, callback) {
    try {
      const expiresAt = Date.now() + this.ttlMs;
      this.db.transaction(() => {
        this.db.prepare('INSERT INTO dashboard_session_revocations (sid, expires_at) VALUES (?, ?) ON CONFLICT(sid) DO UPDATE SET expires_at = excluded.expires_at').run(sid, expiresAt);
        this.db.prepare('DELETE FROM dashboard_sessions WHERE sid = ?').run(sid);
      })();
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  isActive(sid, callback) {
    try {
      const now = Date.now();
      this.#purgeRevocations(now);
      const row = this.db.prepare('SELECT 1 FROM dashboard_sessions WHERE sid = ? AND (expires_at IS NULL OR expires_at > ?)').get(sid, now);
      const revoked = this.db.prepare('SELECT 1 FROM dashboard_session_revocations WHERE sid = ? AND expires_at > ?').get(sid, now);
      const active = Boolean(row && !revoked);
      if (callback) callback(null, active);
      return active;
    } catch (error) {
      if (callback) callback(error);
      return false;
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

  #isRevoked(sid) {
    const now = Date.now();
    this.#purgeRevocations(now);
    return Boolean(this.db.prepare('SELECT 1 FROM dashboard_session_revocations WHERE sid = ? AND expires_at > ?').get(sid, now));
  }

  #purgeRevocations(now = Date.now()) {
    this.db.prepare('DELETE FROM dashboard_session_revocations WHERE expires_at <= ?').run(now);
  }
}

module.exports = { SqliteSessionStore, DEFAULT_SESSION_TTL_MS };
