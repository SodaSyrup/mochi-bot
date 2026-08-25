const OUTCOMES = Object.freeze({
  BANNED: 'banned',
  ALREADY_BANNED: 'already_banned',
  EXEMPT: 'exempt',
  DISABLED: 'disabled',
  ALERTED: 'alerted',
  STALE: 'cache_stale',
  MISSING_PERMISSION: 'missing_permission',
  GUILD_UNAVAILABLE: 'guild_unavailable',
  TRANSIENT_ERROR: 'transient_error',
  PERMANENT_ERROR: 'permanent_error',
});

module.exports = { OUTCOMES };
