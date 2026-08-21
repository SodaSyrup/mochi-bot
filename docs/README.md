# Mochi documentation

Mochi is a Discord bot for invite tracking, server safety, and realtime dashboard administration.

## Start here

1. Follow [Getting started](getting-started.md) to install Mochi and configure Discord.
2. Read [Deployment and operations](operations.md) before running a persistent instance.
3. Use the feature guides for [invite tracking](features/invites.md) and [moderation](features/moderation.md).

## Guides

| Guide | Covers |
| --- | --- |
| [Getting started](getting-started.md) | Prerequisites, installation, environment variables, and application modes |
| [Deployment and operations](operations.md) | PM2, tests, migrations, projections, and database maintenance |
| [Invite tracking](features/invites.md) | Invite semantics, attribution, invite logs, and required permissions |
| [Moderation features](features/moderation.md) | AutoMod controls and honeypot moderation |
| [Dashboard](dashboard.md) | Dashboard pages, access rules, and live event behavior |
| [Plugins](plugins.md) | Plugin catalog, lifecycle, dependencies, and configuration |
| [Slash commands](commands.md) | Command reference and Discord command permissions |
| [Architecture and contracts](architecture.md) | Security, database responsibilities, and Socket.IO payloads |

## Configuration reference

`.env.example` is the authoritative list of environment variables and defaults. The [Getting started](getting-started.md) guide explains the values that matter for local and production deployments.
