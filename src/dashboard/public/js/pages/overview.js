/**
 * Overview Page Script
 */

class OverviewPage {
  constructor() {
    this.currentGuildId = null;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  init() {
    window.Mochi.onGuildChange((guildId) => {
      this.currentGuildId = guildId;
      this.loadOverview();
    });

    window.Mochi.onRealtime('memberJoin', () => {
      this.loadOverview();
    });

    window.Mochi.onRealtime('memberLeave', () => {
      this.loadOverview();
    });
  }

  async loadOverview() {
    if (!this.currentGuildId) return;
    await Promise.all([
      this.fetchGuildDetails(),
      this.fetchTopInviters(),
      this.fetchRecentJoins()
    ]);
  }

  async refreshCurrentGuild() {
    if (this.currentGuildId) {
      await window.Mochi.fetchStats();
      await this.loadOverview();
      window.Mochi.showToast('Metrics refreshed.', 'success');
    }
  }

  async fetchGuildDetails() {
    try {
      const data = await apiFetch(`/api/guilds/${this.currentGuildId}`);
      const totalInvitersEl = document.getElementById('stat-total-inviters');
      const totalMembersEl = document.getElementById('stat-total-members');
      if (totalInvitersEl) totalInvitersEl.textContent = (data.guild.totalInviters || 0).toLocaleString();
      if (totalMembersEl) totalMembersEl.textContent = (data.guild.memberCount || 0).toLocaleString();
    } catch (e) {
      console.error('Error fetching guild details:', e);
    }
  }

  async fetchTopInviters() {
    try {
      const lbData = await apiFetch(`/api/guilds/${this.currentGuildId}/invites/leaderboard?limit=${window.MochiConstants.limits.overviewLeaderboard}`);
      const lbTbody = document.querySelector('#overview-leaderboard-table tbody');
      if (!lbTbody) return;
      lbTbody.innerHTML = '';

      if (lbData.leaderboard.length === 0) {
        lbTbody.innerHTML = `<tr><td colspan="4" class="empty-state">No invites tracked yet.</td></tr>`;
      } else {
        lbData.leaderboard.forEach((r, idx) => {
          const rank = idx + 1;
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td class="rank-cell ${rank <= 3 ? 'rank-top' : ''}">${rank}</td>
            <td>
              <div class="user-cell">
                <img src="${escapeHtml(r.avatar)}" class="user-cell-avatar" alt="" onerror="this.src=window.MochiConstants.discord.defaultAvatar">
                <div>
                  <div class="user-cell-name">${escapeHtml(r.username)}</div>
                <div class="user-cell-id">${escapeHtml(r.userId)}</div>
                </div>
              </div>
            </td>
            <td class="num net">${escapeHtml(r.total)}</td>
            <td class="text-muted text-small">
              ${escapeHtml(r.regular)} regular · ${escapeHtml(r.leaves)} leaves · ${escapeHtml(r.fake)} fake
            </td>
          `;
          lbTbody.appendChild(tr);
        });
      }
    } catch (e) {
      console.error('Error fetching top inviters:', e);
    }
  }

  async fetchRecentJoins() {
    try {
      const histData = await apiFetch(`/api/guilds/${this.currentGuildId}/invites/history?limit=${window.MochiConstants.limits.overviewHistory}`);
      const histTbody = document.querySelector('#overview-history-table tbody');
      if (!histTbody) return;
      histTbody.innerHTML = '';

      if (histData.history.length === 0) {
        histTbody.innerHTML = `<tr><td colspan="4" class="empty-state">No recent joins.</td></tr>`;
      } else {
        histData.history.forEach(j => {
          const tr = document.createElement('tr');
          const isFake = Boolean(j.isFake);
          const isLeft = Boolean(j.isLeft);

          let statusBadge = `<span class="badge badge-success">Active</span>`;
          if (isLeft) statusBadge = `<span class="badge badge-neutral">Left</span>`;
          else if (isFake) statusBadge = `<span class="badge badge-warning">Suspicious</span>`;

          const labelTag = j.inviteLabel ? ` <span class="badge badge-neutral">${escapeHtml(j.inviteLabel)}</span>` : '';

          tr.innerHTML = `
            <td>
              <div class="user-cell">
                <img src="${escapeHtml(j.avatar)}" class="user-cell-avatar" alt="" onerror="this.src=window.MochiConstants.discord.defaultAvatar">
                <div>
                  <div class="user-cell-name">${escapeHtml(j.username)}</div>
                </div>
              </div>
            </td>
            <td><b>${escapeHtml(j.inviterName)}</b></td>
            <td><code>${escapeHtml(j.inviteCode || 'N/A')}</code>${labelTag}</td>
            <td>${statusBadge}</td>
          `;
          histTbody.appendChild(tr);
        });
      }
    } catch (e) {
      console.error('Error fetching recent joins:', e);
    }
  }
}

window.overviewPage = new OverviewPage();
