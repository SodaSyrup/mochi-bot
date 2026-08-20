const { canManageGuild } = require('./permissions');
const { ForbiddenError } = require('../errors');
const { DEMO_GUILD_ID, DEMO_GUILD } = require('../../demo/fixtures');

/**
 * Single source of truth for dashboard guild access.
 *
 * A guild is available to a user only when it is BOTH manageable by the
 * logged-in Discord user AND currently has Mochi as a member.
 *
 * Mode behavior:
 *  - demo:        only the explicit demo guild, for the demo identity.
 *  - development: a session created by the development convenience login
 *                 (`isDev`) may access every guild Mochi is in — there is no
 *                 OAuth permission data in that mode. Never active in demo or
 *                 production.
 *  - live:        intersection of manageable user guilds and bot guilds.
 */
class GuildAccessService {
  constructor({ guildGateway, isDemo = false, isDevelopment = false }) {
    this.gateway = guildGateway;
    this.isDemo = isDemo;
    this.isDevelopment = isDevelopment;
  }

  /**
   * @param {{ id?: string, isDemo?: boolean, isDev?: boolean, discordGuilds?: Array }} sessionUser
   */
  async listManageableGuilds(sessionUser) {
    if (!sessionUser) return [];

    if (this.isDemo) {
      if (!sessionUser.isDemo) return [];
      return [{ ...DEMO_GUILD }];
    }

    const botGuilds = await this.gateway.listGuilds();

    // Development convenience login: no OAuth permission data exists, so the
    // development session may access every guild the bot is connected to.
    if (this.isDevelopment && sessionUser.isDev) {
      return botGuilds.map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon || null,
        memberCount: g.memberCount || 0,
        ownerId: g.ownerId || null,
        isSimulated: false,
      }));
    }

    const userGuilds = sessionUser.discordGuilds || [];
    const botGuildIds = new Set(botGuilds.map((g) => g.id));

    return userGuilds
      .filter((g) => canManageGuild(g))
      .filter((g) => botGuildIds.has(g.id))
      .map((g) => {
        const botGuild = botGuilds.find((b) => b.id === g.id);
        return {
          id: g.id,
          name: g.name || botGuild?.name || 'Unknown',
          icon: g.icon || botGuild?.icon || null,
          memberCount: botGuild?.memberCount || 0,
          ownerId: typeof g.owner === 'boolean' ? null : g.owner,
          isSimulated: false,
        };
      });
  }

  async canViewGuild(sessionUser, guildId) {
    return this.canManageGuild(sessionUser, guildId);
  }

  async canManageGuild(sessionUser, guildId) {
    if (!sessionUser) return false;
    if (this.isDemo) {
      return sessionUser.isDemo && guildId === DEMO_GUILD_ID;
    }
    const guilds = await this.listManageableGuilds(sessionUser);
    return guilds.some((g) => g.id === guildId);
  }

  async assertCanManageGuild(sessionUser, guildId) {
    if (!(await this.canManageGuild(sessionUser, guildId))) {
      throw new ForbiddenError('You do not have permission to manage this guild.');
    }
  }
}

module.exports = { GuildAccessService };
