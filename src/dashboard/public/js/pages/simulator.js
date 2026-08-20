/**
 * 🍡 WebSocket Event Simulator Page Script
 */

class SimulatorPage {
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
    });
  }

  async simulateEvent(type, isFake = false) {
    if (!this.currentGuildId) {
      window.Mochi.showToast('Please select a guild first', 'leave');
      return;
    }

    try {
      if (type === 'join') {
        const randomNames = ['Sakura_Fox', 'KuroNeko', 'MatchaLatte', 'AstroCoder', 'LunaStar', 'MochiFan99'];
        const name = randomNames[Math.floor(Math.random() * randomNames.length)];

        // Fetch active codes to use a real code if available
        let activeCode = 'mochi-welcome';
        try {
          const codesData = await apiFetch(`/api/guilds/${this.currentGuildId}/invites/active-codes`);
          if (codesData.invites && codesData.invites.length > 0) {
            activeCode = codesData.invites[Math.floor(Math.random() * codesData.invites.length)].code;
          }
        } catch (e) {
          // fallback to default
        }

        const data = await apiFetch(`/api/guilds/${this.currentGuildId}/simulate/join`, {
          method: 'POST',
          body: {
            username: name,
            inviterId: '111111111111111111',
            inviteCode: activeCode,
            isFake
          }
        });

        if (data.success) {
          window.Mochi.showToast([{ text: `Dispatched simulated ${isFake ? 'fake join' : 'join'} event for ` }, { b: name }], 'success');
        } else {
          window.Mochi.showToast('Simulated join was a duplicate/no-op.', 'leave');
        }
      } else if (type === 'leave') {
        const data = await apiFetch(`/api/guilds/${this.currentGuildId}/simulate/leave`, {
          method: 'POST',
          body: { userId: 'mem_111111111111111111_0' }
        });

        if (data.success) {
          window.Mochi.showToast('Dispatched simulated departure event', 'leave');
        } else {
          window.Mochi.showToast('Simulated leave was a duplicate/no-op.', 'leave');
        }
      }
    } catch (err) {
      console.error('Error simulating event:', err);
      window.Mochi.showToast(err.status === 403 ? 'You do not have permission to simulate events.' : 'Failed to trigger simulation event', 'leave');
    }
  }

  async simulateAutoMod() {
    const guildId = this.currentGuildId || window.Mochi?.currentGuildId;
    if (!guildId) return;
    try {
      const data = await apiFetch(`/api/guilds/${guildId}/simulate/automod`, {
        method: 'POST',
        body: {
          ruleName: '🛡️ Block Scam Links & Malicious URLs',
          triggerType: 1,
          username: 'PhishingBot',
          channelName: 'general-chat',
          content: 'Free Discord Nitro 1 Year! Visit https://discord-nitro-claim.gift now!!',
          matchedKeyword: 'discord-nitro-claim.gift',
          actionType: 1
        }
      });

      if (data.success) {
        window.Mochi.showToast('🚨 Dispatched simulated AutoMod interception event!', 'leave');
      }
    } catch (err) {
      console.error('Error simulating AutoMod:', err);
      window.Mochi.showToast('Failed to trigger AutoMod simulation', 'leave');
    }
  }
}

window.simulatorPage = new SimulatorPage();
