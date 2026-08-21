const express = require('express');
const { ChannelType } = require('discord.js');
const { ValidationError } = require('../errors');

const TEXT_CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

/** Dashboard routes for the per-guild honeypot assignment and counter. */
function createHoneypotRoutes({ honeypotService, guildService }) {
  const router = express.Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    res.json(await honeypotService.getDashboard(req.params.guildId));
  });

  router.patch('/', async (req, res) => {
    const body = req.body || {};
    const rawChannelId = Object.prototype.hasOwnProperty.call(body, 'channelId')
      ? body.channelId
      : body.channel_id;
    if (rawChannelId === undefined) {
      throw new ValidationError('channelId is required. Use null to disable the honeypot.');
    }

    const channelId = rawChannelId == null ? '' : String(rawChannelId).trim();
    if (!channelId) {
      await honeypotService.disable(req.params.guildId);
      return res.json({ success: true, honeypot: null });
    }

    const channels = await guildService.listChannels(req.params.guildId);
    const channel = channels.find((candidate) => candidate.id === channelId);
    if (!channel || !TEXT_CHANNEL_TYPES.has(channel.type)) {
      throw new ValidationError('Honeypot channel must be a text or announcement channel belonging to this guild.');
    }

    const honeypot = await honeypotService.configure({
      guildId: req.params.guildId,
      channelId,
    });
    const dashboard = await honeypotService.getDashboard(req.params.guildId);
    res.json({ success: true, ...dashboard, honeypot });
  });

  return router;
}

module.exports = { createHoneypotRoutes };
