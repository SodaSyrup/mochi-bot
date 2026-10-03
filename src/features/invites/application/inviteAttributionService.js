const { AttributionType } = require('../domain/attribution');

/** Explains attribution from snapshots and checked single-use candidates. */
function analyzeAttribution({ previous, current, previousVanityUses, currentVanityUses, singleUseCandidates = [], verifiedSingleUseCodes = [] }) {
  const unknown = (reason, retryable = false) => ({
    attribution: { type: AttributionType.UNKNOWN, inviterId: null, inviteCode: null },
    reason,
    retryable,
  });
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
  // Disappeared single-use links compete with normal and vanity changes.
  // Only the service can verify that a link was not manually revoked.
  const candidateCount = positiveCandidates.length + singleUseCandidates.length;

  // Vanity only when it increased by exactly one AND no normal invite competes.
  if (vanityDelta === 1 && candidateCount === 0) {
    return { attribution: { type: AttributionType.VANITY, inviterId: null, inviteCode: null }, reason: 'VANITY_INCREMENT', retryable: false };
  }
  if (vanityChanged) {
    // Vanity moved by >1, or moved alongside a normal invite candidate.
    return unknown('VANITY_CONFLICT');
  }

  if (candidateCount > 1) return unknown('MULTIPLE_CANDIDATES');

  if (singleUseCandidates.length === 1) {
    const candidate = singleUseCandidates[0];
    if (!candidate.inviterId) return unknown('MISSING_INVITER');
    if (!verifiedSingleUseCodes.includes(candidate.code)) return unknown('SINGLE_USE_PENDING', true);
    return {
      attribution: { type: AttributionType.INVITE, inviterId: candidate.inviterId, inviteCode: candidate.code },
      reason: 'SINGLE_USE_DISAPPEARED',
      retryable: false,
    };
  }

  // Exactly one invite gained exactly one use and vanity did not move.
  if (positiveCandidates.length === 1 && positiveCandidates[0].delta === 1) {
    const candidate = positiveCandidates[0];
    if (candidate.invite.inviterId) {
      return {
        attribution: {
          type: AttributionType.INVITE,
          inviterId: candidate.invite.inviterId,
          inviteCode: candidate.code,
        },
        reason: 'INVITE_INCREMENT',
        retryable: false,
      };
    }
    // An invite with no recorded inviter cannot be credited.
    return unknown('MISSING_INVITER');
  }

  // Multiple invites increased, one invite increased by >1, or any
  // vanity/normal overlap that is not a clean single-vanity increment.
  return unknown(positiveCandidates.length ? 'MULTIPLE_USES' : 'NO_USAGE_CHANGE', positiveCandidates.length === 0);
}

function resolveAttribution(input) {
  return analyzeAttribution(input).attribution;
}

module.exports = { resolveAttribution, analyzeAttribution };
