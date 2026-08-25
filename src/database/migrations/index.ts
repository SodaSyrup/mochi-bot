export const migrations = [require('./001-initial')];
const pluginSystemMigration = require('./002-plugin-system');
const guildPluginSettingsMigration = require('./003-guild-plugin-settings');

for (const migration of migrations) {
  if (!Number.isInteger(migration.version) || migration.version <= 0) throw new Error(`Migration ${migration.name || 'unknown'} must export a positive integer "version".`);
  if (typeof migration.up !== 'function') throw new Error(`Migration ${migration.name || 'unknown'} must export an "up(db)" function.`);
}
const seen = new Set<number>();
for (const migration of migrations) {
  if (seen.has(migration.version)) throw new Error(`Duplicate migration version ${migration.version}.`);
  seen.add(migration.version);
}

export function runMigrations(db: any, { silent = false }: { silent?: boolean } = {}): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  const appliedVersions = new Set<number>(db.prepare('SELECT version FROM schema_migrations').all().map((row: any) => row.version));
  const pending = migrations.filter((migration: any) => !appliedVersions.has(migration.version)).sort((a: any, b: any) => a.version - b.version);
  for (const migration of pending) {
    const tx = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
    });
    tx();
    if (!silent) console.log(`[Database] Applied migration ${migration.version} (${migration.name})`);
  }
  pluginSystemMigration.up(db);
  guildPluginSettingsMigration.up(db);
  return pending.length;
}
