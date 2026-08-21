# mochi

A lightweight Discord invite tracking bot with a live web dashboard, built for Bun and SQLite.

## Features

- **Invite tracking**: tracks which invite code was used when a member joins, computes net invites (`regular + bonus - leaves - fake`), flags accounts newer than the configured threshold as fake/suspicious, and handles leaves, vanity URLs, and rejoins.
- **Invite logs**: post member joins, leaves, and bot add/remove activity to a configurable Discord channel from Dashboard → Settings. Human joins show the inviter and the updated net invite total; bots use separate messages and never count as invites.
- **Invite campaign labels**: assign custom labels to invite codes (e.g. `twitter-campaign`, `youtube-promo`) via `/invite-label` or the dashboard to track where traffic comes from.
- **Safety & AutoMod**: view and configure Discord AutoMod rules directly from the dashboard (keyword filters, mention spam, spam presets, member profiles, server verification levels).
- **Web dashboard**: live event feed over authorized Socket.IO rooms, 7-day join/leave charts, invite code manager, server safety controls, and a built-in simulator for sandbox testing.
- **Secure by default**: Discord OAuth with state validation, per-guild authorization, authenticated Socket.IO, and no global guild broadcasts.
- **Fast & light**: uses Bun's native `bun:sqlite` driver with WAL mode for fast local storage.

## Application Modes

The application runs in exactly one explicit mode, selected by `APP_MODE`:

| Mode | Behavior |
| --- | --- |
| `development` | May connect to live Discord if credentials exist. Never silently becomes demo. |
| `demo` | Sandbox mode: explicit demo gateways/fixtures and an isolated demo database. |
| `production` | Requires `DISCORD_TOKEN`, `CLIENT_ID`, `CLIENT_SECRET`, a unique `SESSION_SECRET` and valid dashboard URLs; fails startup otherwise. |

Demo mode uses `data/mochi-demo.sqlite` so demo data never pollutes the live `data/mochi.sqlite`.

## Setup

### Prerequisites

- [Bun](https://bun.sh) (v1.3+)
- A Discord Bot Application from the [Discord Developer Portal](https://discord.com/developers/applications)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/SodaSyrup/mochi-bot.git
   cd mochi-bot
   bun install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Fill in your credentials. See `.env.example` for every option and which values are required for production.

3. Deploy slash commands:
   ```bash
   bun run deploy-commands
   ```

4. Start the application:
   ```bash
   bun dev
   ```
   The dashboard runs at `http://localhost:3000`.

For the sandbox, run with `APP_MODE=demo` (e.g. in `.env`). Demo mode never connects to Discord and uses an isolated demo database.

### Run with PM2

Install the dependencies on the server, then start Mochi through the Bun runtime:

```bash
bun install --production
bun run pm2:start
bun run pm2:startup
```

Run the command printed by `pm2:startup` with the required system privileges.
Then save the current process list:

```bash
bun run pm2:save
```

The ecosystem file keeps the process running, restarts it after crashes, and
writes logs to `logs/pm2-out.log` and `logs/pm2-error.log`. Keep application
settings and secrets in `.env`; after changing them, run:

```bash
bun run pm2:restart
```

Useful commands are `bun run pm2:logs`, `bun run pm2:stop`, and
`bun run pm2:delete`.

## Invite Logs

Invite logging is configured per guild from **Dashboard → Settings → Invite logs** (channel picker). When a channel is selected, Mochi posts plain-text logs there for member joins, leaves, and bot add/remove activity.

- **Human joins** show the member, the inviter, and the inviter's updated net invite total (from the canonical `inviter_stats` view — the same number used everywhere else). Suspicious/fake accounts keep their existing counting semantics and are still logged.
- **Human leaves** show the recorded inviter.
- **UNKNOWN attribution is never guessed** — joins show "couldn't determine who invited them", leaves show "no recorded inviter".
- **Vanity joins/leaves** have their own dedicated wording.
- **Bots use separate `🤖` messages and are never counted as invites.** They never enter `invite_members`, `invite_events`, or inviter totals.
- **Bot-adder attribution** comes from the Discord audit log and is persisted in `bot_attributions`, so a bot's removal message can still name who originally added it even after a restart.
- If a log channel is deleted or Mochi lacks permissions, invite processing continues normally; the failure is logged and the channel remains configured until an admin changes it.

### Required Discord permissions

| Feature | Permission |
| --- | --- |
| Sending invite logs | `View Channel` + `Send Messages` on the configured channel |
| Resolving who added a bot | `View Audit Log` (server-level) |

Without `View Audit Log`, bot messages degrade to "I couldn't determine who added it"; human invite logging is unaffected.

## Invite Semantics

Net invites are always computed as:

```
total = regular + bonus - leaves - fake
```

This single definition lives in the `inviter_stats` database view — routes, commands and the frontend never recompute it.

- **regular** — attributed `INVITE` joins. A normal invite join increments `regular` even if the member is later classified as suspicious.
- **bonus** — manual adjustment credit (see `invite_bonus_adjustments`).
- **leaves** — departures that remove previously earned invite credit. A member already excluded by the fake counter is not double-penalized.
- **fake** — attributed invite joins classified as suspicious. A suspicious invite contributes `regular +1`, `fake +1`, and earns zero net credit.

## Attribution Types

Membership attribution is stored separately from Discord user IDs (never masquerading as one):

- `INVITE` — credited to a specific Discord inviter via an invite code.
- `VANITY` — joined via the guild vanity URL.
- `UNKNOWN` — attribution was ambiguous or unavailable (never guessed).
- `RECONCILED` — discovered during an authoritative member reconciliation; never earns invite credit.

`inviter_id` means exactly one thing: a Discord user ID, or `null`.

## Realtime Transport Contract

Socket.IO forwards canonical application events to authorized guild rooms through documented transport DTOs (`src/dashboard/realtime/eventMappers.js`). The frontend consumes exactly these shapes — no `user`/`member` aliases.

**`memberJoin` / `memberLeave`**

```json
{
  "guildId": "...",
  "member": { "id": "...", "username": "...", "avatar": "..." },
  "attribution": { "type": "INVITE", "inviterId": "...", "inviteCode": "..." },
  "inviter": { "id": "...", "username": "...", "avatar": "..." },
  "isFake": false,
  "inviterStats": { "regular": 4, "bonus": 1, "leaves": 1, "fake": 0, "total": 4 },
  "occurredAt": "..."
}
```

**`inviteCreated`**

```json
{
  "guildId": "...",
  "invite": { "code": "...", "url": "...", "uses": 0, "maxUses": 0, "maxAge": 0, "temporary": false, "channelId": "...", "channelName": "...", "inviter": { "id": "...", "username": "..." }, "createdAt": "...", "label": null },
  "occurredAt": "..."
}
```

**`inviteDeleted`** → `{ guildId, code, occurredAt }`
**`inviteLabelUpdated`** → `{ guildId, code, label, channelId, channelName, occurredAt }`
**`autoModExecution`** → flat `{ guildId, ruleId, ruleName, action, user, ... }`
**`autoModRuleUpdated`** → `{ guildId, action, ruleId, name, enabled }`

## Security

- The dashboard requires Discord OAuth2 login (`identify guilds`).
- OAuth login uses a cryptographically random `state` value stored in the session and validated on callback.
- Only guilds you can manage **and** that Mochi is a member of are listed/accessible; per-guild routes return `403` otherwise. Guild owners are recognized dynamically from Discord for each server, so no global owner ID is required.
- **Development auth bypass:** there is **no implicit admin**. When `APP_MODE=development` **and** `DEV_AUTH_BYPASS=true` **and** the request is loopback-only, `/auth/login` may establish a clearly-logged "Development Admin" session without OAuth. With the bypass disabled (the default), missing OAuth configuration means login is simply unavailable — no automatic admin is created. `DEV_AUTH_BYPASS=true` is **forbidden in production**: the application refuses to start. Demo has its own demo identity and is unaffected.
- **Guild authorization freshness:** guild-management permissions are fetched from Discord at login and cached in the session. They are NOT trusted for the entire session lifetime — the snapshot expires after `GUILD_PERMISSION_CACHE_TTL_SECONDS` (default 600s) and is refreshed from Discord before protected operations continue. A revoked or invalid OAuth authorization fails closed with `401` (re-login) rather than reusing stale permission data.
- **Sessions:** OAuth access/refresh tokens live only server-side in the session (`session.discordOAuth`) for refresh support. They are never sent to browser JavaScript, never returned in API JSON, and never logged. `/auth/user` returns only safe public user fields.
- All `/api/guilds/**` endpoints require authentication and per-guild authorization. `/api/stats` (non-sensitive global telemetry) and `/api/health` are intentionally public for operational health checks; everything else under `/api` is protected.
- Socket.IO uses the shared Express session for authentication, and room membership is authorized per guild. Guild events are delivered only to the authorized guild room — never globally.
- Session cookies are `httpOnly`, `sameSite=lax`, and `secure` in production with a non-default name (`mochi.sid`).
- The Express MemoryStore session store is fine for local/single-instance development (sessions are lost on restart); replace it before horizontally scaled production deployment.

## Database

- Schema is managed by versioned migrations in `src/database/migrations/`, recorded in `schema_migrations`.
- The durable invite lifecycle ledger (`invite_events`) plus bonus adjustment history (`invite_bonus_adjustments`) are the source of truth.
- `invite_members`, `inviters` and `daily_invite_stats` are projections and can be rebuilt from the ledger.
- **Invite cache:** the Discord snapshot is authoritative — including an *empty* snapshot. The persisted `invite_cache` is a temporary fallback used only when Discord cannot be queried; a successful empty fetch clears stale cache rows.

Rebuild projections after any manual database fiddling:

```bash
bun run rebuild-projections                                      # all guilds
bun run rebuild-projections -- --guild <guildId>                 # one guild
bun run rebuild-projections -- --guild <guildId> --dry-run        # preview only, no writes
```

### Migrations & the fresh database baseline

Mochi uses versioned SQLite migrations. The new bot starts with one complete baseline migration; future production schema changes can be added as append-only migrations.

- `001` — the complete current schema: durable invite ledger, projections, invite logs, invite cache/labels, guild settings, and bot attribution.
- `002+` — future production schema changes. Migrations are append-only after the initial baseline.

Development databases are disposable while the bot is being built. Reset them explicitly when changing the baseline (this is a manual developer action, never something the application does at startup):

```bash
rm data/mochi.sqlite
rm data/mochi-demo.sqlite
```

Then start Mochi normally and migration `001` creates the complete clean database.

> **Migration freeze rule:** once Mochi is deployed with a database that must be preserved, never edit, squash, or remove an already-released migration. Need a schema change? Add the next numbered migration (`002`, `003`, …) and leave previously shipped migrations untouched.

## Slash Commands

| Command | Description | Permission |
| --- | --- | --- |
| `/invites [user]` | Check invite stats (net, regular, bonus, leaves, fake) | Everyone |
| `/leaderboard [page]` | Server invite leaderboard | Everyone |
| `/invite-codes [user]` | List active invite links and usage count | Everyone |
| `/invite-label <code> [label]` | Set or remove a campaign label on an invite link | Manage Server |
| `/serverinfo` | Server details, channel counts, and invite telemetry | Everyone |
| `/userinfo [user]` | User account info, join date, and who invited them | Everyone |
| `/botinfo` | Bot system telemetry and uptime | Everyone |
| `/ping` | WebSocket latency | Everyone |
| `/help` | Command reference and dashboard link | Everyone |

## Dashboard Pages

- `/` — Server overview, quick stats, and real-time live event feed
- `/analytics` — 7-day join vs leave trends and conversion metrics
- `/leaderboard` — Complete server inviter rankings
- `/codes` — Active invite codes with usage counters and custom labels
- `/safety` — Discord AutoMod rules and server security settings
- `/settings` — Bot connection status and application configuration
- `/simulator` — Sandbox test bench to simulate member joins, leaves, and AutoMod triggers

## Testing

Run the full suite:

```bash
bun test
```

Tests use isolated in-memory databases and never touch `data/mochi.sqlite`.
