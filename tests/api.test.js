const assert = require('assert');
const DashboardServer = require('../src/dashboard/server');

async function testApiEndpoints() {
  console.log('🧪 Testing Dashboard Server & API Endpoints...');

  const mockClient = {
    user: { username: 'MochiMock', tag: 'MochiMock#0000', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
    guilds: { cache: new Map() },
    ws: { ping: 25 },
    isReady: () => true
  };

  const dashboard = new DashboardServer(mockClient);
  const testPort = 3000 + Math.floor(Math.random() * 5000);
  const server = await dashboard.start(testPort);

  try {
    const baseUrl = `http://localhost:${testPort}`;

    // 1. Test GET /api/stats
    const statsRes = await fetch(`${baseUrl}/api/stats`);
    assert.strictEqual(statsRes.status, 200);
    const statsData = await statsRes.json();
    assert(statsData.bot);
    assert(statsData.telemetry);
    console.log('  ✅ GET /api/stats responded with valid telemetry.');

    // 2. Test GET /api/guilds
    const guildsRes = await fetch(`${baseUrl}/api/guilds`);
    assert.strictEqual(guildsRes.status, 200);
    const guildsData = await guildsRes.json();
    assert(guildsData.guilds.length > 0);
    const targetGuildId = guildsData.guilds[0].id;
    console.log(`  ✅ GET /api/guilds returned ${guildsData.guilds.length} guilds.`);

    // 3. Test GET /api/guilds/:guildId
    const guildRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}`);
    assert.strictEqual(guildRes.status, 200);
    const guildData = await guildRes.json();
    assert(guildData.guild);
    assert(guildData.settings);
    console.log('  ✅ GET /api/guilds/:guildId returned guild settings & channels.');

    // 4. Test PATCH /api/guilds/:guildId/settings
    const patchRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fake_threshold_days: 14
      })
    });
    assert.strictEqual(patchRes.status, 200);
    const patchData = await patchRes.json();
    assert.strictEqual(patchData.settings.fake_threshold_days, 14);
    console.log('  ✅ PATCH /api/guilds/:guildId/settings successfully updated configuration.');

    // 5. Test POST /api/guilds/:guildId/simulate/join
    const simRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/simulate/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'TestSimulatorUser',
        inviterId: 'test_inviter_sim',
        inviteCode: 'mochi-test',
        isFake: false
      })
    });
    assert.strictEqual(simRes.status, 200);
    const simData = await simRes.json();
    assert(simData.success);
    assert.strictEqual(simData.event.user.username, 'TestSimulatorUser');
    console.log('  ✅ POST /api/guilds/:guildId/simulate/join triggered live event.');

    // 6. Test GET /api/guilds/:guildId/channels
    const chanRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/channels`);
    assert.strictEqual(chanRes.status, 200);
    const chanData = await chanRes.json();
    assert(chanData.channels.length > 0);
    console.log(`  ✅ GET /api/guilds/:guildId/channels returned ${chanData.channels.length} channels.`);

    // 7. Test POST /api/guilds/:guildId/invites (Create invite with label)
    const createInvRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: chanData.channels[0].id,
        label: '🚀 TikTok Viral Promo',
        maxAge: 86400,
        maxUses: 50,
        temporary: false
      })
    });
    assert.strictEqual(createInvRes.status, 201);
    const createInvData = await createInvRes.json();
    assert(createInvData.success);
    assert(createInvData.invite.code);
    assert.strictEqual(createInvData.invite.label, '🚀 TikTok Viral Promo');
    assert.strictEqual(createInvData.invite.maxUses, 50);
    const createdCode = createInvData.invite.code;
    console.log(`  ✅ POST /api/guilds/:guildId/invites created labeled invite code: ${createdCode}.`);

    // 8. Test POST /api/guilds/:guildId/invites/:code/label (Update existing label)
    const updateLabelRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/invites/${createdCode}/label`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: '✨ Updated Influencer Campaign'
      })
    });
    assert.strictEqual(updateLabelRes.status, 200);
    const updateLabelData = await updateLabelRes.json();
    assert.strictEqual(updateLabelData.label, '✨ Updated Influencer Campaign');
    console.log('  ✅ POST /api/guilds/:guildId/invites/:code/label updated existing label.');

    // 9. Test GET /api/guilds/:guildId/invites/active-codes
    const activeRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/invites/active-codes`);
    assert.strictEqual(activeRes.status, 200);
    const activeData = await activeRes.json();
    const foundInvite = activeData.invites.find(i => i.code === createdCode);
    assert(foundInvite);
    assert.strictEqual(foundInvite.label, '✨ Updated Influencer Campaign');
    console.log('  ✅ GET /api/guilds/:guildId/invites/active-codes contains newly created and labeled invite.');

    // 10. Test DELETE /api/guilds/:guildId/invites/:code/label (Remove label)
    const delLabelRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/invites/${createdCode}/label`, {
      method: 'DELETE'
    });
    assert.strictEqual(delLabelRes.status, 200);
    const delLabelData = await delLabelRes.json();
    assert.strictEqual(delLabelData.label, null);
    console.log('  ✅ DELETE /api/guilds/:guildId/invites/:code/label removed label.');

    // 11. Test DELETE /api/guilds/:guildId/invites/:code (Revoke invite)
    const revokeRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/invites/${createdCode}`, {
      method: 'DELETE'
    });
    assert.strictEqual(revokeRes.status, 200);
    console.log(`  ✅ DELETE /api/guilds/:guildId/invites/:code revoked invite.`);

    // 12. Test GET /api/guilds/:guildId/safety
    const safetyRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/safety`);
    assert.strictEqual(safetyRes.status, 200);
    const safetyData = await safetyRes.json();
    assert(safetyData.safety);
    assert(typeof safetyData.safety.verificationLevel === 'number');
    console.log('  ✅ GET /api/guilds/:guildId/safety returned Discord safety & moderation configuration.');

    // 13. Test PATCH /api/guilds/:guildId/safety/settings
    const patchSafetyRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/safety/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verificationLevel: 2,
        explicitContentFilter: 2,
        defaultMessageNotifications: 1
      })
    });
    assert.strictEqual(patchSafetyRes.status, 200);
    const patchSafetyData = await patchSafetyRes.json();
    assert.strictEqual(patchSafetyData.safety.verificationLevel, 2);
    assert.strictEqual(patchSafetyData.safety.explicitContentFilter, 2);
    console.log('  ✅ PATCH /api/guilds/:guildId/safety/settings updated server safety settings.');

    // 14. Test GET /api/guilds/:guildId/roles
    const rolesRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/roles`);
    assert.strictEqual(rolesRes.status, 200);
    const rolesData = await rolesRes.json();
    assert(rolesData.roles && rolesData.roles.length > 0);
    console.log(`  ✅ GET /api/guilds/:guildId/roles returned ${rolesData.roles.length} manageable roles.`);

    // 15. Test GET /api/guilds/:guildId/safety/automod
    const automodRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/safety/automod`);
    assert.strictEqual(automodRes.status, 200);
    const automodData = await automodRes.json();
    assert(Array.isArray(automodData.rules));
    console.log(`  ✅ GET /api/guilds/:guildId/safety/automod returned ${automodData.rules.length} AutoMod rules.`);

    // 16. Test POST /api/guilds/:guildId/safety/automod (Create Rule)
    const createRuleRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/safety/automod`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '🧪 Test Scam Link Filter',
        eventType: 1,
        triggerType: 1,
        triggerMetadata: {
          keywordFilter: ['*scam-site.test*', '*free-nitro-fake*'],
          regexPatterns: [],
          allowList: []
        },
        actions: [
          { type: 1, metadata: { customMessage: 'Blocked test scam link.' } }
        ],
        enabled: true
      })
    });
    assert.strictEqual(createRuleRes.status, 201);
    const createRuleData = await createRuleRes.json();
    assert(createRuleData.success);
    assert.strictEqual(createRuleData.rule.name, '🧪 Test Scam Link Filter');
    const createdRuleId = createRuleData.rule.id;
    console.log(`  ✅ POST /api/guilds/:guildId/safety/automod created new AutoMod rule: ${createdRuleId}.`);

    // 17. Test PATCH /api/guilds/:guildId/safety/automod/:ruleId (Toggle & Edit)
    const editRuleRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/safety/automod/${createdRuleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: false,
        name: '🧪 Updated Test Scam Link Filter'
      })
    });
    assert.strictEqual(editRuleRes.status, 200);
    const editRuleData = await editRuleRes.json();
    assert.strictEqual(editRuleData.rule.enabled, false);
    assert.strictEqual(editRuleData.rule.name, '🧪 Updated Test Scam Link Filter');
    console.log('  ✅ PATCH /api/guilds/:guildId/safety/automod/:ruleId toggled and updated rule on Discord.');

    // 18. Test DELETE /api/guilds/:guildId/safety/automod/:ruleId
    const delRuleRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/safety/automod/${createdRuleId}`, {
      method: 'DELETE'
    });
    assert.strictEqual(delRuleRes.status, 200);
    console.log('  ✅ DELETE /api/guilds/:guildId/safety/automod/:ruleId deleted rule from Discord.');

    // 19. Test POST /api/guilds/:guildId/simulate/automod
    const simAutoModRes = await fetch(`${baseUrl}/api/guilds/${targetGuildId}/simulate/automod`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ruleName: '🛡️ Block Scam Links & Malicious URLs',
        triggerType: 1,
        username: 'SimulatedBadActor',
        content: 'Free nitro at scam-test.ru!',
        matchedKeyword: 'scam-test.ru',
        actionType: 1
      })
    });
    assert.strictEqual(simAutoModRes.status, 200);
    const simAutoModData = await simAutoModRes.json();
    assert(simAutoModData.success);
    assert.strictEqual(simAutoModData.incident.matchedKeyword, 'scam-test.ru');
    console.log('  ✅ POST /api/guilds/:guildId/simulate/automod triggered live incident event.');

    // 20. Test Multi-Page App (MPA) Routes
    const pages = [
      { path: '/', title: 'Invite Tracker & Overview' },
      { path: '/analytics', title: 'Invite Analytics' },
      { path: '/leaderboard', title: 'Invite Leaderboard' },
      { path: '/codes', title: 'Active Invite Codes & Labels' },
      { path: '/safety', title: 'Safety & AutoMod Control Center' },
      { path: '/simulator', title: 'WebSocket Simulator' },
      { path: '/settings', title: 'Settings & Bot Status' }
    ];

    for (const page of pages) {
      const res = await fetch(`${baseUrl}${page.path}`);
      assert.strictEqual(res.status, 200, `Expected 200 for ${page.path}`);
      const html = await res.text();
      assert.ok(html.includes(page.title), `Page ${page.path} should contain title '${page.title}'`);
      assert.ok(html.includes('/js/shared.js'), `Page ${page.path} should load shared.js`);
    }
    console.log('  ✅ GET / and all MPA page routes (including /safety) serve correct HTML files.');

    // 21. Test 404 Route
    const notFoundRes = await fetch(`${baseUrl}/some-nonexistent-route-12345`);
    assert.strictEqual(notFoundRes.status, 404);
    const notFoundHtml = await notFoundRes.text();
    assert.ok(notFoundHtml.includes('404 Page Not Found'));
    console.log('  ✅ Unhandled routes correctly return 404.html with status 404.');

    // 22. Test static assets
    const cssRes = await fetch(`${baseUrl}/css/dashboard.css`);
    assert.strictEqual(cssRes.status, 200);
    const sharedJsRes = await fetch(`${baseUrl}/js/shared.js`);
    assert.strictEqual(sharedJsRes.status, 200);
    console.log('  ✅ Static CSS and shared JS assets serve with status 200.');

    console.log('✨ All Dashboard API, Safety & Multi-Page Tests Passed Successfully!\n');
  } finally {
    server.close();
  }
}

module.exports = testApiEndpoints;

if (require.main === module) {
  testApiEndpoints().catch(err => {
    console.error('❌ API Test Failed:', err);
    process.exit(1);
  });
}
