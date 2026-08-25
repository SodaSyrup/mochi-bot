#!/usr/bin/env bun
/** Rebuild member, inviter, and daily projections from the durable invite ledger. */
const config = require('../src/config');
const { resolveDatabasePath } = require('../src/config');
const { createDatabase } = require('../src/database/createDatabase');
const { runMigrations } = require('../src/database/migrations');
const { rebuildGuildInviteProjections } = require('../src/features/invites/infrastructure/projectionRebuilder');
const { getGuildIdsWithInviteData } = require('../src/features/invites/infrastructure/projectionGuilds');

interface ParsedArgs { guilds: string[]; dryRun: boolean }

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { guilds: [], dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--guild') {
      const guildId = argv[i + 1];
      if (guildId) args.guilds.push(guildId);
      i += 1;
    } else if (argv[i] === '--dry-run') {
      args.dryRun = true;
    } else {
      args.guilds.push(argv[i]);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const { guilds: targetGuilds, dryRun } = parseArgs(process.argv);
  const db = createDatabase({ path: resolveDatabasePath(config) });
  runMigrations(db);
  const guildIds: string[] = targetGuilds.length > 0 ? targetGuilds : getGuildIdsWithInviteData(db);

  if (guildIds.length === 0) {
    console.log('No guild activity found; nothing to rebuild.');
    db.close();
    return;
  }

  let totalDifferences = 0;
  for (const guildId of guildIds) {
    if (dryRun) {
      const result = rebuildGuildInviteProjections(db, guildId, { dryRun: true });
      console.log(`[dry-run] guild ${guildId}: expected ${result.members} member(s), ${result.inviters} inviter(s), ${result.days} daily row(s); ${result.differences.length} difference(s) vs current rows.`);
      for (const difference of result.differences.slice(0, 20)) console.log(`  ${difference.reason}: ${difference.table} ${difference.user}`);
      totalDifferences += result.differences.length;
    } else {
      const result = rebuildGuildInviteProjections(db, guildId);
      console.log(`Rebuilt projections for guild ${guildId}: ${result.members} member(s), ${result.inviters} inviter(s), ${result.days} daily row(s).`);
    }
  }

  db.close();
  if (dryRun) console.log(`Dry-run complete. ${totalDifferences} projected difference(s); no writes performed.`);
  else console.log('Projection rebuild completed.');
}

main().catch((error: unknown) => {
  console.error('Projection rebuild failed:', error);
  process.exit(1);
});

