#!/usr/bin/env node
/**
 * Rebuild inviter + daily projections from the durable invite ledger.
 *
 * Usage:
 *   node scripts/rebuild-invite-projections.js            # all guilds
 *   node scripts/rebuild-invite-projections.js <guildId>  # one guild
 *
 * This is an operator/admin tool only. There is intentionally no
 * unauthenticated HTTP endpoint for it.
 */
const config = require('../src/config');
const { createDatabase } = require('../src/database/createDatabase');
const { runMigrations } = require('../src/database/migrations');
const { rebuildGuildInviteProjections } = require('../src/features/invites/infrastructure/projectionRebuilder');

async function main() {
  const targetGuild = process.argv[2];
  const db = createDatabase({ path: config.database.path });
  runMigrations(db);

  let guildIds;
  if (targetGuild) {
    guildIds = [targetGuild];
  } else {
    guildIds = db.prepare('SELECT DISTINCT guild_id FROM invite_events').all().map((r) => r.guild_id);
  }

  if (guildIds.length === 0) {
    console.log('No guild activity found in the ledger; nothing to rebuild.');
    db.close();
    return;
  }

  for (const guildId of guildIds) {
    const result = rebuildGuildInviteProjections(db, guildId);
    console.log(`Rebuilt projections for guild ${guildId}: ${result.inviters} inviter(s), ${result.days} daily row(s).`);
  }

  db.close();
  console.log('Projection rebuild completed.');
}

main().catch((err) => {
  console.error('Projection rebuild failed:', err);
  process.exit(1);
});
