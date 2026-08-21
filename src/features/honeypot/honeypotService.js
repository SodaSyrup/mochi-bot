const { AppError, ExternalServiceError } = require('../../dashboard/errors');
const { HoneypotEvents } = require('../../app/eventBus');

/**
 * Coordinates persistent honeypot state with Discord moderation operations.
 * Discord-specific objects and API calls stay inside the gateway.
 */
class HoneypotService {
  constructor({ honeypotRepository, honeypotGateway, eventBus, logger }) {
    this.repository = honeypotRepository;
    this.gateway = honeypotGateway;
    this.eventBus = eventBus;
    this.logger = logger || console;
    this.queues = new Map();
  }

  get(guildId) {
    return this.repository.get(guildId);
  }

  async getDashboard(guildId) {
    const honeypot = this.repository.get(guildId);
    if (!honeypot) return { honeypot: null, recentKicks: [], permissions: null };

    let permissions = null;
    try {
      permissions = await this.gateway.getPermissionStatus(guildId, honeypot.channel_id);
    } catch (error) {
      this.logger.warn?.('honeypot', 'getDashboard', `Could not inspect honeypot permissions for guild ${guildId}`, { guildId, error });
    }

    return {
      honeypot,
      recentKicks: this.repository.getRecentKicks(guildId, honeypot.channel_id),
      permissions,
    };
  }

  async configure({ guildId, channelId }) {
    const existing = this.repository.get(guildId);

    try {
      const banner = await this.gateway.ensureBanner({
        guildId,
        channelId,
        current: existing,
        kicks: existing?.channel_id === channelId ? existing.kicks : 0,
      });

      return this.repository.setChannel({
        guildId,
        channelId,
        bannerMessageId: banner.id,
      });
    } catch (error) {
      this.#logGatewayError('configure', guildId, error);
      if (error instanceof AppError) throw error;
      throw new ExternalServiceError('Could not configure the honeypot. Check the bot permissions for that channel.');
    }
  }

  async disable(guildId) {
    const existing = this.repository.get(guildId);
    if (!existing) return null;

    try {
      await this.gateway.removeBanner(existing);
    } catch (error) {
      // Disabling should still work if the banner was manually deleted.
      this.logger.warn?.('honeypot', 'disable', `Could not remove honeypot banner in guild ${guildId}`, { guildId, error });
    }
    return this.repository.disable(guildId);
  }

  /**
   * Process one Discord message. Messages are serialized per guild so two
   * simultaneous triggers cannot overwrite the visible counter.
   */
  async handleMessage(message) {
    const guildId = message.guildId || message.guild?.id;
    if (!guildId || !message.channelId) return null;

    const config = this.repository.get(guildId);
    if (!config || config.channel_id !== message.channelId) return null;

    const queueKey = `${guildId}:${config.channel_id}`;
    const previous = this.queues.get(queueKey) || Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(() => this.#punishAndCount(message, config));
    this.queues.set(queueKey, operation);

    try {
      return await operation;
    } finally {
      if (this.queues.get(queueKey) === operation) this.queues.delete(queueKey);
    }
  }

  async #punishAndCount(message, config) {
    try {
      await this.gateway.softBan(message);
      const guildId = message.guildId || message.guild.id;
      const updated = this.repository.recordKick({
        guildId,
        channelId: config.channel_id,
        userId: message.author.id,
        username: message.author.username || message.author.tag || null,
        occurredAt: new Date().toISOString(),
      });
      await this.gateway.updateBanner(updated);
      this.eventBus?.emit(HoneypotEvents.Triggered, {
        guildId: updated.guild_id,
        channelId: updated.channel_id,
        userId: message.author.id,
        username: message.author.username || message.author.tag || null,
        kicks: updated.kicks,
        occurredAt: new Date().toISOString(),
      });
      return updated;
    } catch (error) {
      this.#logGatewayError('handleMessage', message.guildId || message.guild?.id, error);
      return null;
    }
  }

  #logGatewayError(operation, guildId, error) {
    this.logger.error?.('honeypot', operation, `Honeypot operation failed for guild ${guildId}`, {
      guildId,
      error,
    });
  }
}

module.exports = { HoneypotService };
