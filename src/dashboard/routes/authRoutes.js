const express = require('express');
const { generateOAuthState } = require('../auth/permissions');
const { DEMO_ADMIN_ID } = require('../../demo/fixtures');

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
 * Development convenience session. Only created when APP_MODE=development AND
 * OAuth credentials are missing/incomplete, so a local dashboard remains
 * usable without a Discord OAuth app. Never created in demo or production.
 * The `isDev` flag grants access to every guild the bot is connected to via
 * GuildAccessService (there is no OAuth permission data in this mode).
 */
function developmentUser(config) {
  return {
    id: config.bot.ownerId || 'development_admin',
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
 * exchanging the code. OAuth tokens stay server-side in the session.
 */
function createAuthRoutes({ oauthClient, config, logger }) {
  const router = express.Router();

  router.get('/user', (req, res) => {
    if (req.session?.user) {
      return res.json({ authenticated: true, user: req.session.user });
    }
    if (config.app.isDemo) {
      const user = demoUser();
      req.session.user = user;
      return res.json({ authenticated: true, user });
    }
    return res.json({ authenticated: false, user: null });
  });

  router.get('/login', (req, res) => {
    if (config.app.isDemo) {
      req.session.user = demoUser();
      return res.redirect('/');
    }

    if (!oauthClient.enabled) {
      if (config.app.isDevelopment) {
        logger?.warn('auth', 'login', 'Development login: OAuth not configured, using development admin session (local dev only).');
        req.session.user = developmentUser(config);
        return res.redirect('/');
      }
      logger?.warn('auth', 'login', 'OAuth not configured (missing CLIENT_ID/CLIENT_SECRET).');
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
      const { accessToken } = await oauthClient.exchangeCode(code);
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

      res.redirect('/');
    } catch (err) {
      logger?.error('auth', 'callback', 'OAuth callback failed', { error: err });
      res.redirect('/?error=auth_failed');
    }
  });

  router.get('/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });

  return router;
}

module.exports = { createAuthRoutes };
