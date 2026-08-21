const express = require('express');
const { ValidationError } = require('../errors');
const { parseBoundedInt } = require('../http/parseBoundedInt');

/**
 * Invite routes — thin adapters over InviteService. No repository access,
 * no Socket.IO, no business rules here.
 *
 * Pagination policy (shared parser in src/dashboard/http/parseBoundedInt):
 *   leaderboard:  limit default 10 (1..100), page default 1 (1..1000000)
 *   history:      limit default 15 (1..100)
 *   activity-log: limit default 20 (1..100), offset default 0 (0..1000000)
 *   analytics:    days default 7 (1..90)
 */
function createInviteRoutes({ inviteService }) {
  const router = express.Router({ mergeParams: true });

  router.get('/leaderboard', async (req, res) => {
    const limit = parseBoundedInt(req.query.limit, { defaultValue: 10, min: 1, max: 100, name: 'limit' });
    const page = parseBoundedInt(req.query.page, { defaultValue: 1, min: 1, max: 1000000, name: 'page' });
    const offset = (page - 1) * limit;
    const data = await inviteService.getLeaderboardWithUsers(req.params.guildId, { limit, offset });
    res.json(data);
  });

  router.get('/history', async (req, res) => {
    const limit = parseBoundedInt(req.query.limit, { defaultValue: 15, min: 1, max: 100, name: 'limit' });
    const history = await inviteService.getRecentJoinsWithUsers(req.params.guildId, limit);
    res.json({ history });
  });

  router.get('/activity-log', async (req, res) => {
    const limit = parseBoundedInt(req.query.limit, { defaultValue: 20, min: 1, max: 100, name: 'limit' });
    const offset = parseBoundedInt(req.query.offset, { defaultValue: 0, min: 0, max: 1000000, name: 'offset' });
    const filter = req.query.filter || 'all';
    const search = req.query.search || '';
    const data = await inviteService.getActivityLogWithUsers(req.params.guildId, { limit, offset, filter, search });
    res.json(data);
  });

  router.get('/analytics', async (req, res) => {
    const days = parseBoundedInt(req.query.days, { defaultValue: 7, min: 1, max: 90, name: 'days' });
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

  router.post('/reconcile-members', async (req, res) => {
    const result = await inviteService.reconcileGuildMembers(req.params.guildId);
    if (!result.available) {
      return res.json({
        success: false,
        message: 'Guild member reconciliation was unavailable because the bot could not fetch the authoritative member list.',
        joined: 0,
        left: 0,
        unchanged: 0,
      });
    }
    res.json({
      success: true,
      message: `Reconciled ${result.joined} member join${result.joined !== 1 ? 's' : ''} and ${result.left} leave${result.left !== 1 ? 's' : ''}.`,
      joined: result.joined,
      left: result.left,
      unchanged: result.unchanged,
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
