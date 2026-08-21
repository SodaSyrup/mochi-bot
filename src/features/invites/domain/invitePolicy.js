const { AttributionType } = require('./attribution');

const DEFAULT_FAKE_THRESHOLD_DAYS = 7;

/**
 * Centralized invite policy. Live guildMemberAdd handling, member
 * reconciliation and the simulator all call these same rules so bot-member
 * handling and fake classification never diverge between paths.
 *
 * @param {{ now?: () => number }} options - injectable clock for deterministic tests.
 */
function createInvitePolicy({ now = () => Date.now() } = {}) {
  return {
    /** Bot accounts are never tracked as invite members. */
    shouldTrackMember(member) {
      return Boolean(member && !member.bot);
    },

    /**
     * Account age classification. Uses ?? so a legitimate threshold of 0 is
     * honored instead of being replaced by the default.
     */
    isSuspiciousAccount({ accountCreatedAt, joinedAt, fakeThresholdDays }) {
      const thresholdDays = fakeThresholdDays ?? DEFAULT_FAKE_THRESHOLD_DAYS;
      const joinTime = joinedAt ? new Date(joinedAt).getTime() : now();
      const createdTime = accountCreatedAt ? new Date(accountCreatedAt).getTime() : joinTime;
      const ageMs = joinTime - createdTime;
      return ageMs < thresholdDays * 24 * 60 * 60 * 1000;
    },

    /**
     * Whether an inviter may earn credit for a join/leave.
     * Self-invites never earn credit.
     */
    canCreditInviter({ attributionType, inviterId, memberId }) {
      return (
        attributionType === AttributionType.INVITE &&
        inviterId != null &&
        inviterId !== memberId
      );
    },
  };
}

module.exports = { createInvitePolicy, DEFAULT_FAKE_THRESHOLD_DAYS };
