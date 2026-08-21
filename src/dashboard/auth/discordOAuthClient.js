const { UnauthorizedError, ExternalServiceError } = require('../errors');
const { DISCORD_API_BASE_URL } = require('../../platform/discord/urls');

/**
 * Discord OAuth2 client. Wraps the authorize/token/identity/guilds/refresh
 * flows. The auth route and GuildPermissionService stay thin adapters:
 * token mechanics (exchange, refresh, revocation) live here and nowhere else.
 *
 * Tokens are never logged, never returned in API JSON, and never sent to
 * browser JavaScript — they only ever live server-side in the session.
 */
class DiscordOAuthClient {
  constructor({ clientId, clientSecret, redirectUri, logger, fetchImpl = null }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.logger = logger || console;
    this.fetchImpl = fetchImpl || (() => global.fetch);
  }

  #fetch(url, options) {
    return this.fetchImpl()(url, options);
  }

  get enabled() {
    return Boolean(this.clientId && this.clientSecret);
  }

  createAuthorizeUrl(state) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
      state,
    });
    return `${DISCORD_API_BASE_URL}/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for an access token.
   * @returns {Promise<{ accessToken: string, refreshToken: string|null, expiresIn: number, tokenData: object }>}
   */
  async exchangeCode(code) {
    const res = await this.#fetch(`${DISCORD_API_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
      }),
    });
    const tokenData = await res.json();
    if (!tokenData.access_token) {
      throw new ExternalServiceError('Discord token exchange failed.');
    }
    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      expiresIn: Number.isFinite(Number(tokenData.expires_in)) ? Number(tokenData.expires_in) : null,
      tokenData,
    };
  }

  /**
   * Refresh an expired access token using a stored refresh token.
   * A revoked/invalid refresh token results in an UnauthorizedError so the
   * caller can force re-authentication rather than reuse stale authorization.
   * @returns {Promise<{ accessToken: string, refreshToken: string|null, expiresIn: number }>}
   */
  async refreshAccessToken(refreshToken) {
    if (!refreshToken) {
      throw new UnauthorizedError('OAuth refresh token is missing; re-authentication required.');
    }
    const res = await this.#fetch(`${DISCORD_API_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    const tokenData = await res.json();
    if (res.status === 401 || res.status === 400 || !tokenData.access_token) {
      // invalid_grant => the user's authorization was revoked.
      throw new UnauthorizedError('Discord authorization is no longer valid; please sign in again.');
    }
    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || refreshToken,
      expiresIn: Number.isFinite(Number(tokenData.expires_in)) ? Number(tokenData.expires_in) : null,
    };
  }

  async fetchIdentity(accessToken) {
    const res = await this.#fetch(`${DISCORD_API_BASE_URL}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) throw new UnauthorizedError('Discord identity fetch failed; please sign in again.');
    if (!res.ok) throw new ExternalServiceError('Discord identity fetch failed.');
    return res.json();
  }

  /**
   * Fetch the user's guilds with permission bitfields (scope `guilds`).
   * @returns {Promise<Array<{id, name, icon, owner, permissions}>>}
   */
  async fetchGuilds(accessToken) {
    const res = await this.#fetch(`${DISCORD_API_BASE_URL}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) throw new UnauthorizedError('Discord guild fetch failed; please sign in again.');
    if (!res.ok) throw new ExternalServiceError('Discord guild fetch failed.');
    return res.json();
  }

  /**
   * Best-effort OAuth token revocation. Used on logout so the access token is
   * not left valid in the wild. Failures are logged, never thrown to callers.
   */
  async revokeToken(accessToken) {
    if (!accessToken) return;
    try {
      await this.#fetch(`${DISCORD_API_BASE_URL}/oauth2/token/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          token: accessToken,
        }),
      });
    } catch (err) {
      this.logger?.warn('oauth', 'revokeToken', 'Discord token revocation failed; local session will still be destroyed.', { error: err });
    }
  }
}

module.exports = { DiscordOAuthClient };
