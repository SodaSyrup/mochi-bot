/**
 * 🍡 Overview Page Script
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
      window.Mochi.showToast('Server metrics refreshed!', 'success');
    }
  }

  async fetchGuildDetails() {
    try {
      const res = await fetch(`/api/guilds/${this.currentGuildId}`);
      const data = await res.json();
      const totalInvitersEl = document.getElementById('stat-total-inviters');
      const totalMembersEl = document.getElementById('stat-total-members');
      if (totalInvitersEl) totalInvitersEl.textContent = data.guild.totalInviters || 0;
      if (totalMembersEl) totalMembersEl.textContent = data.guild.memberCount || 0;
    } catch (e) {
      console.error('Error fetching guild details:', e);
    }
  }

  async fetchTopInviters() {
    try {
      const lbRes = await fetch(`/api/guilds/${this.currentGuildId}/invites/leaderboard?limit=5`);
      const lbData = await lbRes.json();
      const lbTbody = document.querySelector('#overview-leaderboard-table tbody');
      if (!lbTbody) return;
      lbTbody.innerHTML = '';

      if (lbData.leaderboard.length === 0) {
        lbTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-dim);">No invites tracked yet.</td></tr>`;
      } else {
        const medals = ['🥇', '🥈', '🥉'];
        lbData.leaderboard.forEach((r, idx) => {
          const rank = idx < 3 ? medals[idx] : `#${idx + 1}`;
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><b>${rank}</b></td>
            <td>
              <div class="user-cell">
                <img src="${r.avatar}" class="user-cell-avatar">
                <div>
                  <div class="user-cell-name">${r.username}</div>
                  <div class="user-cell-id">${r.user_id}</div>
                </div>
              </div>
            </td>
            <td><span class="badge-tag regular"><b>${r.total}</b> Net</span></td>
            <td style="font-size: 12px; color: var(--text-muted);">
              ${r.regular} reg • ${r.leaves} left • ${r.fake} fake
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
      const histRes = await fetch(`/api/guilds/${this.currentGuildId}/invites/history?limit=6`);
      const histData = await histRes.json();
      const histTbody = document.querySelector('#overview-history-table tbody');
      if (!histTbody) return;
      histTbody.innerHTML = '';

      if (histData.history.length === 0) {
        histTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-dim);">No recent joins.</td></tr>`;
      } else {
        histData.history.forEach(j => {
          const tr = document.createElement('tr');
          const isFake = Boolean(j.is_fake);
          const isLeft = Boolean(j.is_left);

          let statusBadge = `<span class="badge-tag regular">✅ Verified</span>`;
          if (isLeft) statusBadge = `<span class="badge-tag leave">🚪 Left</span>`;
          else if (isFake) statusBadge = `<span class="badge-tag fake">⚠️ Fake/Alt</span>`;

          const labelTag = j.invite_label ? ` <span class="badge-label" style="font-size: 11px; padding: 2px 6px;">🏷️ ${j.invite_label}</span>` : '';

          tr.innerHTML = `
            <td>
              <div class="user-cell">
                <img src="${j.avatar}" class="user-cell-avatar">
                <div>
                  <div class="user-cell-name">${j.username}</div>
                </div>
              </div>
            </td>
            <td><b>${j.inviterName}</b></td>
            <td><code>${j.invite_code || 'N/A'}</code>${labelTag}</td>
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
