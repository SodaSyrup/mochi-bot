const { runConfigTests } = require('./config.test');
const { runMigrationTests } = require('./migration.test');
const { runInvitePolicyTests } = require('./invitePolicy.test');
const { runInviteRepositoryTests } = require('./inviteRepository.test');
const { runProjectionRebuildTests } = require('./projectionRebuild.test');
const { runInviteServiceTests } = require('./inviteService.test');
const { runAttributionTests } = require('./inviteAttribution.test');
const { runSerialQueueTests } = require('./guildSerialQueue.test');
const { runPermissionTests } = require('./permissions.test');
const { runGuildAccessTests } = require('./guildAccess.test');
const { runApiTests, runDevelopmentLoginTests } = require('./api.test');
const { runSocketTests } = require('./socket.test');
const { runDemoIsolationTests } = require('./demoIsolation.test');
const { runOAuthTests } = require('./oauth.test');
const { runFrontendSafetyTests } = require('./frontendSafety.test');

const suites = [
  ['Config & Application Modes', runConfigTests],
  ['Database Migration', runMigrationTests],
  ['Invite Policy', runInvitePolicyTests],
  ['Invite Repository', runInviteRepositoryTests],
  ['Projection Rebuild', runProjectionRebuildTests],
  ['Invite Service', runInviteServiceTests],
  ['Conservative Attribution', runAttributionTests],
  ['Guild Serial Queue', runSerialQueueTests],
  ['Discord Permissions & OAuth State', runPermissionTests],
  ['Guild Access Service', runGuildAccessTests],
  ['Dashboard HTTP API', runApiTests],
  ['Development Login (no OAuth)', runDevelopmentLoginTests],
  ['Socket.IO Authorization & Isolation', runSocketTests],
  ['Demo / Live Isolation', runDemoIsolationTests],
  ['Discord OAuth', runOAuthTests],
  ['Frontend Injection Safety', runFrontendSafetyTests],
];

async function runAll() {
  console.log('===========================================================');
  console.log('           🍡  MOCHI TEST & VERIFICATION SUITE  🍡         ');
  console.log('===========================================================\n');

  let totalFailed = 0;
  let totalPassed = 0;

  for (const [name, fn] of suites) {
    console.log(`\n🧪 ${name}...`);
    const failed = await fn();
    totalFailed += failed;
  }

  console.log('\n===========================================================');
  if (totalFailed === 0) {
    console.log('🎉 ALL TEST SUITES PASSED WITH 100% SUCCESS!');
    console.log('===========================================================');
    process.exit(0);
  } else {
    console.log(`❌ ${totalFailed} TEST(S) FAILED`);
    console.log('===========================================================');
    process.exit(1);
  }
}

runAll();
