# Dashboard

The dashboard uses Discord OAuth2 and authorizes access per server. It lists only servers that the signed-in user can manage and that Mochi has joined.

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Server overview, quick stats, and live event feed |
| `/analytics` | Seven-day join-versus-leave trends and conversion metrics |
| `/leaderboard` | Complete server inviter rankings |
| `/codes` | Active invite codes, usage counters, and custom labels |
| `/safety` | Discord AutoMod rules and server security settings |
| `/honeypot` | Decoy-channel configuration and softban counter |
| `/permission-groups` | Shared role-permission layers for multiple Discord categories |
| `/settings` | Bot connection status and application configuration, including invite logs |
| `/plugins` | Enable or disable built-in plugins for the selected server |

Plugin switches are per server and require Manage Server access. A plugin is enabled by default until a server setting changes it.

Dependencies are checked when a setting changes. Enable dependencies first.
Disable dependent plugins first. The application-level `DISABLED_PLUGINS`
setting always takes precedence. It appears as a locked plugin entry.

## Realtime feed

The live feed uses authenticated Socket.IO rooms. Events are sent only to the
authorized server room. The event payload contract is documented in
[Architecture and contracts](architecture.md#realtime-transport-contract).

## Access behavior

Mochi fetches server-management permissions from Discord at login and stores
them in the session. The snapshot expires after
`GUILD_PERMISSION_CACHE_TTL_SECONDS` (600 seconds by default). Mochi refreshes
it before a protected operation continues. A revoked or invalid OAuth
authorization returns `401`. The user must sign in again.
