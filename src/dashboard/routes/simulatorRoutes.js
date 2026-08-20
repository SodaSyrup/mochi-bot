const express = require('express');
const { AttributionType } = require('../../features/invites/domain/attribution');
const { ValidationError } = require('../errors');

// Deterministic simulated member id generator (no Math.random).
let simCounter = 0;
function nextSimUserId() {
  simCounter += 1;
  return `sim_${simCounter}`;
}

/**
 * Simulator routes. Simulated input only — these call the SAME application
 * use cases as live Discord events (policy, idempotency, persistence, event
 * publishing, realtime). Only the external input is simulated.
 */
function createSimulatorRoutes({ inviteService, safetyService }) {
  const router = express.Router({ mergeParams: true });

  router.post('/join', async (req, res) => {
    const { guildId } = req.params;
    const {
      userId,
      username = 'DemoMember',
      inviterId = null,
      inviteCode = null,
      attributionType = AttributionType.INVITE,
      isFake = false,
      avatar = 'https://cdn.discordapp.com/embed/avatars/0.png',
    } = req.body || {};

    const memberId = userId || nextSimUserId();
    // Simulated account creation time drives the shared fake policy.
    const joinedAt = new Date().toISOString();
    const accountCreatedAt = isFake
      ? new Date(Date.now() - 60 * 60 * 1000).toISOString()
      : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    const attribution = {
      type: attributionType,
      inviterId: inviterId || null,
      inviteCode: inviteCode || null,
    };

    const memberData = {
      id: memberId,
      guildId,
      username,
      avatar,
      bot: false,
      joinedAt,
      accountCreatedAt,
    };

    const { result, isFake: flaggedFake, inviterStats, attribution: resolvedAttribution } =
      await inviteService.trackMemberJoin(memberData, attribution);

    res.json({
      success: result.applied,
      event: {
        guildId,
        user: { id: memberId, username, avatar },
        attribution: {
          type: resolvedAttribution.type,
          inviterId: resolvedAttribution.inviterId,
          inviteCode: resolvedAttribution.inviteCode,
        },
        isFake: flaggedFake,
        inviterStats,
        joinedAt,
      },
      reason: result.reason,
    });
  });

  router.post('/leave', async (req, res) => {
    const { guildId } = req.params;
    const { userId } = req.body || {};
    if (!userId) throw new ValidationError('userId is required to simulate a leave.');

    const memberData = {
      id: userId,
      guildId,
      username: 'DepartedMember',
      avatar: 'https://cdn.discordapp.com/embed/avatars/3.png',
      bot: false,
      leftAt: new Date().toISOString(),
    };

    const { result } = await inviteService.trackMemberLeave(memberData);

    res.json({
      success: result.applied,
      event: { guildId, user: { id: userId, username: 'DepartedMember' }, leftAt: memberData.leftAt },
      reason: result.reason,
    });
  });

  router.post('/automod', async (req, res) => {
    const { guildId } = req.params;
    const incident = await safetyService.simulateExecution(guildId, {
      ruleId: req.body?.ruleId,
      ruleName: req.body?.ruleName,
      triggerType: req.body?.triggerType,
      username: req.body?.username,
      channelId: req.body?.channelId,
      channelName: req.body?.channelName,
      content: req.body?.content,
      matchedKeyword: req.body?.matchedKeyword,
      actionType: req.body?.actionType,
      timeoutSeconds: req.body?.timeoutSeconds,
    });
    res.json({ success: true, incident });
  });

  return router;
}

module.exports = { createSimulatorRoutes };
