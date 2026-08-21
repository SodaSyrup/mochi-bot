# Invite tracking

Mochi records invite activity per guild and keeps attribution separate from Discord user identity. It handles regular invites, vanity URLs, leaves, rejoining members, suspicious accounts, bot joins, and campaign labels.

## Invite math

Net invites are always computed as:

```text
total = regular + bonus - leaves - fake
```

This definition lives in the `inviter_stats` database view. Routes, commands, and the frontend use that canonical value rather than recomputing it.

- **regular** — attributed `INVITE` joins. A normal invite join increments `regular` even if the member is later classified as suspicious.
- **bonus** — manual adjustment credit from `invite_bonus_adjustments`.
- **leaves** — departures that remove previously earned invite credit. A member already excluded by the fake counter is not double-penalized.
- **fake** — attributed invite joins classified as suspicious. A suspicious invite contributes `regular +1` and `fake +1`, so it earns zero net credit.

The minimum account age used for suspicious-account classification is configured by `FAKE_ACCOUNT_THRESHOLD_DAYS`.

## Attribution types

Membership attribution is stored independently of Discord user IDs:

| Type | Meaning |
| --- | --- |
| `INVITE` | Credited to a specific Discord inviter through an invite code. |
| `VANITY` | Joined through the guild vanity URL. |
| `UNKNOWN` | Attribution was ambiguous or unavailable; Mochi never guesses. |
| `RECONCILED` | Discovered during authoritative member reconciliation; never earns invite credit. |

`inviter_id` means exactly one thing: a Discord user ID, or `null`.

## Invite labels

Assign labels such as `twitter-campaign` or `youtube-promo` to invite codes with `/invite-label` or from the dashboard. Labels make it possible to track where traffic came from without changing invite attribution.

## Invite logs

Configure logging per guild at **Dashboard → Settings → Invite logs** by selecting a channel. Mochi posts plain-text messages for member joins, leaves, and bot add/remove activity.

- Human joins show the member, inviter, and inviter's updated net total from the canonical `inviter_stats` view. Suspicious accounts retain their normal counting semantics and are still logged.
- Human leaves show the recorded inviter.
- UNKNOWN attribution is never guessed. Joins say that Mochi could not determine who invited the member; leaves say that there is no recorded inviter.
- Vanity joins and leaves have dedicated wording.
- Bots use separate `🤖` messages and are never counted as invites. They never enter `invite_members`, `invite_events`, or inviter totals.
- Bot-adder attribution is read from the Discord audit log and persisted in `bot_attributions`, so a later removal can still identify who originally added the bot after a restart.
- If the log channel is deleted or Mochi lacks permission, invite processing continues. The failure is logged and the channel remains configured until an administrator changes it.

## Required Discord permissions

| Feature | Permission |
| --- | --- |
| Sending invite logs | `View Channel` and `Send Messages` on the configured channel |
| Resolving who added a bot | `View Audit Log` at the server level |

Without `View Audit Log`, bot messages fall back to “I couldn't determine who added it”; human invite logging is unaffected.
