const express = require('express');
const os = require('os');
const { discordDefaultAvatar } = require('../../platform/discord/urls');

/**
 * Global telemetry + health. `/stats` is intentionally public (non-sensitive
 * bot telemetry); `/health` exists for operational health checks.
 */
function createStatsRouter({ client, guildGateway, config }) {
  const router = express.Router();

  router.get('/stats', async (req, res) => {
    const guilds = (await guildGateway.listGuilds()) || [];
    const totalMembers = guilds.reduce((acc, g) => acc + (g.memberCount || 0), 0);
    const memUsage = process.memoryUsage();
    const isBotConnected = Boolean(client?.user && client?.isReady && client.isReady());

    res.json({
      bot: {
        name: client?.user?.username || 'Mochi',
        tag: client?.user?.tag || 'Mochi#0000',
        avatar: client?.user?.displayAvatarURL?.() || discordDefaultAvatar(2),
        connected: isBotConnected,
        ping: isBotConnected ? client?.ws?.ping : 0,
        uptime: process.uptime(),
      },
      appMode: config.app.mode,
      telemetry: {
        serverCount: guilds.length,
        memberCount: totalMembers,
        ramMB: (memUsage.heapUsed / 1024 / 1024).toFixed(1),
        runtimeVersion: Bun.version,
        platform: `${os.type()} ${os.release()}`,
      },
    });
  });

  router.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  return router;
}

module.exports = { createStatsRouter };
