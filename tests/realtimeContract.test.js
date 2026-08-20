const { TestSuite, assert } = require('./helpers/harness');
const { InviteEvents, SafetyEvents } = require('../src/app/eventBus');
const {
  mapMemberEvent,
  mapInviteCreatedEvent,
  mapInviteDeletedEvent,
  mapLabelUpdatedEvent,
  mapAutoModExecutionEvent,
  mapRuleUpdatedEvent,
  mapApplicationEvent,
} = require('../src/dashboard/realtime/eventMappers');

/**
 * Unit coverage for the documented realtime transport DTO contract. End-to-end
 * socket delivery of these shapes is covered in socket.test.js.
 */
async function runRealtimeContractTests() {
  const suite = new TestSuite('Realtime Contract (DTO Mappers)');

  suite.test('memberJoin maps to the documented member contract', () => {
    const out = mapMemberEvent({
      guildId: 'g',
      member: { id: 'member-1', username: 'Alice', avatar: 'avatar-url' },
      attribution: { type: 'INVITE', inviterId: 'inviter-1', inviteCode: 'abc' },
      inviter: { id: 'inviter-1', username: 'Inviter', avatar: null },
      isFake: false,
      inviterStats: { regular: 4, bonus: 1, leaves: 1, fake: 0, total: 4 },
      occurredAt: '2026-01-01T00:00:00.000Z',
    });

    assert.ok(!('user' in out), 'no data.user compatibility alias');
    assert.strictEqual(out.member.username, 'Alice');
    assert.strictEqual(out.member.id, 'member-1');
    assert.strictEqual(out.attribution.inviteCode, 'abc');
    assert.strictEqual(out.inviter.username, 'Inviter');
    assert.strictEqual(out.inviterStats.total, 4);
    assert.strictEqual(out.guildId, 'g');
  });

  suite.test('memberLeave uses the identical member naming convention', () => {
    const out = mapMemberEvent({
      guildId: 'g',
      member: { id: 'member-2', username: 'Bob', avatar: null },
      attribution: { type: 'INVITE', inviterId: 'inviter-1', inviteCode: 'abc' },
      inviter: null,
      inviterStats: null,
      isFake: false,
      occurredAt: '2026-01-02T00:00:00.000Z',
    });
    assert.strictEqual(out.member.username, 'Bob');
    assert.strictEqual(out.attribution.inviteCode, 'abc');
  });

  suite.test('inviteCreated exposes the invite code inside the invite object', () => {
    const out = mapInviteCreatedEvent({
      guildId: 'g',
      invite: { code: 'x9', url: 'https://discord.gg/x9', uses: 3, maxUses: 10, maxAge: 0, temporary: false, inviter: { id: 'u', username: 'U' }, createdAt: '2026-01-01T00:00:00.000Z', label: 'Promo' },
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
    assert.strictEqual(out.invite.code, 'x9');
    assert.strictEqual(out.invite.label, 'Promo');
    assert.strictEqual(out.invite.inviter.username, 'U');
  });

  suite.test('inviteDeleted / labelUpdated / ruleUpdated carry only safe fields', () => {
    const deleted = mapInviteDeletedEvent({ guildId: 'g', code: 'abc', occurredAt: '2026-01-01T00:00:00.000Z' });
    assert.deepStrictEqual(deleted, { guildId: 'g', code: 'abc', occurredAt: '2026-01-01T00:00:00.000Z' });

    const label = mapLabelUpdatedEvent({ guildId: 'g', code: 'abc', label: 'New', channelId: 'c1', channelName: 'general', occurredAt: '2026-01-01T00:00:00.000Z' });
    assert.strictEqual(label.label, 'New');
    assert.strictEqual(label.code, 'abc');

    const rule = mapRuleUpdatedEvent({ guildId: 'g', action: 'update', ruleId: 'r1', name: 'Filter', enabled: true });
    assert.deepStrictEqual(rule, { guildId: 'g', action: 'update', ruleId: 'r1', name: 'Filter', enabled: true });
  });

  suite.test('autoModExecution maps to a flat JSON-safe payload', () => {
    const out = mapAutoModExecutionEvent({
      guildId: 'g',
      guildName: 'G',
      ruleId: 'r1',
      ruleName: 'Scam Filter',
      ruleTriggerType: 1,
      action: { type: 1, metadata: { customMessage: 'blocked' } },
      userId: 'u9',
      user: { id: 'u9', username: 'Spammer', avatar: null },
      channelId: 'c1',
      channelName: 'general',
      content: 'bad',
      matchedKeyword: 'x',
      matchedContent: 'x',
      executedAt: '2026-01-01T00:00:00.000Z',
    });
    assert.strictEqual(out.ruleName, 'Scam Filter');
    assert.strictEqual(out.action.type, 1);
    assert.strictEqual(out.user.username, 'Spammer');
    assert.ok(!('stack' in out) && !('session' in out), 'no internal material leaks');
  });

  suite.test('mapApplicationEvent dispatches canonical events to their mapper', () => {
    const joined = mapApplicationEvent(InviteEvents.MemberJoined, { guildId: 'g', member: { id: 'm', username: 'Alice', avatar: null }, attribution: { type: 'INVITE', inviterId: 'u', inviteCode: 'c' }, isFake: false, inviterStats: null, occurredAt: 'x' });
    assert.strictEqual(joined.member.username, 'Alice');

    const created = mapApplicationEvent(InviteEvents.InviteCreated, { guildId: 'g', invite: { code: 'z' }, occurredAt: 'x' });
    assert.strictEqual(created.invite.code, 'z');

    const exec = mapApplicationEvent(SafetyEvents.AutoModExecution, { guildId: 'g', ruleName: 'R', action: { type: 1 }, executedAt: 'x' });
    assert.strictEqual(exec.ruleName, 'R');

    // Unknown event passes through unchanged (defensive).
    assert.deepStrictEqual(mapApplicationEvent('nope.evt', { a: 1 }), { a: 1 });
  });

  return suite.run();
}

module.exports = { runRealtimeContractTests };

if (require.main === module) {
  runRealtimeContractTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
