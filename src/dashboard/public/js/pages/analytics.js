/**
 * 🍡 Analytics Page Script
 */

class AnalyticsPage {
  constructor() {
    this.currentGuildId = null;
    this.growthChart = null;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  init() {
    window.Mochi.onGuildChange((guildId) => {
      this.currentGuildId = guildId;
      this.fetchAnalytics();
    });

    window.Mochi.onRealtime('memberJoin', () => {
      this.fetchAnalytics();
    });

    window.Mochi.onRealtime('memberLeave', () => {
      this.fetchAnalytics();
    });
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
}

window.analyticsPage = new AnalyticsPage();
