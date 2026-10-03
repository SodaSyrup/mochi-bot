const { createHash } = require('node:crypto');
const { rebuildGuildInviteProjections } = require('./projectionRebuilder');
const { ConflictError } = require('../../../dashboard/errors');

const MATCH_WINDOW_MS = 120000;

/** Repairs the durable ledger and retains the source of each repair. */
class InviteLogImportRepository {
  constructor(db) { this.db = db; }

  snapshot(guildId) {
    const events = this.db.prepare('SELECT * FROM invite_events WHERE guild_id = ? ORDER BY id').all(guildId);
    const imports = this.db.prepare('SELECT message_id, source_entry_key FROM invite_log_imports WHERE guild_id = ? ORDER BY message_id, source_entry_key').all(guildId);
    const fingerprint = createHash('sha256').update(JSON.stringify({ events, imports })).digest('hex');
    return { events, imported: new Set(imports.map((row) => `${row.message_id}:${row.source_entry_key}`)), fingerprint };
  }

  plan(guildId, entries, members, policy, fakeThresholdDays) {
    const snapshot = this.snapshot(guildId);
    const eventsByUser = new Map();
    for (const event of snapshot.events) {
      const events = eventsByUser.get(event.user_id) || [];
      events.push(event);
      eventsByUser.set(event.user_id, events);
    }
    const membersById = new Map(members.map((member) => [member.id, member]));
    const groups = new Map();
    const skipped = [];
    const unmatched = new Map();
    for (const entry of entries) {
      const skip = (reason) => skipped.push({ ...entry, reason });
      if (snapshot.imported.has(`${entry.messageId}:${entry.sourceEntryKey || 'message'}`)) { skip('This source message was already imported.'); continue; }
      const userEvents = eventsByUser.get(entry.userId) || [];
      const matches = userEvents.filter((event) => {
        if (entry.eventType !== 'SNAPSHOT') {
          if (event.event_type !== entry.eventType || Math.abs(new Date(event.occurred_at).getTime() - new Date(entry.occurredAt).getTime()) > MATCH_WINDOW_MS) return false;
          if (!entry.joinedAt) return true;
          const join = userEvents.find((row) => row.event_type === 'JOIN' && row.membership_cycle === event.membership_cycle);
          return join && Math.abs(new Date(join.occurred_at).getTime() - new Date(entry.joinedAt).getTime()) <= 1000;
        }
        if (event.event_type !== 'JOIN' || Math.abs(new Date(event.occurred_at).getTime() - new Date(entry.joinedAt).getTime()) > 1000) return false;
        const observed = new Date(entry.occurredAt).getTime();
        const leave = userEvents.find((row) => row.event_type === 'LEAVE' && row.membership_cycle === event.membership_cycle);
        const nextJoin = userEvents.find((row) => row.event_type === 'JOIN' && row.membership_cycle === event.membership_cycle + 1);
        return observed >= new Date(event.occurred_at).getTime() &&
          (!leave || observed <= new Date(leave.occurred_at).getTime()) &&
          (!nextJoin || observed < new Date(nextJoin.occurred_at).getTime());
      });
      let missingLeaveAt = null;
      if (!matches.length && entry.eventType === 'LEAVE' && entry.joinedAt) {
        const member = membersById.get(entry.userId);
        const departed = member && member.membershipVerified !== false && !member.bot && (!member.joinedAt || new Date(member.joinedAt).getTime() > new Date(entry.occurredAt).getTime());
        if (departed) {
          const joinCandidates = userEvents.filter((event) => event.event_type === 'JOIN' &&
            Math.abs(new Date(event.occurred_at).getTime() - new Date(entry.joinedAt).getTime()) <= 1000 &&
            new Date(entry.occurredAt).getTime() >= new Date(event.occurred_at).getTime() &&
            !userEvents.some((row) => row.event_type === 'LEAVE' && row.membership_cycle === event.membership_cycle) &&
            !userEvents.some((row) => row.event_type === 'JOIN' && row.membership_cycle > event.membership_cycle && new Date(row.occurred_at).getTime() <= new Date(entry.occurredAt).getTime()));
          if (joinCandidates.length === 1) { matches.push(joinCandidates[0]); missingLeaveAt = entry.occurredAt; }
        }
      }
      let cycle;
      if (matches.length === 1) {
        cycle = matches[0].membership_cycle;
      } else if (matches.length === 0) {
        if (entry.eventType === 'SNAPSHOT') { skip('The role update does not match a recorded membership period.'); continue; }
        const pending = unmatched.get(entry.userId) || [];
        pending.push(entry);
        unmatched.set(entry.userId, pending);
        continue;
      } else {
        skip('More than one membership period matches this message.'); continue;
      }
      const key = `${entry.userId}:${cycle}`;
      const group = groups.get(key) || { userId: entry.userId, cycle, action: 'repair', entries: [], events: userEvents.filter((event) => event.membership_cycle === cycle) };
      if (missingLeaveAt) {
        if (group.missingLeaveAt && group.missingLeaveAt !== missingLeaveAt) group.conflictingLeaves = true;
        group.missingLeaveAt = missingLeaveAt;
      }
      group.entries.push(entry);
      groups.set(key, group);
    }
    const changes = [];
    for (const group of groups.values()) {
      const knownIds = new Set([
        ...group.entries.filter((entry) => !entry.assumedInviter).map((entry) => entry.inviterId),
        ...group.events.filter((event) => event.inviter_id).map((event) => event.inviter_id),
      ]);
      if (knownIds.size === 1) {
        const knownId = [...knownIds][0];
        const rejected = group.entries.filter((entry) => entry.assumedInviter && entry.inviterId !== knownId);
        skipped.push(...rejected.map((entry) => ({ ...entry, reason: 'Known inviter evidence differs from the requested fallback.' })));
        group.entries = group.entries.filter((entry) => !rejected.includes(entry));
        if (!group.entries.length) continue;
        if (group.missingLeaveAt && !group.entries.some((entry) => entry.eventType === 'LEAVE' && entry.occurredAt === group.missingLeaveAt)) group.missingLeaveAt = null;
      }
      const inviterIds = new Set(group.entries.map((entry) => entry.inviterId));
      const inviterId = group.entries[0].inviterId;
      const conflict = group.conflictingLeaves || inviterIds.size !== 1 || group.events.some((event) =>
        (event.inviter_id && event.inviter_id !== inviterId) ||
        !['UNKNOWN', 'RECONCILED', 'INVITE'].includes(event.attribution_type) ||
        (event.attribution_type === 'INVITE' && !event.inviter_id));
      if (conflict) {
        skipped.push(...group.entries.map((entry) => ({ ...entry, reason: 'Inviter data conflicts with another message or a known record.' })));
      } else if (!group.missingLeaveAt && group.events.every((event) => event.attribution_type === 'INVITE' && event.inviter_id === inviterId)) {
        skipped.push(...group.entries.map((entry) => ({ ...entry, reason: 'Mochi already has this inviter.' })));
      } else {
        changes.push({ ...group, inviterId });
      }
    }

    // A historical period needs both a JOIN and a LEAVE. An open period needs
    // Discord's current joinedAt. Never infer a departure from an old JOIN.
    for (const [userId, pending] of unmatched) {
      pending.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime() || (BigInt(a.messageId) < BigInt(b.messageId) ? -1 : 1));
      const member = membersById.get(userId);
      const userEvents = eventsByUser.get(userId) || [];
      const periods = userEvents.filter((event) => event.event_type === 'JOIN').map((join) => {
        const leave = userEvents.find((event) => event.event_type === 'LEAVE' && event.membership_cycle === join.membership_cycle);
        const restoredLeave = changes.find((change) => change.userId === userId && change.action === 'repair' && change.cycle === join.membership_cycle)?.missingLeaveAt;
        return { start: new Date(join.occurred_at).getTime(), end: leave ? new Date(leave.occurred_at).getTime() : restoredLeave ? new Date(restoredLeave).getTime() : Infinity };
      });
      const skip = (entries, reason) => skipped.push(...entries.map((entry) => ({ ...entry, reason })));
      if (member?.membershipVerified === false) {
        skip(pending, 'Restoring a membership period requires a verified server member list. Try the preview again later.'); continue;
      }
      if (!member || member.bot || !member.accountCreatedAt) {
        skip(pending, 'Could not verify that this member is a human account.'); continue;
      }
      for (let index = 0; index < pending.length; index++) {
        const source = pending[index];
        // A left embed includes both exact times, so it can prove a closed period.
        const closedEmbed = source.eventType === 'LEAVE' && source.joinedAt;
        const join = closedEmbed ? { ...source, eventType: 'JOIN', occurredAt: source.joinedAt } : source;
        if (join.eventType !== 'JOIN') { skip([join], 'No matching join was found for this leave.'); continue; }
        const next = closedEmbed ? null : pending[index + 1];
        const leave = closedEmbed ? source : next?.eventType === 'LEAVE' ? next : null;
        let evidence = closedEmbed ? [source] : leave ? [join, leave] : [join];
        let periodInviterId = join.inviterId;
        if (leave && !closedEmbed) index++;
        if (next && !leave) { skip(evidence, 'Another join appears before a matching leave.'); continue; }
        if (leave?.joinedAt && Math.abs(new Date(leave.joinedAt).getTime() - new Date(join.occurredAt).getTime()) > 1000) { skip(evidence, 'Join and leave messages identify different membership periods.'); continue; }
        if (leave && join.inviterId !== leave.inviterId) {
          if (Boolean(join.assumedInviter) !== Boolean(leave.assumedInviter)) {
            periodInviterId = join.assumedInviter ? leave.inviterId : join.inviterId;
            // Keep departure evidence, but credit the explicit inviter.
            evidence = evidence.map((entry) => entry.assumedInviter ? { ...entry, inviterId: periodInviterId, assumedInviter: false, overriddenFallback: true } : entry);
          } else { skip(evidence, 'Join and leave messages identify different inviters.'); continue; }
        }
        const start = new Date(join.occurredAt).getTime();
        const end = leave ? new Date(leave.occurredAt).getTime() : Infinity;
        const currentStart = member.joinedAt ? new Date(member.joinedAt).getTime() : null;
        if (!leave && (currentStart === null || Math.abs(currentStart - start) > MATCH_WINDOW_MS)) {
          skip(evidence, 'No leave message or matching current Discord membership was found.'); continue;
        }
        if (leave && currentStart !== null && end >= currentStart) {
          skip(evidence, 'This leave conflicts with current Discord membership.'); continue;
        }
        const joinedAt = leave ? join.occurredAt : member.joinedAt;
        const confirmedStart = new Date(joinedAt).getTime();
        if (confirmedStart < new Date(member.accountCreatedAt).getTime()) {
          skip(evidence, 'This join is earlier than the account creation date.'); continue;
        }
        if (periods.some((period) => confirmedStart <= period.end && end >= period.start)) {
          skip(evidence, 'This membership period overlaps recorded history.'); continue;
        }
        periods.push({ start: confirmedStart, end });
        changes.push({ userId, action: 'insert', joinedAt, leftAt: leave?.occurredAt || null,
          inviterId: periodInviterId, isFake: policy.isSuspiciousAccount({ ...member, joinedAt, fakeThresholdDays }), entries: evidence });
      }
      // Adding an old closed period must not make a current member appear left.
      const currentStart = member.joinedAt ? new Date(member.joinedAt).getTime() : null;
      const hasRecordedCurrent = userEvents.some((event) => event.event_type === 'JOIN' &&
        Math.abs(new Date(event.occurred_at).getTime() - currentStart) <= MATCH_WINDOW_MS &&
        !userEvents.some((leave) => leave.event_type === 'LEAVE' && leave.membership_cycle === event.membership_cycle));
      const hasRestoredCurrent = changes.some((change) => change.userId === userId && change.action === 'insert' && !change.leftAt);
      if (currentStart !== null && !hasRecordedCurrent && !hasRestoredCurrent) {
        for (let index = changes.length - 1; index >= 0; index--) {
          const change = changes[index];
          if (change.userId === userId && change.action === 'insert') {
            skip(change.entries, 'Reconcile server members before restoring this older period.');
            changes.splice(index, 1);
          }
        }
      }
    }

    // Insert periods in chronological order. Renumber existing periods without
    // changing their events, so each user's cycle sequence remains contiguous.
    const renumbering = [];
    const insertedUsers = new Set(changes.filter((change) => change.action === 'insert').map((change) => change.userId));
    for (const userId of insertedUsers) {
      const existing = (eventsByUser.get(userId) || []).filter((event) => event.event_type === 'JOIN');
      const timeline = [
        ...existing.map((event) => ({ time: new Date(event.occurred_at).getTime(), previousCycle: event.membership_cycle })),
        ...changes.filter((change) => change.userId === userId && change.action === 'insert').map((change) => ({ time: new Date(change.joinedAt).getTime(), change })),
      ].sort((a, b) => a.time - b.time);
      timeline.forEach((period, index) => {
        const cycle = index + 1;
        if (period.change) period.change.cycle = cycle;
        else {
          renumbering.push({ userId, previousCycle: period.previousCycle, cycle });
          const repair = changes.find((change) => change.userId === userId && change.action === 'repair' && change.cycle === period.previousCycle);
          // Repairs retain their old cycle until apply; preview shows the new cycle.
          if (repair) repair.previewCycle = cycle;
        }
      });
    }
    return { changes, skipped, renumbering, fingerprint: snapshot.fingerprint };
  }

  apply(guildId, plan, { channelId, sourceBotId, actorUserId }) {
    const tx = this.db.transaction(() => {
      if (this.snapshot(guildId).fingerprint !== plan.fingerprint) {
        throw new ConflictError('Invite history changed after the preview. Create a new preview.');
      }
      // Repair original cycle numbers before inserting historical periods.
      for (const change of plan.changes.filter((change) => change.action === 'repair')) {
        this.db.prepare(`UPDATE invite_events SET attribution_type = 'INVITE', inviter_id = ?
          WHERE guild_id = ? AND user_id = ? AND membership_cycle = ?`).run(change.inviterId, guildId, change.userId, change.cycle);
        if (change.missingLeaveAt) {
          const join = change.events.find((event) => event.event_type === 'JOIN');
          this.db.prepare(`INSERT INTO invite_events (guild_id, user_id, membership_cycle, event_type, attribution_type, inviter_id, invite_code, is_fake, occurred_at)
            VALUES (?, ?, ?, 'LEAVE', 'INVITE', ?, ?, ?, ?)`).run(guildId, change.userId, change.cycle, change.inviterId, join.invite_code, join.is_fake, change.missingLeaveAt);
        }
      }
      const reorderedUsers = new Set(plan.renumbering.map((period) => period.userId));
      for (const userId of reorderedUsers) {
        const periods = plan.renumbering.filter((period) => period.userId === userId);
        const offset = Math.max(...periods.map((period) => Math.max(period.previousCycle, period.cycle))) + 1;
        // Temporary positive numbers avoid the unique event key during reorder.
        for (const table of ['invite_events', 'invite_log_imports']) {
          this.db.prepare(`UPDATE ${table} SET membership_cycle = membership_cycle + ? WHERE guild_id = ? AND user_id = ?`).run(offset, guildId, userId);
          for (const period of periods) {
            this.db.prepare(`UPDATE ${table} SET membership_cycle = ? WHERE guild_id = ? AND user_id = ? AND membership_cycle = ?`).run(period.cycle, guildId, userId, period.previousCycle + offset);
          }
        }
      }
      for (const change of plan.changes) {
        if (change.action === 'insert') {
          this.db.prepare(`INSERT INTO invite_events (guild_id, user_id, membership_cycle, event_type, attribution_type, inviter_id, is_fake, occurred_at)
            VALUES (?, ?, ?, 'JOIN', 'INVITE', ?, ?, ?)`).run(guildId, change.userId, change.cycle, change.inviterId, change.isFake ? 1 : 0, change.joinedAt);
          if (change.leftAt) {
            this.db.prepare(`INSERT INTO invite_events (guild_id, user_id, membership_cycle, event_type, attribution_type, inviter_id, is_fake, occurred_at)
              VALUES (?, ?, ?, 'LEAVE', 'INVITE', ?, ?, ?)`).run(guildId, change.userId, change.cycle, change.inviterId, change.isFake ? 1 : 0, change.leftAt);
          }
        }
        for (const entry of change.entries) {
          this.db.prepare(`INSERT INTO invite_log_imports (guild_id, message_id, source_entry_key, channel_id, source_bot_id, user_id, membership_cycle, inviter_id, actor_user_id, inviter_assumed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(guildId, entry.messageId, entry.sourceEntryKey || 'message', channelId, sourceBotId, change.userId, change.previewCycle || change.cycle, change.inviterId, actorUserId, entry.assumedInviter ? 1 : 0);
        }
      }
      if (plan.changes.length) rebuildGuildInviteProjections(this.db, guildId);
      return { repaired: plan.changes.filter((change) => change.action === 'repair').length, restored: plan.changes.filter((change) => change.action === 'insert').length };
    });
    return tx.immediate();
  }
}

module.exports = { InviteLogImportRepository };
