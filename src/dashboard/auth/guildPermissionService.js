const { UnauthorizedError } = require('../errors');
const { DEFAULTS } = require('../../config/defaults');

const DEFAULT_TTL_SECONDS = DEFAULTS.auth.permissionTtlSeconds;
const TOKEN_EXPIRY_SKEW_MS = 60 * 1000; // refresh when the access token is within 60s of expiry

/**
 * Owns the lifetime of OAuth guild-permission snapshots.
 *
 * Authentication session lifetime and authorization snapshot lifetime are
 * DIFFERENT concepts: a long-lived login session must not imply equally
 * long-lived authorization. Snapshots are refreshed (from Discord) when stale;
 * OAuth access tokens are refreshed with the server-side refresh token; and a
 * revoked/invalid authorization must fail closed (401) instead of silently
 * reusing stale permission data.
 *
 * Tokens live only in `session.discordOAuth` server-side and are never
 * serialized to the client.
 */
class GuildPermissionService {
  constructor({ oauthClient, clock = null, ttlSeconds = null, logger = null }) {
    this.oauthClient = oauthClient;
    this.clock = clock || { now: () => Date.now() };
    this.ttlSeconds = ttlSeconds || DEFAULT_TTL_SECONDS;
    this.logger = logger || console;
  }

  /**
   * Whether the stored Discord guild snapshot is still fresh enough to trust.
   */
  isPermissionSnapshotFresh(session) {
    const fetchedAt = session?.discordOAuth?.guildPermissionsFetchedAt;
    if (!fetchedAt) return false;
    const ageMs = this.clock.now() - fetchedAt;
    return ageMs >= 0 && ageMs < this.ttlSeconds * 1000;
  }

  /**
   * Return a usable access token for the session, refreshing it from the
   * server-side refresh token when it is expired or near expiry.
   */
  async getValidAccessToken(session) {
    const oauth = session.discordOAuth;
    if (!oauth?.accessToken) {
      throw new UnauthorizedError('No Discord session; please sign in again.');
    }
    const expiresAt = oauth.expiresAt;
    const now = this.clock.now();
    const nearExpiry = Number.isFinite(expiresAt) && now >= expiresAt - TOKEN_EXPIRY_SKEW_MS;

    if (nearExpiry && oauth.refreshToken) {
      const refreshed = await this.oauthClient.refreshAccessToken(oauth.refreshToken);
      oauth.accessToken = refreshed.accessToken;
      oauth.refreshToken = refreshed.refreshToken;
      oauth.expiresAt = refreshed.expiresIn ? now + refreshed.expiresIn * 1000 : null;
      return oauth.accessToken;
    }
    return oauth.accessToken;
  }

  /**
   * Normalize raw Discord guild objects into the stored permission snapshot
   * shape (parsed inside GuildAccessService via bitfield helpers).
   */
  normalizeGuildPermissions(guilds) {
    return (Array.isArray(guilds) ? guilds : []).map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      owner: Boolean(g.owner),
      permissions: String(g.permissions),
    }));
  }

  /**
   * The current guild-permission snapshot for a session, refreshed from
   * Discord when stale. Mutates the session snapshot in place so express-session
   * persists it; never returns OAuth material.
   */
  async getCurrentGuildPermissions(session) {
    if (!session?.user) return [];
    if (this.isPermissionSnapshotFresh(session)) {
      return session.user.discordGuilds || [];
    }
    const accessToken = await this.getValidAccessToken(session);
    const guilds = await this.oauthClient.fetchGuilds(accessToken);
    session.user.discordGuilds = this.normalizeGuildPermissions(guilds);
    session.discordOAuth = session.discordOAuth || {};
    session.discordOAuth.guildPermissionsFetchedAt = this.clock.now();
    return session.user.discordGuilds;
  }
}

module.exports = { GuildPermissionService, DEFAULT_TTL_SECONDS };
