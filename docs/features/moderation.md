# Moderation features

## AutoMod and server safety

The dashboard can view and configure Discord AutoMod rules and server safety settings, including:

- Keyword filters
- Mention-spam protection
- Discord spam presets
- Member profiles
- Server verification levels

AutoMod execution and rule changes are also exposed through the authenticated realtime event feed. See the [realtime contract](../architecture.md#realtime-transport-contract) for payload shapes.

## Honeypot

Use `/honeypot #channel` to assign or move the softban honeypot. Mochi posts and pins a warning banner in the channel, then softbans members who send messages there. A softban is a ban followed by an immediate unban: it removes the member and recent messages without keeping a permanent ban.

The banner is edited after each successful trigger, and its persistent kick count is stored in SQLite.

Mochi needs these permissions in the honeypot channel/server:

- `View Channel`
- `Send Messages`
- `Embed Links`
- `Ban Members`

Enable Discord's **Message Content Intent** for the application because the feature listens for message creation events.
