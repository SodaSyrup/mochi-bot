const path = require('path');
const fs = require('fs');
const { Database } = require('bun:sqlite');

export function createDatabase({ path: dbPath }: { path: string }): any {
  const dir = path.dirname(dbPath);
  if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

