# Dashboard

The dashboard uses Discord OAuth2 and authorizes access per guild. Only guilds that the signed-in user can manage and that Mochi belongs to are listed and accessible.

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Server overview, quick stats, and live event feed |
| `/analytics` | Seven-day join-versus-leave trends and conversion metrics |
| `/leaderboard` | Complete server inviter rankings |
| `/codes` | Active invite codes, usage counters, and custom labels |
| `/safety` | Discord AutoMod rules and server security settings |
| `/honeypot` | Decoy-channel configuration and softban counter |
| `/settings` | Bot connection status and application configuration, including invite logs |
| `/plugins` | Enable or disable built-in plugins for the selected server |

Plugin switches are per guild and require Manage Server access. A plugin is enabled by default unless a setting has been saved for that guild. Dependencies are enforced when changing state: dependencies must be enabled first, and dependents must be disabled first. The application-level `DISABLED_PLUGINS` setting always takes precedence and appears as a locked plugin entry.

## Realtime feed

The live feed is delivered over authenticated Socket.IO rooms. Events are sent only to the authorized guild room. The event payload contract is documented in [Architecture and contracts](architecture.md#realtime-transport-contract).

## Access behavior

Guild-management permissions are fetched from Discord at login and cached in the session. The snapshot expires after `GUILD_PERMISSION_CACHE_TTL_SECONDS` (600 seconds by default), then Mochi refreshes it before protected operations continue. A revoked or invalid OAuth authorization fails closed with `401`, requiring sign-in again.
