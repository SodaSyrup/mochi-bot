const { UnauthorizedError, ExternalServiceError } = require('../errors');

/**
 * Discord OAuth2 client. Wraps the authorize/token/identity/guilds flows.
 * The auth route stays a thin adapter: generate state, redirect, exchange,
 * store identity.
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
    return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for an access token.
   * @returns {Promise<{ accessToken: string, tokenData: object }>}
   */
  async exchangeCode(code) {
    const res = await this.#fetch('https://discord.com/api/oauth2/token', {
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
    return { accessToken: tokenData.access_token, tokenData };
  }

  async fetchIdentity(accessToken) {
    const res = await this.#fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new ExternalServiceError('Discord identity fetch failed.');
    return res.json();
  }

  /**
   * Fetch the user's guilds with permission bitfields (scope `guilds`).
   * @returns {Promise<Array<{id, name, icon, owner, permissions}>>}
   */
  async fetchGuilds(accessToken) {
    const res = await this.#fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new ExternalServiceError('Discord guild fetch failed.');
    return res.json();
  }
}

module.exports = { DiscordOAuthClient };
