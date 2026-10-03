const { AuditLogEvent, PermissionFlagsBits, GatewayIntentBits } = require('discord.js');
const { ValidationError, ExternalServiceError } = require('../../dashboard/errors');
const { DEFAULTS } = require('../../config/defaults');

const {
  botAddFreshnessMs: BOT_ADD_FRESHNESS_MS,
  auditAttempts: AUDIT_ATTEMPTS,
  auditRetryDelayMs: AUDIT_RETRY_DELAY_MS,
  auditBatchLimit: AUDIT_BATCH_LIMIT,
} = DEFAULTS.operations;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sends invite logs and looks up bot additions in the Discord audit log. */
class DiscordInviteLogGateway {
  constructor({ client, logger }) {
    this.client = client;
    this.logger = logger || console;
  }

  /** Fetch a bounded history. Filter by immutable bot ID, never by author name. */
  async fetchImportMessages(guildId, channelId, sourceBotId, { limit = 1000, before = undefined, onProgress = () => {} } = {}) {
    const guild = this.client?.guilds?.cache?.get(guildId);
    if (!guild) throw new ExternalServiceError('Mochi is not connected to this server.');
    if (!this.client.options.intents.has(GatewayIntentBits.MessageContent)) {
      throw new ValidationError('Enable the Message Content intent before importing invite logs.');
    }
    let channel;
    try {
      channel = await guild.channels.fetch(channelId);
    } catch {
      throw new ExternalServiceError('Could not fetch the invite log channel.');
    }
    if (!channel?.isTextBased() || !channel.messages || channel.guildId !== guildId) {
      throw new ValidationError('The invite log channel must be a text channel in this server.');
    }
    const permissions = channel.permissionsFor(guild.members.me);
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
      throw new ValidationError('Mochi needs View Channel and Read Message History in the invite log channel.');
    }
    const messages = [];
    let scanned = 0;
    let cursor = before;
    let exhausted = false;
    try {
      while (scanned < limit) {
        const batchLimit = Math.min(100, limit - scanned);
        const batch = await channel.messages.fetch({ limit: batchLimit, before: cursor, cache: false });
        if (batch.size === 0) { exhausted = true; break; }
        scanned += batch.size;
        onProgress(scanned);
        for (const message of batch.values()) {
          if (message.author?.id === sourceBotId && message.author.bot && !message.webhookId) {
            messages.push({ id: message.id, content: message.content, embeds: message.embeds.map((embed) => embed.toJSON()), createdTimestamp: message.createdTimestamp, editedTimestamp: message.editedTimestamp });
          }
        }
        const next = [...batch.keys()].reduce((a, b) => BigInt(a) < BigInt(b) ? a : b);
        if (next === cursor) throw new Error('History cursor did not advance.');
        cursor = next;
        if (batch.size < batchLimit) { exhausted = true; break; }
      }
    } catch (error) {
      this.logger.warn('inviteLogs', 'importHistory', 'Could not read invite log history.', { guildId, channelId, error });
      throw new ExternalServiceError('Could not read invite log history. Try the preview again.');
    }
    return { messages, scanned, nextBefore: exhausted ? null : cursor, exhausted };
  }

  /**
   * Send a plain message to a guild channel. User mention syntax is rendered
   * as a clickable reference, while allowedMentions prevents notifications.
   * @returns {Promise<boolean>} true on success, false on any failure.
   */
  async sendMessage(guildId, channelId, content) {
    try {
      const guild = this.client?.guilds?.cache?.get(guildId);
      if (!guild) {
        this.logger.warn('inviteLogs', 'sendMessage', `Guild ${guildId} not in cache for invite log`, { guildId });
        return false;
      }

      let channel = guild.channels?.cache?.get(channelId);
      if (!channel) {
        try {
          channel = await guild.channels.fetch(channelId);
        } catch (err) {
          this.logger.warn('inviteLogs', 'sendMessage', `Invite log channel ${channelId} not found in guild ${guildId}`, {
            guildId,
            channelId,
            error: err,
          });
          return false;
        }
      }

      if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
        this.logger.warn('inviteLogs', 'sendMessage', `Invite log channel ${channelId} does not support messages in guild ${guildId}`, {
          guildId,
          channelId,
        });
        return false;
      }

      const me = guild.members?.me;
      if (me) {
        const perms = channel.permissionsFor?.(me);
        if (
          perms &&
          (!perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.SendMessages))
        ) {
          this.logger.warn('inviteLogs', 'sendMessage', `Mochi lacks View Channel / Send Messages for invite log channel ${channelId}`, {
            guildId,
            channelId,
          });
          return false;
        }
      }

      await channel.send({ content, allowedMentions: { parse: [] } });
      return true;
    } catch (err) {
      this.logger.error('inviteLogs', 'sendMessage', `Failed to send invite log message in guild ${guildId}`, {
        guildId,
        channelId,
        error: err,
      });
      return false;
    }
  }

  /**
   * Find who recently added a bot through the Discord audit log (AuditLogEvent
   * BotAdd). Conservatively rejects old unrelated entries and retries a few
   * times with short delays because audit logs can appear slightly after
   * guildMemberAdd.
   *
   * Returns a plain DTO `{ id, username }` or `null`. Never guesses: if the
   * audit log is unavailable, Mochi lacks View Audit Log, or nothing fresh
   * matches, the result is `null`.
   */
  async findRecentBotAdder(guildId, botUserId) {
    for (let attempt = 1; attempt <= AUDIT_ATTEMPTS; attempt += 1) {
      try {
        const guild = this.client?.guilds?.cache?.get(guildId);
        if (!guild) return null;

        const me = guild.members?.me;
        if (me && !me.permissions?.has?.(PermissionFlagsBits.ViewAuditLog)) {
          this.logger.warn('inviteLogs', 'findBotAdder', `Mochi lacks View Audit Log permission in guild ${guildId}; cannot resolve bot adder`, { guildId });
          return null;
        }

        const audit = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: AUDIT_BATCH_LIMIT });
        const entry = audit?.entries?.find((e) => e.target?.id === botUserId);
        if (entry) {
          const created = entry.createdTimestamp != null ? entry.createdTimestamp : entry.createdAt?.getTime();
          if (created != null && Date.now() - created > BOT_ADD_FRESHNESS_MS) {
            this.logger.warn('inviteLogs', 'findBotAdder', `Found BotAdd audit entry for ${botUserId} but it is outside the freshness window`, { guildId });
            return null;
          }
          const executor = entry.executor;
          if (!executor) return null;
          return { id: executor.id, username: executor.username || null };
        }
      } catch (err) {
        this.logger.warn('inviteLogs', 'findBotAdder', `Audit log fetch failed for guild ${guildId} (attempt ${attempt}/${AUDIT_ATTEMPTS})`, {
          guildId,
          error: err,
        });
      }

      if (attempt < AUDIT_ATTEMPTS) {
        await sleep(AUDIT_RETRY_DELAY_MS);
      }
    }
    return null;
  }
}

module.exports = { DiscordInviteLogGateway };
