const fs = require('fs');
const path = require('path');
const config = require('../config');

// Ensure data directory exists
const dbDir = path.dirname(config.database.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;

// Detect Bun runtime vs Node.js
if (typeof Bun !== 'undefined') {
  const { Database } = require('bun:sqlite');
  db = new Database(config.database.path, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Add pragma helper if needed
  if (!db.pragma) {
    db.pragma = (str) => db.exec(`PRAGMA ${str};`);
  }

  console.log(`[Database] Native bun:sqlite connected successfully at: ${config.database.path}`);
} else {
  const Database = require('better-sqlite3');
  db = new Database(config.database.path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  console.log(`[Database] better-sqlite3 connected successfully at: ${config.database.path}`);
}

// Initialize schema
const schemaPath = path.join(__dirname, 'schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf8');
db.exec(schemaSql);

// Run migrations for existing databases (safe: ALTER TABLE ADD COLUMN is no-op if column exists)
const migrations = [
  `ALTER TABLE invite_cache ADD COLUMN channel_id TEXT`,
  `ALTER TABLE invite_cache ADD COLUMN channel_name TEXT`,
];

for (const sql of migrations) {
  try {
    db.exec(sql);
  } catch (e) {
    // Column already exists — safely ignore
    if (!e.message?.includes('duplicate column')) {
      // Only log unexpected errors
      // console.warn('[Database] Migration skipped:', e.message);
    }
  }
}

module.exports = db;

