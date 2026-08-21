const express = require('express');
const { generateOAuthState } = require('../auth/permissions');
const { DEMO_ADMIN_ID } = require('../../demo/fixtures');

/**
 * Loopback check. Uses the actual TCP peer address (req.socket.remoteAddress)
 * which is never influenced by client-supplied headers, so untrusted
 * X-Forwarded-For values cannot bypass the restriction even though `trust
 * proxy` is not configured.
 */
function isLoopbackAddress(address) {
  if (!address) return false;
  const clean = address.replace(/^::ffff:/, '');
  return clean === '127.0.0.1' || clean === '::1' || /^127\./.test(clean);
}

/**
 * Map the session user to the safe public shape returned to the dashboard.
 * Never includes session id, OAuth tokens, or the raw discordGuilds snapshot.
 */
function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    discriminator: user.discriminator ?? null,
    avatar: user.avatar ?? null,
    tag: user.tag ?? null,
    isDemo: Boolean(user.isDemo),
    isDev: Boolean(user.isDev),
  };
}

function demoUser() {
  return {
    id: DEMO_ADMIN_ID,
    username: 'MochiAdmin',
    discriminator: '0001',
    avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
    tag: 'MochiAdmin#0001',
    isDemo: true,
  };
}

/**
 * Development convenience session. Only created when ALL of the following are
 * true:
 *   - APP_MODE=development
 *   - DEV_AUTH_BYPASS=true (explicit opt-in; never implicit)
 *   - the request originates from a loopback address
 *   - OAuth credentials are missing/incomplete
 *
 * The `isDev` flag grants access to every guild the bot is connected to via
 * GuildAccessService (there is no OAuth permission data in this mode). It is
 * never created in demo or production, and never without the explicit bypass.
 */
function developmentUser() {
  return {
    id: 'development_admin',
    username: 'Development Admin',
    discriminator: null,
    avatar: 'https://cdn.discordapp.com/embed/avatars/2.png',
    tag: 'Development Admin',
    isDemo: false,
    isDev: true,
    discordGuilds: [],
  };
}

/**
 * OAuth routes — thin adapter over DiscordOAuthClient. Login generates and
 * stores a cryptographically random `state`; the callback validates it before
 * exchanging the code. OAuth tokens (access + refresh) stay server-side in
 * `session.discordOAuth` and are never sent to browser JavaScript.
 */
function createAuthRoutes({ oauthClient, config, logger }) {
  const router = express.Router();

  router.get('/user', (req, res) => {
    if (req.session?.user) {
      return res.json({ authenticated: true, user: publicUser(req.session.user) });
    }
    if (config.app.isDemo) {
      const user = demoUser();
      req.session.user = user;
      return res.json({ authenticated: true, user: publicUser(user) });
    }
    return res.json({ authenticated: false, user: null });
  });

  router.get('/login', (req, res) => {
    if (config.app.isDemo) {
      req.session.user = demoUser();
      return res.redirect('/');
    }

    if (!oauthClient.enabled) {
      const bypassEnabled = config.app.devAuthBypass === true && config.app.isDevelopment;
      const loopback = isLoopbackAddress(req.socket?.remoteAddress);
      if (bypassEnabled && loopback) {
        logger?.warn('auth', 'login', 'Development login: DEV_AUTH_BYPASS enabled, using development admin session (loopback only).');
        req.session.user = developmentUser();
        return res.redirect('/');
      }
      logger?.warn('auth', 'login', 'OAuth not configured; development bypass disabled or non-loopback request.');
      return res.redirect('/?error=oauth_not_configured');
    }

    // Reuse the pending state if one exists. Unauthenticated pages auto-redirect
    // to /auth/login; regenerating state on every hit races against the Discord
    // callback (a second tab/reload would invalidate the user's in-flight login).
    if (!req.session.oauthState) {
      req.session.oauthState = generateOAuthState();
    }
    logger?.info('auth', 'login', `Starting Discord OAuth with redirect_uri=${config.dashboard.redirectUri} (client_id=${config.bot.clientId})`);
    res.redirect(oauthClient.createAuthorizeUrl(req.session.oauthState));
  });

  router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      logger?.warn('auth', 'callback', `Discord OAuth error: ${error}`);
      return res.redirect('/?error=auth_denied');
    }
    if (!code) return res.redirect('/?error=no_code');

    // OAuth state validation: reject missing/invalid state, then clear it.
    const expectedState = req.session?.oauthState;
    if (!state || !expectedState || state !== expectedState) {
      logger?.warn('auth', 'callback', 'OAuth state validation failed.');
      return res.redirect('/?error=invalid_state');
    }
    req.session.oauthState = null;

    try {
      const { accessToken, refreshToken, expiresIn } = await oauthClient.exchangeCode(code);
      const [userData, guildsData] = await Promise.all([
        oauthClient.fetchIdentity(accessToken),
        oauthClient.fetchGuilds(accessToken),
      ]);

      req.session.user = {
        id: userData.id,
        username: userData.username,
        discriminator: userData.discriminator,
        avatar: userData.avatar
          ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
          : 'https://cdn.discordapp.com/embed/avatars/0.png',
        tag: userData.discriminator ? `${userData.username}#${userData.discriminator}` : userData.username,
        isDemo: false,
        // Normalized guild permission info (parsed only inside GuildAccessService).
        discordGuilds: (Array.isArray(guildsData) ? guildsData : []).map((g) => ({
          id: g.id,
          name: g.name,
          icon: g.icon,
          owner: Boolean(g.owner),
          permissions: String(g.permissions),
        })),
      };

      // Server-side OAuth credentials for permission refresh. Never exposed to
      // the browser, never logged, never returned in API JSON.
      req.session.discordOAuth = {
        accessToken,
        refreshToken: refreshToken || null,
        expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
        guildPermissionsFetchedAt: Date.now(),
      };

      res.redirect('/');
    } catch (err) {
      logger?.error('auth', 'callback', 'OAuth callback failed', { error: err });
      res.redirect('/?error=auth_failed');
    }
  });

  router.get('/logout', (req, res) => {
    const accessToken = req.session?.discordOAuth?.accessToken;
    req.session.destroy(() => {
      // Best-effort OAuth token revocation; never blocks local logout.
      if (accessToken && oauthClient.enabled) {
        oauthClient.revokeToken(accessToken);
      }
      res.redirect('/');
    });
  });

  return router;
}

module.exports = { createAuthRoutes, isLoopbackAddress, publicUser };
