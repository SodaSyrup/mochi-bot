/**
 * Leaderboard Page Script
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
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No inviters found.</td></tr>`;
        return;
      }

      data.leaderboard.forEach((r, idx) => {
        const rank = idx + 1;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="rank-cell ${rank <= 3 ? 'rank-top' : ''}">${rank}</td>
          <td>
            <div class="user-cell">
              <img src="${escapeHtml(r.avatar)}" class="user-cell-avatar" alt="" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
              <div>
                <div class="user-cell-name">${escapeHtml(r.username)}</div>
                <div class="user-cell-id">${escapeHtml(r.userId)}</div>
              </div>
            </div>
          </td>
          <td class="num net">${escapeHtml(r.total)}</td>
          <td class="num">${escapeHtml(r.regular)}</td>
          <td class="num">${escapeHtml(r.bonus)}</td>
          <td class="num">${escapeHtml(r.leaves)}</td>
          <td class="num">${escapeHtml(r.fake)}</td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error('Error fetching leaderboard:', e);
    }
  }
}

window.leaderboardPage = new LeaderboardPage();
