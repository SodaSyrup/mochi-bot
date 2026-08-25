const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { TestSuite, assert } = require('./helpers/harness');
const {
  buildGlobalBanAlert,
  buildGlobalBanResolvedUpdate,
  globalBanButtonId,
  parseGlobalBanButtonId,
} = require('../src/bot/services/globalBanAlert');
const { interactionHandler } = require('../src/plugins/builtins/global-bans/interactionHandler');
const { OUTCOMES } = require('../src/features/globalBans/domain/outcomes');

function payloadJson(payload) {
  return payload.components.map((component) => component.toJSON?.() || component);
}

async function runGlobalBanAlertTests() {
  const suite = new TestSuite('Global-ban alerts');

  suite.test('builds an alert card with identity, reason, avatar and Ban button', () => {
    const payload = buildGlobalBanAlert({
      userId: '123456789',
      username: 'raid_account',
      globalName: 'Raid Account',
      avatarUrl: 'https://cdn.example/avatar.png',
      reason: 'Confirmed raid **account**',
    });
    const [container] = payloadJson(payload);
    const section = container.components[0];
    const button = container.components[1].components[0];

    assert.strictEqual(payload.flags, MessageFlags.IsComponentsV2);
    assert.strictEqual(container.type, 17);
    assert.strictEqual(section.accessory.media.url, 'https://cdn.example/avatar.png');
    assert.ok(section.components[1].content.includes('Raid Account'));
    assert.ok(section.components[1].content.includes('123456789'));
    assert.ok(section.components[1].content.includes('Confirmed raid \\*\\*account\\*\\*'));
    assert.strictEqual(button.custom_id, globalBanButtonId('123456789'));
    assert.strictEqual(button.label, 'Ban');
    assert.strictEqual(button.style, 4);
    assert.strictEqual(button.disabled, false);
  });

  suite.test('stale alerts disable the Ban button', () => {
    const [container] = payloadJson(buildGlobalBanAlert({ userId: '123456789', username: 'user', stale: true }));
    const button = container.components.find((component) => component.type === 1).components[0];
    assert.strictEqual(button.label, 'Ban unavailable');
    assert.strictEqual(button.disabled, true);
    assert.strictEqual(button.style, 2);
  });

  suite.test('button IDs are strictly validated', () => {
    assert.strictEqual(parseGlobalBanButtonId(globalBanButtonId('123456789')), '123456789');
    assert.strictEqual(parseGlobalBanButtonId('global-ban:ban:not-an-id'), null);
    assert.strictEqual(parseGlobalBanButtonId('other:ban:123456789'), null);
  });

  suite.test('resolved update disables the button and records moderator status', () => {
    const message = { components: payloadJson(buildGlobalBanAlert({ userId: '123456789', username: 'user' })) };
    const update = buildGlobalBanResolvedUpdate(message, { moderatorUsername: 'Mod', outcome: OUTCOMES.BANNED });
    const [container] = update.components;
    const button = container.components.find((component) => component.type === 1).components[0];

    assert.strictEqual(button.disabled, true);
    assert.strictEqual(button.label, 'Banned');
    assert.strictEqual(button.style, 3);
    assert.ok(container.components.some((component) => component.type === 10 && component.content.includes('Banned by Mod')));
  });

  suite.testAsync('button handler requires Ban Members and updates a successful alert', async () => {
    const calls = [];
    const interaction = {
      customId: globalBanButtonId('123456789'),
      guildId: 'guild-1',
      user: { id: '987654321', username: 'Moderator' },
      message: { author: { id: 'bot-1' }, components: [] },
      memberPermissions: { has: (permission) => permission === PermissionFlagsBits.BanMembers },
      isButton: () => true,
      async deferReply(options) { calls.push(['deferReply', options]); this.deferred = true; },
      async editReply(payload) { calls.push(['editReply', payload]); },
    };
    const client = {
      user: { id: 'bot-1' },
      services: {
        globalBans: { async banFromAlert(input) { calls.push(['banFromAlert', input]); return { outcome: OUTCOMES.BANNED }; } },
        globalBanGateway: { async markAlertBanned(input) { calls.push(['markAlertBanned', input]); } },
      },
    };

    await interactionHandler.execute(interaction, client);
    assert.strictEqual(calls[0][0], 'deferReply');
    assert.strictEqual(calls[1][0], 'banFromAlert');
    assert.strictEqual(calls[1][1].moderatorId, '987654321');
    assert.strictEqual(calls[2][0], 'markAlertBanned');
    assert.strictEqual(calls[3][0], 'editReply');
    assert.ok(calls[3][1].content.includes('banned'));
  });

  suite.testAsync('button handler rejects moderators without Ban Members', async () => {
    const replies = [];
    const interaction = {
      customId: globalBanButtonId('123456789'),
      guildId: 'guild-1',
      memberPermissions: { has: () => false },
      isButton: () => true,
      async reply(payload) { replies.push(payload); },
    };
    await interactionHandler.execute(interaction, { services: {} });
    assert.strictEqual(replies.length, 1);
    assert.strictEqual(replies[0].ephemeral, true);
  });

  return suite.run();
}

runGlobalBanAlertTests();
