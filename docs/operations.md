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

The ecosystem file keeps the process running, restarts it after crashes, and writes logs to `logs/pm2-out.log` and `logs/pm2-error.log`. Keep application settings and secrets in `.env`. After changing them, reload the process with:

```bash
bun run pm2:restart
```

Other useful commands are `bun run pm2:logs`, `bun run pm2:stop`, and `bun run pm2:delete`.

## Database model

Mochi uses SQLite with Bun's native `bun:sqlite` driver and WAL mode. The schema is managed by versioned migrations in `src/database/migrations/` and recorded in `schema_migrations`.

The durable invite lifecycle ledger (`invite_events`) and bonus adjustment history (`invite_bonus_adjustments`) are the source of truth. `invite_members`, `inviters`, and `daily_invite_stats` are projections that can be rebuilt from the ledger.

The Discord invite snapshot is authoritative, including an empty snapshot. The persisted `invite_cache` is only a temporary fallback when Discord cannot be queried; a successful empty fetch clears stale cache rows.

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

The new bot starts with one complete baseline migration. Once Mochi is deployed with data that must be preserved, migrations are append-only: never edit, squash, or remove a released migration. Add the next numbered migration for schema changes.

In particular, migration `001` remains unchanged after release.

Development databases are disposable while the bot is being built. Reset one explicitly when changing the baseline; the application never does this at startup:

```bash
rm data/mochi.sqlite
```

Migration `001` will create a clean database on the next start.

Plugin migrations follow the same safety model, with migration namespaced by plugin ID and recorded in `plugin_schema_migrations`. They run in ascending version order; each migration and its record are written in one transaction. There are no automatic down migrations. Disabled plugins do not run migrations, and their existing tables are never removed.

## Testing

Run the complete test suite:

```bash
bun test
```

Tests use isolated in-memory databases and never touch `data/mochi.sqlite`.
