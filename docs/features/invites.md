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

## Import InviteLogger history

Use **Dashboard → Settings → Import invite data**. Save the channel under
**Invite logs** first. Mochi reads only messages from the selected bot in that
channel. It does not import the invite totals shown in those messages.

1. Leave the bot ID blank to find the server bot named `InviteLogger`. If its
   name has changed or the bot has left the server, enter its Discord user ID.
2. Select how many channel messages to scan, up to 5,000. This limit includes
   messages from other users and bots.
3. Select **Preview import**. Review the member IDs, inviter IDs, dates, and
   source messages. No invite records change during the preview.
   The scan runs in the background. The page shows progress while short
   requests check its status. Discord rate limits and large histories can take
   time without holding one HTTP request open. A repeated request with the same
   options resumes the running scan. Scan state is lost when Mochi restarts.
4. Select **Apply preview** within ten minutes. Mochi repairs the invite history
   and rebuilds member records, inviter totals, and daily statistics in one
   database transaction. It does not post new join or leave messages.
5. Use **Preview older messages** to read the next part of the channel history.
   Apply any changes you want to keep before moving to the next preview.
   Mochi keeps pending messages from earlier pages so it can pair a leave with
   a join on an older page. This scan state expires with the preview. A scan can
   retain up to 10,000 pending messages. A manual cursor starts a separate scan.

Mochi accepts the supplied InviteLogger format, in message text or an embed
description:

```text
**<@288090980974985216>** just joined. They were invited by **salad6969** who now has **36 invites** !
```

It also accepts a bold username in place of the member mention, an inviter
mention in place of the inviter username, and the corresponding `left` wording.
Names must match the exact username or legacy username with discriminator of
one current server member. Display names are not used. Names can change or be
reused, so review each name match before applying the preview. Changed names,
departed users without IDs, unsupported formats, and ambiguous matches are
listed under skipped messages.

The message time must be within two minutes of one recorded join or leave.
Mochi fills missing attribution for that membership period. It preserves
timestamps, invite codes, and fake-account flags. A known, conflicting inviter
or vanity attribution is never replaced. Conflicting messages for the same
membership period are also skipped.

A missing current join can be restored when Discord confirms the member and
join time. A missing historical period needs matching join and leave messages
with the same inviter. The period must not overlap recorded history or conflict
with current Discord membership. Mochi verifies the member is a human account
and applies its normal fake-account policy to each restored join. Historical
periods are inserted in time order. Existing period numbers can increase, but
their events and source references are kept. Unpaired history is skipped.
If a current member's current join is missing, reconcile server members first
or include the current join message in the scan. This keeps their membership
record active when older periods are restored.
Deleted messages cannot be recovered.

Each applied source message ID is stored in `invite_log_imports`. Repeat scans
cannot give duplicate credit. If invite history changes after a preview, Mochi
requires a new preview. Previews are lost when Mochi restarts.

Reading history requires **View Channel** and **Read Message History**. The
**Message Content** intent must be enabled for Mochi in the Discord Developer
Portal. Member lookup also requires Mochi's normal **Server Members** intent.
This feature is a manual import. It does not read future InviteLogger messages
automatically.

### User log embeds

Select **User logs — joined, left, and updated** as the log format. Select the user
log channel under **Source channel**. This does not change the channel where
Mochi posts invite logs. Leave the bot ID blank to find `Salad Bot` or `SaladBot`,
or enter the source bot's Discord user ID.
An explicit ID works when the source bot has left the server. Name lookup
requires the bot to still be present. History is still filtered by the message
author's ID and bot flag.
Member-list requests that run at the same time share one fetch. Mochi retries
Discord gateway rate limits after the specified delay, up to two times. If the
member list remains unavailable, an explicit source bot ID still allows logs
with user IDs to repair recorded membership periods. The preview explains this
restriction. Username lookup, restoring new periods, and confirming a missing
departure require a verified member list. A failed list fetch is never treated
as proof that a member has left the server.

Mochi reads `Member Joined`, `Member left`, `Member Roles Updated`, and
`Member Updated` embeds. Each embed is separate evidence, including when one
message contains a leave and a later join. The `User ID` and `Invited By` fields
identify the member and inviter. `Updated By` identifies the person who changed
the roles. It is never used as the inviter. Role names and role IDs do not
change invite counts.

`Invited By` must contain a user mention, a Discord user ID, or an exact, unique
server username. `Joined At` (or `Joined` in a leave embed) must contain a Discord timestamp such as
`<t:1740000000:R>` or an ISO timestamp with a timezone. Discord can display an
exact timestamp as relative text. Literal text such as `10 months ago` alone
is skipped because it cannot identify the join time.

At the server owner's request, explicit `Unknown` or `Unkown` inviter values
default to user ID `772509343916359740`. The preview marks each assumed
inviter. Change or clear **Assign unknown inviters in user logs to this user ID**
to change or disable this fallback. Missing inviter fields, unrecognized names,
vanity values, and known conflicting inviters are not replaced by the fallback.
The source record stores `inviter_assumed = 1` for each applied fallback.
Explicit inviter evidence takes priority over a conflicting assumption.

Join and leave embeds use their exact field timestamps, rather than the message
creation time. A leave embed also uses `Left At`. It can prove a complete closed
membership period using `Joined` and `Left At`, or restore a missing departure
for a recorded join when Discord confirms the person is no longer in that
period. A current join still requires Discord membership confirmation.

For existing records, the exact user log join time must match within one second
to allow for Discord timestamp rounding. The role update must have occurred
during the recorded period. This prevents an old log from assigning an inviter
to a later rejoin. Updated logs repair inviter data; they never create a join or
leave. The normal preview, conflict checks, source records, and duplicate
protection apply separately to each embed. Previous source records are kept
when the database adds support for several embeds in one message.
