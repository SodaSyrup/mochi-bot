const { MessageFlags } = require('discord.js');
const { TestSuite, assert } = require('./helpers/harness');
const { buildHoneypotBanner, normalizeKicks } = require('../src/bot/services/honeypotBanner');
const { DiscordHoneypotGateway } = require('../src/platform/discord/discordHoneypotGateway');

function jsonPayload(payload) {
  return payload.components.map((component) => component.toJSON());
}

function createDiscordFixture({ existing = null } = {}) {
  const sent = [];
  const guild = {
    members: { me: { permissions: { has: () => true } } },
    channels: { cache: new Map() },
  };
  const channel = {
    guild,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    messages: {
      fetch: async (messageId) => (existing && messageId === existing.id ? existing : null),
    },
    send: async (payload) => {
      const message = {
        id: `banner-${sent.length + 1}`,
        payload,
        pinned: false,
        async pin() { this.pinned = true; },
      };
      sent.push(message);
      return message;
    },
  };
  guild.channels.cache.set('channel-1', channel);

  const client = {
    user: { displayAvatarURL: () => 'https://cdn.example/honeypot.png' },
    guilds: { cache: new Map([['guild-1', guild]]) },
  };
  return { client, channel, sent, guild };
}

async function runHoneypotBannerTests() {
  const suite = new TestSuite('Honeypot banner');

  suite.test('builds a Components V2 container with thumbnail and disabled counter', () => {
    const payload = buildHoneypotBanner({ kicks: 67, thumbnailUrl: 'https://cdn.example/honey.png' });
    const [container] = jsonPayload(payload);
    const section = container.components[0];
    const counter = container.components[1].components[0];

    assert.strictEqual(payload.flags, MessageFlags.IsComponentsV2);
    assert.strictEqual(container.type, 17);
    assert.strictEqual(section.type, 9);
    assert.strictEqual(section.components[0].content, '## DO NOT SEND MESSAGES IN THIS CHANNEL');
    assert.strictEqual(section.accessory.media.url, 'https://cdn.example/honey.png');
    assert.strictEqual(counter.label, 'Kicks: 67');
    assert.strictEqual(counter.custom_id, 'honeypot:kicks-counter');
    assert.strictEqual(counter.disabled, true);
  });

  suite.test('normalizes invalid kick counts safely', () => {
    assert.strictEqual(normalizeKicks(-3), 0);
    assert.strictEqual(normalizeKicks('4.9'), 4);
    assert.strictEqual(normalizeKicks('not-a-number'), 0);
    assert.strictEqual(normalizeKicks(Infinity), 0);
  });

  suite.testAsync('creates and pins a Components V2 banner', async () => {
    const fixture = createDiscordFixture();
    const gateway = new DiscordHoneypotGateway({ client: fixture.client });
    const banner = await gateway.ensureBanner({ guildId: 'guild-1', channelId: 'channel-1', kicks: 0 });

    assert.strictEqual(banner.id, 'banner-1');
    assert.strictEqual(fixture.sent.length, 1);
    assert.strictEqual(fixture.sent[0].pinned, true);
    assert.strictEqual(fixture.sent[0].payload.flags, MessageFlags.IsComponentsV2);
    assert.strictEqual(fixture.sent[0].payload.components[0].toJSON().components[1].components[0].label, 'Kicks: 0');
  });

  suite.testAsync('converts an existing legacy banner in place', async () => {
    const existing = {
      id: 'legacy-banner',
      edits: [],
      async edit(payload) { this.edits.push(payload); return this; },
    };
    const fixture = createDiscordFixture({ existing });
    const gateway = new DiscordHoneypotGateway({ client: fixture.client });
    const banner = await gateway.ensureBanner({
      guildId: 'guild-1',
      channelId: 'channel-1',
      current: { channel_id: 'channel-1', banner_message_id: existing.id },
      kicks: 12,
    });

    assert.strictEqual(banner, existing);
    assert.strictEqual(fixture.sent.length, 0);
    assert.strictEqual(existing.edits.length, 1);
    assert.strictEqual(existing.edits[0].content, null);
    assert.deepStrictEqual(existing.edits[0].embeds, []);
    assert.strictEqual(existing.edits[0].flags, MessageFlags.IsComponentsV2);
    assert.strictEqual(existing.edits[0].components[0].toJSON().components[1].components[0].label, 'Kicks: 12');
  });

  suite.testAsync('updates the existing banner without sending another message', async () => {
    const existing = {
      id: 'banner-1',
      edits: [],
      async edit(payload) { this.edits.push(payload); return this; },
    };
    const fixture = createDiscordFixture({ existing });
    const gateway = new DiscordHoneypotGateway({ client: fixture.client });
    await gateway.updateBanner({ guild_id: 'guild-1', channel_id: 'channel-1', banner_message_id: existing.id, kicks: 8 });

    assert.strictEqual(fixture.sent.length, 0);
    assert.strictEqual(existing.edits.length, 1);
    assert.strictEqual(existing.edits[0].components[0].toJSON().components[1].components[0].label, 'Kicks: 8');
  });

  return suite.run();
}

runHoneypotBannerTests();
