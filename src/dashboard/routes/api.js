const express = require('express');
const router = express.Router();
const inviteRepo = require('../../database/repositories/inviteRepo');
const guildRepo = require('../../database/repositories/guildRepo');
const config = require('../../config');
const os = require('os');

module.exports = (client, io) => {
  /**
   * Helper: Get mock/simulated guilds if bot is not in any Discord servers yet
   */
  function getEffectiveGuilds() {
    if (client.guilds && client.guilds.cache.size > 0) {
      return client.guilds.cache.map(g => ({
        id: g.id,
        name: g.name,
        icon: g.iconURL({ dynamic: true }),
        memberCount: g.memberCount,
        ownerId: g.ownerId,
        isSimulated: false
      }));
    }

    // Default Demo Guild for instant testing & visualization
    const demoGuild = guildRepo.getGuild('999888777666555444', '🌸 Mochi Hangout [Demo]', 'https://cdn.discordapp.com/embed/avatars/1.png');
    return [{
      id: demoGuild.guild_id,
      name: demoGuild.name,
      icon: demoGuild.icon || 'https://cdn.discordapp.com/embed/avatars/1.png',
      memberCount: 248,
      ownerId: '123456789012345678',
      isSimulated: true
    }];
  }

  /**
   * GET /api/stats - Global telemetry
   */
  router.get('/stats', (req, res) => {
    const guilds = getEffectiveGuilds();
    const totalMembers = client.guilds?.cache.size > 0
      ? client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)
      : guilds.reduce((acc, g) => acc + g.memberCount, 0);

    const memUsage = process.memoryUsage();
    const isBotConnected = Boolean(client.user && client.isReady && client.isReady());

    res.json({
      bot: {
        name: client.user?.username || 'Mochi',
        tag: client.user?.tag || 'Mochi#0000',
        avatar: client.user?.displayAvatarURL?.() || 'https://cdn.discordapp.com/embed/avatars/2.png',
        connected: isBotConnected,
        demoMode: config.dashboard.demoMode,
        ping: isBotConnected ? client.ws?.ping : 18,
        uptime: process.uptime()
      },
      telemetry: {
        serverCount: guilds.length,
        memberCount: totalMembers,
        ramMB: (memUsage.heapUsed / 1024 / 1024).toFixed(1),
        nodeVersion: process.version,
        platform: `${os.type()} ${os.release()}`
      }
    });
  });

  /**
   * GET /api/guilds - List all manageable guilds
   */
  router.get('/guilds', (req, res) => {
    const guilds = getEffectiveGuilds();
    res.json({ guilds });
  });

  /**
   * GET /api/guilds/:guildId - Get specific guild overview and invite stats
   */
  router.get('/guilds/:guildId', (req, res) => {
    const { guildId } = req.params;
    const discordGuild = client.guilds?.cache.get(guildId);
    const settings = guildRepo.getGuild(
      guildId,
      discordGuild ? discordGuild.name : 'Mochi Hangout [Demo]',
      discordGuild ? discordGuild.iconURL() : null
    );

    const totalInviters = inviteRepo.getInvitersCount(guildId);

    res.json({
      guild: {
        id: settings.guild_id,
        name: settings.name,
        icon: settings.icon,
        memberCount: discordGuild ? discordGuild.memberCount : 248,
        totalInviters
      },
      settings
    });
  });

  /**
   * PATCH /api/guilds/:guildId/settings - Update guild settings
   */
  router.patch('/guilds/:guildId/settings', (req, res) => {
    const { guildId } = req.params;
    const body = req.body;

    const updated = guildRepo.updateGuild(guildId, {
      fake_threshold_days: body.fake_threshold_days !== undefined ? parseInt(body.fake_threshold_days, 10) : undefined
    });

    res.json({ success: true, settings: updated });
  });

  /**
   * GET /api/guilds/:guildId/invites/leaderboard - Top inviters
   */
  router.get('/guilds/:guildId/invites/leaderboard', (req, res) => {
    const { guildId } = req.params;
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);
    const offset = (page - 1) * limit;

    const total = inviteRepo.getInvitersCount(guildId);
    const rows = inviteRepo.getLeaderboard(guildId, limit, offset);

    const enriched = rows.map(r => {
      const user = client.users?.cache.get(r.user_id);
      return {
        ...r,
        username: user ? user.username : `User_${r.user_id.slice(-4)}`,
        avatar: user ? user.displayAvatarURL() : 'https://cdn.discordapp.com/embed/avatars/0.png'
      };
    });

    res.json({
      leaderboard: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    });
  });

  /**
   * GET /api/guilds/:guildId/invites/history - Recent join history
   */
  router.get('/guilds/:guildId/invites/history', (req, res) => {
    const { guildId } = req.params;
    const limit = parseInt(req.query.limit || '15', 10);
    const joins = inviteRepo.getRecentJoins(guildId, limit);

    const enriched = joins.map(j => {
      const u = client.users?.cache.get(j.user_id);
      const inv = j.inviter_id ? client.users?.cache.get(j.inviter_id) : null;
      return {
        ...j,
        username: u ? u.username : `User_${j.user_id.slice(-4)}`,
        avatar: u ? u.displayAvatarURL() : 'https://cdn.discordapp.com/embed/avatars/0.png',
        inviterName: inv ? inv.username : (j.inviter_id === 'VANITY' ? 'Vanity URL' : (j.inviter_id || 'Unknown'))
      };
    });

    res.json({ history: enriched });
  });

  /**
   * GET /api/guilds/:guildId/invites/analytics - Daily analytics series
   */
  router.get('/guilds/:guildId/invites/analytics', (req, res) => {
    const { guildId } = req.params;
    const days = parseInt(req.query.days || '7', 10);
    let stats = inviteRepo.getDailyStats(guildId, days);

    if (stats.length === 0) {
      const now = new Date();
      stats = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        stats.push({
          date: d,
          joins: Math.floor(Math.random() * 8) + 2,
          leaves: Math.floor(Math.random() * 3),
          fakes: Math.random() > 0.7 ? 1 : 0
        });
      }
    }

    res.json({ analytics: stats });
  });

  /**
   * GET /api/guilds/:guildId/channels - List available channels for invite creation
   */
  router.get('/guilds/:guildId/channels', (req, res) => {
    const { guildId } = req.params;
    const discordGuild = client.guilds?.cache.get(guildId);

    if (discordGuild) {
      const channels = discordGuild.channels.cache
        .filter(c => c.isTextBased?.() || c.type === 0 || c.type === 2 || c.type === 5)
        .map(c => ({
          id: c.id,
          name: c.name,
          type: c.type,
          position: c.position || 0
        }))
        .sort((a, b) => a.position - b.position);

      if (channels.length > 0) {
        return res.json({ channels });
      }
    }

    // Default simulated channels for demo & testing
    res.json({
      channels: [
        { id: 'chan_welcome', name: 'welcome', type: 0 },
        { id: 'chan_general', name: 'general-chat', type: 0 },
        { id: 'chan_announcements', name: 'announcements', type: 5 },
        { id: 'chan_community', name: 'community-lounge', type: 0 },
        { id: 'chan_giveaways', name: 'giveaways', type: 0 }
      ]
    });
  });

  /**
   * GET /api/guilds/:guildId/invites/active-codes - Active invite codes with custom labels
   */
  router.get('/guilds/:guildId/invites/active-codes', async (req, res) => {
    const { guildId } = req.params;
    const discordGuild = client.guilds?.cache.get(guildId);
    const labels = inviteRepo.getInviteLabels(guildId);
    const labelMap = new Map(labels.map(l => [l.code, l]));

    if (discordGuild && discordGuild.members.me?.permissions.has('ManageGuild')) {
      try {
        const fetched = await discordGuild.invites.fetch();
        const list = Array.from(fetched.values()).map(inv => {
          const labelData = labelMap.get(inv.code);
          return {
            code: inv.code,
            url: `https://discord.gg/${inv.code}`,
            uses: inv.uses || 0,
            maxUses: inv.maxUses || 0,
            maxAge: inv.maxAge || 0,
            temporary: inv.temporary || false,
            channelId: inv.channel?.id || labelData?.channel_id || null,
            channelName: inv.channel?.name || labelData?.channel_name || 'general',
            inviter: inv.inviter ? { id: inv.inviter.id, username: inv.inviter.username, avatar: inv.inviter.displayAvatarURL?.() } : null,
            createdAt: inv.createdAt,
            expiresAt: inv.expiresAt,
            label: labelData ? labelData.label : null
          };
        });
        return res.json({ invites: list });
      } catch (e) {
        // Fall back to database cache
      }
    }

    let cached = inviteRepo.getCachedInvites(guildId);

    // If empty in sandbox/demo mode, seed with sample invites
    if (cached.length === 0) {
      const demoInvites = [
        { code: 'mochi-welcome', uses: 48, maxUses: 0, channelId: 'chan_welcome', channelName: 'welcome', inviterId: '111111111111111111', createdAt: new Date(Date.now() - 86400000 * 3).toISOString() },
        { code: 'mochi-twitter', uses: 32, maxUses: 100, channelId: 'chan_general', channelName: 'general-chat', inviterId: '123456789012345678', createdAt: new Date(Date.now() - 86400000 * 2).toISOString() },
        { code: 'mochi-partner', uses: 12, maxUses: 50, channelId: 'chan_community', channelName: 'community-lounge', inviterId: '123456789012345678', createdAt: new Date(Date.now() - 86400000).toISOString() }
      ];
      inviteRepo.saveCachedInvites(guildId, demoInvites);
      inviteRepo.setInviteLabel(guildId, 'mochi-welcome', '🌸 Official Welcome Link', 'chan_welcome', 'welcome');
      inviteRepo.setInviteLabel(guildId, 'mochi-twitter', '🐦 Twitter Campaign', 'chan_general', 'general-chat');
      inviteRepo.setInviteLabel(guildId, 'mochi-partner', '🤝 Partner Sponsorship', 'chan_community', 'community-lounge');
      cached = inviteRepo.getCachedInvites(guildId);
    }

    const formatted = cached.map(c => {
      const u = c.inviterId ? client.users?.cache.get(c.inviterId) : null;
      return {
        ...c,
        url: `https://discord.gg/${c.code}`,
        inviter: {
          id: c.inviterId,
          username: u ? u.username : (c.inviterId === '111111111111111111' ? 'TopInviter_Sakura' : 'MochiAdmin')
        }
      };
    });

    res.json({ invites: formatted });
  });

  /**
   * POST /api/guilds/:guildId/invites - Create a new invite with optional label
   */
  router.post('/guilds/:guildId/invites', async (req, res) => {
    const { guildId } = req.params;
    const {
      channelId,
      maxAge = 0,
      maxUses = 0,
      temporary = false,
      label = ''
    } = req.body;

    const discordGuild = client.guilds?.cache.get(guildId);
    let createdInvite = null;

    if (discordGuild && discordGuild.members.me?.permissions.has('CreateInstantInvite')) {
      try {
        let channel = channelId ? discordGuild.channels.cache.get(channelId) : null;
        if (!channel) {
          channel = discordGuild.channels.cache.find(c => c.isTextBased?.() || c.type === 0);
        }

        if (channel && channel.createInvite) {
          const inv = await channel.createInvite({
            maxAge: parseInt(maxAge, 10) || 0,
            maxUses: parseInt(maxUses, 10) || 0,
            temporary: Boolean(temporary),
            unique: true,
            reason: label ? `Created via Mochi Dashboard [Label: ${label}]` : 'Created via Mochi Dashboard'
          });

          if (label && label.trim()) {
            inviteRepo.setInviteLabel(guildId, inv.code, label.trim(), channel.id, channel.name);
          }

          inviteRepo.saveCachedInvite(guildId, {
            code: inv.code,
            uses: 0,
            maxUses: inv.maxUses || 0,
            inviterId: client.user?.id,
            channelId: channel.id,
            channelName: channel.name,
            createdAt: inv.createdAt || new Date()
          });

          createdInvite = {
            code: inv.code,
            url: `https://discord.gg/${inv.code}`,
            uses: inv.uses || 0,
            maxUses: inv.maxUses || 0,
            maxAge: inv.maxAge || 0,
            temporary: inv.temporary || false,
            channelId: channel.id,
            channelName: channel.name,
            inviter: {
              id: client.user?.id || 'bot',
              username: client.user?.username || 'Mochi'
            },
            createdAt: inv.createdAt || new Date().toISOString(),
            label: label ? label.trim() : null
          };
        }
      } catch (err) {
        console.error('[Dashboard API] Error creating Discord invite:', err.message);
      }
    }

    // Sandbox / fallback simulation
    if (!createdInvite) {
      const code = 'mochi-' + Math.random().toString(36).substring(2, 8);
      const chanNameMap = {
        'chan_welcome': 'welcome',
        'chan_general': 'general-chat',
        'chan_announcements': 'announcements',
        'chan_community': 'community-lounge',
        'chan_giveaways': 'giveaways'
      };
      const channelName = chanNameMap[channelId] || (channelId ? channelId.replace('chan_', '') : 'general-chat');

      if (label && label.trim()) {
        inviteRepo.setInviteLabel(guildId, code, label.trim(), channelId || 'chan_general', channelName);
      }

      inviteRepo.saveCachedInvite(guildId, {
        code,
        uses: 0,
        maxUses: parseInt(maxUses, 10) || 0,
        inviterId: '123456789012345678',
        channelId: channelId || 'chan_general',
        channelName,
        createdAt: new Date()
      });

      createdInvite = {
        code,
        url: `https://discord.gg/${code}`,
        uses: 0,
        maxUses: parseInt(maxUses, 10) || 0,
        maxAge: parseInt(maxAge, 10) || 0,
        temporary: Boolean(temporary),
        channelId: channelId || 'chan_general',
        channelName,
        inviter: {
          id: '123456789012345678',
          username: client.user?.username || 'MochiAdmin'
        },
        createdAt: new Date().toISOString(),
        label: label ? label.trim() : null
      };
    }

    // Broadcast WebSocket event
    io.to(`guild_${guildId}`).emit('inviteCreated', createdInvite);
    io.emit('inviteCreated', createdInvite);

    res.status(201).json({
      success: true,
      message: 'Invite created successfully',
      invite: createdInvite
    });
  });

  /**
   * POST or PATCH /api/guilds/:guildId/invites/:code/label - Set or update label for an existing invite
   */
  const handleSetLabel = (req, res) => {
    const { guildId, code } = req.params;
    const { label, channelId, channelName } = req.body;

    if (!label || !label.trim()) {
      inviteRepo.deleteInviteLabel(guildId, code);
      const updatePayload = { guildId, code, label: null };
      io.to(`guild_${guildId}`).emit('inviteLabelUpdated', updatePayload);
      io.emit('inviteLabelUpdated', updatePayload);
      return res.json({ success: true, code, label: null });
    }

    const saved = inviteRepo.setInviteLabel(guildId, code, label.trim(), channelId, channelName);
    const updatePayload = {
      guildId,
      code,
      label: saved.label,
      channelId: saved.channel_id,
      channelName: saved.channel_name
    };

    io.to(`guild_${guildId}`).emit('inviteLabelUpdated', updatePayload);
    io.emit('inviteLabelUpdated', updatePayload);

    res.json({
      success: true,
      message: 'Invite label updated',
      label: saved.label,
      invite: saved
    });
  };

  router.post('/guilds/:guildId/invites/:code/label', handleSetLabel);
  router.patch('/guilds/:guildId/invites/:code/label', handleSetLabel);

  /**
   * DELETE /api/guilds/:guildId/invites/:code/label - Remove label from an invite
   */
  router.delete('/guilds/:guildId/invites/:code/label', (req, res) => {
    const { guildId, code } = req.params;
    inviteRepo.deleteInviteLabel(guildId, code);

    const updatePayload = { guildId, code, label: null };
    io.to(`guild_${guildId}`).emit('inviteLabelUpdated', updatePayload);
    io.emit('inviteLabelUpdated', updatePayload);

    res.json({ success: true, message: 'Invite label removed', code, label: null });
  });

  /**
   * DELETE /api/guilds/:guildId/invites/:code - Revoke/Delete an invite code
   */
  router.delete('/guilds/:guildId/invites/:code', async (req, res) => {
    const { guildId, code } = req.params;
    const discordGuild = client.guilds?.cache.get(guildId);

    if (discordGuild && discordGuild.members.me?.permissions.has('ManageGuild')) {
      try {
        const fetched = await discordGuild.invites.fetch();
        const inv = fetched.get(code);
        if (inv) {
          await inv.delete('Revoked via Mochi Dashboard');
        }
      } catch (err) {
        console.error('[Dashboard API] Error revoking Discord invite:', err.message);
      }
    }

    inviteRepo.deleteCachedInvite(guildId, code);
    inviteRepo.deleteInviteLabel(guildId, code);

    const deletePayload = { guildId, code };
    io.to(`guild_${guildId}`).emit('inviteDeleted', deletePayload);
    io.emit('inviteDeleted', deletePayload);

    res.json({ success: true, message: 'Invite revoked successfully', code });
  });

  /**
   * POST /api/guilds/:guildId/simulate/join - Test bench: simulate join event
   */
  router.post('/guilds/:guildId/simulate/join', (req, res) => {
    const { guildId } = req.params;
    const { username = 'DemoMember', inviterId = '123456789012345678', inviteCode = 'mochi-welcome', isFake = false } = req.body;
    const randomId = 'sim_' + Math.floor(Math.random() * 1000000);

    const stats = inviteRepo.recordJoin(guildId, randomId, inviterId, inviteCode, isFake);
    const labelData = inviteRepo.getInviteLabel(guildId, inviteCode);

    const eventPayload = {
      guildId,
      user: {
        id: randomId,
        username,
        avatar: 'https://cdn.discordapp.com/embed/avatars/' + (Math.floor(Math.random() * 5)) + '.png'
      },
      inviter: {
        id: inviterId,
        username: 'TopInviter_Sakura'
      },
      code: inviteCode,
      label: labelData ? labelData.label : null,
      isFake,
      inviterStats: stats,
      joinedAt: new Date().toISOString()
    };

    io.to(`guild_${guildId}`).emit('memberJoin', eventPayload);
    io.emit('memberJoin', eventPayload);

    res.json({ success: true, event: eventPayload });
  });

  /**
   * POST /api/guilds/:guildId/simulate/leave - Test bench: simulate leave event
   */
  router.post('/guilds/:guildId/simulate/leave', (req, res) => {
    const { guildId } = req.params;
    const { userId = 'sim_demo' } = req.body;

    const affected = inviteRepo.recordLeave(guildId, userId);

    const eventPayload = {
      guildId,
      user: {
        id: userId,
        username: 'DepartedMember',
        avatar: 'https://cdn.discordapp.com/embed/avatars/3.png'
      },
      inviterId: '123456789012345678',
      affectedInviter: affected,
      leftAt: new Date().toISOString()
    };

    io.to(`guild_${guildId}`).emit('memberLeave', eventPayload);
    io.emit('memberLeave', eventPayload);

    res.json({ success: true, event: eventPayload });
  });

  /**
   * GET /api/guilds/:guildId/roles - List manageable roles (for AutoMod exempt roles)
   */
  router.get('/guilds/:guildId/roles', (req, res) => {
    const { guildId } = req.params;
    const discordGuild = client.guilds?.cache.get(guildId);

    if (discordGuild && discordGuild.roles) {
      const roles = discordGuild.roles.cache
        .filter(r => r.name !== '@everyone')
        .map(r => ({
          id: r.id,
          name: r.name,
          color: r.hexColor !== '#000000' ? r.hexColor : '#99aab5',
          position: r.position,
          managed: r.managed
        }))
        .sort((a, b) => b.position - a.position);

      if (roles.length > 0) {
        return res.json({ roles });
      }
    }

    // Default demo roles for sandbox / testing
    res.json({
      roles: [
        { id: 'role_admin', name: 'Server Admin', color: '#f43f5e', position: 10, managed: false },
        { id: 'role_mod', name: 'Moderator', color: '#8b5cf6', position: 8, managed: false },
        { id: 'role_vip', name: 'VIP Supporter', color: '#eab308', position: 5, managed: false },
        { id: 'role_bots', name: 'Verified Bots', color: '#06b6d4', position: 3, managed: true },
        { id: 'role_member', name: 'Community Member', color: '#10b981', position: 1, managed: false }
      ]
    });
  });

  // In-memory fallback stores for demo / testing mode
  const simulatedSafetySettings = new Map();
  const simulatedAutoModRules = new Map();

  function getDemoRules(guildId) {
    if (!simulatedAutoModRules.has(guildId)) {
      simulatedAutoModRules.set(guildId, [
        {
          id: 'automod_rule_1',
          guildId,
          name: '🛡️ Block Scam Links & Malicious URLs',
          enabled: true,
          eventType: 1, // MESSAGE_SEND
          triggerType: 1, // KEYWORD
          triggerMetadata: {
            keywordFilter: ['*discord.gg/*', '*nitro-drop*.ru*', '*steamcommunity.gift*'],
            regexPatterns: ['https?:\\/\\/(?:www\\.)?dis[c|k]ord-(?:gift|nitro)\\.[a-z]{2,8}'],
            presets: [],
            allowList: ['discord.gg/mochihangout'],
            mentionTotalLimit: 0
          },
          actions: [
            { type: 1, metadata: { customMessage: '🛑 Posting unauthorized invite links or malicious domains is strictly forbidden!' } },
            { type: 2, metadata: { channelId: 'chan_announcements' } }
          ],
          exemptRoles: ['role_admin', 'role_mod'],
          exemptChannels: ['chan_community'],
          creatorId: '123456789012345678'
        },
        {
          id: 'automod_rule_2',
          guildId,
          name: '🚫 Anti-Spam & Severe Profanity Filter',
          enabled: true,
          eventType: 1, // MESSAGE_SEND
          triggerType: 4, // KEYWORD_PRESET
          triggerMetadata: {
            keywordFilter: [],
            regexPatterns: [],
            presets: [1, 2, 3], // Profanity, Sexual Content, Slurs
            allowList: [],
            mentionTotalLimit: 0
          },
          actions: [
            { type: 1, metadata: { customMessage: '⚠️ Message blocked due to server safety policy.' } },
            { type: 3, metadata: { durationSeconds: 300 } } // 5m Timeout
          ],
          exemptRoles: ['role_admin'],
          exemptChannels: [],
          creatorId: '123456789012345678'
        },
        {
          id: 'automod_rule_3',
          guildId,
          name: '⚡ Anti-Mention Raid Protection (Limit 5)',
          enabled: true,
          eventType: 1, // MESSAGE_SEND
          triggerType: 5, // MENTION_SPAM
          triggerMetadata: {
            keywordFilter: [],
            regexPatterns: [],
            presets: [],
            allowList: [],
            mentionTotalLimit: 5,
            mentionRaidProtectionEnabled: true
          },
          actions: [
            { type: 1, metadata: { customMessage: '🚨 Excessive mentions detected and blocked!' } },
            { type: 3, metadata: { durationSeconds: 600 } } // 10m Timeout
          ],
          exemptRoles: ['role_admin', 'role_mod'],
          exemptChannels: [],
          creatorId: '123456789012345678'
        },
        {
          id: 'automod_rule_4',
          guildId,
          name: '👤 Impersonation & Sus Profile Blocker',
          enabled: false,
          eventType: 2, // MEMBER_UPDATE
          triggerType: 6, // MEMBER_PROFILE
          triggerMetadata: {
            keywordFilter: ['free nitro', 'airdrop bot', 'discord mod', 'official mochi staff'],
            regexPatterns: [],
            presets: [],
            allowList: [],
            mentionTotalLimit: 0
          },
          actions: [
            { type: 4, metadata: {} } // BLOCK_MEMBER_INTERACTION
          ],
          exemptRoles: ['role_admin'],
          exemptChannels: [],
          creatorId: '123456789012345678'
        }
      ]);
    }
    return simulatedAutoModRules.get(guildId);
  }

  function formatDiscordRule(r) {
    return {
      id: r.id,
      guildId: r.guildId || r.guild?.id,
      name: r.name,
      enabled: Boolean(r.enabled),
      eventType: r.eventType,
      triggerType: r.triggerType,
      triggerMetadata: {
        keywordFilter: r.triggerMetadata?.keywordFilter || [],
        regexPatterns: r.triggerMetadata?.regexPatterns || [],
        presets: r.triggerMetadata?.presets || [],
        allowList: r.triggerMetadata?.allowList || [],
        mentionTotalLimit: r.triggerMetadata?.mentionTotalLimit || 0,
        mentionRaidProtectionEnabled: Boolean(r.triggerMetadata?.mentionRaidProtectionEnabled)
      },
      actions: (r.actions || []).map(a => ({
        type: a.type,
        metadata: {
          channelId: a.metadata?.channelId || null,
          durationSeconds: a.metadata?.durationSeconds || 0,
          customMessage: a.metadata?.customMessage || null
        }
      })),
      exemptRoles: Array.isArray(r.exemptRoles) ? r.exemptRoles : Array.from(r.exemptRoles?.values?.() || []),
      exemptChannels: Array.isArray(r.exemptChannels) ? r.exemptChannels : Array.from(r.exemptChannels?.values?.() || []),
      creatorId: r.creatorId || null
    };
  }

  /**
   * GET /api/guilds/:guildId/safety - Fetch server safety & moderation configuration
   */
  router.get('/guilds/:guildId/safety', async (req, res) => {
    const { guildId } = req.params;
    const discordGuild = client.guilds?.cache.get(guildId);

    if (discordGuild) {
      let rulesCount = 0;
      let enabledRulesCount = 0;
      try {
        if (discordGuild.autoModerationRules) {
          const rules = await discordGuild.autoModerationRules.fetch();
          rulesCount = rules.size;
          enabledRulesCount = rules.filter(r => r.enabled).size;
        }
      } catch (err) {
        console.warn('[Dashboard API] Could not fetch live AutoMod rules count:', err.message);
      }

      return res.json({
        safety: {
          guildId: discordGuild.id,
          guildName: discordGuild.name,
          verificationLevel: discordGuild.verificationLevel, // 0 = NONE, 1 = LOW, 2 = MEDIUM, 3 = HIGH, 4 = VERY_HIGH
          explicitContentFilter: discordGuild.explicitContentFilter, // 0 = DISABLED, 1 = MEMBERS_WITHOUT_ROLES, 2 = ALL_MEMBERS
          defaultMessageNotifications: discordGuild.defaultMessageNotifications, // 0 = ALL_MESSAGES, 1 = ONLY_MENTIONS
          mfaLevel: discordGuild.mfaLevel, // 0 = NONE, 1 = ELEVATED
          safetyAlertsChannelId: discordGuild.safetyAlertsChannelId || discordGuild.publicUpdatesChannelId || discordGuild.systemChannelId || null,
          rulesChannelId: discordGuild.rulesChannelId || null,
          features: discordGuild.features || [],
          rulesCount,
          enabledRulesCount,
          isSimulated: false
        }
      });
    }

    // Demo / fallback simulation
    const settings = simulatedSafetySettings.get(guildId) || {
      guildId,
      guildName: '🌸 Mochi Hangout [Demo]',
      verificationLevel: 1, // LOW
      explicitContentFilter: 1, // MEMBERS_WITHOUT_ROLES
      defaultMessageNotifications: 1, // ONLY_MENTIONS
      mfaLevel: 0, // NONE
      safetyAlertsChannelId: 'chan_announcements',
      rulesChannelId: 'chan_welcome',
      features: ['COMMUNITY', 'AUTO_MODERATION', 'INVITE_SPLASH'],
      rulesCount: getDemoRules(guildId).length,
      enabledRulesCount: getDemoRules(guildId).filter(r => r.enabled).length,
      isSimulated: true
    };

    res.json({ safety: settings });
  });

  /**
   * PATCH /api/guilds/:guildId/safety/settings - Update server safety settings
   */
  router.patch('/guilds/:guildId/safety/settings', async (req, res) => {
    const { guildId } = req.params;
    const {
      verificationLevel,
      explicitContentFilter,
      defaultMessageNotifications,
      safetyAlertsChannelId
    } = req.body;

    const discordGuild = client.guilds?.cache.get(guildId);

    if (discordGuild && discordGuild.members.me?.permissions.has('ManageGuild')) {
      try {
        const updatePayload = {};
        if (verificationLevel !== undefined) updatePayload.verificationLevel = parseInt(verificationLevel, 10);
        if (explicitContentFilter !== undefined) updatePayload.explicitContentFilter = parseInt(explicitContentFilter, 10);
        if (defaultMessageNotifications !== undefined) updatePayload.defaultMessageNotifications = parseInt(defaultMessageNotifications, 10);
        if (safetyAlertsChannelId !== undefined) updatePayload.safetyAlertsChannel = safetyAlertsChannelId || null;

        await discordGuild.edit(updatePayload);

        return res.json({
          success: true,
          message: 'Server safety settings updated on Discord',
          safety: {
            guildId: discordGuild.id,
            guildName: discordGuild.name,
            verificationLevel: discordGuild.verificationLevel,
            explicitContentFilter: discordGuild.explicitContentFilter,
            defaultMessageNotifications: discordGuild.defaultMessageNotifications,
            mfaLevel: discordGuild.mfaLevel,
            safetyAlertsChannelId: discordGuild.safetyAlertsChannelId || safetyAlertsChannelId,
            isSimulated: false
          }
        });
      } catch (err) {
        console.error('[Dashboard API] Error updating Discord guild safety settings:', err.message);
      }
    }

    // Demo / fallback simulation
    const current = simulatedSafetySettings.get(guildId) || {
      guildId,
      guildName: '🌸 Mochi Hangout [Demo]',
      verificationLevel: 1,
      explicitContentFilter: 1,
      defaultMessageNotifications: 1,
      mfaLevel: 0,
      safetyAlertsChannelId: 'chan_announcements',
      rulesChannelId: 'chan_welcome',
      features: ['COMMUNITY', 'AUTO_MODERATION', 'INVITE_SPLASH'],
      rulesCount: getDemoRules(guildId).length,
      enabledRulesCount: getDemoRules(guildId).filter(r => r.enabled).length,
      isSimulated: true
    };

    if (verificationLevel !== undefined) current.verificationLevel = parseInt(verificationLevel, 10);
    if (explicitContentFilter !== undefined) current.explicitContentFilter = parseInt(explicitContentFilter, 10);
    if (defaultMessageNotifications !== undefined) current.defaultMessageNotifications = parseInt(defaultMessageNotifications, 10);
    if (safetyAlertsChannelId !== undefined) current.safetyAlertsChannelId = safetyAlertsChannelId;

    simulatedSafetySettings.set(guildId, current);

    res.json({
      success: true,
      message: 'Server safety settings updated',
      safety: current
    });
  });

  /**
   * GET /api/guilds/:guildId/safety/automod - List all Discord AutoMod rules
   */
  router.get('/guilds/:guildId/safety/automod', async (req, res) => {
    const { guildId } = req.params;
    const discordGuild = client.guilds?.cache.get(guildId);

    if (discordGuild && discordGuild.autoModerationRules) {
      try {
        const fetched = await discordGuild.autoModerationRules.fetch();
        const rules = Array.from(fetched.values()).map(formatDiscordRule);
        return res.json({ rules });
      } catch (err) {
        console.warn('[Dashboard API] Failed to fetch live AutoMod rules from Discord:', err.message);
      }
    }

    // Demo / fallback simulation
    const rules = getDemoRules(guildId);
    res.json({ rules });
  });

  /**
   * POST /api/guilds/:guildId/safety/automod - Create a new AutoMod rule
   */
  router.post('/guilds/:guildId/safety/automod', async (req, res) => {
    const { guildId } = req.params;
    const {
      name,
      eventType = 1, // 1: MESSAGE_SEND, 2: MEMBER_UPDATE
      triggerType = 1, // 1: KEYWORD, 3: SPAM, 4: KEYWORD_PRESET, 5: MENTION_SPAM, 6: MEMBER_PROFILE
      triggerMetadata = {},
      actions = [],
      exemptRoles = [],
      exemptChannels = [],
      enabled = true
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Rule name is required.' });
    }

    const discordGuild = client.guilds?.cache.get(guildId);
    let createdRule = null;

    if (discordGuild && discordGuild.autoModerationRules && discordGuild.members.me?.permissions.has('ManageGuild')) {
      try {
        const payload = {
          name: name.trim(),
          eventType: parseInt(eventType, 10),
          triggerType: parseInt(triggerType, 10),
          enabled: Boolean(enabled),
          actions: (actions || []).map(a => ({
            type: parseInt(a.type, 10),
            metadata: {
              channel: a.metadata?.channelId,
              durationSeconds: a.metadata?.durationSeconds ? parseInt(a.metadata.durationSeconds, 10) : undefined,
              customMessage: a.metadata?.customMessage
            }
          })),
          exemptRoles: exemptRoles || [],
          exemptChannels: exemptChannels || [],
          reason: 'Created via Mochi Safety Dashboard'
        };

        if (payload.triggerType === 1 || payload.triggerType === 6) {
          payload.triggerMetadata = {
            keywordFilter: triggerMetadata.keywordFilter || [],
            regexPatterns: triggerMetadata.regexPatterns || [],
            allowList: triggerMetadata.allowList || []
          };
        } else if (payload.triggerType === 4) {
          payload.triggerMetadata = {
            presets: (triggerMetadata.presets || []).map(p => parseInt(p, 10)),
            allowList: triggerMetadata.allowList || []
          };
        } else if (payload.triggerType === 5) {
          payload.triggerMetadata = {
            mentionTotalLimit: parseInt(triggerMetadata.mentionTotalLimit || 5, 10),
            mentionRaidProtectionEnabled: Boolean(triggerMetadata.mentionRaidProtectionEnabled)
          };
        }

        const created = await discordGuild.autoModerationRules.create(payload);
        createdRule = formatDiscordRule(created);
      } catch (err) {
        console.error('[Dashboard API] Error creating Discord AutoMod rule:', err.message);
      }
    }

    // Demo / fallback simulation
    if (!createdRule) {
      const demoRules = getDemoRules(guildId);
      const newId = 'automod_rule_' + Date.now();
      createdRule = {
        id: newId,
        guildId,
        name: name.trim(),
        enabled: Boolean(enabled),
        eventType: parseInt(eventType, 10) || 1,
        triggerType: parseInt(triggerType, 10) || 1,
        triggerMetadata: {
          keywordFilter: triggerMetadata.keywordFilter || [],
          regexPatterns: triggerMetadata.regexPatterns || [],
          presets: triggerMetadata.presets || [],
          allowList: triggerMetadata.allowList || [],
          mentionTotalLimit: triggerMetadata.mentionTotalLimit || 0,
          mentionRaidProtectionEnabled: Boolean(triggerMetadata.mentionRaidProtectionEnabled)
        },
        actions: actions || [{ type: 1, metadata: {} }],
        exemptRoles: exemptRoles || [],
        exemptChannels: exemptChannels || [],
        creatorId: client.user?.id || '123456789012345678'
      };
      demoRules.unshift(createdRule);
    }

    io.to(`guild_${guildId}`).emit('autoModRuleUpdated', { guildId, action: 'create', rule: createdRule });
    io.emit('autoModRuleUpdated', { guildId, action: 'create', rule: createdRule });

    res.status(201).json({
      success: true,
      message: 'AutoMod rule created successfully',
      rule: createdRule
    });
  });

  /**
   * PATCH /api/guilds/:guildId/safety/automod/:ruleId - Edit or toggle an AutoMod rule
   */
  router.patch('/guilds/:guildId/safety/automod/:ruleId', async (req, res) => {
    const { guildId, ruleId } = req.params;
    const updates = req.body;
    const discordGuild = client.guilds?.cache.get(guildId);
    let updatedRule = null;

    if (discordGuild && discordGuild.autoModerationRules && discordGuild.members.me?.permissions.has('ManageGuild')) {
      try {
        const payload = {};
        if (updates.name !== undefined) payload.name = updates.name;
        if (updates.enabled !== undefined) payload.enabled = Boolean(updates.enabled);
        if (updates.eventType !== undefined) payload.eventType = parseInt(updates.eventType, 10);
        if (updates.triggerMetadata !== undefined) payload.triggerMetadata = updates.triggerMetadata;
        if (updates.actions !== undefined) {
          payload.actions = updates.actions.map(a => ({
            type: parseInt(a.type, 10),
            metadata: {
              channel: a.metadata?.channelId,
              durationSeconds: a.metadata?.durationSeconds ? parseInt(a.metadata.durationSeconds, 10) : undefined,
              customMessage: a.metadata?.customMessage
            }
          }));
        }
        if (updates.exemptRoles !== undefined) payload.exemptRoles = updates.exemptRoles;
        if (updates.exemptChannels !== undefined) payload.exemptChannels = updates.exemptChannels;
        payload.reason = 'Updated via Mochi Safety Dashboard';

        const edited = await discordGuild.autoModerationRules.edit(ruleId, payload);
        updatedRule = formatDiscordRule(edited);
      } catch (err) {
        console.error('[Dashboard API] Error editing Discord AutoMod rule:', err.message);
      }
    }

    // Demo / fallback simulation
    if (!updatedRule) {
      const demoRules = getDemoRules(guildId);
      const idx = demoRules.findIndex(r => r.id === ruleId);
      if (idx !== -1) {
        const rule = demoRules[idx];
        if (updates.name !== undefined) rule.name = updates.name;
        if (updates.enabled !== undefined) rule.enabled = Boolean(updates.enabled);
        if (updates.eventType !== undefined) rule.eventType = parseInt(updates.eventType, 10);
        if (updates.triggerType !== undefined) rule.triggerType = parseInt(updates.triggerType, 10);
        if (updates.triggerMetadata !== undefined) {
          rule.triggerMetadata = { ...rule.triggerMetadata, ...updates.triggerMetadata };
        }
        if (updates.actions !== undefined) rule.actions = updates.actions;
        if (updates.exemptRoles !== undefined) rule.exemptRoles = updates.exemptRoles;
        if (updates.exemptChannels !== undefined) rule.exemptChannels = updates.exemptChannels;
        updatedRule = rule;
      }
    }

    if (!updatedRule) {
      return res.status(404).json({ success: false, error: 'Rule not found' });
    }

    io.to(`guild_${guildId}`).emit('autoModRuleUpdated', { guildId, action: 'update', rule: updatedRule });
    io.emit('autoModRuleUpdated', { guildId, action: 'update', rule: updatedRule });

    res.json({
      success: true,
      message: 'AutoMod rule updated successfully',
      rule: updatedRule
    });
  });

  /**
   * DELETE /api/guilds/:guildId/safety/automod/:ruleId - Delete an AutoMod rule
   */
  router.delete('/guilds/:guildId/safety/automod/:ruleId', async (req, res) => {
    const { guildId, ruleId } = req.params;
    const discordGuild = client.guilds?.cache.get(guildId);

    if (discordGuild && discordGuild.autoModerationRules && discordGuild.members.me?.permissions.has('ManageGuild')) {
      try {
        await discordGuild.autoModerationRules.delete(ruleId, 'Deleted via Mochi Safety Dashboard');
      } catch (err) {
        console.error('[Dashboard API] Error deleting Discord AutoMod rule:', err.message);
      }
    }

    // Remove from demo store if present
    const demoRules = getDemoRules(guildId);
    const idx = demoRules.findIndex(r => r.id === ruleId);
    if (idx !== -1) {
      demoRules.splice(idx, 1);
    }

    io.to(`guild_${guildId}`).emit('autoModRuleUpdated', { guildId, action: 'delete', ruleId });
    io.emit('autoModRuleUpdated', { guildId, action: 'delete', ruleId });

    res.json({ success: true, message: 'AutoMod rule deleted successfully', ruleId });
  });

  /**
   * POST /api/guilds/:guildId/simulate/automod - Simulate AutoMod incident / trigger event
   */
  router.post('/guilds/:guildId/simulate/automod', (req, res) => {
    const { guildId } = req.params;
    const {
      ruleId = 'automod_rule_1',
      ruleName = '🛡️ Block Scam Links & Malicious URLs',
      triggerType = 1,
      username = 'SuspiciousScammer',
      channelId = 'chan_general',
      channelName = 'general-chat',
      content = 'Free Nitro giveaway! Click discord-gift.ru/claim now!',
      matchedKeyword = 'discord-gift.ru',
      actionType = 1, // 1: BLOCK_MESSAGE, 2: SEND_ALERT_MESSAGE, 3: TIMEOUT, 4: BLOCK_MEMBER_INTERACTION
      timeoutSeconds = 300
    } = req.body;

    const actionData = {
      guildId,
      guildName: '🌸 Mochi Hangout [Demo]',
      ruleId,
      ruleName,
      ruleTriggerType: parseInt(triggerType, 10),
      action: {
        type: parseInt(actionType, 10),
        metadata: {
          channelId,
          durationSeconds: timeoutSeconds,
          customMessage: 'Message blocked by Discord AutoMod protection.'
        }
      },
      userId: 'user_sim_' + Math.floor(Math.random() * 900000 + 100000),
      user: {
        id: 'user_sim_' + Math.floor(Math.random() * 900000 + 100000),
        username,
        avatar: 'https://cdn.discordapp.com/embed/avatars/' + Math.floor(Math.random() * 5) + '.png'
      },
      channelId,
      channelName,
      messageId: 'msg_' + Date.now(),
      content,
      matchedKeyword,
      matchedContent: matchedKeyword,
      executedAt: new Date().toISOString()
    };

    io.to(`guild_${guildId}`).emit('autoModExecution', actionData);
    io.emit('autoModExecution', actionData);

    res.json({ success: true, incident: actionData });
  });

  return router;
};

