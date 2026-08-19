const express = require('express');
const router = express.Router();
const config = require('../../config');

/**
 * Get current session user
 */
router.get('/user', (req, res) => {
  if (req.session?.user) {
    return res.json({ authenticated: true, user: req.session.user });
  }

  // If in demo mode, auto-provide demo admin user
  if (config.dashboard.demoMode) {
    const demoUser = {
      id: '123456789012345678',
      username: 'MochiAdmin',
      discriminator: '0001',
      avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
      tag: 'MochiAdmin#0001',
      isDemo: true
    };
    req.session.user = demoUser;
    return res.json({ authenticated: true, user: demoUser });
  }

  return res.json({ authenticated: false, user: null });
});

/**
 * Discord OAuth2 Login or Demo Login
 */
router.get('/login', (req, res) => {
  if (!config.bot.clientId || !config.bot.clientSecret || config.dashboard.demoMode) {
    // Demo Mode login
    req.session.user = {
      id: '123456789012345678',
      username: 'MochiAdmin',
      discriminator: '0001',
      avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
      tag: 'MochiAdmin#0001',
      isDemo: true
    };
    return res.redirect('/');
  }

  const redirectUri = encodeURIComponent(config.dashboard.redirectUri);
  const scope = encodeURIComponent('identify guilds');
  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${config.bot.clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
  
  res.redirect(discordAuthUrl);
});

/**
 * Discord OAuth2 Callback
 */
router.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: config.bot.clientId,
        client_secret: config.bot.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.dashboard.redirectUri
      }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      return res.redirect('/?error=token_failed');
    }

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const userData = await userResponse.json();

    req.session.user = {
      id: userData.id,
      username: userData.username,
      discriminator: userData.discriminator,
      avatar: userData.avatar
        ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
        : 'https://cdn.discordapp.com/embed/avatars/0.png',
      tag: `${userData.username}#${userData.discriminator}`,
      isDemo: false
    };

    res.redirect('/');
  } catch (err) {
    console.error('[Auth] OAuth error:', err);
    res.redirect('/?error=auth_failed');
  }
});

/**
 * Logout
 */
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
