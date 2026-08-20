const { AttributionType } = require('../domain/attribution');

/**
 * Rebuild a guild's inviter projections and daily analytics from the durable
 * ledger (invite_events + invite_bonus_adjustments).
 *
 * This is the single definition of how projections are derived from history:
 *  - regular: INVITE JOIN events with a real, non-self inviter
 *  - fake:    those same JOIN events classified as suspicious
 *  - leaves:  INVITE LEAVE events with a real, non-self inviter that were not
 *             already excluded by the fake counter (no double penalty)
 *  - bonus:   SUM(invite_bonus_adjustments.amount)
 *  - daily joins/fakes: JOIN events split by fake status; daily leaves count
 *             every literal departure
 */
function rebuildGuildInviteProjections(db, guildId) {
  const joinRows = db
    .prepare(`
      SELECT user_id, inviter_id, is_fake, attribution_type
      FROM invite_events
      WHERE guild_id = ? AND event_type = 'JOIN'
    `)
    .all(guildId);

  const leaveRows = db
    .prepare(`
      SELECT user_id, inviter_id, is_fake, attribution_type
      FROM invite_events
      WHERE guild_id = ? AND event_type = 'LEAVE'
    `)
    .all(guildId);

  const bonusRows = db
    .prepare(`
      SELECT user_id, amount FROM invite_bonus_adjustments WHERE guild_id = ?
    `)
    .all(guildId);

  const dailyRows = db
    .prepare(`
      SELECT event_type, attribution_type, is_fake, substr(occurred_at, 1, 10) AS day
      FROM invite_events
      WHERE guild_id = ?
    `)
    .all(guildId);

  const counts = new Map();
  const getCounts = (userId) => {
    if (!counts.has(userId)) {
      counts.set(userId, { regular: 0, leaves: 0, fake: 0, bonus: 0 });
    }
    return counts.get(userId);
  };

  for (const row of joinRows) {
    if (row.attribution_type === AttributionType.INVITE && row.inviter_id && row.inviter_id !== row.user_id) {
      const c = getCounts(row.inviter_id);
      c.regular += 1;
      if (row.is_fake) c.fake += 1;
    }
  }

  for (const row of leaveRows) {
    if (row.attribution_type === AttributionType.INVITE && row.inviter_id && row.inviter_id !== row.user_id && !row.is_fake) {
      const c = getCounts(row.inviter_id);
      c.leaves += 1;
    }
  }

  for (const row of bonusRows) {
    getCounts(row.user_id).bonus += row.amount;
  }

  const dayCounts = new Map();
  for (const row of dailyRows) {
    if (!row.day) continue;
    if (!dayCounts.has(row.day)) dayCounts.set(row.day, { joins: 0, leaves: 0, fakes: 0 });
    const d = dayCounts.get(row.day);
    if (row.event_type === 'LEAVE') {
      d.leaves += 1;
    } else if (row.attribution_type === AttributionType.PRE_EXISTING) {
      // Pre-existing backfill never produced daily stats at sync time, so
      // rebuilding must not invent them.
      continue;
    } else if (row.is_fake) {
      d.fakes += 1;
    } else {
      d.joins += 1;
    }
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM inviters WHERE guild_id = ?').run(guildId);
    const insertInviter = db.prepare(`
      INSERT INTO inviters (guild_id, user_id, regular, bonus, leaves, fake, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    for (const [userId, c] of counts) {
      insertInviter.run(guildId, userId, c.regular, c.bonus, c.leaves, c.fake);
    }

    db.prepare('DELETE FROM daily_invite_stats WHERE guild_id = ?').run(guildId);
    const insertDaily = db.prepare(`
      INSERT INTO daily_invite_stats (guild_id, date, joins, leaves, fakes)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const [date, d] of dayCounts) {
      insertDaily.run(guildId, date, d.joins, d.leaves, d.fakes);
    }
  });
  tx();

  return { inviters: counts.size, days: dayCounts.size };
}

module.exports = { rebuildGuildInviteProjections };
