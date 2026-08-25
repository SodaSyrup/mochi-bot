const OUTCOMES = Object.freeze({
  BANNED: 'banned',
  ALREADY_BANNED: 'already_banned',
  EXEMPT: 'exempt',
  DISABLED: 'disabled',
  NOT_LISTED: 'not_listed',
  POLICY_CHANGED: 'policy_changed',
  ALERTED: 'alerted',
  STALE: 'cache_stale',
  MISSING_PERMISSION: 'missing_permission',
  GUILD_UNAVAILABLE: 'guild_unavailable',
  TRANSIENT_ERROR: 'transient_error',
  PERMANENT_ERROR: 'permanent_error',
});

module.exports = { OUTCOMES };
