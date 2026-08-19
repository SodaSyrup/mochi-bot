# mochi

A lightweight Discord invite tracking bot with a live web dashboard, built with Bun and SQLite.

## Features

- **Invite tracking**: tracks which invite code was used when a member joins, calculates net invites (`regular + bonus - leaves - fake`), flags accounts newer than 7 days as fake/suspicious, and handles leaves and vanity URLs.
- **Invite campaign labels**: assign custom labels to invite codes (e.g. `twitter-campaign`, `youtube-promo`) via `/invite-label` or the dashboard to track where traffic comes from.
- **Safety & AutoMod**: view and configure Discord AutoMod rules directly from the dashboard (keyword filters, mention spam, spam presets, member profiles, server verification levels).
- **Web dashboard**: live event feed over WebSocket, 7-day join/leave charts, invite code manager, server safety controls, and a built-in simulator for sandbox testing.
- **Fast & light**: uses `bun:sqlite` (with `better-sqlite3` fallback for Node.js) with WAL mode for fast local storage.

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
   Open `.env` and fill in your credentials:
   - `DISCORD_TOKEN`: Bot token
   - `CLIENT_ID`: Application client ID
   - `CLIENT_SECRET`: OAuth2 client secret (for dashboard login)
   - `SESSION_SECRET`: Random secret string for session cookies

3. Deploy slash commands:
   ```bash
   bun run deploy-commands
   ```

4. Start the application:
   ```bash
   bun dev
   ```
   The dashboard runs at `http://localhost:3000`.

> **Sandbox Mode:** If `DISCORD_TOKEN` is left blank or `DEMO_MODE=true` is set in `.env`, the bot and dashboard run in simulated sandbox mode so you can test all features without connecting to live Discord.

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

Run the test suite:

```bash
bun test
# or
bun run tests/runAll.js
```

## License

MIT
