const { TestSuite, assert } = require('./helpers/harness');
const { createInvitePolicy, DEFAULT_FAKE_THRESHOLD_DAYS } = require('../src/features/invites/domain/invitePolicy');
const { AttributionType } = require('../src/features/invites/domain/attribution');

async function runInvitePolicyTests() {
  const suite = new TestSuite('Invite Policy');

  suite.test('bot accounts are never tracked', () => {
    const policy = createInvitePolicy();
    assert.strictEqual(policy.shouldTrackMember({ id: '1', bot: true }), false);
    assert.strictEqual(policy.shouldTrackMember({ id: '1', bot: false }), true);
    assert.strictEqual(policy.shouldTrackMember({ id: '1' }), true);
  });

  suite.test('fake threshold 0 is honored (?? semantics)', () => {
    const policy = createInvitePolicy({ now: () => new Date('2026-01-10T00:00:00Z').getTime() });
    const fresh = {
      accountCreatedAt: '2026-01-09T00:00:00Z', // 1 day old
      joinedAt: '2026-01-10T00:00:00Z',
      fakeThresholdDays: 0, // 0 must NOT be replaced by the default
    };
    // threshold 0 means "no minimum age" -> not suspicious
    assert.strictEqual(policy.isSuspiciousAccount(fresh), false);

    // Without a configured value, the default applies (1 day < 7 days -> fake).
    assert.strictEqual(
      policy.isSuspiciousAccount({ ...fresh, fakeThresholdDays: undefined }),
      true
    );
  });

  suite.test('isSuspiciousAccount uses injected clock deterministically', () => {
    const policy = createInvitePolicy({ now: () => new Date('2026-01-10T00:00:00Z').getTime() });
    assert.strictEqual(
      policy.isSuspiciousAccount({ accountCreatedAt: '2026-01-09T00:00:00Z', joinedAt: '2026-01-10T00:00:00Z', fakeThresholdDays: 7 }),
      true
    );
    assert.strictEqual(
      policy.isSuspiciousAccount({ accountCreatedAt: '2025-06-01T00:00:00Z', joinedAt: '2026-01-10T00:00:00Z', fakeThresholdDays: 7 }),
      false
    );
  });

  suite.test('canCreditInviter rules', () => {
    const policy = createInvitePolicy();
    assert.strictEqual(policy.canCreditInviter({ attributionType: AttributionType.INVITE, inviterId: 'inv', memberId: 'm' }), true);
    assert.strictEqual(policy.canCreditInviter({ attributionType: AttributionType.INVITE, inviterId: 'm', memberId: 'm' }), false); // self
    assert.strictEqual(policy.canCreditInviter({ attributionType: AttributionType.VANITY, inviterId: null, memberId: 'm' }), false);
    assert.strictEqual(policy.canCreditInviter({ attributionType: AttributionType.UNKNOWN, inviterId: null, memberId: 'm' }), false);
    assert.strictEqual(policy.canCreditInviter({ attributionType: AttributionType.INVITE, inviterId: null, memberId: 'm' }), false);
  });

  return suite.run();
}

module.exports = { runInvitePolicyTests, DEFAULT_FAKE_THRESHOLD_DAYS };

if (require.main === module) {
  runInvitePolicyTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
