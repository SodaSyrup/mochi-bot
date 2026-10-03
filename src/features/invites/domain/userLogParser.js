const TYPES = { 'member joined': 'JOIN', 'member left': 'LEAVE', 'member roles updated': 'SNAPSHOT', 'member updated': 'SNAPSHOT' };

function readTime(value) {
  const text = (value || '').replace(/^[`*]+|[`*]+$/g, '').trim();
  const timestamp = text.match(/^<t:(\d{1,12})(?::[tTdDfFR])?>$/);
  if (timestamp) return Number(timestamp[1]) * 1000;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) ? Date.parse(text) : NaN;
}

/** Each embed is separate evidence, even when a message contains several. */
function parseUserLogMessage(message, members, options = {}) {
  const entries = [];
  const skipped = [];
  for (const [index, embed] of (message.embeds || []).entries()) {
    const eventType = TYPES[embed.title?.trim().toLowerCase()];
    if (!eventType) continue;
    const parsed = parseEmbed(message, embed, eventType, members, options);
    const sourceEntryKey = `embed:${index}`;
    if (parsed.reason) skipped.push({ messageId: message.id, sourceEntryKey, reason: parsed.reason });
    else entries.push({ ...parsed, sourceEntryKey });
  }
  if (!entries.length && !skipped.length) return { reason: 'No supported member join, leave, or update embed was found.' };
  return { entries, skipped };
}

function parseEmbed(message, embed, eventType, members, { unknownInviterId = null } = {}) {
  const fields = new Map();
  for (const field of embed.fields || []) {
    const name = field.name.replace(/[*`]/g, '').trim().replace(/:$/, '').toLowerCase();
    if (fields.has(name)) return { reason: 'The embed has duplicate fields.' };
    fields.set(name, field.value.trim());
  }
  const userId = (fields.get('user id') || '').replace(/[`*]/g, '').trim();
  if (!/^\d{17,20}$/.test(userId)) return { reason: 'The User ID field does not contain one Discord user ID.' };
  const userMention = (fields.get('user') || '').match(/<@!?(\d{17,20})>/);
  if (userMention && userMention[1] !== userId) return { reason: 'The User and User ID fields conflict.' };
  // Updated By is a different person. Never use it as the inviter.
  const invitedBy = (fields.get('invited by') || '').replace(/^[`*]+|[`*]+$/g, '').trim();
  const unknownInviter = /^(?:unknown|unkown)(?: user)?$/i.test(invitedBy);
  if ((unknownInviter && !unknownInviterId) || /^(?:none|n\/a|not found|not tracked|vanity(?: url)?)$/i.test(invitedBy)) {
    return { reason: 'The user log has no recorded inviter.' };
  }
  const mention = invitedBy.match(/^<@!?(\d{17,20})>$/);
  const rawId = /^\d{17,20}$/.test(invitedBy) ? invitedBy : null;
  const named = members.filter((member) => !member.bot && (member.username === invitedBy || member.legacyUsername === invitedBy));
  const inviterId = unknownInviter ? unknownInviterId : mention?.[1] || rawId || (named.length === 1 ? named[0].id : null);
  if (!inviterId) return { reason: 'The Invited By field has no user ID or unique server username.' };
  if (inviterId === userId) return { reason: 'Self-invites are not imported.' };
  if (members.some((member) => member.id === userId && member.bot)) return { reason: 'Bot members are not imported.' };
  const joinedMs = readTime(fields.get('joined at') || fields.get('joined'));
  const updatedMs = readTime(fields.get('updated at'));
  const embedMs = embed.timestamp ? Date.parse(embed.timestamp) : NaN;
  const observedMs = Number.isFinite(updatedMs) ? updatedMs : Number.isFinite(embedMs) ? embedMs : Number(message.editedTimestamp || message.createdTimestamp);
  const occurredMs = eventType === 'JOIN' ? joinedMs : eventType === 'LEAVE' ? readTime(fields.get('left at')) : observedMs;
  if (!Number.isFinite(joinedMs) || !Number.isFinite(occurredMs) || joinedMs > occurredMs || occurredMs > Date.now()) {
    return { reason: 'Joined At (or Joined) and the event time must contain valid exact timestamps. Relative text alone cannot identify a membership period.' };
  }
  return { userId, inviterId, eventType, joinedAt: new Date(joinedMs).toISOString(),
    occurredAt: new Date(occurredMs).toISOString(), messageId: message.id,
    memberName: null, inviterName: unknownInviter || mention || rawId ? null : invitedBy,
    assumedInviter: unknownInviter };
}

module.exports = { parseUserLogMessage };
