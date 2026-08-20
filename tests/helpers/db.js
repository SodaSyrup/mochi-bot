const { createDatabase } = require('../../src/database/createDatabase');
const { runMigrations } = require('../../src/database/migrations');
const { InviteRepository } = require('../../src/features/invites/infrastructure/inviteRepository');
const { GuildRepository } = require('../../src/features/guilds/infrastructure/guildRepository');

/**
 * Create an isolated in-memory database with all migrations applied.
 * Tests must NEVER touch the real data/mochi.sqlite.
 */
function createTestDb() {
  const db = createDatabase({ path: ':memory:' });
  runMigrations(db, { silent: true });
  return db;
}

function createRepos(db) {
  return {
    invites: new InviteRepository(db),
    guilds: new GuildRepository(db),
  };
}

module.exports = { createTestDb, createRepos };
