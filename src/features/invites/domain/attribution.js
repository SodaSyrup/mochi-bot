// Invite attribution types. These are stored in `attribution_type` and used to
// describe HOW a membership was attributed. They are NOT Discord user IDs and
// must never be written into `inviter_id`. `inviter_id` means exactly one
// thing: a Discord user ID or null.
const AttributionType = Object.freeze({
  INVITE: 'INVITE',
  VANITY: 'VANITY',
  UNKNOWN: 'UNKNOWN',
  RECONCILED: 'RECONCILED',
});

const ATTRIBUTION_TYPES = Object.freeze(Object.values(AttributionType));

function isAttributionType(value) {
  return ATTRIBUTION_TYPES.includes(value);
}

module.exports = { AttributionType, ATTRIBUTION_TYPES, isAttributionType };
