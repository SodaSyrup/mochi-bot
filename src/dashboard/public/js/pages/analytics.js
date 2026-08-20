/**
 * 🍡 Analytics Page Script
 * Interactive Growth Metrics & Member Activity Audit Trail
 */

class AnalyticsPage {
  constructor() {
    this.currentGuildId = null;
    this.growthChart = null;
    this.currentFilter = 'all';
    this.searchQuery = '';
    this.currentPage = 0;
    this.pageSize = 15;
    this.totalEntries = 0;
    this.searchDebounceTimer = null;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  init() {
    window.Mochi.onGuildChange((guildId) => {
      this.currentGuildId = guildId;
      this.currentPage = 0;
      this.refreshAll();
    });

    window.Mochi.onRealtime('memberJoin', (eventData) => {
      this.fetchAnalytics();
      this.fetchActivityLog();
    });

    window.Mochi.onRealtime('memberLeave', (eventData) => {
      this.fetchAnalytics();
      this.fetchActivityLog();
    });
  }

  refreshAll() {
    this.fetchAnalytics();
    this.fetchActivityLog();
  }

  async syncHistoricalMembers() {
    if (!this.currentGuildId) return;

    const btn = document.getElementById('btn-sync-members');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing...';
    }

    try {
      const res = await fetch(`/api/guilds/${this.currentGuildId}/invites/sync-members`, { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        window.Mochi?.showToast(`✅ ${data.message}`, 'success');
        this.fetchActivityLog(); // Refresh table to show newly synced members
      } else {
        window.Mochi?.showToast(`ℹ️ ${data.message}`, 'leave');
      }
    } catch (e) {
      console.error('Error syncing historical members:', e);
      window.Mochi?.showToast('❌ Failed to sync historical members.', 'leave');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Sync Historical Members';
      }
    }
  }

  setFilter(filter) {
    this.currentFilter = filter;
    this.currentPage = 0;

    // Update active tab buttons
    document.querySelectorAll('#activity-filter-tabs .filter-tab').forEach(tab => {
      if (tab.dataset.filter === filter) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    this.fetchActivityLog();
  }

  handleSearch(value) {
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.searchQuery = value.trim();
      this.currentPage = 0;
      this.fetchActivityLog();
    }, 250);
  }

  prevPage() {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.fetchActivityLog();
    }
  }

  nextPage() {
    if ((this.currentPage + 1) * this.pageSize < this.totalEntries) {
      this.currentPage++;
      this.fetchActivityLog();
    }
  }

  async fetchAnalytics() {
    if (!this.currentGuildId) return;

    try {
      const res = await fetch(`/api/guilds/${this.currentGuildId}/invites/analytics?days=7`);
      const data = await res.json();
      const stats = data.analytics || [];

      const labels = stats.map(s => s.date);
      const joinsData = stats.map(s => s.joins);
      const leavesData = stats.map(s => s.leaves);
      const fakesData = stats.map(s => s.fakes);

      const chartEl = document.getElementById('growthChart');
      if (!chartEl) return;
      const ctx = chartEl.getContext('2d');

      if (this.growthChart) {
        this.growthChart.destroy();
      }

      this.growthChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Member Joins',
              data: joinsData,
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              fill: true,
              tension: 0.35,
              borderWidth: 3
            },
            {
              label: 'Departures',
              data: leavesData,
              borderColor: '#f43f5e',
              backgroundColor: 'rgba(244, 63, 94, 0.08)',
              fill: true,
              tension: 0.35,
              borderWidth: 2
            },
            {
              label: 'Fake / Alt Accounts',
              data: fakesData,
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245, 158, 11, 0.05)',
              fill: true,
              tension: 0.35,
              borderWidth: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: '#94a3b8', font: { family: 'Inter', size: 12, weight: 500 } }
            }
          },
          scales: {
            x: {
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: '#64748b' }
            },
            y: {
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: '#64748b', stepSize: 1 }
            }
          }
        }
      });
    } catch (e) {
      console.error('Error rendering analytics chart:', e);
    }
  }

  async fetchActivityLog() {
    if (!this.currentGuildId) return;

    const tbody = document.getElementById('activity-table-body');
    if (!tbody) return;

    const offset = this.currentPage * this.pageSize;
    const searchParam = encodeURIComponent(this.searchQuery);
    const filterParam = encodeURIComponent(this.currentFilter);

    try {
      const url = `/api/guilds/${this.currentGuildId}/invites/activity-log?limit=${this.pageSize}&offset=${offset}&filter=${filterParam}&search=${searchParam}`;
      const res = await fetch(url);
      const data = await res.json();

      const items = data.items || [];
      this.totalEntries = data.total || 0;
      const summary = data.summary || { total: 0, joins: 0, leaves: 0, fakes: 0 };

      // Update stat cards
      const elJoins = document.getElementById('stat-active-joins');
      const elLeaves = document.getElementById('stat-total-leaves');
      const elFakes = document.getElementById('stat-total-fakes');
      const elRate = document.getElementById('stat-retention-rate');

      if (elJoins) elJoins.textContent = summary.joins.toLocaleString();
      if (elLeaves) elLeaves.textContent = summary.leaves.toLocaleString();
      if (elFakes) elFakes.textContent = summary.fakes.toLocaleString();

      if (elRate) {
        const totalEvents = (summary.joins + summary.leaves) || 0;
        const rate = totalEvents > 0 ? Math.round((summary.joins / totalEvents) * 100) : 100;
        elRate.textContent = `${rate}%`;
      }

      // Update tab counter badges
      const countAll = document.getElementById('count-all');
      const countJoins = document.getElementById('count-joins');
      const countLeaves = document.getElementById('count-leaves');
      const countFakes = document.getElementById('count-fakes');

      if (countAll) countAll.textContent = summary.total || 0;
      if (countJoins) countJoins.textContent = summary.joins || 0;
      if (countLeaves) countLeaves.textContent = summary.leaves || 0;
      if (countFakes) countFakes.textContent = summary.fakes || 0;

      // Update pagination controls
      const pagBar = document.getElementById('activity-pagination-bar');
      const pagInfo = document.getElementById('pagination-info');
      const btnPrev = document.getElementById('btn-prev-page');
      const btnNext = document.getElementById('btn-next-page');

      if (pagBar) {
        pagBar.style.display = this.totalEntries > 0 ? 'flex' : 'none';
      }

      if (pagInfo) {
        const start = this.totalEntries === 0 ? 0 : offset + 1;
        const end = Math.min(offset + items.length, this.totalEntries);
        pagInfo.textContent = `Showing ${start}-${end} of ${this.totalEntries} entries`;
      }

      if (btnPrev) btnPrev.disabled = this.currentPage === 0;
      if (btnNext) btnNext.disabled = (this.currentPage + 1) * this.pageSize >= this.totalEntries;

      // Render table rows
      if (items.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; color: var(--text-dim); padding: 36px 12px;">
              <div style="font-size: 28px; margin-bottom: 8px;">🔍</div>
              <div style="font-weight: 500; color: var(--text-main);">No activity records found</div>
              <div style="font-size: 12px; margin-top: 4px;">Try changing the filter tabs or clearing your search term.</div>
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = items.map(item => this.renderTableRow(item)).join('');
    } catch (e) {
      console.error('Error fetching activity log:', e);
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; color: var(--accent-rose); padding: 24px;">
            <i class="fa-solid fa-circle-exclamation"></i> Failed to load activity log. Please try again.
          </td>
        </tr>
      `;
    }
  }

  renderTableRow(item) {
    const isLeft = item.isLeft;
    const isFake = item.isFake;
    const eventTime = isLeft && item.leftAt ? item.leftAt : item.joinedAt;
    const relativeTime = this.formatRelativeTime(eventTime);
    const fullDate = eventTime ? new Date(eventTime).toLocaleString() : 'Unknown';

    // Activity description cell
    let actionBadge = '';
    let actionDetail = '';

    if (isLeft) {
      actionBadge = `<span class="badge-tag leave"><i class="fa-solid fa-arrow-right-from-bracket"></i> Left Server</span>`;
      actionDetail = `<span class="audit-action-subtitle">Member departed after joining on ${item.joinedAt ? new Date(item.joinedAt).toLocaleDateString() : 'N/A'}</span>`;
    } else if (isFake && item.isPreExisting) {
      actionBadge = `<span class="badge-tag fake"><i class="fa-solid fa-clock-rotate-left"></i> Pre-Bot Join (Suspicious)</span>`;
      actionDetail = `<span class="audit-action-subtitle">Account was young when they joined — recorded from historical member list</span>`;
    } else if (item.isPreExisting) {
      actionBadge = `<span class="badge-tag bonus"><i class="fa-solid fa-clock-rotate-left"></i> Joined Prior to Bot</span>`;
      actionDetail = `<span class="audit-action-subtitle">Historical member — invite attribution not available</span>`;
    } else if (isFake) {
      actionBadge = `<span class="badge-tag fake"><i class="fa-solid fa-triangle-exclamation"></i> Suspicious Join</span>`;
      actionDetail = `<span class="audit-action-subtitle">Account created within threshold (possible alt/bot)</span>`;
    } else {
      actionBadge = `<span class="badge-tag regular"><i class="fa-solid fa-arrow-right-to-bracket"></i> Joined Server</span>`;
      const labelBadge = item.inviteLabel ? `<span class="badge-label" style="font-size: 11px; margin-left: 4px;">🏷️ ${this.escapeHtml(item.inviteLabel)}</span>` : '';
      actionDetail = `<span class="audit-action-subtitle">Via <code>${this.escapeHtml(item.inviteCode)}</code>${labelBadge}</span>`;
    }

    // Authenticity Status Badge
    let statusBadge = '';
    if (isFake && item.isPreExisting) {
      statusBadge = `<span class="badge-tag fake" title="Account was young relative to its server join date"><i class="fa-solid fa-shield-virus"></i> Pre-Bot / Suspicious</span>`;
    } else if (isFake) {
      statusBadge = `<span class="badge-tag fake" title="Flagged: Account age less than configured safety threshold"><i class="fa-solid fa-shield-virus"></i> Fake / Alt</span>`;
    } else if (isLeft) {
      statusBadge = `<span class="badge-tag leave" title="Member is no longer in server"><i class="fa-solid fa-user-xmark"></i> Departed</span>`;
    } else if (item.isPreExisting) {
      statusBadge = `<span class="badge-tag bonus" title="Member was present before the bot was added"><i class="fa-solid fa-hourglass-start"></i> Pre-Existing</span>`;
    } else {
      statusBadge = `<span class="badge-tag regular" title="Verified active server member"><i class="fa-solid fa-shield-check"></i> Verified Member</span>`;
    }

    // Inviter column
    let inviterContent = '';
    if (item.isPreExisting) {
      inviterContent = `<span class="badge-tag bonus" title="Joined before Mochi was added — no invite data available"><i class="fa-solid fa-clock-rotate-left"></i> Not Available</span>`;
    } else if (item.inviterId === 'VANITY') {
      inviterContent = `<span class="badge-tag bonus"><i class="fa-solid fa-globe"></i> Vanity URL</span>`;
    } else if (!item.inviterId || item.inviterId === 'UNKNOWN') {
      inviterContent = `<span style="color: var(--text-dim); font-size: 12px;"><i class="fa-solid fa-question-circle"></i> Unknown / Direct</span>`;
    } else {
      inviterContent = `
        <div class="member-profile-cell">
          <img src="${item.inviterAvatar}" class="member-avatar-img" style="width: 24px; height: 24px;" alt="Inviter" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
          <div class="member-meta-info">
            <span style="font-size: 12.5px; font-weight: 500; color: var(--text-main);">${this.escapeHtml(item.inviterName || 'Unknown')}</span>
            <span class="member-id-text">${item.inviterId || 'N/A'}</span>
          </div>
        </div>
      `;
    }

    return `
      <tr>
        <td>
          <div class="member-profile-cell">
            <img src="${item.avatar}" class="member-avatar-img" alt="Avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <div class="member-meta-info">
              <span class="member-name-text">${this.escapeHtml(item.username)}</span>
              <span class="member-id-text">${item.userId}</span>
            </div>
          </div>
        </td>
        <td>
          <div class="audit-action-cell">
            <div class="audit-action-title">${actionBadge}</div>
            ${actionDetail}
          </div>
        </td>
        <td>${inviterContent}</td>
        <td>${statusBadge}</td>
        <td style="white-space: nowrap;">
          <span style="font-size: 12.5px; font-weight: 500;" title="${fullDate}">${relativeTime}</span>
          <div style="font-size: 11px; color: var(--text-dim);">${eventTime ? new Date(eventTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</div>
        </td>
      </tr>
    `;
  }

  formatRelativeTime(dateString) {
    if (!dateString) return 'Just now';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return 'Recently';

    const now = new Date();
    const diffSec = Math.floor((now - d) / 1000);

    if (diffSec < 45) return 'Just now';
    if (diffSec < 90) return '1 minute ago';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 172800) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

window.analyticsPage = new AnalyticsPage();
