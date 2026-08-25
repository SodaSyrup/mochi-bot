const MODES = Object.freeze(['disabled', 'alert', 'enforce']);

function isValidMode(mode) {
  return MODES.includes(mode);
}

function normalizeUserId(value) {
  const id = String(value || '').trim();
  return /^\d{5,25}$/.test(id) ? id : null;
}

function isActiveRecord(record, now = Date.now()) {
  if (!record || record.state !== 'active') return false;
  if (!record.expires_at) return true;
  const expires = Date.parse(record.expires_at);
  return !Number.isFinite(expires) || expires > now;
}

module.exports = { MODES, isValidMode, normalizeUserId, isActiveRecord };
