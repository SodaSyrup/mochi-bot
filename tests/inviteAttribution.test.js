const { TestSuite, assert } = require('./helpers/harness');
const { resolveAttribution } = require('../src/features/invites/application/inviteAttributionService');
const { AttributionType } = require('../src/features/invites/domain/attribution');

async function runAttributionTests() {
  const suite = new TestSuite('Conservative Attribution');

  const inv = (code, uses, inviterId = 'u1') => ({ code, uses, inviterId });

  suite.test('single +1 delta -> INVITE', () => {
    const r = resolveAttribution({
      previous: [inv('a', 5)],
      current: [inv('a', 6)],
      previousVanityUses: 0,
      currentVanityUses: 0,
    });
    assert.deepStrictEqual(r, { type: AttributionType.INVITE, inviterId: 'u1', inviteCode: 'a' });
  });

  suite.test('new invite with exactly one use -> INVITE', () => {
    const r = resolveAttribution({
      previous: [],
      current: [inv('new', 1)],
      previousVanityUses: 0,
      currentVanityUses: 0,
    });
    assert.strictEqual(r.type, AttributionType.INVITE);
    assert.strictEqual(r.inviteCode, 'new');
  });

  suite.test('multiple invites increased -> UNKNOWN', () => {
    const r = resolveAttribution({
      previous: [inv('a', 5), inv('b', 3)],
      current: [inv('a', 6), inv('b', 4)],
      previousVanityUses: 0,
      currentVanityUses: 0,
    });
    assert.strictEqual(r.type, AttributionType.UNKNOWN);
  });

  suite.test('invite increased by >1 -> UNKNOWN', () => {
    const r = resolveAttribution({
      previous: [inv('a', 5)],
      current: [inv('a', 8)],
      previousVanityUses: 0,
      currentVanityUses: 0,
    });
    assert.strictEqual(r.type, AttributionType.UNKNOWN);
  });

  suite.test('vanity +1 with no normal candidate -> VANITY', () => {
    const r = resolveAttribution({
      previous: [],
      current: [],
      previousVanityUses: 3,
      currentVanityUses: 4,
    });
    assert.deepStrictEqual(r, { type: AttributionType.VANITY, inviterId: null, inviteCode: null });
  });

  suite.test('vanity + normal both changed -> UNKNOWN', () => {
    const r = resolveAttribution({
      previous: [inv('a', 5)],
      current: [inv('a', 6)],
      previousVanityUses: 3,
      currentVanityUses: 4,
    });
    assert.strictEqual(r.type, AttributionType.UNKNOWN);
  });

  suite.test('vanity increased by >1 -> UNKNOWN', () => {
    const r = resolveAttribution({
      previous: [],
      current: [],
      previousVanityUses: 3,
      currentVanityUses: 6,
    });
    assert.strictEqual(r.type, AttributionType.UNKNOWN);
  });

  suite.test('invite with no inviter id -> UNKNOWN (no credit guess)', () => {
    const r = resolveAttribution({
      previous: [inv('a', 5, null)],
      current: [inv('a', 6, null)],
      previousVanityUses: 0,
      currentVanityUses: 0,
    });
    assert.strictEqual(r.type, AttributionType.UNKNOWN);
  });

  suite.test('no baseline vanity -> cannot attribute vanity', () => {
    const r = resolveAttribution({
      previous: [],
      current: [],
      previousVanityUses: null,
      currentVanityUses: 4,
    });
    assert.strictEqual(r.type, AttributionType.UNKNOWN);
  });

  return suite.run();
}

module.exports = { runAttributionTests };

if (require.main === module) {
  runAttributionTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
