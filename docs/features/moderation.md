# Moderation features

## AutoMod and server safety

The dashboard can view and configure Discord AutoMod rules and server safety settings. It supports:

- Keyword filters
- Mention-spam protection
- Discord spam presets
- Member profiles
- Server verification levels

The authenticated real-time event feed also reports AutoMod actions and rule
changes. See the [real-time contract](../architecture.md#realtime-transport-contract)
for payload formats.

## Honeypot

Use `/honeypot #channel` to assign or move the softban honeypot. Mochi posts and pins a warning banner in the channel. It then softbans members who send messages there.

A softban bans a member and then unbans the member. It removes the member and recent messages without keeping a permanent ban.

The banner is edited after each successful trigger, and its persistent kick count is stored in SQLite.

Mochi needs these permissions in the honeypot channel/server:

- `View Channel`
- `Send Messages`
- `Embed Links`
- `Ban Members`

Enable Discord's **Message Content Intent** for the application. The feature needs this intent to receive message creation events.
