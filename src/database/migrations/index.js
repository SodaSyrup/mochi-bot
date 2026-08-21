// Migration 001 is the released application baseline. Plugin metadata is
// initialized idempotently alongside the baseline by pluginMigrationRunner,
// which keeps this compatibility list stable for existing callers that inspect
// the released application history.
const migrations = [require('./001-initial')];
const pluginSystemMigration = require('./002-plugin-system');
const guildPluginSettingsMigration = require('./003-guild-plugin-settings');

for (const migration of migrations) {
  if (!Number.isInteger(migration.version) || migration.version <= 0) {
    throw new Error(`Migration ${migration.name || 'unknown'} must export a positive integer "version".`);
  }
  if (typeof migration.up !== 'function') {
    throw new Error(`Migration ${migration.name || 'unknown'} must export an "up(db)" function.`);
  }
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

  // The plugin metadata table is infrastructure for namespaced migrations.
  // It is deliberately not added to schema_migrations: that table remains the
  // released application-baseline history, while plugin migrations have their
  // own (plugin_id, version) ledger.
  pluginSystemMigration.up(db);
  guildPluginSettingsMigration.up(db);

  return pending.length;
}

module.exports = { runMigrations, migrations };
