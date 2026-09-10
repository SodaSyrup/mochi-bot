# Slash commands

Mochi registers these application commands:

| Command | Description | Default permission |
| --- | --- | --- |
| `/invites [user]` | Check invite stats: net, regular, bonus, leaves, and fake | Everyone |
| `/leaderboard [page]` | View the server invite leaderboard | Everyone |
| `/invite-codes [user]` | List active invite links and usage counts | Everyone |
| `/invite-label <code> [label]` | Set or remove a campaign label on an invite link | Manage Server |
| `/serverinfo` | Show server details, channel counts, and invite telemetry | Everyone |
| `/userinfo [user]` | Show account information, join date, and inviter | Everyone |
| `/botinfo` | Show bot system telemetry and uptime | Everyone |
| `/ping` | Show WebSocket latency | Everyone |
| `/help` | Show the command reference and dashboard link | Everyone |
| `/honeypot <channel>` | Enable or move the softban honeypot | Manage Server |

## Native Discord command permissions

Discord manages access to application commands. After installing Mochi, open
**Server Settings → Integrations → Mochi → Manage**. Members with **Manage
Server** and **Manage Roles**, and administrators, can allow or deny commands
for roles, members, and channels.

The default **Manage Server** commands are `/invite-codes`, `/invite-label`, and
`/honeypot`. The other commands are available to everyone by default. Discord's
per-command integration settings can change this access.

Re-run command deployment after changing command metadata:

```bash
bun run deploy-commands
```
