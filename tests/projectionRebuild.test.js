const { TestSuite, assert } = require('./helpers/harness');
const { createTestDb, createRepos } = require('./helpers/db');
const { AttributionType } = require('../src/features/invites/domain/attribution');

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

  return suite.run();
}

module.exports = { runProjectionRebuildTests };

if (require.main === module) {
  runProjectionRebuildTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
