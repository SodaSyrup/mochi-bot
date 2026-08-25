const express = require('express');
const { ValidationError } = require('../errors');
const { MODES, normalizeUserId } = require('../../features/globalBans/domain/globalBanPolicy');

function createGlobalBanRoutes({ globalBanService, guildService }) {
  const router = express.Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    const dashboard = await globalBanService.getDashboard(req.params.guildId);
    dashboard.channels = await guildService.listChannels(req.params.guildId);
    res.json(dashboard);
  });

  router.patch('/settings', async (req, res) => {
    const body = req.body || {};
    if (!MODES.includes(body.mode)) throw new ValidationError(`mode must be one of: ${MODES.join(', ')}.`);
    let logChannelId = body.logChannelId === undefined ? undefined : (body.logChannelId || null);
    if (logChannelId) {
      const channels = await guildService.listChannels(req.params.guildId);
      if (!channels.some((channel) => channel.id === String(logChannelId))) throw new ValidationError('logChannelId must belong to this guild.');
      logChannelId = String(logChannelId);
    }
    const deleteMessageSeconds = body.deleteMessageSeconds === undefined ? 0 : Number(body.deleteMessageSeconds);
    if (!Number.isInteger(deleteMessageSeconds) || deleteMessageSeconds < 0 || deleteMessageSeconds > 7 * 24 * 60 * 60) {
      throw new ValidationError('deleteMessageSeconds must be an integer between 0 and 604800.');
    }
    const settings = await globalBanService.updateSettings(req.params.guildId, {
      mode: body.mode,
      logChannelId,
      deleteMessageSeconds,
      updatedBy: req.session?.discordUser?.id || req.session?.user?.id || null,
    });
    res.json({ success: true, settings });
  });

  router.get('/exemptions', (req, res) => {
    res.json({ exemptions: globalBanService.repository.listExemptions(req.params.guildId) });
  });

  router.post('/exemptions', (req, res) => {
    const userId = normalizeUserId(req.body?.userId || req.body?.user_id);
    if (!userId) throw new ValidationError('A valid Discord user ID is required.');
    const exemption = globalBanService.addExemption(req.params.guildId, userId, {
      reason: req.body.reason,
      expiresAt: req.body.expiresAt || null,
      createdBy: req.session?.discordUser?.id || req.session?.user?.id || null,
    });
    res.status(201).json({ success: true, exemption });
  });

  router.delete('/exemptions/:userId', (req, res) => {
    globalBanService.deleteExemption(req.params.guildId, req.params.userId);
    res.json({ success: true });
  });

  router.post('/reconcile', async (req, res) => {
    const count = await globalBanService.reconcileGuild(req.params.guildId);
    res.status(202).json({ success: true, queued: count });
  });

  return router;
}

module.exports = { createGlobalBanRoutes };
