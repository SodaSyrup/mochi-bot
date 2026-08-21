const { DEMO_GUILD_ID, DEMO_USERS, DEMO_INVITES, DEMO_LABELS, DEMO_MEMBERS } = require('./fixtures');

/**
 * Demo invite gateway. Stateful in-memory mirror of a Discord guild's invites
 * so the invite service's attribution pipeline (snapshot deltas) can be
 * exercised end-to-end in demo mode. Only ever selected for APP_MODE=demo.
 */
class DemoInviteGateway {
  constructor() {
    this.invites = new Map();
    this.vanityUses = 0;
    this.codeCounter = 1000;
    for (const inv of DEMO_INVITES) {
      this.invites.set(inv.code, { ...inv, createdAt: new Date(Date.now() - 3 * 86400000).toISOString() });
    }
  }

  async fetchGuildInvites(guildId) {
    if (guildId !== DEMO_GUILD_ID) return null;
    return { invites: Array.from(this.invites.values()), vanityUses: this.vanityUses };
  }

  async fetchGuildMembers(guildId) {
    if (guildId !== DEMO_GUILD_ID) return null;
    return DEMO_MEMBERS.map((m) => ({
      id: m.id,
      guildId,
      username: m.username,
      avatar: null,
      bot: m.bot,
      joinedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
      accountCreatedAt: new Date(Date.now() - 200 * 86400000).toISOString(),
    }));
  }

  async createInvite({ guildId, channelId, maxAge = 0, maxUses = 0, temporary = false, reason }) {
    if (guildId !== DEMO_GUILD_ID) throw new Error('Unknown demo guild.');
    this.codeCounter += 1;
    const channel = this.channelName(channelId);
    const code = `mochi-${this.codeCounter.toString(36)}`;
    const snapshot = {
      code,
      uses: 0,
      maxUses: parseInt(maxUses, 10) || 0,
      maxAge: parseInt(maxAge, 10) || 0,
      temporary: Boolean(temporary),
      inviterId: '111111111111111111',
      channelId: channelId || 'chan_general',
      channelName: channel,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    };
    this.invites.set(code, snapshot);
    return snapshot;
  }

  channelName(channelId) {
    const map = { chan_welcome: 'welcome', chan_general: 'general-chat', chan_announcements: 'announcements', chan_community: 'community-lounge', chan_giveaways: 'giveaways' };
    return map[channelId] || (channelId ? String(channelId).replace('chan_', '') : 'general-chat');
  }

  async deleteInvite(guildId, code) {
    if (guildId !== DEMO_GUILD_ID) throw new Error('Unknown demo guild.');
    this.invites.delete(code);
    return { code };
  }

  async resolveUser(userId) {
    return DEMO_USERS[userId] || null;
  }

  async resolveUsers(userIds) {
    return new Map(
      [...new Set((userIds || []).filter(Boolean).map(String))]
        .map((id) => [id, DEMO_USERS[id] || null])
    );
  }

  demoMembers() {
    return DEMO_MEMBERS;
  }
}

module.exports = { DemoInviteGateway };
