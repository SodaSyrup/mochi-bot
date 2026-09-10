# Deployment and operations

## Run with PM2

Install production dependencies on the server, then start Mochi through Bun:

```bash
bun install --production
bun run pm2:start
bun run pm2:startup
```

Run the command printed by `pm2:startup` with the required system privileges, then save the current process list:

```bash
bun run pm2:save
```

The ecosystem file keeps the process running. It restarts the process after a crash. It writes logs to `logs/pm2-out.log` and `logs/pm2-error.log`.

Keep application settings and secrets in `.env`. After you change them, reload the process:

```bash
bun run pm2:restart
```

Use `bun run pm2:logs` to view logs. Use `bun run pm2:stop` to stop the process. Use `bun run pm2:delete` to remove the PM2 process.

## Database model

Mochi uses SQLite with Bun's native `bun:sqlite` driver and WAL mode. Versioned
migrations in `src/database/migrations/` manage the schema. Mochi records
completed migrations in `schema_migrations`.

The invite lifecycle ledger (`invite_events`) and bonus adjustment history
(`invite_bonus_adjustments`) are the source of truth. `invite_members`,
`inviters`, and `daily_invite_stats` are projections. Mochi can rebuild them
from the ledger.

The Discord invite snapshot is authoritative, including an empty snapshot. The
persisted `invite_cache` is a temporary fallback when Mochi cannot query
Discord. A successful empty fetch clears stale cache rows.

## Rebuild projections

After manually changing invite data, rebuild the projections:

```bash
bun run rebuild-projections                                      # all guilds
bun run rebuild-projections -- --guild <guildId>                 # one guild
bun run rebuild-projections -- --guild <guildId> --dry-run        # preview only, no writes
```

## Migrations

The current migration sequence is:

| Migration | Contents |
| --- | --- |
| `001` | Complete initial schema: invite ledger, projections, invite logs, invite cache and labels, guild settings, and bot attribution |
| `002` | Namespaced plugin migration metadata |
| `003` | Per-guild plugin enablement settings |
| `004+` | Future production schema changes |

The new bot starts with one complete baseline migration. After deployment,
preserve the migration history. Do not edit, combine, or remove a released
migration. Add the next numbered migration for each schema change.

Migration `001` must remain unchanged after release.

Development databases are disposable while the bot is being built. Reset one explicitly when changing the baseline; the application never does this at startup:

```bash
rm data/mochi.sqlite
```

Migration `001` will create a clean database on the next start.

Plugin migrations follow the same safety model. Each migration uses the plugin ID as its namespace and is recorded in `plugin_schema_migrations`.

Migrations run in ascending version order. Each migration and its record are
written in one transaction. Mochi does not run down migrations. Disabled
plugins do not run migrations. Mochi does not remove their existing tables.

## Testing

Run the complete test suite:

```bash
bun test
```

Tests use isolated in-memory databases and never touch `data/mochi.sqlite`.
