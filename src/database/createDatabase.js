const path = require('path');
const fs = require('fs');

/**
 * Create a SQLite database handle backed by either bun:sqlite (Bun) or
 * better-sqlite3 (Node). Returns an object that supports `prepare`, `exec`
 * and `transaction` so callers do not care which runtime is active.
 *
 * @param {{ path: string }} options - `path` may be a file path or `:memory:`.
 */
function createDatabase({ path: dbPath }) {
  const dir = path.dirname(dbPath);
  if (dir && dir !== '.') {
    fs.mkdirSync(dir, { recursive: true });
  }

  let db;
  if (typeof Bun !== 'undefined') {
    const { Database } = require('bun:sqlite');
    db = new Database(dbPath, { create: true });
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA foreign_keys = ON;');
  } else {
    const Database = require('better-sqlite3');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
  }

  if (typeof db.pragma !== 'function') {
    db.pragma = (sql) => db.exec(`PRAGMA ${sql};`);
  }

  return db;
}

module.exports = { createDatabase };
