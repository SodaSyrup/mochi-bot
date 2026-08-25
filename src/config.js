const path = require('path');
const crypto = require('crypto');
const { DEFAULTS, DEFAULT_SECRET, LEGACY_ENV_KEYS, BUILTIN_PLUGIN_IDS } = require('./config/defaults');
const { PluginValidationError } = require('./plugins/core/errors');

const APP_MODES = Object.freeze(['development', 'production']);

function resolveAppMode(env = process.env) {
  const explicit = (env.APP_MODE || '').trim().toLowerCase();
  return explicit || DEFAULTS.app.mode;
}

/**
 * Single source of truth for the database file path.
 *
 * Application composition and maintenance tooling (e.g. the projection
 * rebuild CLI) MUST call this helper instead of re-deriving the database path.
 */
function resolveDatabasePath(config) {
  return config.database.path;
}

function buildConfig(env = process.env) {
  const mode = resolveAppMode(env);
  const legacyEnvKeys = LEGACY_ENV_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(env, key));
  if (!APP_MODES.includes(mode)) {
    throw new Error(
      `Invalid APP_MODE "${mode}". Allowed values: ${APP_MODES.join(', ')}. ` +
      'Set APP_MODE=development|production in .env.'
    );
  }

  const isProduction = mode === 'production';
  const isDevelopment = mode === 'development';

  const devAuthBypass = env.DEV_AUTH_BYPASS === 'true';

  // Legacy flags are no longer supported in any mode. Failing early prevents
  // an old DEMO_MODE setting from being mistaken for an active sandbox.
  if (legacyEnvKeys.length > 0) {
    throw new Error(
      `[Config] Obsolete environment variable(s): ${legacyEnvKeys.join(', ')}. ` +
      'Remove them and use the current .env.example schema.'
    );
  }

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
  const dashboardUrl = (env.DASHBOARD_URL || DEFAULTS.dashboard.url).replace(/\/+$/, '');
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

  // In production the secret is required. In development we fall back to an
  // ephemeral random secret so cookies still work without shipping a default.
  const sessionSecret = isProduction
    ? env.SESSION_SECRET
    : env.SESSION_SECRET && env.SESSION_SECRET !== DEFAULT_SECRET
      ? env.SESSION_SECRET
      : crypto.randomBytes(32).toString('hex');

  const databasePath = env.DATABASE_PATH || path.join(__dirname, '../data/mochi.sqlite');
  const sessionStorePath = env.SESSION_STORE_PATH || path.join(__dirname, '../data/mochi-sessions.sqlite');

  const permissionTtlSeconds = parseIntegerInRange(
    env.GUILD_PERMISSION_CACHE_TTL_SECONDS,
    DEFAULTS.auth.permissionTtlSeconds,
    1,
    24 * 60 * 60,
    'GUILD_PERMISSION_CACHE_TTL_SECONDS'
  );

  const fakeAccountThresholdDays = parseIntegerInRange(
    env.FAKE_ACCOUNT_THRESHOLD_DAYS,
    DEFAULTS.inviteTracker.fakeAccountThresholdDays,
    0,
    DEFAULTS.inviteTracker.maxFakeAccountThresholdDays,
    'FAKE_ACCOUNT_THRESHOLD_DAYS'
  );

  const disabledPlugins = parseDisabledPlugins(env.DISABLED_PLUGINS);

  const globalBansAdminUserIds = parseDiscordUserIds(env.GLOBAL_BANS_ADMIN_USER_IDS);
  const globalBansAdminToken = String(env.GLOBAL_BANS_ADMIN_TOKEN || '').trim();
  if ((globalBansAdminUserIds.length > 0) !== Boolean(globalBansAdminToken)) {
    throw new Error('[Config] GLOBAL_BANS_ADMIN_USER_IDS and GLOBAL_BANS_ADMIN_TOKEN must be configured together.');
  }

  const globalBansApiUrl = (env.GLOBAL_BANS_API_URL || '').trim().replace(/\/+$/, '');
  if (globalBansApiUrl) {
    try {
      const parsed = new URL(globalBansApiUrl);
      if (isProduction && parsed.protocol !== 'https:') {
        throw new Error('[Config] GLOBAL_BANS_API_URL must use HTTPS in production.');
      }
    } catch (error) {
      if (error.message.startsWith('[Config]')) throw error;
      throw new Error('[Config] GLOBAL_BANS_API_URL must be a valid absolute URL.');
    }
  }

  return {
    app: {
      mode,
      isProduction,
      isDevelopment,
      devAuthBypass,
      legacyEnvKeys,
    },
    plugins: {
      disabled: disabledPlugins,
      apiVersion: DEFAULTS.plugins.apiVersion,
    },
    bot: {
      token,
      clientId,
      clientSecret,
      embedColor: env.EMBED_COLOR || DEFAULTS.bot.embedColor,
    },
    dashboard: {
      port: parseIntegerInRange(env.PORT, DEFAULTS.dashboard.port, 0, 65535, 'PORT'),
      sessionCookieName: env.SESSION_COOKIE_NAME || DEFAULTS.dashboard.sessionCookieName,
      sessionTtlMs:
        parseIntegerInRange(
          env.SESSION_TTL_SECONDS,
          DEFAULTS.dashboard.sessionTtlSeconds,
          5 * 60,
          30 * 24 * 60 * 60,
          'SESSION_TTL_SECONDS'
        ) * 1000,
      sessionSecret,
      sessionStorePath,
      url: dashboardUrl,
      redirectUri,
    },
    database: {
      path: databasePath,
    },
    inviteTracker: {
      fakeAccountThresholdDays,
      maxFakeAccountThresholdDays: DEFAULTS.inviteTracker.maxFakeAccountThresholdDays,
    },
    auth: {
      devAuthBypass,
      permissionTtlSeconds,
    },
    limits: DEFAULTS.limits,
    operations: DEFAULTS.operations,
    globalBans: {
      apiUrl: globalBansApiUrl,
      syncToken: env.GLOBAL_BANS_SYNC_TOKEN || '',
      adminToken: globalBansAdminToken,
      adminUserIds: globalBansAdminUserIds,
      syncIntervalSeconds: parseIntegerInRange(env.GLOBAL_BANS_SYNC_INTERVAL_SECONDS, DEFAULTS.globalBans.syncIntervalSeconds, 5, 24 * 60 * 60, 'GLOBAL_BANS_SYNC_INTERVAL_SECONDS'),
      requestTimeoutMs: parseIntegerInRange(env.GLOBAL_BANS_REQUEST_TIMEOUT_MS, DEFAULTS.globalBans.requestTimeoutMs, 250, 60 * 1000, 'GLOBAL_BANS_REQUEST_TIMEOUT_MS'),
      maxCacheStalenessSeconds: parseIntegerInRange(env.GLOBAL_BANS_MAX_CACHE_STALENESS_SECONDS, DEFAULTS.globalBans.maxCacheStalenessSeconds, 60, 30 * 24 * 60 * 60, 'GLOBAL_BANS_MAX_CACHE_STALENESS_SECONDS'),
      guildConcurrency: parseIntegerInRange(env.GLOBAL_BANS_GUILD_CONCURRENCY, DEFAULTS.globalBans.guildConcurrency, 1, 25, 'GLOBAL_BANS_GUILD_CONCURRENCY'),
      maxJobAttempts: parseIntegerInRange(env.GLOBAL_BANS_JOB_MAX_ATTEMPTS, DEFAULTS.globalBans.maxJobAttempts, 1, 50, 'GLOBAL_BANS_JOB_MAX_ATTEMPTS'),
      enforcementEnabled: env.GLOBAL_BANS_ENFORCEMENT_ENABLED !== 'false',
    },
  };
}

function parseDisabledPlugins(value) {
  if (value === undefined || value === null || String(value).trim() === '') return [];
  const ids = String(value).split(',').map((id) => id.trim()).filter(Boolean);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw new PluginValidationError(`[Config] DISABLED_PLUGINS contains duplicate plugin ID "${id}".`, { pluginId: id });
    if (!BUILTIN_PLUGIN_IDS.includes(id)) {
      throw new PluginValidationError(`[Config] DISABLED_PLUGINS contains unknown plugin ID "${id}".`, { pluginId: id });
    }
    seen.add(id);
  }
  return ids;
}

function parseDiscordUserIds(value) {
  if (value === undefined || value === null || String(value).trim() === '') return [];
  const ids = String(value).split(',').map((id) => id.trim()).filter(Boolean);
  const seen = new Set();
  for (const id of ids) {
    if (!/^\d{5,25}$/.test(id)) throw new Error(`[Config] GLOBAL_BANS_ADMIN_USER_IDS contains invalid Discord user ID "${id}".`);
    if (seen.has(id)) throw new Error(`[Config] GLOBAL_BANS_ADMIN_USER_IDS contains duplicate Discord user ID "${id}".`);
    seen.add(id);
  }
  return [...seen];
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
module.exports.parseDisabledPlugins = parseDisabledPlugins;
module.exports.parseDiscordUserIds = parseDiscordUserIds;
