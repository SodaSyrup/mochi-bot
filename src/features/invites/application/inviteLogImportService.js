const { randomUUID } = require('node:crypto');
const { parseInviteLoggerMessage } = require('../domain/inviteLoggerParser');
const { parseUserLogMessage } = require('../domain/userLogParser');
const { ValidationError, ConflictError, ExternalServiceError, NotFoundError } = require('../../../dashboard/errors');

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const ID = /^\d{17,20}$/;

/** Imports only an approved, server-side preview. Uses the live invite queue. */
class InviteLogImportService {
  constructor({ repository, inviteService, inviteLogGateway, guildRepository }) {
    this.repo = repository;
    this.invites = inviteService;
    this.gateway = inviteLogGateway;
    this.guilds = guildRepository;
    this.previews = new Map();
    this.previewJobs = new Map();
  }

  startPreview(guildId, input, actorUserId) {
    if (input && (typeof input !== 'object' || Array.isArray(input))) throw new ValidationError('Import options must be an object.');
    const signature = JSON.stringify(input || {});
    for (const [id, job] of this.previewJobs) {
      if (job.finishedAt && Date.now() - job.finishedAt > PREVIEW_TTL_MS) this.previewJobs.delete(id);
      else if (job.guildId === guildId && job.actorUserId === actorUserId && job.state === 'running') {
        if (job.signature === signature) return { jobId: id, state: job.state, progress: job.progress };
        throw new ConflictError('An import preview is already running for this server. Wait for it to finish.');
      }
    }
    if (this.previewJobs.size >= 100) throw new ConflictError('Too many import scans are open. Try again later.');
    const jobId = randomUUID();
    const job = { guildId, actorUserId, signature, state: 'running', progress: 'Starting the log scan.', finishedAt: null, result: null, error: null };
    this.previewJobs.set(jobId, job);
    // Defer work until the start request can send its short response.
    setImmediate(() => {
      void this.preview(guildId, input, actorUserId, (progress) => { job.progress = progress; }).then((result) => {
        job.result = result;
        job.state = 'complete';
        job.finishedAt = Date.now();
      }).catch((error) => {
        job.state = 'failed';
        job.finishedAt = Date.now();
        job.error = { message: error.status ? error.message : 'Could not finish the import preview.', code: error.code || 'INTERNAL' };
        this.invites.logger?.error?.('invites', 'importPreview', 'Import preview failed.', { guildId, error });
      });
    });
    return { jobId, state: job.state, progress: job.progress };
  }

  getPreviewJob(guildId, jobId, actorUserId) {
    const job = this.previewJobs.get(jobId);
    if (!job || job.guildId !== guildId || job.actorUserId !== actorUserId || (job.finishedAt && Date.now() - job.finishedAt > PREVIEW_TTL_MS)) {
      throw new NotFoundError('This scan is unavailable or has expired. Create a new preview.');
    }
    return { jobId, state: job.state, progress: job.progress, ...(job.state === 'complete' ? { result: job.result } : {}), ...(job.state === 'failed' ? { error: job.error } : {}) };
  }

  async preview(guildId, input, actorUserId, onProgress = () => {}) {
    const { sourceBotId: requestedBotId, channelId: requestedChannelId, sourceFormat = 'invite-logger', before, limit = 1000, continuationToken } = input || {};
    // The server owner requested this fallback for explicit Unknown user logs.
    const unknownInviterId = input?.unknownInviterId === undefined ? (sourceFormat === 'user-logs' ? '772509343916359740' : null) : input.unknownInviterId || null;
    if (unknownInviterId && (typeof unknownInviterId !== 'string' || !ID.test(unknownInviterId))) throw new ValidationError('The unknown inviter fallback must be a Discord user ID.');
    if (!['invite-logger', 'user-logs'].includes(sourceFormat)) throw new ValidationError('Select InviteLogger messages or user log embeds.');
    if (requestedChannelId && (typeof requestedChannelId !== 'string' || !ID.test(requestedChannelId))) throw new ValidationError('The source channel must be a Discord channel ID.');
    const channelId = requestedChannelId || this.guilds.getGuild(guildId)?.invite_log_channel_id;
    if (!channelId) throw new ValidationError('Save an invite log channel before creating a preview.');
    if (requestedBotId && (typeof requestedBotId !== 'string' || !ID.test(requestedBotId))) throw new ValidationError('The source bot ID must be a Discord user ID.');
    if (before && (typeof before !== 'string' || !ID.test(before))) throw new ValidationError('The history cursor must be a Discord message ID.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new ValidationError('Scan between 1 and 5000 channel messages.');
    if (typeof this.gateway.fetchImportMessages !== 'function') throw new ExternalServiceError('Invite log imports require a Discord connection.');
    onProgress('Fetching the server member list. Discord may require a wait.');
    const authoritativeMembers = await this.invites.gateway.fetchGuildMembers(guildId);
    const membersAvailable = authoritativeMembers !== null && authoritativeMembers !== undefined;
    const members = authoritativeMembers || [];
    const sourceNames = sourceFormat === 'user-logs' ? ['Salad Bot', 'SaladBot'] : ['InviteLogger'];
    let sourceBotId = requestedBotId;
    if (!sourceBotId) {
      const sources = members.filter((member) => member.bot && sourceNames.includes(member.username));
      if (sources.length !== 1) throw new ValidationError('Enter the source bot user ID. Name lookup requires the bot to be in this server.');
      sourceBotId = sources[0].id;
    }
    // An explicit ID also identifies a departed bot. The Discord gateway
    // checks the message author ID and bot flag when it reads history.
    let previous = null;
    if (continuationToken) {
      previous = this.previews.get(continuationToken);
      if (!previous || previous.guildId !== guildId || previous.actorUserId !== actorUserId || previous.expiresAt <= Date.now() ||
        previous.channelId !== channelId || previous.sourceBotId !== sourceBotId || previous.sourceFormat !== sourceFormat || previous.unknownInviterId !== unknownInviterId || previous.nextBefore !== before) {
        throw new ConflictError('The earlier scan is unavailable. Create a new preview.');
      }
    }
    onProgress('Reading log history.');
    const history = await this.gateway.fetchImportMessages(guildId, channelId, sourceBotId, { limit, before: before || undefined,
      onProgress: (scanned) => onProgress(`Read ${scanned} of up to ${limit} channel messages.`) });
    onProgress('Reading member and inviter fields.');
    const entries = [...(previous?.entries || [])];
    const skipped = [];
    for (const message of history.messages) {
      const parsed = sourceFormat === 'user-logs' ? parseUserLogMessage(message, members, { unknownInviterId }) : parseInviteLoggerMessage(message, members);
      if (parsed.reason) skipped.push({ messageId: message.id, reason: parsed.reason, text: (message.content || message.embeds?.[0]?.description || '').slice(0, 300) });
      else if (parsed.entries) { entries.push(...parsed.entries); skipped.push(...parsed.skipped); }
      else entries.push(parsed);
    }
    if (entries.length > 10000) throw new ValidationError('This scan has too many pending messages. Start a new scan with a larger message limit.');
    const membersById = new Map(members.map((member) => [member.id, member]));
    const unknownIds = [...new Set(entries.map((entry) => entry.userId).filter((id) => !membersById.has(id)))];
    if (unknownIds.length) {
      onProgress(`Checking ${unknownIds.length} user accounts. Discord may require a wait.`);
      const users = await this.invites.gateway.resolveUsers(unknownIds, { onProgress: (completed, total) => onProgress(`Checked ${completed} of ${total} user accounts.`) });
      for (const [id, user] of users) {
        if (user && typeof user.bot === 'boolean') membersById.set(id, { ...user, joinedAt: null, membershipVerified: membersAvailable });
      }
    }
    const verifiedEntries = [];
    for (const entry of entries) {
      if (membersById.get(entry.userId)?.bot) skipped.push({ ...entry, reason: 'Bot joins are not imported.' });
      else verifiedEntries.push(entry);
    }
    onProgress('Matching log entries to recorded membership periods.');
    const plan = await this.invites.queue.run(guildId, async () => this.repo.plan(guildId, verifiedEntries, [...membersById.values()], this.invites.policy, this.guilds.getGuild(guildId)?.fake_threshold_days));
    for (const [token, preview] of this.previews) {
      if (preview.expiresAt <= Date.now() || (preview.guildId === guildId && preview.actorUserId === actorUserId)) this.previews.delete(token);
    }
    if (this.previews.size >= 100) throw new ConflictError('Too many import previews are open. Try again in ten minutes.');
    const token = randomUUID();
    const expiresAt = Date.now() + PREVIEW_TTL_MS;
    const sourceKey = (entry) => `${entry.messageId}:${entry.sourceEntryKey || 'message'}`;
    const completedIds = new Set(plan.skipped.filter((entry) => entry.reason === 'This source message was already imported.' || entry.reason === 'Mochi already has this inviter.').map(sourceKey));
    this.previews.set(token, { guildId, actorUserId, channelId, sourceBotId, sourceFormat, unknownInviterId, configuredChannel: !requestedChannelId, plan, expiresAt, entries: verifiedEntries.filter((entry) => !completedIds.has(sourceKey(entry))), nextBefore: history.nextBefore, consumed: false });
    return {
      token, expiresAt, channelId, sourceBotId, sourceFormat, scanned: history.scanned,
      notices: membersAvailable ? [] : ['The server member list is unavailable. User IDs can repair recorded periods. Username lookup and restoration of new periods require a verified member list.'],
      sourceMessages: history.messages.length, retainedMessages: verifiedEntries.length, nextBefore: history.nextBefore,
      changes: plan.changes.map((change) => ({
        userId: change.userId, memberName: membersById.get(change.userId)?.username || null,
        inviterId: change.inviterId, inviterName: membersById.get(change.inviterId)?.username || null,
        cycle: change.previewCycle || change.cycle, action: change.action,
        joinedAt: change.joinedAt || change.events?.find((event) => event.event_type === 'JOIN')?.occurred_at || null,
        leftAt: change.leftAt || change.missingLeaveAt || change.events?.find((event) => event.event_type === 'LEAVE')?.occurred_at || null,
        restoresLeave: Boolean(change.missingLeaveAt),
        messageId: change.entries[0].messageId, occurredAt: change.entries[0].occurredAt,
        sources: change.entries.map((entry) => ({ messageId: entry.messageId, eventType: entry.eventType })),
        matchedByName: change.entries.some((entry) => entry.memberName || entry.inviterName),
        assumedInviter: change.entries.some((entry) => entry.assumedInviter),
        overriddenFallback: change.entries.some((entry) => entry.overriddenFallback),
      })),
      skipped: [...skipped, ...plan.skipped],
    };
  }

  async apply(guildId, token, actorUserId) {
    if (typeof token !== 'string') throw new ValidationError('Create an import preview first.');
    return this.invites.queue.run(guildId, async () => {
      const preview = this.previews.get(token);
      if (!preview || preview.consumed || preview.guildId !== guildId || preview.actorUserId !== actorUserId || preview.expiresAt <= Date.now()) {
        throw new ConflictError('This preview has expired or is unavailable. Create a new preview.');
      }
      preview.consumed = true;
      if (preview.configuredChannel && this.guilds.getGuild(guildId)?.invite_log_channel_id !== preview.channelId) {
        throw new ConflictError('The invite log channel changed. Create a new preview.');
      }
      const result = this.repo.apply(guildId, preview.plan, preview);
      const sourceKey = (entry) => `${entry.messageId}:${entry.sourceEntryKey || 'message'}`;
      const appliedIds = new Set(preview.plan.changes.flatMap((change) => change.entries.map(sourceKey)));
      preview.entries = preview.entries.filter((entry) => !appliedIds.has(sourceKey(entry)));
      return { success: true, ...result, message: `Repaired ${result.repaired} membership periods and restored ${result.restored} missing joins.` };
    });
  }
}

module.exports = { InviteLogImportService };
