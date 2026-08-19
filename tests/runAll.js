const testDatabaseLayer = require('./database.test');
const testInviteTracker = require('./inviteTracker.test');
const testApiEndpoints = require('./api.test');

async function runAll() {
  console.log('===========================================================');
  console.log('           🍡  MOCHI TEST & VERIFICATION SUITE  🍡         ');
  console.log('===========================================================\n');

  try {
    await testDatabaseLayer();
    await testInviteTracker();
    await testApiEndpoints();

    console.log('🎉 ALL TEST SUITES PASSED WITH 100% SUCCESS!');
    console.log('===========================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  }
}

runAll();
