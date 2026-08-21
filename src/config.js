const path = require('path');
const crypto = require('crypto');

const APP_MODES = Object.freeze(['development', 'demo', 'production']);
const DEFAULT_SECRET = 'mochi_default_secret_please_change_in_production';
const DEFAULT_FAKE_THRESHOLD_DAYS = 7;
const DEFAULT_GUILD_PERMISSION_CACHE_TTL_SECONDS = 600;

function resolveAppMode(env = process.env) {
  const explicit = (env.APP_MODE || '').trim().toLowerCase();
  return explicit || 'development';
}

/**
 * Single source of truth for the database file path.
 *
 * demo mode uses the demo database; every other mode uses the configured
 * normal database. Application composition and maintenance tooling (e.g. the
 * projection rebuild CLI) MUST call this helper instead of re-deriving the
 * demo-vs-normal path themselves, so they can never select a different file.
 */
function resolveDatabasePath(config) {
  return config.app.isDemo ? config.database.demoPath : config.database.path;
}

function buildConfig(env = process.env) {
  const mode = resolveAppMode(env);
  if (!APP_MODES.includes(mode)) {
    throw new Error(
      `Invalid APP_MODE "${mode}". Allowed values: ${APP_MODES.join(', ')}. ` +
      'Set APP_MODE=development|demo|production in .env.'
    );
  }

  const isProduction = mode === 'production';
  const isDemo = mode === 'demo';
  const isDevelopment = mode === 'development';

  const devAuthBypass = env.DEV_AUTH_BYPASS === 'true';

  // The development auth bypass must NEVER be enabled in production. Fail
  // configuration validation rather than silently ignoring an insecure setting.
  if (isProduction && devAuthBypass) {
    throw new Error(
      '[Config] DEV_AUTH_BYPASS=true is forbidden in APP_MODE=production. ' +
      'Remove DEV_AUTH_BYPASS before starting in production.'
    );
  }

  const token = env.DISCORD_TOKEN || '';
  const clientId = env.CLIENT_ID || '';
  const clientSecret = env.CLIENT_SECRET || '';
  // Keep the public origin canonical for CORS and derive the OAuth callback
  // without accidentally producing a double slash.
  const dashboardUrl = (env.DASHBOARD_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const redirectUri = env.REDIRECT_URI || `${dashboardUrl}/auth/callback`;

  if (isProduction) {
    const missing = [];
    if (!token) missing.push('DISCORD_TOKEN');
    if (!clientId) missing.push('CLIENT_ID');
    if (!clientSecret) missing.push('CLIENT_SECRET');
    if (!env.SESSION_SECRET || env.SESSION_SECRET === DEFAULT_SECRET) {
      missing.push('SESSION_SECRET (must be a unique random value, not the default)');
    }
    let redirectValid = false;
    try {
      new URL(redirectUri);
      new URL(dashboardUrl);
      redirectValid = true;
    } catch {
      redirectValid = false;
    }
    if (!redirectValid) missing.push('DASHBOARD_URL / REDIRECT_URI (must be valid absolute URLs)');

    if (missing.length > 0) {
      throw new Error(
        `[Config] APP_MODE=production is missing required configuration: ${missing.join(', ')}. ` +
        'Fix these in your environment or .env before starting.'
      );
    }
  }

  // In production the secret is required. In development/demo we fall back to an
  // ephemeral random secret so cookies still work without shipping a default.
  const sessionSecret = isProduction
    ? env.SESSION_SECRET
    : env.SESSION_SECRET && env.SESSION_SECRET !== DEFAULT_SECRET
      ? env.SESSION_SECRET
      : crypto.randomBytes(32).toString('hex');

  const databasePath = env.DATABASE_PATH || path.join(__dirname, '../data/mochi.sqlite');
  const demoSqlitePath = env.DEMO_DATABASE_PATH || path.join(__dirname, '../data/mochi-demo.sqlite');

  const permissionTtlSeconds = parseInt(
    env.GUILD_PERMISSION_CACHE_TTL_SECONDS || String(DEFAULT_GUILD_PERMISSION_CACHE_TTL_SECONDS),
    10
  );

  const fakeAccountThresholdDays = parseIntegerInRange(
    env.FAKE_ACCOUNT_THRESHOLD_DAYS,
    DEFAULT_FAKE_THRESHOLD_DAYS,
    0,
    365,
    'FAKE_ACCOUNT_THRESHOLD_DAYS'
  );

  return {
    app: {
      mode,
      isProduction,
      isDemo,
      isDevelopment,
      devAuthBypass,
    },
    bot: {
      token,
      clientId,
      clientSecret,
      embedColor: env.EMBED_COLOR || '#7c3aed',
    },
    dashboard: {
      port: parseInt(env.PORT || '3000', 10),
      sessionSecret,
      url: dashboardUrl,
      redirectUri,
    },
    database: {
      path: databasePath,
      demoPath: demoSqlitePath,
    },
    inviteTracker: {
      fakeAccountThresholdDays,
    },
    auth: {
      devAuthBypass,
      permissionTtlSeconds,
    },
  };
}

function parseIntegerInRange(value, fallback, min, max, name) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`[Config] ${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

module.exports = buildConfig();
module.exports.buildConfig = buildConfig;
module.exports.resolveDatabasePath = resolveDatabasePath;
