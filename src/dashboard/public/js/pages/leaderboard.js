/**
 * 🍡 Leaderboard Page Script
 */

class LeaderboardPage {
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
      this.fetchLeaderboard();
    });

    window.Mochi.onRealtime('memberJoin', () => {
      this.fetchLeaderboard();
    });

    window.Mochi.onRealtime('memberLeave', () => {
      this.fetchLeaderboard();
    });
  }

  async fetchLeaderboard() {
    if (!this.currentGuildId) return;

    try {
      const data = await apiFetch(`/api/guilds/${this.currentGuildId}/invites/leaderboard?limit=25`);
      const tbody = document.querySelector('#full-leaderboard-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (!data.leaderboard || data.leaderboard.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim);">No inviters found.</td></tr>`;
        return;
      }

      const medals = ['🥇', '🥈', '🥉'];
      data.leaderboard.forEach((r, idx) => {
        const rank = idx < 3 ? medals[idx] : `#${idx + 1}`;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><b>${escapeHtml(rank)}</b></td>
          <td>
            <div class="user-cell">
              <img src="${escapeHtml(r.avatar)}" class="user-cell-avatar">
              <div>
                <div class="user-cell-name">${escapeHtml(r.username)}</div>
                <div class="user-cell-id">${escapeHtml(r.user_id)}</div>
              </div>
            </div>
          </td>
          <td><span class="badge-tag regular"><b>${escapeHtml(r.total)}</b> Net</span></td>
          <td><span class="badge-tag regular">${escapeHtml(r.regular)}</span></td>
          <td><span class="badge-tag leave">${escapeHtml(r.leaves)}</span></td>
          <td><span class="badge-tag fake">${escapeHtml(r.fake)}</span></td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error('Error fetching leaderboard:', e);
    }
  }
}

window.leaderboardPage = new LeaderboardPage();
