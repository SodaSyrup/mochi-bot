const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Use an isolated test database
const testDbPath = path.join(__dirname, 'test_mochi.sqlite');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

process.env.DATABASE_PATH = testDbPath;
const db = require('../src/database/db');
const inviteRepo = require('../src/database/repositories/inviteRepo');
const guildRepo = require('../src/database/repositories/guildRepo');

async function testDatabaseLayer() {
  console.log('🧪 Testing Database Layer & Repositories...');

  const guildId = 'test_guild_' + Math.random().toString(36).substring(2, 9);
  const inviterId = 'user_inviter_' + Math.random().toString(36).substring(2, 9);
  const memberId1 = 'user_joiner_' + Math.random().toString(36).substring(2, 9);
  const memberId2 = 'user_joiner_fake_' + Math.random().toString(36).substring(2, 9);

  // 1. Guild repository test
  const guild = guildRepo.getGuild(guildId, 'Test Discord Server');
  assert.strictEqual(guild.name, 'Test Discord Server');

  const updatedGuild = guildRepo.updateGuild(guildId, {
    fake_threshold_days: 10
  });
  assert.strictEqual(updatedGuild.fake_threshold_days, 10);
  console.log('  ✅ Guild Repository CRUD passed.');

  // 2. Invite Join & Leave flow
  const join1 = inviteRepo.recordJoin(guildId, memberId1, inviterId, 'discord-code-1', false);
  assert.strictEqual(join1.regular, 1);
  assert.strictEqual(join1.total, 1);

  // Fake account join
  const join2 = inviteRepo.recordJoin(guildId, memberId2, inviterId, 'discord-code-1', true);
  assert.strictEqual(join2.regular, 1);
  assert.strictEqual(join2.fake, 1);
  assert.strictEqual(join2.total, 0); // Net: 1 regular - 1 fake = 0

  // Member Leaves
  const leave = inviteRepo.recordLeave(guildId, memberId1);
  assert.strictEqual(leave.leaves, 1);
  assert.strictEqual(leave.total, -1); // Net: 1 regular - 1 fake - 1 leave = -1
  console.log('  ✅ Invite Repository tracking and penalty calculations passed.');

  // 3. Leaderboard & Stats
  const lb = inviteRepo.getLeaderboard(guildId);
  assert.strictEqual(lb.length, 1);
  assert.strictEqual(lb[0].total, -1);

  const stats = inviteRepo.getDailyStats(guildId);
  assert(stats.length > 0);
  console.log('  ✅ Leaderboard & daily analytics queries passed.');

  // 4. Invite Labels CRUD
  const savedLabel = inviteRepo.setInviteLabel(guildId, 'mochi-test-promo', 'YouTube Launch Video', 'chan_123', 'announcements');
  assert.strictEqual(savedLabel.label, 'YouTube Launch Video');
  assert.strictEqual(savedLabel.channel_name, 'announcements');

  const fetchedLabel = inviteRepo.getInviteLabel(guildId, 'mochi-test-promo');
  assert.strictEqual(fetchedLabel.label, 'YouTube Launch Video');

  const allLabels = inviteRepo.getInviteLabels(guildId);
  assert.strictEqual(allLabels.length, 1);
  assert.strictEqual(allLabels[0].code, 'mochi-test-promo');

  // Save cached invite and verify join with label
  inviteRepo.saveCachedInvite(guildId, {
    code: 'mochi-test-promo',
    uses: 5,
    maxUses: 100,
    inviterId,
    channelId: 'chan_123',
    channelName: 'announcements',
    createdAt: new Date()
  });

  const cachedList = inviteRepo.getCachedInvites(guildId);
  assert.strictEqual(cachedList.length, 1);
  assert.strictEqual(cachedList[0].code, 'mochi-test-promo');
  assert.strictEqual(cachedList[0].label, 'YouTube Launch Video');

  // Delete label
  inviteRepo.deleteInviteLabel(guildId, 'mochi-test-promo');
  const deletedLabel = inviteRepo.getInviteLabel(guildId, 'mochi-test-promo');
  assert.ok(!deletedLabel, `Expected label to be gone after deletion, got: ${JSON.stringify(deletedLabel)}`);
  console.log('  ✅ Invite Labels CRUD & joined cache passed.');

  console.log('✨ All Database Layer Tests Passed Successfully!\n');
}

module.exports = testDatabaseLayer;

if (require.main === module) {
  testDatabaseLayer().catch(err => {
    console.error('❌ Database Test Failed:', err);
    process.exit(1);
  });
}
