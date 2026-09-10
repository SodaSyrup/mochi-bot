const { AttributionType } = require('../domain/attribution');

/** Resolves invite attribution from a previous and current snapshot. */
function resolveAttribution({ previous, current, previousVanityUses, currentVanityUses }) {
  const previousByCode = new Map((previous || []).map((inv) => [inv.code, inv]));

  // Count usage deltas for codes present before; a brand-new code with exactly
  // one use is also a candidate (it must still participate in ambiguity checks).
  const deltas = [];
  for (const inv of current || []) {
    const uses = inv.uses || 0;
    const cached = previousByCode.get(inv.code);
    if (!cached) {
      if (uses > 0) deltas.push({ code: inv.code, delta: uses, invite: inv });
      continue;
    }
    const delta = uses - (cached.uses || 0);
    if (delta > 0) deltas.push({ code: inv.code, delta, invite: inv });
  }

  const hasVanityBaseline = previousVanityUses != null && currentVanityUses != null;
  const vanityDelta = hasVanityBaseline ? currentVanityUses - previousVanityUses : 0;
  const vanityChanged = vanityDelta > 0;

  const positiveCandidates = deltas.filter((d) => d.delta > 0);

  // Vanity only when it increased by exactly one AND no normal invite competes.
  if (vanityDelta === 1 && positiveCandidates.length === 0) {
    return { type: AttributionType.VANITY, inviterId: null, inviteCode: null };
  }
  if (vanityChanged) {
    // Vanity moved by >1, or moved alongside a normal invite candidate.
    return { type: AttributionType.UNKNOWN, inviterId: null, inviteCode: null };
  }

  // Exactly one invite gained exactly one use and vanity did not move.
  if (positiveCandidates.length === 1 && positiveCandidates[0].delta === 1) {
    const candidate = positiveCandidates[0];
    if (candidate.invite.inviterId) {
      return {
        type: AttributionType.INVITE,
        inviterId: candidate.invite.inviterId,
        inviteCode: candidate.code,
      };
    }
    // An invite with no recorded inviter cannot be credited.
    return { type: AttributionType.UNKNOWN, inviterId: null, inviteCode: null };
  }

  // Multiple invites increased, one invite increased by >1, or any
  // vanity/normal overlap that is not a clean single-vanity increment.
  return { type: AttributionType.UNKNOWN, inviterId: null, inviteCode: null };
}

module.exports = { resolveAttribution };
