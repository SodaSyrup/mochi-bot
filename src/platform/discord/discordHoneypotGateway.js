const { PermissionFlagsBits } = require('discord.js');
const { buildHoneypotEmbed } = require('../../bot/services/honeypotBanner');
const { DEFAULTS } = require('../../config/defaults');

/** Discord adapter for honeypot channel banners and softbans. */
class DiscordHoneypotGateway {
  constructor({ client, logger }) {
    this.client = client;
    this.logger = logger;
  }

  #guild(guildId) {
    return this.client?.guilds?.cache?.get(guildId) || null;
  }

  #channel(guildId, channelId) {
    const guild = this.#guild(guildId);
    return guild?.channels?.cache?.get(channelId) || null;
  }

  #assertPermissions(channel) {
    if (!channel?.isTextBased?.()) throw new Error('Honeypot channel must be a text channel.');

    const me = channel.guild?.members?.me;
    const permissions = channel.permissionsFor?.(me);
    if (!permissions?.has(PermissionFlagsBits.ViewChannel) ||
        !permissions.has(PermissionFlagsBits.SendMessages) ||
        !permissions.has(PermissionFlagsBits.EmbedLinks)) {
      throw new Error('Bot needs View Channel, Send Messages, and Embed Links in the honeypot channel.');
    }

    if (!me?.permissions?.has(PermissionFlagsBits.BanMembers)) {
      throw new Error('Bot needs Ban Members permission to operate the honeypot.');
    }
  }

  async getPermissionStatus(guildId, channelId) {
    const guild = this.#guild(guildId);
    const channel = this.#channel(guildId, channelId);
    const me = guild?.members?.me;
    const channelPermissions = channel?.permissionsFor?.(me);
    const hasChannel = (permission) => Boolean(channelPermissions?.has(permission));

    return {
      viewChannel: hasChannel(PermissionFlagsBits.ViewChannel),
      sendMessages: hasChannel(PermissionFlagsBits.SendMessages),
      embedLinks: hasChannel(PermissionFlagsBits.EmbedLinks),
      banMembers: Boolean(me?.permissions?.has(PermissionFlagsBits.BanMembers)),
    };
  }

  async ensureBanner({ guildId, channelId, current, kicks }) {
    const channel = this.#channel(guildId, channelId);
    this.#assertPermissions(channel);

    let banner = null;
    if (current?.channel_id === channelId && current.banner_message_id) {
      banner = await channel.messages.fetch(current.banner_message_id).catch(() => null);
    }

    if (banner) {
      await banner.edit({ embeds: [buildHoneypotEmbed(kicks)] });
    } else {
      banner = await channel.send({ embeds: [buildHoneypotEmbed(kicks)] });
      await Promise.resolve(banner.pin?.()).catch(() => {});
    }

    return banner;
  }

  async updateBanner(config) {
    const channel = this.#channel(config.guild_id, config.channel_id);
    if (!channel?.isTextBased?.() || !config.banner_message_id) return;

    const banner = await channel.messages.fetch(config.banner_message_id).catch(() => null);
    if (banner) await banner.edit({ embeds: [buildHoneypotEmbed(config.kicks)] });
  }

  async removeBanner(config) {
    const channel = this.#channel(config.guild_id, config.channel_id);
    if (!channel?.isTextBased?.() || !config.banner_message_id) return;
    const banner = await channel.messages.fetch(config.banner_message_id).catch(() => null);
    await Promise.resolve(banner?.delete?.()).catch(() => {});
  }

  async softBan(message) {
    const guild = message.guild;
    if (!guild?.members?.ban || !guild.members.unban) throw new Error('Guild moderation APIs are unavailable.');

    const reason = 'Honeypot triggered: message sent in the protected channel';
    await guild.members.ban(message.author.id, {
      deleteMessageSeconds: DEFAULTS.honeypot.softBanDeleteMessageSeconds,
      reason,
    });

    // A ban followed immediately by an unban removes the user and their
    // recent messages without leaving a permanent ban: a Discord softban.
    await guild.members.unban(message.author.id, reason);
  }
}

module.exports = { DiscordHoneypotGateway };
