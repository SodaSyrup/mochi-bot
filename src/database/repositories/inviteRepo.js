const db = require('../db');

class InviteRepository {
  /**
   * Get an inviter's aggregated statistics
   */
  getInviter(guildId, userId) {
    const row = db.prepare(`
      SELECT 
        user_id,
        regular,
        leaves,
        fake,
        (regular - leaves - fake) AS total,
        updated_at
      FROM inviters
      WHERE guild_id = ? AND user_id = ?
    `).get(guildId, userId);

    if (!row) {
      return {
        userId,
        guildId,
        regular: 0,
        leaves: 0,
        fake: 0,
        total: 0
      };
    }
    return {
      userId: row.user_id,
      guildId,
      regular: row.regular,
      leaves: row.leaves,
      fake: row.fake,
      total: row.total
    };
  }

  /**
   * Ensure inviter record exists
   */
  getOrCreateInviter(guildId, userId) {
    db.prepare(`
      INSERT INTO inviters (guild_id, user_id, regular, leaves, fake, updated_at)
      VALUES (?, ?, 0, 0, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(guild_id, user_id) DO NOTHING
    `).run(guildId, userId);
    return this.getInviter(guildId, userId);
  }

  /**
   * Record a member join tracked to an inviter
   */
  recordJoin(guildId, userId, inviterId, inviteCode, isFake = false) {
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    const transaction = db.transaction(() => {
      // 1. Record/Update member entry
      db.prepare(`
        INSERT INTO invite_members (guild_id, user_id, inviter_id, invite_code, joined_at, is_fake, is_left, left_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 0, NULL)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          inviter_id = excluded.inviter_id,
          invite_code = excluded.invite_code,
          joined_at = CURRENT_TIMESTAMP,
          is_fake = excluded.is_fake,
          is_left = 0,
          left_at = NULL
      `).run(guildId, userId, inviterId || null, inviteCode || null, isFake ? 1 : 0);

      // 2. Update inviter tallies if an inviter exists
      if (inviterId && inviterId !== 'VANITY' && inviterId !== 'UNKNOWN' && inviterId !== userId) {
        this.getOrCreateInviter(guildId, inviterId);

        if (isFake) {
          db.prepare(`
            UPDATE inviters 
            SET fake = fake + 1, updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ? AND user_id = ?
          `).run(guildId, inviterId);
        } else {
          db.prepare(`
            UPDATE inviters 
            SET regular = regular + 1, updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ? AND user_id = ?
          `).run(guildId, inviterId);
        }
      }

      // 3. Record daily statistics
      this.recordDailyStat(guildId, today, isFake ? 'fakes' : 'joins');
    });

    transaction();
    return inviterId ? this.getInviter(guildId, inviterId) : null;
  }

  /**
   * Record a member departure and penalize the inviter
   */
  recordLeave(guildId, userId) {
    const today = new Date().toISOString().split('T')[0];

    let affectedInviter = null;

    const transaction = db.transaction(() => {
      const member = db.prepare(`
        SELECT inviter_id, is_fake, is_left 
        FROM invite_members 
        WHERE guild_id = ? AND user_id = ?
      `).get(guildId, userId);

      if (member) {
        db.prepare(`
          UPDATE invite_members 
          SET is_left = 1, left_at = CURRENT_TIMESTAMP 
          WHERE guild_id = ? AND user_id = ?
        `).run(guildId, userId);

        if (member.inviter_id && member.inviter_id !== 'VANITY' && member.inviter_id !== 'UNKNOWN' && member.inviter_id !== userId) {
          db.prepare(`
            UPDATE inviters 
            SET leaves = leaves + 1, updated_at = CURRENT_TIMESTAMP 
            WHERE guild_id = ? AND user_id = ?
          `).run(guildId, member.inviter_id);

          affectedInviter = this.getInviter(guildId, member.inviter_id);
        }
      }

      this.recordDailyStat(guildId, today, 'leaves');
    });

    transaction();
    return affectedInviter;
  }

  /**
   * Get invite info for a specific member
   */
  getInviteMember(guildId, userId) {
    return db.prepare(`
      SELECT * FROM invite_members WHERE guild_id = ? AND user_id = ?
    `).get(guildId, userId);
  }

  /**
   * Reset invites for a user
   */
  resetInvites(guildId, userId) {
    db.prepare(`
      DELETE FROM inviters WHERE guild_id = ? AND user_id = ?
    `).run(guildId, userId);
    return this.getInviter(guildId, userId);
  }

  /**
   * Get guild leaderboard
   */
  getLeaderboard(guildId, limit = 10, offset = 0) {
    return db.prepare(`
      SELECT 
        user_id,
        regular,
        leaves,
        fake,
        (regular - leaves - fake) AS total
      FROM inviters
      WHERE guild_id = ?
      ORDER BY total DESC, regular DESC
      LIMIT ? OFFSET ?
    `).all(guildId, limit, offset);
  }

  /**
   * Get total inviters count in guild
   */
  getInvitersCount(guildId) {
    const res = db.prepare(`SELECT COUNT(*) as count FROM inviters WHERE guild_id = ?`).get(guildId);
    return res ? res.count : 0;
  }

  /**
   * Record a daily stat increment
   */
  recordDailyStat(guildId, date, column) {
    const validCols = ['joins', 'leaves', 'fakes'];
    if (!validCols.includes(column)) return;

    db.prepare(`
      INSERT INTO daily_invite_stats (guild_id, date, joins, leaves, fakes)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, date) DO UPDATE SET
        ${column} = ${column} + 1
    `).run(
      guildId,
      date,
      column === 'joins' ? 1 : 0,
      column === 'leaves' ? 1 : 0,
      column === 'fakes' ? 1 : 0
    );
  }

  /**
   * Get daily stats history for charts
   */
  getDailyStats(guildId, days = 7) {
    const rows = db.prepare(`
      SELECT date, joins, leaves, fakes
      FROM daily_invite_stats
      WHERE guild_id = ?
      ORDER BY date DESC
      LIMIT ?
    `).all(guildId, days);

    return rows.reverse();
  }

  /**
   * Get recent joins for the dashboard activity feed with labels
   */
  getRecentJoins(guildId, limit = 10) {
    return db.prepare(`
      SELECT 
        im.user_id, 
        im.inviter_id, 
        im.invite_code, 
        im.joined_at, 
        im.is_fake, 
        im.is_left,
        im.left_at,
        il.label as invite_label,
        il.channel_name
      FROM invite_members im
      LEFT JOIN invite_labels il ON im.guild_id = il.guild_id AND im.invite_code = il.code
      WHERE im.guild_id = ?
      ORDER BY COALESCE(im.left_at, im.joined_at) DESC
      LIMIT ?
    `).all(guildId, limit);
  }

  /**
   * Get detailed activity log with filtering, searching, and pagination
   */
  getActivityLog(guildId, { limit = 20, offset = 0, filter = 'all', search = '' } = {}) {
    const conditions = ['im.guild_id = ?'];
    const params = [guildId];

    if (filter === 'joins') {
      conditions.push('im.is_left = 0');
    } else if (filter === 'leaves') {
      conditions.push('im.is_left = 1');
    } else if (filter === 'fakes') {
      conditions.push('im.is_fake = 1');
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      conditions.push('(im.user_id LIKE ? OR im.inviter_id LIKE ? OR im.invite_code LIKE ? OR il.label LIKE ?)');
      params.push(s, s, s, s);
    }

    const whereClause = conditions.join(' AND ');

    // Total count for pagination
    const countSql = `
      SELECT COUNT(*) as count 
      FROM invite_members im
      LEFT JOIN invite_labels il ON im.guild_id = il.guild_id AND im.invite_code = il.code
      WHERE ${whereClause}
    `;
    const countRow = db.prepare(countSql).get(...params);
    const total = countRow ? countRow.count : 0;

    // Fetch items ordered by most recent event (left_at if left, otherwise joined_at)
    const itemsSql = `
      SELECT 
        im.user_id, 
        im.inviter_id, 
        im.invite_code, 
        im.joined_at, 
        im.is_fake, 
        im.is_left,
        im.left_at,
        il.label as invite_label,
        il.channel_name
      FROM invite_members im
      LEFT JOIN invite_labels il ON im.guild_id = il.guild_id AND im.invite_code = il.code
      WHERE ${whereClause}
      ORDER BY COALESCE(im.left_at, im.joined_at) DESC
      LIMIT ? OFFSET ?
    `;
    const items = db.prepare(itemsSql).all(...params, limit, offset);

    // Summary counts for tabs/badges
    const summaryRow = db.prepare(`
      SELECT 
        COUNT(*) as total_members,
        SUM(CASE WHEN is_left = 0 THEN 1 ELSE 0 END) as active_joins,
        SUM(CASE WHEN is_left = 1 THEN 1 ELSE 0 END) as total_leaves,
        SUM(CASE WHEN is_fake = 1 THEN 1 ELSE 0 END) as total_fakes
      FROM invite_members
      WHERE guild_id = ?
    `).get(guildId);

    return {
      items,
      total,
      limit,
      offset,
      summary: {
        total: summaryRow?.total_members || 0,
        joins: summaryRow?.active_joins || 0,
        leaves: summaryRow?.total_leaves || 0,
        fakes: summaryRow?.total_fakes || 0
      }
    };
  }

  /**
   * Sync and backfill pre-existing guild members who joined before the bot was invited
   */
  syncPreExistingMembers(guildId, membersList) {
    const insertStmt = db.prepare(`
      INSERT INTO invite_members (guild_id, user_id, inviter_id, invite_code, joined_at, is_fake, is_left, left_at)
      VALUES (?, ?, 'PRE_EXISTING', 'PRE_BOT', ?, ?, 0, NULL)
      ON CONFLICT(guild_id, user_id) DO NOTHING
    `);

    let insertedCount = 0;
    const transaction = db.transaction(() => {
      for (const m of membersList) {
        const res = insertStmt.run(
          guildId,
          m.userId,
          m.joinedAt || new Date().toISOString(),
          m.isFake ? 1 : 0
        );
        if (res.changes > 0) {
          insertedCount++;
        }
      }
    });

    transaction();
    return insertedCount;
  }

  /**
   * Set or update label for an invite code
   */
  setInviteLabel(guildId, code, label, channelId = null, channelName = null) {
    if (!label || !label.trim()) {
      return this.deleteInviteLabel(guildId, code);
    }

    const trimmedLabel = label.trim();
    db.prepare(`
      INSERT INTO invite_labels (guild_id, code, label, channel_id, channel_name, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(guild_id, code) DO UPDATE SET
        label = excluded.label,
        channel_id = COALESCE(excluded.channel_id, invite_labels.channel_id),
        channel_name = COALESCE(excluded.channel_name, invite_labels.channel_name),
        updated_at = CURRENT_TIMESTAMP
    `).run(guildId, code, trimmedLabel, channelId, channelName);

    return this.getInviteLabel(guildId, code);
  }

  /**
   * Get label for an invite code
   */
  getInviteLabel(guildId, code) {
    return db.prepare(`
      SELECT guild_id, code, label, channel_id, channel_name, created_at, updated_at
      FROM invite_labels
      WHERE guild_id = ? AND code = ?
    `).get(guildId, code);
  }

  /**
   * Get all invite labels for a guild
   */
  getInviteLabels(guildId) {
    return db.prepare(`
      SELECT code, label, channel_id, channel_name, created_at, updated_at
      FROM invite_labels
      WHERE guild_id = ?
    `).all(guildId);
  }

  /**
   * Delete label for an invite code
   */
  deleteInviteLabel(guildId, code) {
    db.prepare(`
      DELETE FROM invite_labels
      WHERE guild_id = ? AND code = ?
    `).run(guildId, code);
    return { success: true };
  }

  /**
   * Cache invite list in database
   */
  saveCachedInvites(guildId, invites) {
    const deleteStmt = db.prepare(`DELETE FROM invite_cache WHERE guild_id = ?`);
    const insertStmt = db.prepare(`
      INSERT INTO invite_cache (guild_id, code, uses, inviter_id, max_uses, channel_id, channel_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      deleteStmt.run(guildId);
      for (const inv of invites) {
        insertStmt.run(
          guildId,
          inv.code,
          inv.uses || 0,
          inv.inviterId || (inv.inviter ? inv.inviter.id : null) || null,
          inv.maxUses || 0,
          inv.channelId || null,
          inv.channelName || null,
          inv.createdAt ? new Date(inv.createdAt).toISOString() : null
        );
      }
    });

    transaction();
  }

  /**
   * Save or update a single cached invite
   */
  saveCachedInvite(guildId, invite) {
    db.prepare(`
      INSERT INTO invite_cache (guild_id, code, uses, inviter_id, max_uses, channel_id, channel_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, code) DO UPDATE SET
        uses = excluded.uses,
        inviter_id = COALESCE(excluded.inviter_id, invite_cache.inviter_id),
        max_uses = excluded.max_uses,
        channel_id = COALESCE(excluded.channel_id, invite_cache.channel_id),
        channel_name = COALESCE(excluded.channel_name, invite_cache.channel_name),
        created_at = COALESCE(excluded.created_at, invite_cache.created_at)
    `).run(
      guildId,
      invite.code,
      invite.uses || 0,
      invite.inviterId || (invite.inviter ? invite.inviter.id : null) || null,
      invite.maxUses || 0,
      invite.channelId || null,
      invite.channelName || null,
      invite.createdAt ? new Date(invite.createdAt).toISOString() : new Date().toISOString()
    );
  }

  /**
   * Remove a single invite from cache
   */
  deleteCachedInvite(guildId, code) {
    db.prepare(`
      DELETE FROM invite_cache WHERE guild_id = ? AND code = ?
    `).run(guildId, code);
  }

  /**
   * Get cached invites from DB enriched with custom labels
   */
  getCachedInvites(guildId) {
    return db.prepare(`
      SELECT 
        c.code, 
        c.uses, 
        c.inviter_id as inviterId, 
        c.max_uses as maxUses, 
        c.channel_id as channelId,
        c.channel_name as channelName,
        c.created_at as createdAt,
        l.label
      FROM invite_cache c
      LEFT JOIN invite_labels l ON c.guild_id = l.guild_id AND c.code = l.code
      WHERE c.guild_id = ?
      ORDER BY c.created_at DESC
    `).all(guildId);
  }
}

module.exports = new InviteRepository();

