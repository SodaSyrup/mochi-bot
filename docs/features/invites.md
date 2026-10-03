# Invite tracking

Mochi records invite activity per server. It keeps attribution separate from
Discord user identity. It handles regular invites, vanity URLs, leaves,
returning members, suspicious accounts, bot joins, and campaign labels.

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

### Single-use invites

Discord can remove a single-use invite before Mochi reads its final use count.
Mochi keeps deleted-invite details for 30 seconds. It checks unresolved joins
up to three times, with 500 milliseconds between checks.

A disappeared invite can be credited when it had zero uses and a one-use
limit, has not expired, disappeared near the join, and is the only candidate.
Mochi also checks the recent Discord audit log for manual deletion. This
fallback requires **View Audit Log**. Missing or incomplete audit data,
conflicting invite changes, or unavailable vanity usage keep the result
UNKNOWN. Dashboard revocations are excluded.

This fallback is an inference from invite state. Discord does not provide the
invite code in a member join event. A delayed audit entry or missing gateway
events can still prevent a correct match. Recent deleted-invite data is kept
in memory and does not survive a restart. Mochi logs the decision reason for
each live join.

## Invite labels

Assign labels such as `twitter-campaign` or `youtube-promo` to invite codes with
`/invite-label` or the dashboard. Labels show where traffic came from without
changing invite attribution.

## Invite logs

Configure logging for each server at **Dashboard → Settings → Invite logs**.
Select a channel. Mochi posts plain-text messages for member joins, leaves, and
bot add or remove activity.

- Human joins show the member, inviter, and the inviter's updated net total from
  the canonical `inviter_stats` view. Suspicious accounts keep their normal
  counting rules and are still logged.
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

Without `View Audit Log`, bot messages say that Mochi could not determine who added the bot. Human invite logging is not affected.
