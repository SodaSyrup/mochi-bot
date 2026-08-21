const { canManageGuild } = require('./permissions');
const { ForbiddenError } = require('../errors');

/**
 * Single source of truth for dashboard guild access.
 *
 * A guild is available to a user only when it is BOTH manageable by the
 * logged-in Discord user AND currently has Mochi as a member.
 *
 * Authorization is evaluated against a CURRENT permission snapshot. When a
 * GuildPermissionService is wired in, stale snapshots are refreshed from
 * Discord before the access decision (see GuildPermissionService); a failed or
 * revoked refresh fails closed rather than allowing stale authorization.
 *
 * Development behavior: a session created by the development convenience login
 *                 (`isDev`) may access every guild Mochi is in — there is no
 *                 OAuth permission data in that mode. Live sessions use the
 *                 intersection of manageable user guilds and bot guilds.
 *
 * Methods accept a session context ({ user, discordOAuth }) so permission
 * refresh can read/write the OAuth snapshot server-side.
 */
class GuildAccessService {
  constructor({ guildGateway, permissionService = null, isDevelopment = false }) {
    this.gateway = guildGateway;
    this.permissionService = permissionService;
    this.isDevelopment = isDevelopment;
  }

  // Accept either a full session ({ user }) or a bare sessionUser object.
  #user(ctx) {
    if (!ctx) return null;
    return ctx.user || ctx;
  }

  /**
   * @param {{ user?: { id?: string, isDev?: boolean, discordGuilds?: Array }, discordOAuth?: object }} session
   */
  async listManageableGuilds(session) {
    const sessionUser = this.#user(session);
    if (!sessionUser) return [];

    const botGuilds = await this.gateway.listGuilds();
    const botGuildById = new Map(botGuilds.map((guild) => [guild.id, guild]));

    // Development convenience login: no OAuth permission data exists, so the
    // development session may access every guild the bot is connected to.
    if (this.isDevelopment && sessionUser.isDev) {
      return botGuilds.map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon || null,
        memberCount: g.memberCount || 0,
        ownerId: g.ownerId || null,
      }));
    }

    let userGuilds = sessionUser.discordGuilds || [];
    // Live OAuth sessions refresh stale snapshots before the decision.
    if (this.permissionService && session?.discordOAuth) {
      userGuilds = await this.permissionService.getCurrentGuildPermissions(session);
    }

    return userGuilds
      .filter((g) => {
        const botGuild = botGuildById.get(g.id);
        if (!botGuild) return false;

        // Discord's OAuth guild snapshot normally includes `owner`, but the
        // bot's live guild object also exposes the authoritative ownerId. Use
        // both so the server owner is recognized dynamically per guild without
        // requiring a global OWNER_ID environment variable.
        const isOwner = g.owner === true || botGuild.ownerId === sessionUser.id;
        return isOwner || canManageGuild(g);
      })
      .map((g) => {
        const botGuild = botGuildById.get(g.id);
        return {
          id: g.id,
          name: g.name || botGuild?.name || 'Unknown',
          icon: g.icon || botGuild?.icon || null,
          memberCount: botGuild?.memberCount || 0,
          ownerId: botGuild?.ownerId || (g.owner ? sessionUser.id : null),
        };
      });
  }

  async canViewGuild(session, guildId) {
    return this.canManageGuild(session, guildId);
  }

  async canManageGuild(session, guildId) {
    const sessionUser = this.#user(session);
    if (!sessionUser) return false;
    const guilds = await this.listManageableGuilds(session);
    return guilds.some((g) => g.id === guildId);
  }

  async assertCanManageGuild(session, guildId) {
    if (!(await this.canManageGuild(session, guildId))) {
      throw new ForbiddenError('You do not have permission to manage this guild.');
    }
  }
}

module.exports = { GuildAccessService };
