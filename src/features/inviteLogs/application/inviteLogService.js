const { InviteEvents } = require('../../../app/eventBus');
const { AttributionType } = require('../../invites/domain/attribution');

/** Escape user-controlled text before putting it in Discord markdown. */
function escapeDiscordText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/\|/g, '\\|')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>');
}

function usernameLabel(username, userId) {
  const safe = escapeDiscordText(username);
  if (safe) return safe;
  if (userId) return `User_${String(userId).slice(-4)}`;
  return 'Unknown user';
}

/** Render a user mention when an ID is available, otherwise use the username. */
function userReference(username, userId) {
  const id = userId == null ? '' : String(userId);
  if (/^\d+$/.test(id)) return `<@${id}>`;
  return `**${usernameLabel(username, userId)}**`;
}

/** Formats invite and bot activity for the configured log channel. */
class InviteLogService {
  constructor({ guildRepository, inviteLogRepository, inviteLogGateway, eventBus, logger, subscribe = true, pluginSettings = null }) {
    this.guilds = guildRepository;
    this.repo = inviteLogRepository;
    this.gateway = inviteLogGateway;
    this.eventBus = eventBus;
    this.logger = logger || console;
    this.pluginSettings = pluginSettings;

    this.subscriptionListeners = [];
    if (this.eventBus && subscribe) {
      const joinedListener = (event) => {
        void this.handleMemberJoined(event).catch((err) => {
          this.#log('handleMemberJoined', 'Invite log handler failed', { guildId: event?.guildId, error: err, level: 'error' });
        });
      };
      const leftListener = (event) => {
        void this.handleMemberLeft(event).catch((err) => {
          this.#log('handleMemberLeft', 'Invite log handler failed', { guildId: event?.guildId, error: err, level: 'error' });
        });
      };
      this.eventBus.on(InviteEvents.MemberJoined, joinedListener);
      this.eventBus.on(InviteEvents.MemberLeft, leftListener);
      this.subscriptionListeners.push(
        [InviteEvents.MemberJoined, joinedListener],
        [InviteEvents.MemberLeft, leftListener]
      );
    }
  }

  detachSubscriptions() {
    for (const [event, listener] of this.subscriptionListeners.splice(0)) {
      this.eventBus?.off?.(event, listener);
    }
  }

  #log(operation, message, context) {
    const level = context?.level === 'error' ? 'error' : context?.level === 'warn' ? 'warn' : 'info';
    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level]('inviteLogs', operation, message, context);
    } else if (this.logger && typeof this.logger.log === 'function') {
      this.logger.log(`[inviteLogs] (${operation}) ${message}`);
    }
  }

  /** Logged channel for a guild, or null when invite logging is disabled. */
  #channelId(guildId) {
    const guild = this.guilds.getGuild(guildId);
    return guild?.invite_log_channel_id || null;
  }

  // ----------------------------------------------------------- human events

  /**
   * A human join was successfully applied by InviteService.
   * event.inviterStats.total is the canonical net invite total shown in the log.
   */
  async handleMemberJoined(event) {
    if (!event?.guildId) return;
    if (this.pluginSettings && !this.pluginSettings.isEnabled(event.guildId, 'invite-logs')) return;
    const channelId = this.#channelId(event.guildId);
    if (!channelId) return;

    const memberReference = userReference(event.member?.username, event.member?.id);
    const type = event.attribution?.type;

    let content;
    if (type === AttributionType.INVITE) {
      const inviterReference = userReference(event.inviter?.username, event.attribution?.inviterId);
      const total = event.inviterStats?.total ?? 0;
      content = `${memberReference} joined and they were invited by ${inviterReference}. ${inviterReference} now has **${total} invite${total === 1 ? '' : 's'}**.`;
    } else if (type === AttributionType.VANITY) {
      content = `${memberReference} joined through the server vanity URL.`;
    } else if (type === AttributionType.RECONCILED) {
      // Reconciled members are recorded without a live event; this
      // branch is defensive and must never produce startup spam.
      return;
    } else {
      content = `${memberReference} joined, but Mochi could not determine who invited them.`;
    }

    await this.gateway.sendMessage(event.guildId, channelId, content);
  }

  async handleMemberLeft(event) {
    if (!event?.guildId) return;
    if (this.pluginSettings && !this.pluginSettings.isEnabled(event.guildId, 'invite-logs')) return;
    const channelId = this.#channelId(event.guildId);
    if (!channelId) return;

    const memberReference = userReference(event.member?.username, event.member?.id);
    const type = event.attribution?.type;

    let content;
    if (type === AttributionType.INVITE && event.attribution?.inviterId) {
      const inviterReference = userReference(event.inviter?.username, event.attribution?.inviterId);
      content = `${memberReference} left. They were invited by ${inviterReference}.`;
    } else if (type === AttributionType.VANITY) {
      content = `${memberReference} left. They originally joined through the server vanity URL.`;
    } else {
      content = `${memberReference} left. Mochi has no recorded inviter for them.`;
    }

    await this.gateway.sendMessage(event.guildId, channelId, content);
  }

  // --------------------------------------------------------------- bot events

  /**
   * A bot was added to a guild. Resolve who added it from the audit log,
   * persist the (possibly null) attribution, and log a bot-specific message.
   */
  async handleBotJoin(memberData) {
    if (!memberData?.guildId) return;
    const channelId = this.#channelId(memberData.guildId);
    if (!channelId) return;

    const botReference = userReference(memberData.username, memberData.id);
    const adder = await this.gateway.findRecentBotAdder(memberData.guildId, memberData.id);

    // Always overwrite the current attribution. A failed resolution stores
    // NULL so a stale record from an earlier installation is never reused.
    this.repo.upsertBotAttribution({
      guildId: memberData.guildId,
      botUserId: memberData.id,
      addedByUserId: adder?.id ?? null,
      addedByUsername: adder?.username ?? null,
    });

    let content;
    if (adder?.id) {
      const adderReference = userReference(adder.username, adder.id);
      content = `🤖 ${botReference} was added to this server by ${adderReference}.`;
    } else {
      content = `🤖 ${botReference} was added to this server, but Mochi could not determine who added it.`;
    }

    await this.gateway.sendMessage(memberData.guildId, channelId, content);
  }

  /**
   * A bot was removed from a guild. Use the persisted attribution (which
   * survives restarts) to state who originally added it. Never guesses who
   * removed it.
   */
  async handleBotLeave(memberData) {
    if (!memberData?.guildId) return;
    const channelId = this.#channelId(memberData.guildId);
    if (!channelId) return;

    const botReference = userReference(memberData.username, memberData.id);
    const stored = this.repo.getBotAttribution(memberData.guildId, memberData.id);

    let content;
    if (stored?.added_by_user_id) {
      const adderReference = userReference(stored.added_by_username, stored.added_by_user_id);
      content = `🤖 ${botReference} has been removed from this server. It was added by ${adderReference}.`;
    } else {
      content = `🤖 ${botReference} has been removed from this server. Mochi has no recorded adder for it.`;
    }

    await this.gateway.sendMessage(memberData.guildId, channelId, content);
  }
}

module.exports = { InviteLogService };
