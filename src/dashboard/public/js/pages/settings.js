/**
 * Settings Page Script
 */

class SettingsPage {
  constructor() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  init() {
    // Initialized alongside Mochi shared
  }

  async refreshStatus() {
    await window.Mochi.fetchStats();
    window.Mochi.showToast('Status refreshed.', 'success');
  }
}

window.settingsPage = new SettingsPage();
