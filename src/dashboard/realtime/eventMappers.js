const { InviteEvents, SafetyEvents, HoneypotEvents } = require('../../app/eventBus');

/**
 * Realtime transport DTO mappers.
 *
 * The Socket.IO gateway forwards CANONICAL application events to authorized
 * guild rooms. These mappers are the single documented translation between an
 * application event and the transport payload a frontend client receives.
 *
 * Each mapper whitelists exactly the fields a guild client needs — never raw
 * Error objects, Discord.js entities, DB rows, or session/OAuth material.
 * Payloads are plain JSON-safe objects.
 */

function pickMember(member) {
  if (!member) return null;
  return {
    id: member.id,
    username: member.username || `User_${String(member.id).slice(-4)}`,
    avatar: member.avatar || null,
  };
}

function pickAttribution(attribution) {
  if (!attribution) return null;
  return {
    type: attribution.type || 'UNKNOWN',
    inviterId: attribution.inviterId ?? null,
    inviteCode: attribution.inviteCode ?? null,
  };
}

function pickInviter(inviter) {
  if (!inviter) return null;
  return {
    id: inviter.id,
    username: inviter.username || null,
    avatar: inviter.avatar || null,
  };
}

function pickStats(stats) {
  if (!stats) return null;
  return {
    regular: stats.regular || 0,
    bonus: stats.bonus || 0,
    leaves: stats.leaves || 0,
    fake: stats.fake || 0,
    total: stats.total || 0,
  };
}

function mapMemberEvent(event) {
  return {
    guildId: event.guildId,
    member: pickMember(event.member),
    attribution: pickAttribution(event.attribution),
    inviter: pickInviter(event.inviter),
    isFake: Boolean(event.isFake),
    inviterStats: pickStats(event.inviterStats),
    occurredAt: event.occurredAt || new Date().toISOString(),
  };
}

function mapInviteCreatedEvent(event) {
  const invite = event.invite || {};
  return {
    guildId: event.guildId,
    invite: {
      code: invite.code || '',
      url: invite.url || null,
      uses: invite.uses || 0,
      maxUses: invite.maxUses || 0,
      maxAge: invite.maxAge || 0,
      temporary: Boolean(invite.temporary),
      channelId: invite.channelId || null,
      channelName: invite.channelName || null,
      inviter: pickInviter(invite.inviter),
      createdAt: invite.createdAt || null,
      label: invite.label || null,
    },
    occurredAt: event.occurredAt || new Date().toISOString(),
  };
}

function mapInviteDeletedEvent(event) {
  return {
    guildId: event.guildId,
    code: event.code,
    occurredAt: event.occurredAt || new Date().toISOString(),
  };
}

function mapLabelUpdatedEvent(event) {
  return {
    guildId: event.guildId,
    code: event.code,
    label: event.label || null,
    channelId: event.channelId || null,
    channelName: event.channelName || null,
    occurredAt: event.occurredAt || new Date().toISOString(),
  };
}

function mapAutoModExecutionEvent(event) {
  return {
    guildId: event.guildId,
    guildName: event.guildName || null,
    ruleId: event.ruleId || null,
    ruleName: event.ruleName || null,
    ruleTriggerType: event.ruleTriggerType ?? null,
    action: event.action || null,
    userId: event.userId || null,
    user: pickMember(event.user),
    channelId: event.channelId || null,
    channelName: event.channelName || null,
    messageId: event.messageId || null,
    content: event.content || '',
    matchedKeyword: event.matchedKeyword || null,
    matchedContent: event.matchedContent || null,
    executedAt: event.executedAt || new Date().toISOString(),
  };
}

function mapRuleUpdatedEvent(event) {
  return {
    guildId: event.guildId,
    action: event.action,
    ruleId: event.ruleId,
    name: event.name || null,
    enabled: event.enabled ?? null,
  };
}

function mapHoneypotTriggeredEvent(event) {
  return {
    guildId: event.guildId,
    channelId: event.channelId || null,
    userId: event.userId || null,
    username: event.username || null,
    kicks: Number(event.kicks || 0),
    occurredAt: event.occurredAt || new Date().toISOString(),
  };
}

/**
 * Map of canonical application event -> transport mapper.
 * Only events listed here are ever forwarded to clients.
 */
const EVENT_MAPPERS = Object.freeze({
  [InviteEvents.MemberJoined]: mapMemberEvent,
  [InviteEvents.MemberLeft]: mapMemberEvent,
  [InviteEvents.InviteCreated]: mapInviteCreatedEvent,
  [InviteEvents.InviteDeleted]: mapInviteDeletedEvent,
  [InviteEvents.LabelUpdated]: mapLabelUpdatedEvent,
  [SafetyEvents.AutoModExecution]: mapAutoModExecutionEvent,
  [SafetyEvents.AutoModRuleUpdated]: mapRuleUpdatedEvent,
  [HoneypotEvents.Triggered]: mapHoneypotTriggeredEvent,
});

function mapApplicationEvent(appEvent, data) {
  const mapper = EVENT_MAPPERS[appEvent];
  if (!mapper) return data;
  return mapper(data);
}

module.exports = {
  EVENT_MAPPERS,
  mapApplicationEvent,
  mapMemberEvent,
  mapInviteCreatedEvent,
  mapInviteDeletedEvent,
  mapLabelUpdatedEvent,
  mapAutoModExecutionEvent,
  mapRuleUpdatedEvent,
  mapHoneypotTriggeredEvent,
};
