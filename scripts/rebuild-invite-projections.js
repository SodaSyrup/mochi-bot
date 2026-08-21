#!/usr/bin/env node
/**
 * Rebuild member + inviter + daily projections from the durable invite ledger.
 *
 * Usage:
 *   node scripts/rebuild-invite-projections.js                  # all guilds
 *   node scripts/rebuild-invite-projections.js <guildId>        # one guild
 *   node scripts/rebuild-invite-projections.js --guild <id>     # one guild
 *   node scripts/rebuild-invite-projections.js --guild <id> --dry-run
 *
 * --dry-run derives the expected projections, compares them against the current
 * rows and reports every difference WITHOUT writing anything.
 *
 * This is an operator/admin tool only. There is intentionally no
 * unauthenticated HTTP endpoint for it.
 */
const config = require('../src/config');
const { resolveDatabasePath } = require('../src/config');
const { createDatabase } = require('../src/database/createDatabase');
const { runMigrations } = require('../src/database/migrations');
const { rebuildGuildInviteProjections } = require('../src/features/invites/infrastructure/projectionRebuilder');
const { getGuildIdsWithInviteData } = require('../src/features/invites/infrastructure/projectionGuilds');

// Guild discovery for "all guilds" runs delegates to the shared helper so the
// definition never drifts from future rebuild-all tools. It covers durable
// ledger tables AND projection tables (stale projections must still be
// discoverable so an integrity/repair run can clear them).

function parseArgs(argv) {
  const args = { guilds: [], dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--guild') {
      args.guilds.push(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--dry-run') {
      args.dryRun = true;
    } else {
      args.guilds.push(argv[i]);
    }
  }
  return args;
}

async function main() {
  const { guilds: targetGuilds, dryRun } = parseArgs(process.argv);
  // Same DB path resolution as application composition — never a duplicated
  // path derivation.
  const db = createDatabase({ path: resolveDatabasePath(config) });
  runMigrations(db);

  let guildIds;
  if (targetGuilds.length > 0) {
    guildIds = targetGuilds;
  } else {
    guildIds = getGuildIdsWithInviteData(db);
  }

  if (guildIds.length === 0) {
    console.log('No guild activity found; nothing to rebuild.');
    db.close();
    return;
  }

  let totalDifferences = 0;
  for (const guildId of guildIds) {
    if (dryRun) {
      const result = rebuildGuildInviteProjections(db, guildId, { dryRun: true });
      console.log(
        `[dry-run] guild ${guildId}: expected ${result.members} member(s), ${result.inviters} inviter(s), ` +
        `${result.days} daily row(s); ${result.differences.length} difference(s) vs current rows.`
      );
      for (const d of result.differences.slice(0, 20)) {
        console.log(`  ${d.reason}: ${d.table} ${d.user}`);
      }
      totalDifferences += result.differences.length;
    } else {
      const result = rebuildGuildInviteProjections(db, guildId);
      console.log(`Rebuilt projections for guild ${guildId}: ${result.members} member(s), ${result.inviters} inviter(s), ${result.days} daily row(s).`);
    }
  }

  db.close();
  if (dryRun) {
    console.log(`Dry-run complete. ${totalDifferences} projected difference(s); no writes performed.`);
  } else {
    console.log('Projection rebuild completed.');
  }
}

main().catch((err) => {
  console.error('Projection rebuild failed:', err);
  process.exit(1);
});
