const fs = require('fs');
const path = require('path');

const migrations = [];
const migrationsDir = __dirname;

for (const file of fs.readdirSync(migrationsDir).sort()) {
  if (!/^\d{3}-.+\.js$/.test(file)) continue;
  const migration = require(path.join(migrationsDir, file));
  if (!Number.isInteger(migration.version) || migration.version <= 0) {
    throw new Error(`Migration ${file} must export a positive integer "version".`);
  }
  if (typeof migration.up !== 'function') {
    throw new Error(`Migration ${file} must export an "up(db)" function.`);
  }
  migrations.push(migration);
}

// Detect duplicate/overlapping versions.
const seen = new Set();
for (const m of migrations) {
  if (seen.has(m.version)) {
    throw new Error(`Duplicate migration version ${m.version}.`);
  }
  seen.add(m.version);
}

/**
 * Run all pending migrations in ascending version order.
 * Each migration and its schema_migrations record run inside one transaction.
 * Failures propagate — unexpected database errors must never be swallowed.
 * @param {object} db
 * @param {{ silent?: boolean }} [options]
 */
function runMigrations(db, { silent = false } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedVersions = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );

  const pending = migrations
    .filter((m) => !appliedVersions.has(m.version))
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    const tx = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
        migration.version,
        migration.name
      );
    });
    tx();
    if (!silent) console.log(`[Database] Applied migration ${migration.version} (${migration.name})`);
  }

  return pending.length;
}

module.exports = { runMigrations, migrations };
