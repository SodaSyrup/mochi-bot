/**
 * Analytics Page Script
 * Growth metrics, chart, and member activity audit trail.
 */

class AnalyticsPage {
  constructor() {
    this.currentGuildId = null;
    this.growthChart = null;
    this.currentFilter = 'all';
    this.searchQuery = '';
    this.currentPage = 0;
    this.pageSize = window.MochiConstants.limits.analyticsPageSize;
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

    window.Mochi.onRealtime('memberJoin', () => {
      this.fetchAnalytics();
      this.fetchActivityLog();
    });

    window.Mochi.onRealtime('memberLeave', () => {
      this.fetchAnalytics();
      this.fetchActivityLog();
    });
  }

  refreshAll() {
    this.fetchAnalytics();
    this.fetchActivityLog();
  }

  async reconcileMembers() {
    if (!this.currentGuildId) return;

    const btn = document.getElementById('btn-reconcile-members');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Reconciling…';
    }

    try {
      const data = await apiFetch(`/api/guilds/${this.currentGuildId}/invites/reconcile-members`, { method: 'POST' });

      if (data.success) {
        window.Mochi?.showToast(data.message, 'success');
        this.fetchActivityLog();
      } else {
        window.Mochi?.showToast(data.message, 'leave');
      }
    } catch (e) {
      console.error('Error reconciling members:', e);
      window.Mochi?.showToast('Could not reconcile members.', 'leave');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> Reconcile members';
      }
    }
  }

  setFilter(filter) {
    this.currentFilter = filter;
    this.currentPage = 0;

    document.querySelectorAll('#activity-filter-tabs .tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.filter === filter);
    });

    this.fetchActivityLog();
  }

  handleSearch(value) {
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.searchQuery = value.trim();
      this.currentPage = 0;
      this.fetchActivityLog();
    }, window.MochiConstants.limits.searchDebounceMs);
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
      const res = await apiFetch(`/api/guilds/${this.currentGuildId}/invites/analytics?days=${window.MochiConstants.limits.analyticsDays}`);
      const stats = res.analytics || [];

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
              label: 'Joins',
              data: joinsData,
              borderColor: window.MochiConstants.colors.success,
              backgroundColor: 'transparent',
              fill: false,
              tension: 0.3,
              borderWidth: 2,
              pointRadius: 2
            },
            {
              label: 'Leaves',
              data: leavesData,
              borderColor: window.MochiConstants.colors.danger,
              backgroundColor: 'transparent',
              fill: false,
              tension: 0.3,
              borderWidth: 2,
              pointRadius: 2
            },
            {
              label: 'Suspicious',
              data: fakesData,
              borderColor: window.MochiConstants.colors.warning,
              backgroundColor: 'transparent',
              fill: false,
              tension: 0.3,
              borderWidth: 2,
              pointRadius: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: window.MochiConstants.colors.textSecondary, font: { size: 12 } }
            }
          },
          scales: {
            x: {
              grid: { color: window.MochiConstants.colors.chartGrid },
              ticks: { color: window.MochiConstants.colors.textMuted }
            },
            y: {
              beginAtZero: true,
              grid: { color: window.MochiConstants.colors.chartGrid },
              ticks: { color: window.MochiConstants.colors.textMuted, precision: 0 }
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
      const data = await apiFetch(url);

      const items = data.items || [];
      this.totalEntries = data.total || 0;
      const summary = data.summary || { total: 0, joins: 0, leaves: 0, fakes: 0 };

      // Update metric values
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

      // Update tab counts
      const countAll = document.getElementById('count-all');
      const countJoins = document.getElementById('count-joins');
      const countLeaves = document.getElementById('count-leaves');
      const countFakes = document.getElementById('count-fakes');

      if (countAll) countAll.textContent = summary.total || 0;
      if (countJoins) countJoins.textContent = summary.joins || 0;
      if (countLeaves) countLeaves.textContent = summary.leaves || 0;
      if (countFakes) countFakes.textContent = summary.fakes || 0;

      // Pagination controls
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
        pagInfo.textContent = `Showing ${start}–${end} of ${this.totalEntries}`;
      }

      if (btnPrev) btnPrev.disabled = this.currentPage === 0;
      if (btnNext) btnNext.disabled = (this.currentPage + 1) * this.pageSize >= this.totalEntries;

      // Render rows
      if (items.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" class="empty-state">
              <div class="empty-title">No activity records found.</div>
              <div class="empty-hint">Try changing the filter or clearing your search.</div>
            </td>
          </tr>`;
        return;
      }

      tbody.innerHTML = items.map(item => this.renderTableRow(item)).join('');
    } catch (e) {
      console.error('Error fetching activity log:', e);
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-state">Could not load activity. Try again.</td>
        </tr>`;
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
      actionBadge = `<span class="badge badge-neutral">Left server</span>`;
      actionDetail = `Departed after joining ${item.joinedAt ? new Date(item.joinedAt).toLocaleDateString() : 'N/A'}.`;
    } else if (isFake && item.isReconciled) {
      actionBadge = `<span class="badge badge-warning">Reconciled join (suspicious)</span>`;
      actionDetail = 'Account was young when it joined — invite attribution was not available.';
    } else if (item.isReconciled) {
      actionBadge = `<span class="badge badge-neutral">Reconciled join</span>`;
      actionDetail = 'Member discovered during authoritative reconciliation — invite attribution not available.';
    } else if (isFake) {
      actionBadge = `<span class="badge badge-warning">Suspicious join</span>`;
      actionDetail = 'Account created within the threshold (possible alt or bot).';
    } else {
      actionBadge = `<span class="badge badge-success">Joined server</span>`;
      const labelBadge = item.inviteLabel ? ` <span class="badge badge-neutral">${this.escapeHtml(item.inviteLabel)}</span>` : '';
      actionDetail = `Via <code>${this.escapeHtml(item.inviteCode)}</code>${labelBadge}`;
    }

    // Status badge
    let statusBadge = '';
    if (isFake && item.isReconciled) {
      statusBadge = `<span class="badge badge-warning">Suspicious</span>`;
    } else if (isFake) {
      statusBadge = `<span class="badge badge-warning">Suspicious</span>`;
    } else if (isLeft) {
      statusBadge = `<span class="badge badge-neutral">Departed</span>`;
    } else if (item.isReconciled) {
      statusBadge = `<span class="badge badge-neutral">Reconciled</span>`;
    } else {
      statusBadge = `<span class="badge badge-success">Active</span>`;
    }

    // Inviter column
    const attributionType = item.attribution?.type || '';
    const inviterId = item.attribution?.inviterId || null;
    let inviterContent = '';
    if (item.isReconciled) {
      inviterContent = `<span class="text-muted text-small">Not available</span>`;
    } else if (attributionType === 'VANITY') {
      inviterContent = `<span class="text-secondary">Vanity URL</span>`;
    } else if (attributionType === 'UNKNOWN' || !inviterId) {
      inviterContent = `<span class="text-muted text-small">Unknown / direct</span>`;
    } else {
      inviterContent = `
        <div class="member-profile-cell">
              <img src="${this.escapeHtml(item.inviterAvatar)}" class="member-avatar-img" alt="" onerror="this.src=window.MochiConstants.discord.defaultAvatar">
          <div class="member-meta-info">
            <span class="member-name-text">${this.escapeHtml(item.inviterName || 'Unknown')}</span>
            <span class="member-id-text">${this.escapeHtml(inviterId)}</span>
          </div>
        </div>
      `;
    }

    return `
      <tr>
        <td>
          <div class="member-profile-cell">
              <img src="${this.escapeHtml(item.avatar)}" class="member-avatar-img" alt="" onerror="this.src=window.MochiConstants.discord.defaultAvatar">
            <div class="member-meta-info">
              <span class="member-name-text">${this.escapeHtml(item.username)}</span>
              <span class="member-id-text">${this.escapeHtml(item.userId)}</span>
            </div>
          </div>
        </td>
        <td>
          <div class="audit-action-cell">
            <div class="audit-action-title">${actionBadge}</div>
            <div class="audit-action-subtitle">${actionDetail}</div>
          </div>
        </td>
        <td>${inviterContent}</td>
        <td>${statusBadge}</td>
        <td>
          <span class="text-secondary nowrap" title="${this.escapeHtml(fullDate)}">${relativeTime}</span>
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
