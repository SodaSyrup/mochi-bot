/**
 * Runtime policy defaults. Values that affect deployment can be overridden by
 * environment variables in config.js; application policy stays named and
 * discoverable here instead of being repeated throughout the codebase.
 */
const DEFAULTS = Object.freeze({
  app: Object.freeze({ mode: 'development' }),
  dashboard: Object.freeze({
    port: 3000,
    url: 'http://localhost:3000',
    sessionCookieName: 'mochi.sid',
    sessionTtlSeconds: 7 * 24 * 60 * 60,
  }),
  bot: Object.freeze({ embedColor: '#7c3aed' }),
  auth: Object.freeze({ permissionTtlSeconds: 10 * 60 }),
  inviteTracker: Object.freeze({ fakeAccountThresholdDays: 7, maxFakeAccountThresholdDays: 365 }),
  limits: Object.freeze({
    maxInviteLabelLength: 60,
    maxInviteAgeSeconds: 7 * 24 * 60 * 60,
    maxInviteUses: 100,
    pagination: Object.freeze({
      leaderboardDefault: 10,
      botInviteCodesDefault: 15,
      historyDefault: 15,
      activityDefault: 20,
      recentHoneypotKicks: 10,
      max: 100,
      maxPage: 1000000,
      maxOffset: 1000000,
      analyticsDefaultDays: 7,
      analyticsMaxDays: 90,
    }),
  }),
  operations: Object.freeze({
    eventBusMaxListeners: 50,
    presenceIntervalMs: 60 * 1000,
    guildInviteInitConcurrency: 4,
    guildMemberReconcileConcurrency: 2,
    userResolveConcurrency: 6,
    botAddFreshnessMs: 30 * 1000,
    auditAttempts: 3,
    auditRetryDelayMs: 500,
    auditBatchLimit: 10,
  }),
  honeypot: Object.freeze({ softBanDeleteMessageSeconds: 24 * 60 * 60 }),
});

const DEFAULT_SECRET = 'mochi_default_secret_please_change_in_production';
const LEGACY_ENV_KEYS = Object.freeze(['DEMO_MODE', 'DEMO_DATABASE_PATH', 'DEFAULT_PREFIX']);

module.exports = { DEFAULTS, DEFAULT_SECRET, LEGACY_ENV_KEYS };
