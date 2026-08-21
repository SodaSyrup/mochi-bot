const { buildHoneypotEmbed } = require('../bot/services/honeypotBanner');

/** No-op gateway that keeps the demo composition root feature-complete. */
class DemoHoneypotGateway {
  constructor() {
    this.messages = new Map();
    this.actions = [];
    this.nextId = 1;
  }

  async ensureBanner({ guildId, channelId, kicks }) {
    const id = `demo-honeypot-${this.nextId++}`;
    this.messages.set(id, { guildId, channelId, embeds: [buildHoneypotEmbed(kicks)] });
    return { id };
  }

  async updateBanner(config) {
    const banner = this.messages.get(config.banner_message_id);
    if (banner) banner.embeds = [buildHoneypotEmbed(config.kicks)];
  }

  async getPermissionStatus() {
    return {
      viewChannel: true,
      sendMessages: true,
      embedLinks: true,
      banMembers: true,
    };
  }

  async removeBanner(config) {
    this.messages.delete(config.banner_message_id);
  }

  async softBan(message) {
    this.actions.push({ type: 'softban', guildId: message.guildId, userId: message.author?.id });
  }
}

module.exports = { DemoHoneypotGateway };
