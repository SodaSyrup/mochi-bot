require('dotenv').config();
const path = require('path');

module.exports = {
  bot: {
    token: process.env.DISCORD_TOKEN || '',
    clientId: process.env.CLIENT_ID || '',
    clientSecret: process.env.CLIENT_SECRET || '',
    ownerId: process.env.OWNER_ID || '',
    defaultPrefix: process.env.DEFAULT_PREFIX || '!',
    embedColor: process.env.EMBED_COLOR || '#7c3aed',
  },
  dashboard: {
    port: parseInt(process.env.PORT || '3000', 10),
    sessionSecret: process.env.SESSION_SECRET || 'mochi_default_secret_please_change_in_production',
    url: process.env.DASHBOARD_URL || 'http://localhost:3000',
    redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback',
    demoMode: process.env.DEMO_MODE === 'true' || !process.env.DISCORD_TOKEN,
  },
  database: {
    path: process.env.DATABASE_PATH || path.join(__dirname, '../data/mochi.sqlite'),
  },
  inviteTracker: {
    fakeAccountThresholdDays: 7, // Accounts < 7 days old flagged as fake
  }
};
