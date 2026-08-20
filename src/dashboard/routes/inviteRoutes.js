const express = require('express');
const { ValidationError } = require('../errors');

/**
 * Invite routes — thin adapters over InviteService. No repository access,
 * no Socket.IO, no business rules here.
 */
function createInviteRoutes({ inviteService }) {
  const router = express.Router({ mergeParams: true });

  router.get('/leaderboard', async (req, res) => {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '10', 10), 100));
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const offset = (page - 1) * limit;
    const data = await inviteService.getLeaderboardWithUsers(req.params.guildId, { limit, offset });
    res.json(data);
  });

  router.get('/history', async (req, res) => {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '15', 10), 100));
    const history = await inviteService.getRecentJoinsWithUsers(req.params.guildId, limit);
    res.json({ history });
  });

  router.get('/activity-log', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
    const filter = req.query.filter || 'all';
    const search = req.query.search || '';
    const data = await inviteService.getActivityLogWithUsers(req.params.guildId, { limit, offset, filter, search });
    res.json(data);
  });

  router.get('/analytics', async (req, res) => {
    const days = Math.max(1, Math.min(parseInt(req.query.days || '7', 10), 90));
    const stats = inviteService.getDailyStats(req.params.guildId, days);

    // Fill every day in the requested window so charts render a continuous
    // series; empty periods are explicit zeros, never random data.
    const byDate = new Map(stats.map((s) => [s.date, s]));
    const now = Date.now();
    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const existing = byDate.get(d);
      series.push(existing || { date: d, joins: 0, leaves: 0, fakes: 0 });
    }

    res.json({ analytics: series });
  });

  router.post('/sync-members', async (req, res) => {
    const result = await inviteService.syncPreExistingMembers(req.params.guildId);
    if (!result.available) {
      return res.json({
        success: false,
        message: 'Guild not connected to bot — sync requires the bot to be in the server.',
        synced: 0,
      });
    }
    res.json({
      success: true,
      message: `Successfully synced ${result.synced} historical member${result.synced !== 1 ? 's' : ''} into the audit log.`,
      synced: result.synced,
    });
  });

  router.get('/active-codes', async (req, res) => {
    const invites = await inviteService.getActiveInvites(req.params.guildId);
    res.json({ invites });
  });

  router.post('/', async (req, res) => {
    const { channelId, maxAge, maxUses, temporary, label } = req.body || {};
    if (label !== undefined && typeof label !== 'string') {
      throw new ValidationError('label must be a string.');
    }
    const invite = await inviteService.createInvite({
      guildId: req.params.guildId,
      channelId,
      maxAge,
      maxUses,
      temporary,
      label,
    });
    res.status(201).json({ success: true, message: 'Invite created successfully', invite });
  });

  const handleSetLabel = async (req, res) => {
    const { code } = req.params;
    const { label, channelId, channelName } = req.body || {};
    if (!label || !label.trim()) {
      const payload = inviteService.removeInviteLabel(req.params.guildId, code);
      return res.json({ success: true, code, label: null, invite: payload });
    }
    const payload = inviteService.setInviteLabel({ guildId: req.params.guildId, code, label, channelId, channelName });
    res.json({ success: true, message: 'Invite label updated', label: payload.label, invite: payload });
  };

  router.post('/:code/label', handleSetLabel);
  router.patch('/:code/label', handleSetLabel);

  router.delete('/:code/label', async (req, res) => {
    const payload = inviteService.removeInviteLabel(req.params.guildId, req.params.code);
    res.json({ success: true, message: 'Invite label removed', code: req.params.code, label: null, invite: payload });
  });

  router.delete('/:code', async (req, res) => {
    await inviteService.deleteInvite(req.params.guildId, req.params.code);
    res.json({ success: true, message: 'Invite revoked successfully', code: req.params.code });
  });

  return router;
}

module.exports = { createInviteRoutes };
