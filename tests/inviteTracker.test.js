const assert = require('assert');
const inviteTracker = require('../src/bot/services/inviteTracker');

async function testInviteTracker() {
  console.log('🧪 Testing Invite Tracker Service & Templating...');

  // 1. Test template variable replacement
  const template = 'Welcome {user} to {guild.name}! Invited by {inviter} ({inviter.invites} total). Code: {invite.code}';
  const data = {
    member: { id: '999111', user: { username: 'Newbie', tag: 'Newbie#0001' } },
    guild: { name: 'Mochi Haven', memberCount: 150 },
    inviterUser: { id: '777222', username: 'Recruiter', tag: 'Recruiter#1234' },
    inviterStats: { total: 15, regular: 12, bonus: 5, leaves: 1, fake: 1 },
    usedInvite: { code: 'mochi-rules' },
    joinType: 'NORMAL'
  };

  const formatted = inviteTracker.formatTemplate(template, data);
  assert.strictEqual(
    formatted,
    'Welcome <@999111> to Mochi Haven! Invited by <@777222> (15 total). Code: mochi-rules'
  );
  console.log('  ✅ Template formatting with {user}, {inviter}, {inviter.invites}, {invite.code} passed.');

  // 2. Test invite cache handling
  inviteTracker.handleInviteCreate({
    guild: { id: 'guild_test_xyz' },
    code: 'spring-event',
    uses: 0,
    maxUses: 100,
    inviter: { id: 'user_1' },
    createdAt: new Date()
  });

  const cached = inviteTracker.invitesCache.get('guild_test_xyz');
  assert(cached.has('spring-event'));
  assert.strictEqual(cached.get('spring-event').uses, 0);

  inviteTracker.handleInviteDelete({
    guild: { id: 'guild_test_xyz' },
    code: 'spring-event'
  });
  assert(!cached.has('spring-event'));
  console.log('  ✅ Invite cache lifecycle (create, get, delete) passed.');

  console.log('✨ All Invite Tracker Tests Passed Successfully!\n');
}

module.exports = testInviteTracker;

if (require.main === module) {
  testInviteTracker().catch(err => {
    console.error('❌ Invite Tracker Test Failed:', err);
    process.exit(1);
  });
}
