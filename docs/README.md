# Mochi documentation

Mochi is a Discord bot for invite tracking, server safety, and real-time dashboard administration.

## Start here

1. Follow [Getting started](getting-started.md) to install Mochi and configure Discord.
2. Read [Deployment and operations](operations.md) before running a persistent instance.
3. Use the feature guides for [invite tracking](features/invites.md),
   [moderation](features/moderation.md), [global protection](features/global-bans.md),
   and [permission groups](features/permission-groups.md).

## Guides

| Guide | Covers |
| --- | --- |
| [Getting started](getting-started.md) | Prerequisites, installation, environment variables, and application modes |
| [Deployment and operations](operations.md) | PM2, tests, migrations, projections, and database maintenance |
| [Invite tracking](features/invites.md) | Invite semantics, attribution, invite logs, and required permissions |
| [Moderation features](features/moderation.md) | AutoMod controls and honeypot moderation |
| [Global protection](features/global-bans.md) | Centrally managed ban registry, synchronization, enforcement modes, and operations |
| [Permission groups](features/permission-groups.md) | Shared role permissions across multiple project categories |
| [Dashboard](dashboard.md) | Dashboard pages, access rules, and live event behavior |
| [Plugins](plugins.md) | Plugin catalog, lifecycle, dependencies, and configuration |
| [Slash commands](commands.md) | Command reference and Discord command permissions |
| [Architecture and contracts](architecture.md) | Security, database responsibilities, and Socket.IO payloads |

## Configuration reference

`.env.example` lists all environment variables and their default values. The [Getting started](getting-started.md) guide explains the settings for local and production deployments.
