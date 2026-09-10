# Getting started

## Prerequisites

- [Bun](https://bun.sh) 1.3 or later
- A Discord bot application from the [Discord Developer Portal](https://discord.com/developers/applications)

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/SodaSyrup/mochi-bot.git
cd mochi-bot
bun install
```

Create the local configuration file:

```bash
cp .env.example .env
```

Enter the Discord credentials and dashboard settings in `.env`. `.env.example` lists every supported option, including production requirements.

Deploy slash commands and start the application:

```bash
bun run deploy-commands
bun dev
```

The dashboard runs at <http://localhost:3000> by default.

## Application modes

Mochi runs in exactly one explicit mode, selected by `APP_MODE`:

| Mode | Behavior |
| --- | --- |
| `development` | Can connect to live Discord when credentials exist. The development auth bypass needs explicit opt-in. |
| `production` | Requires `DISCORD_TOKEN`, `CLIENT_ID`, `CLIENT_SECRET`, unique `SESSION_SECRET`, and valid dashboard URLs. Startup stops if a requirement is missing. |

For local dashboard work, `DEV_AUTH_BYPASS=true` can create a development-only
admin session. This works only when `APP_MODE=development` and the request comes
from the local host. The setting is disabled by default and is forbidden in
production.

## Discord application setup

Mochi registers application commands for server installation. In the Discord
Developer Portal, keep **Guild Install** enabled. Include both the `bot` and
`applications.commands` scopes in the default install settings.

The [Slash commands](commands.md) and [Moderation features](features/moderation.md) guides list command access and feature-specific permissions.

## Important environment variables

The full reference is in `.env.example`. These settings are especially important:

| Variable | Purpose |
| --- | --- |
| `APP_MODE` | Selects `development` or `production`. |
| `DISCORD_TOKEN`, `CLIENT_ID`, `CLIENT_SECRET` | Discord bot and OAuth credentials. |
| `DASHBOARD_URL` | Public dashboard URL. Mochi uses it to derive the OAuth callback unless `REDIRECT_URI` is set. |
| `SESSION_SECRET` | Unique secret required in production. |
| `SESSION_STORE_PATH` | Persistent SQLite session store; defaults to `./data/mochi-sessions.sqlite`. |
| `DATABASE_PATH` | Application database; defaults to `./data/mochi.sqlite`. |
| `GUILD_PERMISSION_CACHE_TTL_SECONDS` | Maximum cache time for Discord server-management permissions. The default is 600 seconds. |
| `FAKE_ACCOUNT_THRESHOLD_DAYS` | Minimum account age before an account is considered trusted; defaults to 7 days. |
| `DISABLED_PLUGINS` | Comma-separated list of built-in plugins disabled globally. |

Keep `.env`, the application database, and the session database out of source control. Use persistent storage for both databases in production.
