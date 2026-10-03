/** Read explicit InviteLogger statements. Totals are never imported. */
function parseInviteLoggerMessage(message, members) {
  const texts = [message.content || ''];
  for (const embed of message.embeds || []) {
    if (embed.description) texts.push(embed.description);
  }
  const matches = [];
  for (const text of texts) {
    const match = text.trim().match(/^(\*\*<@!?\d{17,20}>\*\*|<@!?\d{17,20}>|\*\*[^\n]+?\*\*)\s+(?:just\s+)?(joined|left)[.!]?\s+(?:They\s+were|They\s+originally\s+were|and\s+they\s+were)\s+invited\s+by\s+(\*\*<@!?\d{17,20}>\*\*|<@!?\d{17,20}>|\*\*[^\n]+?\*\*)(?:\s+(?:who\s+now\s+has\s+\*\*\d+\s+invites?\*\*\s*!?|now\s+has\s+\*\*\d+\s+invites?\*\*\s*[.!]?))?\s*[.!]?$/i);
    if (!match) continue;
    const resolve = (value) => {
      const reference = value.startsWith('**') ? value.slice(2, -2) : value;
      const mention = reference.match(/^<@!?(\d{17,20})>$/);
      if (mention) return { id: mention[1], name: null };
      const users = members.filter((member) => (member.username === reference || member.legacyUsername === reference) && !member.bot);
      return { id: users.length === 1 ? users[0].id : null, name: reference };
    };
    const member = resolve(match[1]);
    const inviter = resolve(match[3]);
    matches.push({ userId: member.id, memberName: member.name, eventType: match[2].toLowerCase() === 'joined' ? 'JOIN' : 'LEAVE', inviterId: inviter.id, inviterName: inviter.name });
  }
  if (matches.length !== 1) return { reason: 'Message format is unsupported or ambiguous.' };
  const parsed = matches[0];
  if (!parsed.userId) return { reason: `No unique server member has the username ${parsed.memberName}.` };
  if (!parsed.inviterId) return { reason: `No unique server member has the username ${parsed.inviterName}.` };
  if (parsed.userId === parsed.inviterId) return { reason: 'Self-invites are not imported.' };
  if (members.some((member) => member.id === parsed.userId && member.bot)) return { reason: 'Bot joins are not imported.' };
  return { ...parsed, messageId: message.id, occurredAt: new Date(message.createdTimestamp).toISOString() };
}

module.exports = { parseInviteLoggerMessage };
