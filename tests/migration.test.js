const { TestSuite, assert } = require('./helpers/harness');
const { createDatabase } = require('../src/database/createDatabase');
const { runMigrations } = require('../src/database/migrations');

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

async function runMigrationTests() {
  const suite = new TestSuite('Database Migration');

  suite.test('legacy DB migrates with data preserved and ledger built', () => {
    const db = createLegacyFixtureDb();
    runMigrations(db, { silent: true });

    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((r) => r.version);
    assert.deepStrictEqual(versions, [1, 2, 3]);

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

  suite.test('running migrations twice is a no-op', () => {
    const db = createLegacyFixtureDb();
    runMigrations(db, { silent: true });
    const eventsBefore = db.prepare('SELECT COUNT(*) c FROM invite_events').get().c;
    const n = runMigrations(db, { silent: true });
    const eventsAfter = db.prepare('SELECT COUNT(*) c FROM invite_events').get().c;
    assert.strictEqual(n, 0);
    assert.strictEqual(eventsBefore, eventsAfter);
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

  return suite.run();
}

module.exports = { runMigrationTests, createLegacyFixtureDb };

if (require.main === module) {
  runMigrationTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
