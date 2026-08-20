# mochi

A lightweight Discord invite tracking bot with a live web dashboard, built with Bun or Node and SQLite.

## Features

- **Invite tracking**: tracks which invite code was used when a member joins, computes net invites (`regular + bonus - leaves - fake`), flags accounts newer than the configured threshold as fake/suspicious, and handles leaves, vanity URLs, and rejoins.
- **Invite campaign labels**: assign custom labels to invite codes (e.g. `twitter-campaign`, `youtube-promo`) via `/invite-label` or the dashboard to track where traffic comes from.
- **Safety & AutoMod**: view and configure Discord AutoMod rules directly from the dashboard (keyword filters, mention spam, spam presets, member profiles, server verification levels).
- **Web dashboard**: live event feed over authorized Socket.IO rooms, 7-day join/leave charts, invite code manager, server safety controls, and a built-in simulator for sandbox testing.
- **Secure by default**: Discord OAuth with state validation, per-guild authorization, authenticated Socket.IO, and no global guild broadcasts.
- **Fast & light**: uses `bun:sqlite` (with `better-sqlite3` fallback for Node.js) with WAL mode for fast local storage.

## Application Modes

The application runs in exactly one explicit mode, selected by `APP_MODE`:

| Mode | Behavior |
| --- | --- |
| `development` | May connect to live Discord if credentials exist. Never silently becomes demo. |
| `demo` | Sandbox mode: explicit demo gateways/fixtures and an isolated demo database. |
| `production` | Requires `DISCORD_TOKEN`, `CLIENT_ID`, `CLIENT_SECRET`, a unique `SESSION_SECRET` and valid dashboard URLs; fails startup otherwise. |

`DEMO_MODE=true` is still recognized as a legacy alias and normalized to `APP_MODE=demo`, but `APP_MODE` is the preferred configuration.

Demo mode uses `data/mochi-demo.sqlite` so demo data never pollutes the live `data/mochi.sqlite`.

## Setup

### Prerequisites

- [Bun](https://bun.sh) (v1.0+) or [Node.js](https://nodejs.org) (v18+)
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
- `PRE_EXISTING` — backfilled from historical member sync; never earns credit.
- `OAUTH` — reserved for Discord OAuth-style flows.

`inviter_id` means exactly one thing: a Discord user ID, or `null`.

## Security

- The dashboard requires Discord OAuth2 login (`identify guilds`).
- OAuth login uses a cryptographically random `state` value stored in the session and validated on callback.
- Only guilds you can manage **and** that Mochi is a member of are listed/accessible; per-guild routes return `403` otherwise.
- **Development convenience login:** when running with `APP_MODE=development` and OAuth credentials are missing/incomplete (`CLIENT_ID`/`CLIENT_SECRET`), `/auth/login` establishes a clearly-logged "Development Admin" session that may access every guild the bot is connected to. This exists only so a local dashboard remains usable without a Discord OAuth app — it is never available in `demo` (which has its own demo identity) or `production` (which requires real OAuth credentials to even start).
- All `/api/guilds/**` endpoints require authentication and per-guild authorization. `/api/stats` (non-sensitive global telemetry) and `/api/health` are intentionally public for operational health checks; everything else under `/api` is protected.
- Socket.IO uses the shared Express session for authentication, and room membership is authorized per guild. Guild events are delivered only to the authorized guild room — never globally.
- Session cookies are `httpOnly`, `sameSite=lax`, and `secure` in production with a non-default name (`mochi.sid`).
- The Express MemoryStore session store is fine for local/single-instance development; replace it before horizontally scaled production deployment.

## Database

- Schema is managed by versioned migrations in `src/database/migrations/`, recorded in `schema_migrations`.
- The durable invite lifecycle ledger (`invite_events`) plus bonus adjustment history (`invite_bonus_adjustments`) are the source of truth.
- `invite_members`, `inviters` and `daily_invite_stats` are projections and can be rebuilt from the ledger.

Rebuild projections after any manual database fiddling:

```bash
node scripts/rebuild-invite-projections.js              # all guilds
node scripts/rebuild-invite-projections.js <guildId>    # one guild
```

### Upgrading an existing database

The v2 migration synthesizes lifecycle events from existing `invite_members` rows, imports non-zero bonus values as one adjustment per inviter, and rebuilds projections. It is idempotent and recorded in `schema_migrations`. **Back up your database first:**

```bash
cp data/mochi.sqlite data/mochi.sqlite.bak
```

If the rebuilt projections differ from the old aggregate counters (lost rejoin history), the ledger wins and the difference is reported at migration time.

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
- `/settings` — Welcome/leave channel config, custom message templates, and bot options
- `/simulator` — Sandbox test bench to simulate member joins, leaves, and AutoMod triggers

## Testing

Run the full suite (Bun or Node):

```bash
bun run tests/runAll.js
npm run test:node
```

`bun test` also runs every suite. Tests use isolated in-memory databases and never touch `data/mochi.sqlite`.
