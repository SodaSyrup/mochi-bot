const { TestSuite, assert } = require('./helpers/harness');
const { createTestDb, createRepos } = require('./helpers/db');
const { AttributionType } = require('../src/features/invites/domain/attribution');
const { ProjectionRebuildError } = require('../src/features/invites/infrastructure/projectionRebuilder');

const INVITE = (id, code = 'c') => ({ type: AttributionType.INVITE, inviterId: id, inviteCode: code });

async function runProjectionRebuildTests() {
  const suite = new TestSuite('Projection Rebuild');

  suite.test('rebuild restores corrupted inviter + daily projections', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);

    invites.trackJoin({ guildId: 'g', userId: 'm1', attribution: INVITE('inv'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });
    invites.trackJoin({ guildId: 'g', userId: 'm2', attribution: INVITE('inv'), isFake: true, joinedAt: '2026-01-02T10:00:00Z' });
    invites.trackJoin({ guildId: 'g', userId: 'm3', attribution: INVITE('inv'), isFake: false, joinedAt: '2026-01-03T10:00:00Z' });
    invites.trackLeave({ guildId: 'g', userId: 'm1', leftAt: '2026-01-04T10:00:00Z' });
    invites.addBonus({ guildId: 'g', userId: 'inv', amount: 4, reason: 'manual' });
    invites.addBonus({ guildId: 'g', userId: 'inv', amount: -1, reason: 'correction' });

    const expected = invites.getInviter('g', 'inv');
    assert.strictEqual(expected.regular, 3);
    assert.strictEqual(expected.fake, 1);
    assert.strictEqual(expected.leaves, 1);
    assert.strictEqual(expected.bonus, 3); // 4 + (-1)
    assert.strictEqual(expected.total, 3 + 3 - 1 - 1);

    const expectedDaily = JSON.stringify(invites.getDailyStats('g', 10));

    // Corrupt the aggregates.
    db.prepare('UPDATE inviters SET regular = 999, fake = 999, leaves = 999, bonus = 999 WHERE guild_id=?').run('g');
    db.prepare('UPDATE daily_invite_stats SET joins = 999, leaves = 999, fakes = 999 WHERE guild_id=?').run('g');

    const result = invites.rebuildGuildProjections('g');
    assert.strictEqual(result.inviters, 1);

    assert.deepStrictEqual(invites.getInviter('g', 'inv'), expected);
    assert.strictEqual(JSON.stringify(invites.getDailyStats('g', 10)), expectedDaily);
  });

  suite.test('rebuild reconstructs bonus purely from adjustments', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.addBonus({ guildId: 'g', userId: 'u', amount: 5, reason: 'a' });
    invites.addBonus({ guildId: 'g', userId: 'u', amount: 2, reason: 'b' });
    invites.addBonus({ guildId: 'g', userId: 'u', amount: -3, reason: 'c' });

    assert.strictEqual(invites.getInviter('g', 'u').bonus, 4);

    db.prepare('UPDATE inviters SET bonus = 777 WHERE guild_id=? AND user_id=?').run('g', 'u');
    invites.rebuildGuildProjections('g');
    assert.strictEqual(invites.getInviter('g', 'u').bonus, 4);
  });

  suite.test('rebuild drops inviter rows with no remaining events', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv') });
    invites.trackLeave({ guildId: 'g', userId: 'm' });
    assert.strictEqual(invites.getInvitersCount('g'), 1);

    db.prepare('DELETE FROM invite_events WHERE guild_id=?').run('g');
    invites.rebuildGuildProjections('g');
    assert.strictEqual(invites.getInvitersCount('g'), 0);
  });

  // ----------------------------------------------- invite_members projection

  suite.test('rebuild restores a corrupted invite_members row for an active member', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm1', attribution: INVITE('inv1', 'codeA'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });

    // Manually corrupt the projection.
    db.prepare(`
      UPDATE invite_members SET inviter_id='WRONG', membership_cycle=99, is_left=1, joined_at='1990-01-01T00:00:00Z', attribution_type='VANITY'
      WHERE guild_id='g' AND user_id='m1'
    `).run();

    invites.rebuildGuildProjections('g');
    const member = invites.getCurrentMember('g', 'm1');
    assert.strictEqual(member.inviter_id, 'inv1');
    assert.strictEqual(member.invite_code, 'codeA');
    assert.strictEqual(member.membership_cycle, 1);
    assert.strictEqual(member.is_left, 0);
    assert.strictEqual(member.left_at, null);
    assert.strictEqual(member.joined_at, '2026-01-01T10:00:00Z');
    assert.strictEqual(member.attribution_type, AttributionType.INVITE);
  });

  suite.test('rebuild reconstructs a left member with left_at', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm1', attribution: INVITE('inv1'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });
    invites.trackLeave({ guildId: 'g', userId: 'm1', leftAt: '2026-01-05T10:00:00Z' });

    invites.rebuildGuildProjections('g');
    const member = invites.getCurrentMember('g', 'm1');
    assert.strictEqual(member.is_left, 1);
    assert.strictEqual(member.membership_cycle, 1);
    assert.strictEqual(member.left_at, '2026-01-05T10:00:00Z');
    assert.strictEqual(member.joined_at, '2026-01-01T10:00:00Z');
  });

  suite.test('rejoin rebuild uses the latest membership cycle', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('alice', 'a'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });
    invites.trackLeave({ guildId: 'g', userId: 'm', leftAt: '2026-01-02T10:00:00Z' });
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('bob', 'b'), isFake: false, joinedAt: '2026-01-03T10:00:00Z' });

    invites.rebuildGuildProjections('g');
    const member = invites.getCurrentMember('g', 'm');
    assert.strictEqual(member.membership_cycle, 2);
    assert.strictEqual(member.is_left, 0);
    assert.strictEqual(member.inviter_id, 'bob');
    assert.strictEqual(member.invite_code, 'b');
    assert.strictEqual(member.joined_at, '2026-01-03T10:00:00Z');
    assert.strictEqual(member.left_at, null);

    // Historical cycle 1 remains preserved in the ledger.
    const events = db.prepare(`
      SELECT event_type, membership_cycle, inviter_id FROM invite_events
      WHERE guild_id='g' AND user_id='m' ORDER BY membership_cycle, event_type
    `).all();
    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].inviter_id, 'alice');
  });

  suite.test('changed inviter across cycles: latest JOIN attribution wins', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('alice', 'a'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });
    invites.trackLeave({ guildId: 'g', userId: 'm', leftAt: '2026-01-02T10:00:00Z' });
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('bob', 'b'), isFake: false, joinedAt: '2026-01-03T10:00:00Z' });

    invites.rebuildGuildProjections('g');
    const member = invites.getCurrentMember('g', 'm');
    assert.strictEqual(member.inviter_id, 'bob');
    assert.strictEqual(member.membership_cycle, 2);
    assert.strictEqual(member.is_left, 0);

    // Historical cycle 1 must remain in invite_events.
    const cycle1 = db.prepare(`
      SELECT inviter_id FROM invite_events
      WHERE guild_id='g' AND user_id='m' AND membership_cycle=1 AND event_type='JOIN'
    `).get();
    assert.strictEqual(cycle1.inviter_id, 'alice');
  });

  suite.test('rebuild preserves fake attribution and a re-left rejoin cycle', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv1'), isFake: true, joinedAt: '2026-01-01T10:00:00Z' });
    invites.trackLeave({ guildId: 'g', userId: 'm', leftAt: '2026-01-02T10:00:00Z' });
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv2'), isFake: false, joinedAt: '2026-01-03T10:00:00Z' });
    invites.trackLeave({ guildId: 'g', userId: 'm', leftAt: '2026-01-04T10:00:00Z' });

    invites.rebuildGuildProjections('g');
    const member = invites.getCurrentMember('g', 'm');
    assert.strictEqual(member.membership_cycle, 2);
    assert.strictEqual(member.is_left, 1);
    assert.strictEqual(member.joined_at, '2026-01-03T10:00:00Z');
    assert.strictEqual(member.left_at, '2026-01-04T10:00:00Z');
    assert.strictEqual(member.inviter_id, 'inv2');
  });

  suite.test('vanity and unknown members rebuild with no inviter credit and null inviter_id', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'mv', attribution: { type: AttributionType.VANITY, inviterId: null, inviteCode: null }, isFake: false, joinedAt: '2026-01-01T10:00:00Z' });
    invites.trackJoin({ guildId: 'g', userId: 'mu', attribution: { type: AttributionType.UNKNOWN, inviterId: null, inviteCode: null }, isFake: false, joinedAt: '2026-01-02T10:00:00Z' });

    invites.rebuildGuildProjections('g');
    const vanity = invites.getCurrentMember('g', 'mv');
    assert.strictEqual(vanity.attribution_type, AttributionType.VANITY);
    assert.strictEqual(vanity.inviter_id, null);
    const unknown = invites.getCurrentMember('g', 'mu');
    assert.strictEqual(unknown.attribution_type, AttributionType.UNKNOWN);
    assert.strictEqual(unknown.inviter_id, null);
    assert.strictEqual(invites.getInvitersCount('g'), 0);
  });

  suite.test('rebuilding one guild does not touch another guild', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    // Guild A member with corruption.
    invites.trackJoin({ guildId: 'guildA', userId: 'm', attribution: INVITE('invA'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });
    db.prepare("UPDATE invite_members SET inviter_id='BAD' WHERE guild_id='guildA' AND user_id='m'").run();
    // Guild B member (normal, untouched by A's rebuild).
    invites.trackJoin({ guildId: 'guildB', userId: 'x', attribution: INVITE('invB'), isFake: false, joinedAt: '2026-01-02T10:00:00Z' });
    invites.trackLeave({ guildId: 'guildB', userId: 'x', leftAt: '2026-01-03T10:00:00Z' });

    invites.rebuildGuildProjections('guildA');

    const a = invites.getCurrentMember('guildA', 'm');
    assert.strictEqual(a.inviter_id, 'invA');
    const b = invites.getCurrentMember('guildB', 'x');
    assert.strictEqual(b.inviter_id, 'invB');
    assert.strictEqual(b.is_left, 1);
    assert.strictEqual(invites.getInviter('guildB', 'invB').leaves, 1);
  });

  suite.test('rebuild is atomic: a malformed ledger rolls back every projection write', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });

    // Corrupt: introduce a LEAVE without a JOIN in a new cycle.
    db.prepare(`
      INSERT INTO invite_events (guild_id, user_id, membership_cycle, event_type, attribution_type, inviter_id, invite_code, is_fake, occurred_at)
      VALUES ('g', 'm', 2, 'LEAVE', 'INVITE', 'inv', 'c', 0, '2026-01-02T10:00:00Z')
    `).run();

    assert.throws(() => invites.rebuildGuildProjections('g'), (err) => err instanceof ProjectionRebuildError);

    // Nothing partial: inviter counters are unchanged and intact.
    const inv = invites.getInviter('g', 'inv');
    assert.strictEqual(inv.regular, 1);
    assert.strictEqual(inv.leaves, 0);
    // The member projection was NOT replaced (rollback restored prior rows).
    const member = invites.getCurrentMember('g', 'm');
    assert.strictEqual(member.inviter_id, 'inv');
  });

  suite.test('rebuild rejects a non-contiguous cycle sequence', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });
    invites.trackLeave({ guildId: 'g', userId: 'm', leftAt: '2026-01-02T10:00:00Z' });
    // Simulate a corrupted ledger: cycle 3 JOIN but no cycle 2.
    db.prepare(`
      INSERT INTO invite_events (guild_id, user_id, membership_cycle, event_type, attribution_type, inviter_id, invite_code, is_fake, occurred_at)
      VALUES ('g', 'm', 3, 'JOIN', 'INVITE', 'inv', 'c', 0, '2026-01-03T10:00:00Z')
    `).run();

    assert.throws(() => invites.rebuildGuildProjections('g'), (err) => err instanceof ProjectionRebuildError);
  });

  suite.test('rebuild rejects a LEAVE timestamp before its JOIN', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv'), isFake: false, joinedAt: '2026-01-05T10:00:00Z' });
    // Corrupted: leave before the join.
    db.prepare(`
      INSERT INTO invite_events (guild_id, user_id, membership_cycle, event_type, attribution_type, inviter_id, invite_code, is_fake, occurred_at)
      VALUES ('g', 'm', 1, 'LEAVE', 'INVITE', 'inv', 'c', 0, '2026-01-01T10:00:00Z')
    `).run();

    assert.throws(() => invites.rebuildGuildProjections('g'), (err) => err instanceof ProjectionRebuildError);
  });

  suite.test('regression: total formula survives full rebuild including members', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    for (let i = 0; i < 9; i++) {
      invites.trackJoin({ guildId: 'g', userId: `m${i}`, attribution: INVITE('inv'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });
    }
    invites.trackJoin({ guildId: 'g', userId: 'mf', attribution: INVITE('inv'), isFake: true, joinedAt: '2026-01-02T10:00:00Z' });
    invites.trackLeave({ guildId: 'g', userId: 'm0', leftAt: '2026-01-03T10:00:00Z' });
    invites.trackLeave({ guildId: 'g', userId: 'm1', leftAt: '2026-01-03T10:00:00Z' });
    invites.addBonus({ guildId: 'g', userId: 'inv', amount: 3, reason: 'bonus' });

    const before = invites.getInviter('g', 'inv');
    assert.strictEqual(before.total, 10);

    invites.rebuildGuildProjections('g');
    const after = invites.getInviter('g', 'inv');
    assert.deepStrictEqual(after, before);
    assert.strictEqual(after.total, 10); // regular 10 + bonus 3 - leaves 2 - fake 1

    // Fake leaves still not double-penalized after rebuild.
    const fake = invites.getCurrentMember('g', 'mf');
    assert.strictEqual(fake.is_left, 0);
    assert.strictEqual(fake.is_fake, 1);
  });

  suite.test('dry-run reports differences without writing anything', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });
    db.prepare("UPDATE invite_members SET inviter_id='WRONG' WHERE guild_id='g' AND user_id='m'").run();

    const result = invites.rebuildGuildProjections('g', { dryRun: true });
    assert.strictEqual(result.dryRun, true);
    assert.ok(result.differences.some((d) => d.table === 'invite_members' && d.reason === 'MEMBER CHANGED'));
    // No writes performed.
    const member = invites.getCurrentMember('g', 'm');
    assert.strictEqual(member.inviter_id, 'WRONG', 'dry-run must not modify rows');
  });

  suite.test('dry-run on a fully consistent guild reports no differences', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });
    invites.trackLeave({ guildId: 'g', userId: 'm', leftAt: '2026-01-02T10:00:00Z' });

    const result = invites.rebuildGuildProjections('g', { dryRun: true });
    assert.deepStrictEqual(result.differences, []);
  });

  return suite.run();
}

module.exports = { runProjectionRebuildTests };

if (require.main === module) {
  runProjectionRebuildTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
