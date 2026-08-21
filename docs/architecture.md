# Architecture and contracts

## Security model

- The dashboard requires Discord OAuth2 with the `identify` and `guilds` scopes.
- OAuth login uses a cryptographically random `state` value stored in the session and validated on callback.
- Only guilds the user can manage and that Mochi belongs to are listed or accessible. Per-guild routes return `403` otherwise.
- Guild owners are recognized dynamically from Discord for each server; no global owner ID is required.
- There is no implicit development admin. When `APP_MODE=development`, `DEV_AUTH_BYPASS=true`, and the request is loopback-only, `/auth/login` may establish a clearly logged “Development Admin” session without OAuth. With the bypass disabled, missing OAuth configuration simply makes login unavailable. `DEV_AUTH_BYPASS=true` is forbidden in production, where startup fails.
- Guild-management permissions are fetched from Discord at login and cached in the session only until `GUILD_PERMISSION_CACHE_TTL_SECONDS` expires. Mochi refreshes them before protected operations. Revoked or invalid OAuth authorization fails closed with `401` instead of reusing stale permissions.
- OAuth access and refresh tokens remain server-side in `session.discordOAuth` for refresh support. They are never sent to browser JavaScript, returned in API JSON, or logged. `/auth/user` returns only safe public user fields.
- All `/api/guilds/**` endpoints require authentication and per-guild authorization. `/api/stats` (non-sensitive global telemetry) and `/api/health` are intentionally public for operational health checks; everything else under `/api` is protected.
- Socket.IO uses the shared Express session for authentication. Room membership is authorized per guild, and events are delivered only to the authorized guild room, never globally.
- Session cookies are `httpOnly`, `sameSite=lax`, and `secure` in production. The cookie name is non-default: `mochi.sid`.
- Sessions are stored server-side in SQLite at `SESSION_STORE_PATH` (`./data/mochi-sessions.sqlite` by default), so PM2 restarts do not force users to log in again. Keep this database on persistent storage. Horizontally scaled deployments need a shared session store instead of the local SQLite file.

## Realtime transport contract

Socket.IO forwards canonical application events to authorized guild rooms through documented transport DTOs in `src/dashboard/realtime/eventMappers.js`. The frontend consumes these exact shapes; there are no `user` or `member` aliases.

### `memberJoin` and `memberLeave`

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

### `inviteCreated`

```json
{
  "guildId": "...",
  "invite": {
    "code": "...",
    "url": "...",
    "uses": 0,
    "maxUses": 0,
    "maxAge": 0,
    "temporary": false,
    "channelId": "...",
    "channelName": "...",
    "inviter": { "id": "...", "username": "..." },
    "createdAt": "...",
    "label": null
  },
  "occurredAt": "..."
}
```

Other event shapes:

- `inviteDeleted` → `{ guildId, code, occurredAt }`
- `inviteLabelUpdated` → `{ guildId, code, label, channelId, channelName, occurredAt }`
- `autoModExecution` → flat `{ guildId, ruleId, ruleName, action, user, ... }`
- `autoModRuleUpdated` → `{ guildId, action, ruleId, name, enabled }`

## Data responsibilities

The database layer separates durable facts from rebuildable read models:

```text
invite_events + invite_bonus_adjustments
                │
                ├── inviter_stats (canonical net totals)
                ├── invite_members
                ├── inviters
                └── daily_invite_stats
```

The invite cache is a fallback for Discord query failures, not a competing source of truth. See [Invite tracking](features/invites.md) and [Deployment and operations](operations.md) for the domain rules and maintenance commands.
