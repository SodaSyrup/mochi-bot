const { InviteEvents } = require('../../../app/eventBus');
const { AttributionType } = require('../../invites/domain/attribution');

/**
 * Escape a username before embedding it in Discord markdown so Discord-controlled
 * strings can never break formatting, form custom timestamps, or trigger role /
 * channel / user mentions.
 */
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

/**
 * Invite-logs application service.
 *
 * Human join/leave logging consumes the canonical InviteEvents published by
 * InviteService — this service NEVER re-derives attribution or invite totals.
 * Bot add/remove logging is entirely separate: bots never enter the invite
 * ledger, and bot-adder attribution comes from the Discord audit log and is
 * persisted in bot_attributions.
 *
 * This service is secondary infrastructure. Every failure (missing channel,
 * send error, audit-log error) is logged and swallowed so invite tracking is
 * never rolled back or made to look like it failed.
 */
class InviteLogService {
  constructor({ guildRepository, inviteLogRepository, inviteLogGateway, eventBus, logger }) {
    this.guilds = guildRepository;
    this.repo = inviteLogRepository;
    this.gateway = inviteLogGateway;
    this.eventBus = eventBus;
    this.logger = logger || console;

    if (this.eventBus) {
      this.eventBus.on(InviteEvents.MemberJoined, (event) => {
        void this.handleMemberJoined(event).catch((err) => {
          this.#log('handleMemberJoined', 'Invite log handler failed', { guildId: event?.guildId, error: err, level: 'error' });
        });
      });
      this.eventBus.on(InviteEvents.MemberLeft, (event) => {
        void this.handleMemberLeft(event).catch((err) => {
          this.#log('handleMemberLeft', 'Invite log handler failed', { guildId: event?.guildId, error: err, level: 'error' });
        });
      });
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
    const channelId = this.#channelId(event.guildId);
    if (!channelId) return;

    const memberName = usernameLabel(event.member?.username, event.member?.id);
    const type = event.attribution?.type;

    let content;
    if (type === AttributionType.INVITE) {
      const inviterName = usernameLabel(event.inviter?.username, event.attribution?.inviterId);
      const total = event.inviterStats?.total ?? 0;
      content = `**${memberName}** joined and they were invited by **${inviterName}**. **${inviterName}** now has **${total} invite${total === 1 ? '' : 's'}**.`;
    } else if (type === AttributionType.VANITY) {
      content = `**${memberName}** joined via the server vanity URL.`;
    } else if (type === AttributionType.RECONCILED) {
      // Reconciled members are recorded without a live event; this
      // branch is defensive and must never produce startup spam.
      return;
    } else {
      content = `**${memberName}** joined, but I couldn't determine who invited them.`;
    }

    await this.gateway.sendMessage(event.guildId, channelId, content);
  }

  async handleMemberLeft(event) {
    if (!event?.guildId) return;
    const channelId = this.#channelId(event.guildId);
    if (!channelId) return;

    const memberName = usernameLabel(event.member?.username, event.member?.id);
    const type = event.attribution?.type;

    let content;
    if (type === AttributionType.INVITE && event.attribution?.inviterId) {
      const inviterName = usernameLabel(event.inviter?.username, event.attribution?.inviterId);
      content = `**${memberName}** left. They were invited by **${inviterName}**.`;
    } else if (type === AttributionType.VANITY) {
      content = `**${memberName}** left. They originally joined via the server vanity URL.`;
    } else {
      content = `**${memberName}** left. I don't have a recorded inviter for them.`;
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

    const botName = usernameLabel(memberData.username, memberData.id);
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
      const adderName = usernameLabel(adder.username, adder.id);
      content = `🤖 **${botName}** was added to this server by **${adderName}**.`;
    } else {
      content = `🤖 **${botName}** was added to this server, but I couldn't determine who added it.`;
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

    const botName = usernameLabel(memberData.username, memberData.id);
    const stored = this.repo.getBotAttribution(memberData.guildId, memberData.id);

    let content;
    if (stored?.added_by_user_id) {
      const adderName = usernameLabel(stored.added_by_username, stored.added_by_user_id);
      content = `🤖 **${botName}** has been removed from this server. It was added by **${adderName}**.`;
    } else {
      content = `🤖 **${botName}** has been removed from this server. I don't have a recorded adder for it.`;
    }

    await this.gateway.sendMessage(memberData.guildId, channelId, content);
  }
}

module.exports = { InviteLogService };
