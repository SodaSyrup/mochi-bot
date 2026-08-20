// Invite attribution types. These are stored in `attribution_type` and used to
// describe HOW a membership was attributed. They are NOT Discord user IDs and
// must never be written into `inviter_id`. `inviter_id` means exactly one
// thing: a Discord user ID or null.
const AttributionType = Object.freeze({
  INVITE: 'INVITE',
  VANITY: 'VANITY',
  UNKNOWN: 'UNKNOWN',
  PRE_EXISTING: 'PRE_EXISTING',
  OAUTH: 'OAUTH',
});

const ATTRIBUTION_TYPES = Object.freeze(Object.values(AttributionType));

function isAttributionType(value) {
  return ATTRIBUTION_TYPES.includes(value);
}

/**
 * Normalize a stored inviter value into a valid attribution.
 * Legacy databases stored magic strings in inviter_id; this is the only place
 * those legacy strings may be translated.
 */
function attributionFromLegacyInviter(inviterId) {
  if (inviterId === AttributionType.VANITY) {
    return { type: AttributionType.VANITY, inviterId: null, inviteCode: null };
  }
  if (inviterId === AttributionType.UNKNOWN || inviterId == null || inviterId === '') {
    return { type: AttributionType.UNKNOWN, inviterId: null, inviteCode: null };
  }
  if (inviterId === AttributionType.PRE_EXISTING) {
    return { type: AttributionType.PRE_EXISTING, inviterId: null, inviteCode: null };
  }
  return { type: AttributionType.INVITE, inviterId, inviteCode: null };
}

module.exports = { AttributionType, ATTRIBUTION_TYPES, isAttributionType, attributionFromLegacyInviter };
