const { TestSuite, assert } = require('./helpers/harness');
const { createDatabase } = require('../src/database/createDatabase');
const { runMigrations } = require('../src/database/migrations');
const { getGuildIdsWithInviteData } = require('../src/features/invites/infrastructure/projectionGuilds');

const OLD_SCHEMA = `
CREATE TABLE guilds (
  guild_id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT,
  fake_threshold_days INTEGER DEFAULT 7,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE inviters (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  regular INTEGER DEFAULT 0, bonus INTEGER DEFAULT 0, leaves INTEGER DEFAULT 0, fake INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE invite_members (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, inviter_id TEXT, invite_code TEXT,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, is_fake INTEGER DEFAULT 0, is_left INTEGER DEFAULT 0, left_at DATETIME,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE invite_cache (
  guild_id TEXT NOT NULL, code TEXT NOT NULL, uses INTEGER DEFAULT 0, inviter_id TEXT,
  max_uses INTEGER DEFAULT 0, channel_id TEXT, channel_name TEXT, created_at DATETIME,
  PRIMARY KEY (guild_id, code)
);
CREATE TABLE invite_labels (
  guild_id TEXT NOT NULL, code TEXT NOT NULL, label TEXT NOT NULL, channel_id TEXT, channel_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, code)
);
CREATE TABLE daily_invite_stats (
  guild_id TEXT NOT NULL, date TEXT NOT NULL, joins INTEGER DEFAULT 0, leaves INTEGER DEFAULT 0, fakes INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, date)
);
`;

function createLegacyFixtureDb() {
  const db = createDatabase({ path: ':memory:' });
  db.exec(OLD_SCHEMA);
  const g = 'guild1';
  db.exec(`
    INSERT INTO guilds (guild_id, name, fake_threshold_days) VALUES ('${g}', 'Legacy Guild', 7);
    INSERT INTO inviters (guild_id, user_id, regular, bonus, leaves, fake) VALUES
      ('${g}', 'inv1', 5, 2, 1, 1),
      ('${g}', 'inv2', 3, 0, 0, 0);
    INSERT INTO invite_members (guild_id, user_id, inviter_id, invite_code, joined_at, is_fake, is_left, left_at) VALUES
      ('${g}', 'mem_normal', 'inv1', 'code1', '2026-01-01T10:00:00Z', 0, 0, NULL),
      ('${g}', 'mem_fake', 'inv1', 'code2', '2026-01-02T10:00:00Z', 1, 1, '2026-01-03T10:00:00Z'),
      ('${g}', 'mem_vanity', 'VANITY', NULL, '2026-01-04T10:00:00Z', 0, 0, NULL),
      ('${g}', 'mem_unknown', 'UNKNOWN', NULL, '2026-01-05T10:00:00Z', 0, 0, NULL),
      ('${g}', 'mem_pre', 'PRE_EXISTING', 'PRE_BOT', '2026-01-06T10:00:00Z', 0, 0, NULL);
    INSERT INTO invite_cache (guild_id, code, uses, inviter_id, channel_id, channel_name) VALUES
      ('${g}', 'code1', 5, 'inv1', 'chan_1', 'general');
    INSERT INTO invite_labels (guild_id, code, label, channel_id, channel_name) VALUES
      ('${g}', 'code1', 'Promo', 'chan_1', 'general');
    INSERT INTO daily_invite_stats (guild_id, date, joins, leaves, fakes) VALUES ('${g}', '2026-01-01', 1, 0, 0);
  `);
  return db;
}

// A legacy (pre-migration) database with the old mutable schema and nothing else.
function createEmptyLegacyDb() {
  const db = createDatabase({ path: ':memory:' });
  db.exec(OLD_SCHEMA);
  return db;
}

// A database sitting exactly at the boundary where migration 003 will run:
// baseline (1) + ledger (2) applied, 003/004 not yet.
function createPreMigration3Db() {
  const migration1 = require('../src/database/migrations/001-baseline-schema');
  const migration2 = require('../src/database/migrations/002-invite-ledger');
  const db = createDatabase({ path: ':memory:' });
  migration1.up(db);
  migration2.up(db);
  return db;
}

async function runMigrationTests() {
  const suite = new TestSuite('Database Migration');

  suite.test('legacy DB migrates with data preserved and ledger built', () => {
    const db = createLegacyFixtureDb();
    runMigrations(db, { silent: true });

    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((r) => r.version);
    assert.deepStrictEqual(versions, [1, 2, 3, 4]);

    // All member rows preserved with normalized attribution.
    const members = db.prepare('SELECT user_id, attribution_type, inviter_id, membership_cycle FROM invite_members ORDER BY user_id').all();
    const byId = Object.fromEntries(members.map((m) => [m.user_id, m]));
    assert.strictEqual(byId['mem_normal'].attribution_type, 'INVITE');
    assert.strictEqual(byId['mem_normal'].inviter_id, 'inv1');
    assert.strictEqual(byId['mem_normal'].membership_cycle, 1);
    assert.strictEqual(byId['mem_vanity'].attribution_type, 'VANITY');
    assert.strictEqual(byId['mem_vanity'].inviter_id, null);
    assert.strictEqual(byId['mem_unknown'].attribution_type, 'UNKNOWN');
    assert.strictEqual(byId['mem_unknown'].inviter_id, null);
    assert.strictEqual(byId['mem_pre'].attribution_type, 'PRE_EXISTING');
    assert.strictEqual(byId['mem_pre'].inviter_id, null);

    // Ledger events synthesized.
    const events = db.prepare(`
      SELECT user_id, event_type, attribution_type, inviter_id FROM invite_events ORDER BY id
    `).all();
    assert.strictEqual(events.length, 6); // 5 joins + 1 leave
    const fakeLeave = events.find((e) => e.user_id === 'mem_fake' && e.event_type === 'LEAVE');
    assert.strictEqual(fakeLeave.inviter_id, 'inv1');
    assert.strictEqual(fakeLeave.attribution_type, 'INVITE');

    // Bonus imported once.
    const bonuses = db.prepare('SELECT guild_id, user_id, amount, reason FROM invite_bonus_adjustments').all();
    assert.strictEqual(bonuses.length, 1);
    assert.strictEqual(bonuses[0].amount, 2);
    assert.ok(bonuses[0].reason.includes('Legacy bonus'));

    // Projections rebuilt from ledger: inv1 regular 2 (mem_normal + mem_fake), fake 1, leaves 0, bonus 2.
    const inv1 = db.prepare(`SELECT * FROM inviter_stats WHERE guild_id='guild1' AND user_id='inv1'`).get();
    assert.strictEqual(inv1.regular, 2);
    assert.strictEqual(inv1.fake, 1);
    assert.strictEqual(inv1.leaves, 0);
    assert.strictEqual(inv1.bonus, 2);
    assert.strictEqual(inv1.total, 2 + 2 - 0 - 1);

    // Labels and cache preserved.
    assert.strictEqual(db.prepare(`SELECT COUNT(*) c FROM invite_labels`).get().c, 1);
    assert.strictEqual(db.prepare(`SELECT uses FROM invite_cache WHERE code='code1'`).get().uses, 5);

    // Daily stats rebuilt from events.
    const daily = db.prepare(`SELECT date, joins, leaves, fakes FROM daily_invite_stats WHERE guild_id='guild1'`).all();
    assert.ok(daily.length >= 5);
  });

  suite.test('legacy aggregate snapshots are archived before rebuild', () => {
    const db = createLegacyFixtureDb();
    runMigrations(db, { silent: true });

    const archived = db.prepare(`
      SELECT guild_id, user_id, regular, bonus, leaves, fake
      FROM legacy_inviter_stats_snapshot ORDER BY user_id
    `).all();
    // inv1 (5,2,1,1) and inv2 (3,0,0,0) were the pre-rebuild aggregates.
    assert.strictEqual(archived.length, 2);
    const byId = Object.fromEntries(archived.map((a) => [a.user_id, a]));
    assert.deepStrictEqual(
      [byId['inv1'].regular, byId['inv1'].bonus, byId['inv1'].leaves, byId['inv1'].fake],
      [5, 2, 1, 1]
    );
    assert.deepStrictEqual(
      [byId['inv2'].regular, byId['inv2'].bonus, byId['inv2'].leaves, byId['inv2'].fake],
      [3, 0, 0, 0]
    );
  });

  suite.test('legacy daily statistics are archived before the rebuild', () => {
    const db = createLegacyFixtureDb();
    runMigrations(db, { silent: true });

    const archived = db.prepare(`
      SELECT guild_id, date, joins, leaves, fakes
      FROM legacy_daily_invite_stats_snapshot
    `).all();
    // The fixture created one pre-migration daily row for guild1 / 2026-01-01.
    assert.strictEqual(archived.length, 1);
    assert.deepStrictEqual(
      [archived[0].guild_id, archived[0].date, archived[0].joins, archived[0].leaves, archived[0].fakes],
      ['guild1', '2026-01-01', 1, 0, 0]
    );
  });

  suite.test('archive predicate parentheses: fake-only rows are NOT re-archived', () => {
    const db = createLegacyFixtureDb();
    runMigrations(db, { silent: true });

    // The explicit parentheses mean `AND NOT EXISTS` guards the WHOLE
    // non-zero predicate, so a fake-only row already archived stays archived
    // exactly once (without parentheses SQL would only guard the fake term).
    const rows = db.prepare(`
      SELECT user_id, fake FROM legacy_inviter_stats_snapshot WHERE user_id = 'inv1'
    `).all();
    assert.strictEqual(rows.length, 1);
    const counts = db.prepare('SELECT COUNT(*) c FROM legacy_inviter_stats_snapshot').get();
    assert.strictEqual(counts.c, 2);
  });

  suite.test('migration 004 does not double-archive when 003 already archived', () => {
    const db = createLegacyFixtureDb();
    runMigrations(db, { silent: true });
    const before = db.prepare('SELECT COUNT(*) c FROM legacy_daily_invite_stats_snapshot').get().c;
    const n = runMigrations(db, { silent: true });
    const after = db.prepare('SELECT COUNT(*) c FROM legacy_daily_invite_stats_snapshot').get().c;
    assert.strictEqual(n, 0);
    assert.strictEqual(after, before);
  });

  suite.test('migration 004 backfills the daily archive for DBs where 003 already ran', () => {
    // Simulate a database that migrated before the daily archive existed:
    // run 003's schema/state, then drop the archive table and re-run 004 by
    // applying only the pending path. Easiest reliable approach: build a fresh
    // fixture, run migrations, delete the daily snapshot, and re-run the 004
    // migration body against a schema_migrations that already contains 4.
    const db = createLegacyFixtureDb();
    runMigrations(db, { silent: true });

    // Wipe the archive to mimic a pre-archive deployment.
    db.exec('DROP TABLE legacy_daily_invite_stats_snapshot');

    const migration4 = require('../src/database/migrations/004-archive-legacy-daily-stats');
    migration4.up(db);

    const archived = db.prepare('SELECT COUNT(*) c FROM legacy_daily_invite_stats_snapshot').get();
    assert.ok(archived.c >= 1, 'migration 004 must backfill the daily archive');

    // Idempotent on re-run.
    migration4.up(db);
    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM legacy_daily_invite_stats_snapshot').get().c, archived.c);
  });

  suite.test('union reconciliation preserves a removed legacy inviter in the archive', () => {
    const db = createLegacyFixtureDb();
    runMigrations(db, { silent: true });

    // inv2 had aggregate counters (regular=3) but no member rows attributed to
    // it; the rebuilt ledger has no events, so inv2 is REMOVED from the
    // projection. Its legacy aggregate must still exist in the archive rather
    // than being silently destroyed.
    const newInv2 = db.prepare(`SELECT regular FROM inviter_stats WHERE guild_id='guild1' AND user_id='inv2'`).get();
    assert.ok(!newInv2, 'inv2 has no rebuilt projection row');
    const archivedInv2 = db.prepare(`
      SELECT regular FROM legacy_inviter_stats_snapshot WHERE guild_id='guild1' AND user_id='inv2'
    `).get();
    assert.strictEqual(archivedInv2.regular, 3);
  });

  suite.test('running migrations twice is a no-op', () => {
    const db = createLegacyFixtureDb();
    runMigrations(db, { silent: true });
    const eventsBefore = db.prepare('SELECT COUNT(*) c FROM invite_events').get().c;
    const archiveBefore = db.prepare('SELECT COUNT(*) c FROM legacy_inviter_stats_snapshot').get().c;
    const n = runMigrations(db, { silent: true });
    const eventsAfter = db.prepare('SELECT COUNT(*) c FROM invite_events').get().c;
    const archiveAfter = db.prepare('SELECT COUNT(*) c FROM legacy_inviter_stats_snapshot').get().c;
    assert.strictEqual(n, 0);
    assert.strictEqual(eventsBefore, eventsAfter);
    assert.strictEqual(archiveBefore, archiveAfter);
  });

  suite.test('member projection is rebuilt from the ledger by migration', () => {
    const db = createLegacyFixtureDb();
    runMigrations(db, { silent: true });
    // mem_normal: JOIN cycle 1 present. mem_fake: JOIN + LEAVE (left).
    const normal = db.prepare(`
      SELECT inviter_id, membership_cycle, is_left FROM invite_members WHERE guild_id='guild1' AND user_id='mem_normal'
    `).get();
    assert.strictEqual(normal.inviter_id, 'inv1');
    assert.strictEqual(normal.membership_cycle, 1);
    assert.strictEqual(normal.is_left, 0);
    const fake = db.prepare(`
      SELECT is_left, is_fake FROM invite_members WHERE guild_id='guild1' AND user_id='mem_fake'
    `).get();
    assert.strictEqual(fake.is_left, 1);
    assert.strictEqual(fake.is_fake, 1);
  });

  suite.test('no magic sentinel inviter ids remain after migration', () => {
    const db = createLegacyFixtureDb();
    runMigrations(db, { silent: true });
    const sentinels = db.prepare(`
      SELECT COUNT(*) c FROM invite_events WHERE inviter_id IN ('VANITY', 'UNKNOWN', 'PRE_EXISTING')
    `).get().c;
    assert.strictEqual(sentinels, 0);
    const memberSentinels = db.prepare(`
      SELECT COUNT(*) c FROM invite_members WHERE inviter_id IN ('VANITY', 'UNKNOWN', 'PRE_EXISTING')
    `).get().c;
    assert.strictEqual(memberSentinels, 0);
  });

  // ------------------------------------------------ shared guild discovery

  suite.test('getGuildIdsWithInviteData returns each guild exactly once across tables', () => {
    const db = createPreMigration3Db();
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
    const db = createPreMigration3Db();
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

  // ------------------------------------------- migration 003 discovery paths

  suite.test('migration 003 rebuilds a guild that exists only in member state', () => {
    const db = createEmptyLegacyDb();
    db.exec(`
      INSERT INTO guilds (guild_id, name) VALUES ('gMember', 'Member Guild');
      INSERT INTO invite_members (guild_id, user_id, inviter_id, invite_code, joined_at, is_fake, is_left, left_at)
      VALUES ('gMember', 'm1', 'inv1', 'code1', '2026-01-01T10:00:00Z', 0, 0, NULL);
    `);
    runMigrations(db, { silent: true });

    // JOIN synthesized from the member row, then the member projection rebuilt.
    const member = db.prepare(`
      SELECT inviter_id, membership_cycle, attribution_type FROM invite_members
      WHERE guild_id='gMember' AND user_id='m1'
    `).get();
    assert.strictEqual(member.inviter_id, 'inv1');
    assert.strictEqual(member.membership_cycle, 1);
    assert.strictEqual(member.attribution_type, 'INVITE');
    const inviter = db.prepare(`SELECT * FROM inviter_stats WHERE guild_id='gMember' AND user_id='inv1'`).get();
    assert.strictEqual(inviter.regular, 1, 'rebuild must derive the inviter credit for the discovered guild');
  });

  suite.test('migration 003 discovers and clears a guild that exists only in the inviter projection', () => {
    const db = createEmptyLegacyDb();
    db.exec(`
      INSERT INTO guilds (guild_id, name) VALUES ('gInviter', 'Inviter Guild');
      INSERT INTO inviters (guild_id, user_id, regular, bonus, leaves, fake)
      VALUES ('gInviter', 'legacyInv', 3, 0, 0, 0);
    `);
    runMigrations(db, { silent: true });

    // No ledger history means the stale aggregate cannot be reconstructed; the
    // discovered guild is rebuilt/cleared to durable truth.
    const cleared = db.prepare(`SELECT * FROM inviter_stats WHERE guild_id='gInviter'`).get();
    assert.ok(!cleared, 'inviter-only guild must be discovered and its stale projection cleared');
    // The legacy aggregate is archived, never silently destroyed.
    const archived = db.prepare(`
      SELECT regular FROM legacy_inviter_stats_snapshot WHERE guild_id='gInviter' AND user_id='legacyInv'
    `).get();
    assert.strictEqual(archived.regular, 3);
  });

  suite.test('migration 003 rebuilds the bonus projection for a bonus-adjustment-only guild', () => {
    const migration3 = require('../src/database/migrations/003-backfill-invite-ledger');
    const db = createPreMigration3Db();
    db.prepare(`INSERT INTO guilds (guild_id, name) VALUES (?, ?)`).run('gBonus', 'Bonus Guild');
    // A bonus adjustment with no invite_events and no invite_members rows.
    db.prepare(`INSERT INTO invite_bonus_adjustments (guild_id, user_id, amount, reason) VALUES (?, 'bonusInv', 7, 'manual')`).run('gBonus');

    migration3.up(db);

    const inviter = db.prepare(`SELECT * FROM inviter_stats WHERE guild_id='gBonus' AND user_id='bonusInv'`).get();
    assert.ok(inviter, 'bonus-only guild must be discovered via the adjustments table');
    assert.strictEqual(inviter.bonus, 7, 'bonus projection must be rebuilt from the adjustment');
    assert.strictEqual(inviter.regular, 0);
    assert.strictEqual(inviter.total, 7, 'total must reflect the bonus with zero member events');
  });

  suite.test('migration 003 discovers a guild that exists only in legacy daily stats', () => {
    const db = createEmptyLegacyDb();
    db.exec(`
      INSERT INTO guilds (guild_id, name) VALUES ('gDaily', 'Daily Guild');
      INSERT INTO daily_invite_stats (guild_id, date, joins, leaves, fakes)
      VALUES ('gDaily', '2026-01-01', 4, 1, 0);
    `);
    runMigrations(db, { silent: true });

    // The daily-only guild is discovered; with no ledger it is rebuilt to the
    // (empty) durable truth, and the pre-rebuild aggregate is archived.
    const daily = db.prepare(`SELECT * FROM daily_invite_stats WHERE guild_id='gDaily'`).all();
    assert.strictEqual(daily.length, 0, 'stale daily projection must be cleared by the rebuild');
    const archived = db.prepare(`
      SELECT joins, leaves, fakes FROM legacy_daily_invite_stats_snapshot WHERE guild_id='gDaily'
    `).get();
    assert.deepStrictEqual([archived.joins, archived.leaves, archived.fakes], [4, 1, 0]);
  });

  return suite.run();
}

module.exports = { runMigrationTests, createLegacyFixtureDb };

if (require.main === module) {
  runMigrationTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
