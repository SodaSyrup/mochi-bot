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
const { runSocketTests, runSocketIsolationTests, runSocketSessionPersistenceTests } = require('./socket.test');
const { runDemoIsolationTests } = require('./demoIsolation.test');
const { runOAuthTests } = require('./oauth.test');
const { runFrontendSafetyTests } = require('./frontendSafety.test');
const { runFrontendShellTests } = require('./frontendShell.test');
const { runFrontendSmokeTests } = require('./frontendSmoke.test');
const { runPermissionFreshnessTests } = require('./permissionFreshness.test');
const { runSafetyTests } = require('./safety.test');
const { runInviteCacheTests } = require('./inviteCache.test');
const { runRealtimeContractTests } = require('./realtimeContract.test');
const { runQueryValidationTests } = require('./queryValidation.test');

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
  ['Guild Permission Freshness', runPermissionFreshnessTests],
  ['Dashboard HTTP API', runApiTests],
  ['Development Login (no OAuth)', runDevelopmentLoginTests],
  ['Invite Cache Semantics', runInviteCacheTests],
  ['Realtime Contract', runRealtimeContractTests],
  ['Query Validation', runQueryValidationTests],
  ['Safety Error Handling', runSafetyTests],
  ['Socket.IO Authorization & Isolation', runSocketTests],
  ['Socket.IO Guild Isolation', runSocketIsolationTests],
  ['Socket.IO Session Persistence', runSocketSessionPersistenceTests],
  ['Demo / Live Isolation', runDemoIsolationTests],
  ['Discord OAuth', runOAuthTests],
  ['Frontend Injection Safety', runFrontendSafetyTests],
  ['Frontend Shell (layout + status)', runFrontendShellTests],
  ['Frontend Shell Smoke (DOM load)', runFrontendSmokeTests],
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
