const { TestSuite, assert } = require('./helpers/harness');
const { createDatabase } = require('../src/database/createDatabase');
const { runMigrations, migrations } = require('../src/database/migrations');
const { createRepos } = require('./helpers/db');
const { getGuildIdsWithInviteData } = require('../src/features/invites/infrastructure/projectionGuilds');
const { AttributionType } = require('../src/features/invites/domain/attribution');

// The complete current production schema must be created by migration 001 and
// nothing else. These lists are the contract a fresh database must satisfy.
const EXPECTED_TABLES = [
  'guilds',
  'inviters',
  'invite_members',
  'invite_cache',
  'invite_labels',
  'daily_invite_stats',
  'invite_events',
  'invite_bonus_adjustments',
];

const EXPECTED_VIEWS = ['inviter_stats'];

const EXPECTED_INDEXES = [
  'idx_invite_members_inviter',
  'idx_invite_labels_guild',
  'idx_invite_events_guild_time',
  'idx_invite_events_guild_inviter',
  'idx_invite_events_guild_user',
  'idx_bonus_adjustments_guild_user',
];

// Abandoned same-day prototype tables must never reappear in a fresh baseline.
const FORBIDDEN_LEGACY_TABLES = [
  'legacy_inviter_stats_snapshot',
  'legacy_daily_invite_stats_snapshot',
];

function objectNames(db, type) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name")
    .all(type)
    .map((r) => r.name);
}

function schemaSignature(db) {
  return db
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'view', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all()
    .map((r) => `${r.type}:${r.name}:${r.sql}`)
    .join('\n');
}

const INVITE = (id, code = 'c') => ({ type: AttributionType.INVITE, inviterId: id, inviteCode: code });

async function runMigrationTests() {
  const suite = new TestSuite('Database Migration');

  // ------------------------------------------------ clean baseline registry

  suite.test('migration registry is exactly one clean baseline (001)', () => {
    assert.strictEqual(migrations.length, 1, 'there must be exactly one migration');
    assert.strictEqual(migrations[0].version, 1);
    assert.strictEqual(migrations[0].name, 'initial');
  });

  // ------------------------------------------ fresh database bootstrap (001)

  suite.test('fresh empty database: migration 001 runs once and creates the complete schema', () => {
    const db = createDatabase({ path: ':memory:' });

    // schema_migrations does not exist on a truly empty database.
    const before = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    assert.ok(!before, 'schema_migrations must be absent on an empty database');

    const applied = runMigrations(db, { silent: true });
    assert.strictEqual(applied, 1, 'exactly one migration applies to a fresh database');

    // Migration metadata records 001.
    const versions = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
    assert.deepStrictEqual(versions, [{ version: 1, name: 'initial' }]);

    // Every current table exists.
    const tables = new Set(objectNames(db, 'table'));
    for (const t of EXPECTED_TABLES) {
      assert.ok(tables.has(t), `table ${t} must be created by migration 001`);
    }

    // Current view exists.
    const views = new Set(objectNames(db, 'view'));
    for (const v of EXPECTED_VIEWS) {
      assert.ok(views.has(v), `view ${v} must be created by migration 001`);
    }

    // Current indexes exist.
    const indexes = new Set(objectNames(db, 'index'));
    for (const i of EXPECTED_INDEXES) {
      assert.ok(indexes.has(i), `index ${i} must be created by migration 001`);
    }

    // No abandoned prototype snapshot tables exist.
    for (const t of FORBIDDEN_LEGACY_TABLES) {
      assert.ok(!tables.has(t), `legacy table ${t} must not exist on a fresh baseline`);
    }
  });

  suite.test('migration runner is idempotent: rerunning changes nothing', () => {
    const db = createDatabase({ path: ':memory:' });
    runMigrations(db, { silent: true });
    const signature = schemaSignature(db);

    const appliedAgain = runMigrations(db, { silent: true });
    assert.strictEqual(appliedAgain, 0, 'a fully migrated database applies nothing');

    assert.strictEqual(schemaSignature(db), signature, 'rerunning migrations must not change the schema');
  });

  suite.test('future real migrations can begin at 002', () => {
    const db = createDatabase({ path: ':memory:' });
    runMigrations(db, { silent: true });
    const maxVersion = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;
    assert.strictEqual(maxVersion, 1, 'baseline occupies version 1; the next change is 002');
  });

  // ------------------------------------------- repositories work immediately

  suite.test('current repositories are usable immediately on a fresh migrated database', () => {
    const db = createDatabase({ path: ':memory:' });
    runMigrations(db, { silent: true });
    const { invites, guilds } = createRepos(db);

    const guild = guilds.getGuild('g', 'Fresh Guild');
    assert.strictEqual(guild.guild_id, 'g');

    const join = invites.trackJoin({ guildId: 'g', userId: 'm1', attribution: INVITE('inv', 'code1'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });
    assert.strictEqual(join.reason, 'CREATED');
    invites.trackLeave({ guildId: 'g', userId: 'm1', leftAt: '2026-01-02T10:00:00Z' });
    invites.addBonus({ guildId: 'g', userId: 'inv', amount: 3, reason: 'manual', actorUserId: 'admin' });

    const inviter = invites.getInviter('g', 'inv');
    assert.strictEqual(inviter.regular, 1);
    assert.strictEqual(inviter.bonus, 3);
    assert.strictEqual(inviter.leaves, 1);
    assert.strictEqual(inviter.total, 1 + 3 - 1);

    assert.strictEqual(invites.getLeaderboard('g', { limit: 10 }).length, 1);
    assert.strictEqual(invites.getDailyStats('g', 10).length, 2);
    assert.ok(invites.getCurrentMember('g', 'm1'));
    assert.ok(invites.getActivityLog('g', { limit: 20 }).total === 2);

    invites.setInviteLabel('g', 'code1', 'Promo');
    assert.strictEqual(invites.getInviteLabel('g', 'code1').label, 'Promo');
    invites.saveCachedInvites('g', [{ code: 'code1', uses: 1 }]);
    assert.strictEqual(invites.getCachedInvites('g').length, 1);
  });

  suite.test('inviter_stats view computes the canonical totals on a fresh baseline', () => {
    const db = createDatabase({ path: ':memory:' });
    runMigrations(db, { silent: true });
    const { invites } = createRepos(db);
    const g = 'g';

    invites.trackJoin({ guildId: g, userId: 'm1', attribution: INVITE('inv', 'c'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });
    invites.trackJoin({ guildId: g, userId: 'm2', attribution: INVITE('inv', 'c'), isFake: true, joinedAt: '2026-01-02T10:00:00Z' });
    invites.trackLeave({ guildId: g, userId: 'm1', leftAt: '2026-01-03T10:00:00Z' });
    invites.addBonus({ guildId: g, userId: 'inv', amount: 4, reason: 'r' });

    const row = db.prepare("SELECT * FROM inviter_stats WHERE guild_id=? AND user_id='inv'").get(g);
    assert.strictEqual(row.regular, 2);
    assert.strictEqual(row.fake, 1);
    assert.strictEqual(row.leaves, 1);
    assert.strictEqual(row.bonus, 4);
    assert.strictEqual(row.total, 2 + 4 - 1 - 1, 'view must hold total = regular + bonus - leaves - fake');
  });

  // ----------------------------- fresh schema application smoke (Phase 17)

  suite.test('fresh schema smoke: join/leave/bonus/leaderboard identical before and after rebuild', () => {
    const db = createDatabase({ path: ':memory:' });
    runMigrations(db, { silent: true });
    const { invites, guilds } = createRepos(db);
    const g = 'guildSmoke';
    guilds.getGuild(g, 'Smoke Guild');

    invites.trackJoin({ guildId: g, userId: 'm1', attribution: INVITE('inv', 'code1'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });
    invites.trackJoin({ guildId: g, userId: 'm2', attribution: INVITE('inv', 'code1'), isFake: true, joinedAt: '2026-01-02T10:00:00Z' });
    invites.trackJoin({ guildId: g, userId: 'm3', attribution: INVITE('inv', 'code1'), isFake: false, joinedAt: '2026-01-03T10:00:00Z' });
    invites.trackLeave({ guildId: g, userId: 'm1', leftAt: '2026-01-04T10:00:00Z' });
    invites.addBonus({ guildId: g, userId: 'inv', amount: 5, reason: 'smoke' });

    const inviterBefore = invites.getInviter(g, 'inv');
    assert.strictEqual(inviterBefore.regular, 3);
    assert.strictEqual(inviterBefore.fake, 1);
    assert.strictEqual(inviterBefore.leaves, 1);
    assert.strictEqual(inviterBefore.bonus, 5);
    assert.strictEqual(inviterBefore.total, 3 + 5 - 1 - 1);

    const leaderboardBefore = JSON.stringify(invites.getLeaderboard(g, { limit: 10 }));
    const dailyBefore = JSON.stringify(invites.getDailyStats(g, 10));
    const membersBefore = JSON.stringify(invites.getRecentJoins(g, 10));

    const result = invites.rebuildGuildProjections(g);
    assert.strictEqual(result.inviters, 1);

    assert.deepStrictEqual(invites.getInviter(g, 'inv'), inviterBefore);
    assert.strictEqual(JSON.stringify(invites.getLeaderboard(g, { limit: 10 })), leaderboardBefore);
    assert.strictEqual(JSON.stringify(invites.getDailyStats(g, 10)), dailyBefore);
    assert.strictEqual(JSON.stringify(invites.getRecentJoins(g, 10)), membersBefore);
  });

  // -------------------------------- rebuild after fresh bootstrap (Phase 37)

  suite.test('projection rebuild after fresh bootstrap repairs corruption and retains bonus', () => {
    const db = createDatabase({ path: ':memory:' });
    runMigrations(db, { silent: true });
    const { invites } = createRepos(db);
    const g = 'g';

    invites.trackJoin({ guildId: g, userId: 'm1', attribution: INVITE('inv', 'c'), isFake: false, joinedAt: '2026-01-01T10:00:00Z' });
    invites.addBonus({ guildId: g, userId: 'inv', amount: 7, reason: 'manual' });

    // Corrupt every projection table.
    db.prepare('UPDATE inviters SET regular = 999, bonus = 999, leaves = 999, fake = 999 WHERE guild_id=?').run(g);
    db.prepare('UPDATE daily_invite_stats SET joins = 999, leaves = 999, fakes = 999 WHERE guild_id=?').run(g);
    db.prepare("UPDATE invite_members SET inviter_id='WRONG', is_left=1, membership_cycle=99 WHERE guild_id=? AND user_id='m1'").run(g);

    invites.rebuildGuildProjections(g);

    const inviter = invites.getInviter(g, 'inv');
    assert.strictEqual(inviter.regular, 1);
    assert.strictEqual(inviter.bonus, 7, 'bonus must be reconstructed from the adjustment ledger');
    assert.strictEqual(inviter.leaves, 0);
    assert.strictEqual(inviter.fake, 0);
    assert.strictEqual(inviter.total, 1 + 7);

    const member = invites.getCurrentMember(g, 'm1');
    assert.strictEqual(member.inviter_id, 'inv');
    assert.strictEqual(member.membership_cycle, 1);
    assert.strictEqual(member.is_left, 0);

    const daily = invites.getDailyStats(g, 10);
    assert.strictEqual(daily.length, 1);
    assert.strictEqual(daily[0].joins, 1);
  });

  // --------------------------------------------- shared guild discovery

  suite.test('getGuildIdsWithInviteData returns each guild exactly once across tables', () => {
    const db = createDatabase({ path: ':memory:' });
    runMigrations(db, { silent: true });
    const g = 'dupGuild';
    db.prepare(`INSERT INTO guilds (guild_id, name) VALUES (?, ?)`).run(g, 'Dup Guild');
    db.prepare(`
      INSERT INTO invite_events (guild_id, user_id, membership_cycle, event_type, attribution_type, inviter_id, invite_code, is_fake, occurred_at)
      VALUES (?, ?, 1, 'JOIN', 'INVITE', 'inv', 'c', 0, '2026-01-01T10:00:00Z')
    `).run(g, 'm1');
    db.prepare(`INSERT INTO invite_bonus_adjustments (guild_id, user_id, amount, reason) VALUES (?, ?, 1, 'r')`).run(g, 'inv');
    db.prepare(`
      INSERT INTO invite_members (guild_id, user_id, inviter_id, invite_code, joined_at, membership_cycle, attribution_type)
      VALUES (?, ?, 'inv', 'c', '2026-01-01T10:00:00Z', 1, 'INVITE')
    `).run(g, 'm1');
    db.prepare(`INSERT INTO inviters (guild_id, user_id, regular) VALUES (?, ?, 1)`).run(g, 'inv');
    db.prepare(`INSERT INTO daily_invite_stats (guild_id, date, joins) VALUES (?, '2026-01-01', 1)`).run(g);

    const ids = getGuildIdsWithInviteData(db);
    assert.deepStrictEqual(ids, [g], 'a guild in every source table is returned exactly once');
  });

  suite.test('getGuildIdsWithInviteData discovers a guild in each single table', () => {
    const db = createDatabase({ path: ':memory:' });
    runMigrations(db, { silent: true });
    const expectations = [
      { table: 'invite_events', guild: 'gEvents', insert: (g) => db.prepare(`
        INSERT INTO invite_events (guild_id, user_id, membership_cycle, event_type, attribution_type, inviter_id, invite_code, is_fake, occurred_at)
        VALUES (?, ?, 1, 'JOIN', 'INVITE', 'inv', 'c', 0, '2026-01-01T10:00:00Z')
      `).run(g, 'm1') },
      { table: 'invite_bonus_adjustments', guild: 'gBonuses', insert: (g) => db.prepare(`INSERT INTO invite_bonus_adjustments (guild_id, user_id, amount, reason) VALUES (?, 'inv', 5, 'r')`).run(g) },
      { table: 'invite_members', guild: 'gMembers', insert: (g) => db.prepare(`
        INSERT INTO invite_members (guild_id, user_id, inviter_id, invite_code, joined_at, membership_cycle, attribution_type)
        VALUES (?, 'm1', 'inv', 'c', '2026-01-01T10:00:00Z', 1, 'INVITE')
      `).run(g) },
      { table: 'inviters', guild: 'gInviters', insert: (g) => db.prepare(`INSERT INTO inviters (guild_id, user_id, regular) VALUES (?, 'inv', 2)`).run(g) },
      { table: 'daily_invite_stats', guild: 'gDaily', insert: (g) => db.prepare(`INSERT INTO daily_invite_stats (guild_id, date, joins) VALUES (?, '2026-01-01', 3)`).run(g) },
    ];
    for (const e of expectations) {
      db.prepare(`INSERT INTO guilds (guild_id, name) VALUES (?, ?)`).run(e.guild, e.guild);
      e.insert(e.guild);
    }
    const ids = new Set(getGuildIdsWithInviteData(db));
    for (const e of expectations) {
      assert.ok(ids.has(e.guild), `${e.table}-only guild must be discovered`);
    }
  });

  return suite.run();
}

module.exports = { runMigrationTests };

if (require.main === module) {
  runMigrationTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
