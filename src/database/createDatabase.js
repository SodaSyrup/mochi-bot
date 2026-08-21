const path = require('path');
const fs = require('fs');
const { Database } = require('bun:sqlite');

/**
 * Create a SQLite database handle backed by Bun's native SQLite driver.
 *
 * @param {{ path: string }} options - `path` may be a file path or `:memory:`.
 */
function createDatabase({ path: dbPath }) {
  const dir = path.dirname(dbPath);
  if (dir && dir !== '.') {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  return db;
}

module.exports = { createDatabase };
