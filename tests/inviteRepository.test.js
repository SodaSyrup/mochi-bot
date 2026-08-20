const { TestSuite, assert } = require('./helpers/harness');
const { createTestDb, createRepos } = require('./helpers/db');
const { AttributionType } = require('../src/features/invites/domain/attribution');

const INVITE = (inviterId, code = 'code1') => ({ type: AttributionType.INVITE, inviterId, inviteCode: code });
const VANITY = { type: AttributionType.VANITY, inviterId: null, inviteCode: null };
const UNKNOWN = { type: AttributionType.UNKNOWN, inviterId: null, inviteCode: null };
const PRE_EXISTING = { type: AttributionType.PRE_EXISTING, inviterId: null, inviteCode: null };

async function runInviteRepositoryTests() {
  const suite = new TestSuite('Invite Repository');

  suite.test('duplicate join is idempotent', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    const r1 = invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv'), isFake: false });
    const r2 = invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv2'), isFake: true });

    assert.strictEqual(r1.applied, true);
    assert.strictEqual(r1.reason, 'CREATED');
    assert.strictEqual(r2.applied, false);
    assert.strictEqual(r2.reason, 'DUPLICATE_JOIN');

    assert.strictEqual(invites.countInviteEvents('g'), 1);
    assert.strictEqual(invites.getCurrentMember('g', 'm').inviter_id, 'inv');
    const inviter = invites.getInviter('g', 'inv');
    assert.strictEqual(inviter.regular, 1);
    assert.strictEqual(inviter.fake, 0);
    const daily = invites.getDailyStats('g', 7);
    assert.strictEqual(daily.reduce((a, d) => a + d.joins, 0), 1);
  });

  suite.test('duplicate leave is idempotent', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv') });
    const l1 = invites.trackLeave({ guildId: 'g', userId: 'm' });
    const l2 = invites.trackLeave({ guildId: 'g', userId: 'm' });

    assert.strictEqual(l1.applied, true);
    assert.strictEqual(l2.applied, false);
    assert.strictEqual(l2.reason, 'DUPLICATE_LEAVE');

    const events = db.prepare('SELECT event_type FROM invite_events WHERE guild_id=? AND user_id=?').all('g', 'm');
    assert.strictEqual(events.filter((e) => e.event_type === 'LEAVE').length, 1);
    assert.strictEqual(invites.getInviter('g', 'inv').leaves, 1);
    const daily = invites.getDailyStats('g', 7);
    assert.strictEqual(daily.reduce((a, d) => a + d.leaves, 0), 1);
  });

  suite.test('unknown leave does not mutate stats', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    const r = invites.trackLeave({ guildId: 'g', userId: 'never_seen' });
    assert.strictEqual(r.applied, false);
    assert.strictEqual(r.reason, 'UNKNOWN_MEMBER');
    assert.strictEqual(invites.countInviteEvents('g'), 0);
    const daily = invites.getDailyStats('g', 7);
    assert.strictEqual(daily.reduce((a, d) => a + d.leaves, 0), 0);
  });

  suite.test('rejoin produces distinct membership cycles', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv') });
    invites.trackLeave({ guildId: 'g', userId: 'm' });
    const r = invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv') });

    assert.strictEqual(r.applied, true);
    assert.strictEqual(r.reason, 'REJOINED');
    assert.strictEqual(r.cycle, 2);

    const rows = db.prepare(`
      SELECT event_type, membership_cycle FROM invite_events
      WHERE guild_id=? AND user_id=? ORDER BY membership_cycle, event_type
    `).all('g', 'm');
    assert.deepStrictEqual(rows, [
      { event_type: 'JOIN', membership_cycle: 1 },
      { event_type: 'LEAVE', membership_cycle: 1 },
      { event_type: 'JOIN', membership_cycle: 2 },
    ]);

    const member = invites.getCurrentMember('g', 'm');
    assert.strictEqual(member.is_left, 0);
    assert.strictEqual(member.membership_cycle, 2);
    assert.strictEqual(invites.getInviter('g', 'inv').regular, 2);
    assert.strictEqual(invites.getInviter('g', 'inv').leaves, 1);
  });

  suite.test('fake join counts regular+1 fake+1 with zero net credit', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv'), isFake: true });
    const inv = invites.getInviter('g', 'inv');
    assert.strictEqual(inv.regular, 1);
    assert.strictEqual(inv.fake, 1);
    assert.strictEqual(inv.total, 0); // 1 + 0 - 0 - 1
  });

  suite.test('fake leave does not double-subtract net credit', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv'), isFake: true });
    invites.trackLeave({ guildId: 'g', userId: 'm' });
    const inv = invites.getInviter('g', 'inv');
    assert.strictEqual(inv.regular, 1);
    assert.strictEqual(inv.fake, 1);
    assert.strictEqual(inv.leaves, 0); // no double penalty
    assert.strictEqual(inv.total, 0);
  });

  suite.test('vanity join creates history but no inviter credit', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: VANITY });
    assert.strictEqual(invites.countInviteEvents('g'), 1);
    assert.strictEqual(invites.getInvitersCount('g'), 0);
  });

  suite.test('unknown attribution creates history but no inviter credit', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: UNKNOWN });
    assert.strictEqual(invites.countInviteEvents('g'), 1);
    assert.strictEqual(invites.getInvitersCount('g'), 0);
  });

  suite.test('pre-existing sync creates history without inviter credit and is idempotent', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    const count1 = invites.syncPreExistingMembers('g', [
      { userId: 'p1', joinedAt: '2026-01-01T00:00:00Z', isFake: false },
      { userId: 'p2', joinedAt: '2026-01-02T00:00:00Z', isFake: true },
    ]);
    assert.strictEqual(count1, 2);
    assert.strictEqual(invites.getInvitersCount('g'), 0);

    const count2 = invites.syncPreExistingMembers('g', [
      { userId: 'p1', joinedAt: '2026-01-01T00:00:00Z', isFake: false },
      { userId: 'p2', joinedAt: '2026-01-02T00:00:00Z', isFake: true },
      { userId: 'p3', joinedAt: '2026-01-03T00:00:00Z', isFake: false },
    ]);
    assert.strictEqual(count2, 1); // only p3 is new
    assert.strictEqual(invites.countInviteEvents('g'), 3);
  });

  suite.test('self-invite does not receive credit', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('m') });
    assert.strictEqual(invites.getInvitersCount('g'), 0);
    invites.trackLeave({ guildId: 'g', userId: 'm' });
    assert.strictEqual(invites.getInvitersCount('g'), 0);
  });

  suite.test('bonus formula: 10 + 3 - 2 - 1 = 10', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    // 9 normal joins + 1 fake join => regular 10, fake 1
    for (let i = 0; i < 9; i++) {
      invites.trackJoin({ guildId: 'g', userId: `m${i}`, attribution: INVITE('inv') });
    }
    invites.trackJoin({ guildId: 'g', userId: 'fake1', attribution: INVITE('inv'), isFake: true });
    invites.trackLeave({ guildId: 'g', userId: 'm0' });
    invites.trackLeave({ guildId: 'g', userId: 'm1' });
    invites.addBonus({ guildId: 'g', userId: 'inv', amount: 3, reason: 'manual' });

    const inv = invites.getInviter('g', 'inv');
    assert.strictEqual(inv.regular, 10);
    assert.strictEqual(inv.bonus, 3);
    assert.strictEqual(inv.leaves, 2);
    assert.strictEqual(inv.fake, 1);
    assert.strictEqual(inv.total, 10);

    // Same value through the leaderboard.
    const lb = invites.getLeaderboard('g');
    assert.strictEqual(lb[0].total, 10);
    assert.strictEqual(lb[0].bonus, 3);
  });

  suite.test('zero-result inviter DTO includes all fields including bonus', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    const inv = invites.getInviter('g', 'nobody');
    assert.deepStrictEqual(inv, { userId: 'nobody', guildId: 'g', regular: 0, bonus: 0, leaves: 0, fake: 0, total: 0 });
  });

  suite.test('activity log lists lifecycle events including rejoins', () => {
    const db = createTestDb();
    const { invites } = createRepos(db);
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv') });
    invites.trackLeave({ guildId: 'g', userId: 'm' });
    invites.trackJoin({ guildId: 'g', userId: 'm', attribution: INVITE('inv2') });

    const log = invites.getActivityLog('g');
    assert.strictEqual(log.items.length, 3);
    const cycles = log.items.map((i) => `${i.eventType}${i.membershipCycle}`);
    assert.deepStrictEqual(cycles, ['JOIN2', 'LEAVE1', 'JOIN1']);
  });

  return suite.run();
}

module.exports = { runInviteRepositoryTests };

if (require.main === module) {
  runInviteRepositoryTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
