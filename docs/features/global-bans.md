# Global protection

Mochi can synchronize a centrally curated Discord user registry from a
Cloudflare D1 database through a narrow Cloudflare Worker API. The feature is
safe by default: every guild starts in `disabled` mode and must explicitly
choose `alert` or `enforce` in the dashboard.

## Modes

- `disabled`: the registry is not used for this guild.
- `alert`: listed joins are reported to the configured channel.
- `enforce`: listed users are permanently banned, including during background
  reconciliation.

Guild-local exemptions are checked before enforcement. Mochi never automatically
unbans a user when a global entry is revoked; revocation creates a review
notice instead so an independent local ban is not accidentally removed.

## Deployment

The Worker project is in `cloudflare/global-bans`. Create a D1 database, replace
`database_id` in `wrangler.jsonc`, and apply the migration:

```sh
cd cloudflare/global-bans
npx wrangler d1 migrations apply mochi-global-bans --remote
npx wrangler secret put SYNC_TOKEN
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

The Mochi process only receives the Worker URL and read-only synchronization
token. It must not receive a Cloudflare account API token.

```dotenv
GLOBAL_BANS_API_URL=https://global-bans.example.com
GLOBAL_BANS_SYNC_TOKEN=...
```

In production the feature remains operationally degraded when the Worker is
unreachable. Mochi uses its local cache while it is fresh, then falls back to
alerts after the configured maximum cache age. The global enforcement kill
switch is `GLOBAL_BANS_ENFORCEMENT_ENABLED=false`.

## Administrative mutations

The administrative Worker API uses a separate token and requires an
`Idempotency-Key` header. Entries are proposed first and activated explicitly.
Administrative requests should also send `X-Operator-Id` so the D1 audit log
identifies the responsible operator.

The bot runtime cannot activate or revoke entries. Its token can only read the
snapshot and ordered change feed.

## Owner-only registry dashboard

The Mochi dashboard also supports an optional owner-only **Global registry**
page. It is available only to the Discord user IDs listed in
`GLOBAL_BANS_ADMIN_USER_IDS` on that Mochi instance. Configure the same value
used by the Worker secret `ADMIN_TOKEN` as `GLOBAL_BANS_ADMIN_TOKEN`:

```dotenv
GLOBAL_BANS_ADMIN_USER_IDS=123456789012345678
GLOBAL_BANS_ADMIN_TOKEN=...
```

The browser talks only to Mochi's authenticated dashboard API; the Worker
admin token is never sent to the browser. Registry entries are proposed first
and then explicitly activated, rejected, revoked, or reopened. Every mutation
uses an idempotency key, optimistic version checks, an operator Discord ID,
and the Worker audit feed.

The ordinary `Global protection` page remains guild-scoped. Guild owners and
moderators can configure alert/enforce mode there, but do not receive central
registry access unless their Discord ID is in the explicit allowlist.

## Local-ban recommendations

The owner-only registry page includes a **Recommended from this server** panel.
After selecting a manageable server in the dashboard guild picker, Mochi reads
that server's Discord ban list (the bot needs the `Ban Members` permission),
checks each user against the central registry, and marks only users with no
existing record as eligible. **Use suggestion** copies the local user ID and
ban reason into the proposal form; it never creates, activates, or otherwise
mutates a global entry. Registry lookups are bounded and briefly cached, and
the panel fails closed when the central registry cannot be verified.
