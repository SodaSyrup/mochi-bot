# Architecture and contracts

## Security model

- The dashboard requires Discord OAuth2 with the `identify` and `guilds` scopes.
- OAuth login uses a cryptographically random `state` value stored in the session and validated on callback.
- Mochi lists only servers that the user can manage and that Mochi has joined. Per-server routes return `403` for other servers.
- Discord provides the owner for each server. Mochi does not need a global owner ID.
- Mochi has no implicit development admin. `/auth/login` can create a
  “Development Admin” session only when `APP_MODE=development`,
  `DEV_AUTH_BYPASS=true`, and the request comes from the local host. The
  session is logged. Without the bypass, missing OAuth settings make login
  unavailable. `DEV_AUTH_BYPASS=true` is forbidden in production. The
  application does not start when it is set there.
- Mochi fetches server-management permissions from Discord at login. It stores
  them in the session until `GUILD_PERMISSION_CACHE_TTL_SECONDS` expires. Mochi
  refreshes them before protected operations. A revoked or invalid OAuth
  authorization returns `401`. Mochi does not use stale permissions.
- OAuth access and refresh tokens stay on the server in `session.discordOAuth`.
  Mochi uses them to refresh access. Mochi never sends them to browser
  JavaScript, returns them in API JSON, or writes them to logs. `/auth/user`
  returns only safe public user fields.
- All `/api/guilds/**` endpoints require authentication and per-server
  authorization. `/api/stats` provides non-sensitive global telemetry.
  `/api/health` is public for health checks. All other `/api` routes are
  protected.
- Socket.IO uses the shared Express session for authentication. Mochi authorizes room membership per server. It sends events only to the authorized server room.
- Session cookies are `httpOnly`, `sameSite=lax`, and `secure` in production. The cookie name is non-default: `mochi.sid`.
- Sessions are stored on the server in SQLite at `SESSION_STORE_PATH`
  (`./data/mochi-sessions.sqlite` by default). PM2 restarts do not force users
  to log in again. Keep this database on persistent storage. Horizontally
  scaled deployments need a shared session store instead of the local SQLite
  file.

## Realtime transport contract

Socket.IO forwards canonical application events to authorized server rooms. The
transport DTOs are defined in `src/dashboard/realtime/eventMappers.js`. The
frontend uses these exact shapes. The payloads have no `user` or `member`
aliases.

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

The invite cache is a fallback for Discord query failures. It is not a second
source of truth. See [Invite tracking](features/invites.md) and [Deployment and
operations](operations.md) for domain rules and maintenance commands.
