# Mochi

Mochi is a Discord bot for invite tracking. It has a live web dashboard. It uses Bun and SQLite.

## Quick start

Requirements:

- [Bun](https://bun.sh) 1.3 or later
- A Discord bot application from the [Discord Developer Portal](https://discord.com/developers/applications)

```bash
git clone https://github.com/SodaSyrup/mochi-bot.git
cd mochi-bot
bun install
cp .env.example .env
bun run deploy-commands
bun dev
```

The landing page is available at <http://localhost:3000>. Open the dashboard at <http://localhost:3000/dashboard>. Configure `.env` before deployment. Production checks more settings at startup than development.

## What Mochi provides

- Invite attribution, net-invite tracking, campaign labels, leaves, rejoins, vanity URLs, and suspicious-account handling
- Configurable invite logs for joins, leaves, and bot add/remove activity
- A dashboard with live events, analytics, invite management, AutoMod controls, category permission groups, a honeypot, and plugin settings
- Optional global protection using a centrally managed Cloudflare D1 registry, local caching, per-guild alert/enforcement modes, and exemptions
- Discord OAuth, per-guild authorization, authenticated realtime rooms, and server-side sessions
- Explicit built-in plugins for utility commands, invites, invite logs, safety, grouped category permissions, and honeypot moderation

## Documentation

Read the [documentation home](docs/README.md) for the full guides:

- [Getting started](docs/getting-started.md) — installation, environment configuration, and application modes
- [Deployment and operations](docs/operations.md) — PM2, database maintenance, migrations, projections, and tests
- [Invite tracking](docs/features/invites.md) — attribution, invite math, invite logs, and Discord permissions
- [Moderation features](docs/features/moderation.md) — AutoMod and the honeypot
- [Global protection](docs/features/global-bans.md) — Cloudflare D1 registry synchronization and per-guild enforcement
- [Permission groups](docs/features/permission-groups.md) — shared role permissions across project categories
- [Dashboard](docs/dashboard.md) — pages, access, and dashboard behavior
- [Plugins](docs/plugins.md) — built-in catalog, lifecycle, dependencies, and per-guild settings
- [Slash commands](docs/commands.md) — command reference and native Discord permissions
- [Architecture and contracts](docs/architecture.md) — security model, database design, and realtime DTOs
