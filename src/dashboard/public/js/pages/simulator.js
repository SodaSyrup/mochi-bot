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
          const codesRes = await fetch(`/api/guilds/${this.currentGuildId}/invites/active-codes`);
          const codesData = await codesRes.json();
          if (codesData.invites && codesData.invites.length > 0) {
            activeCode = codesData.invites[Math.floor(Math.random() * codesData.invites.length)].code;
          }
        } catch (e) {
          // fallback to default
        }

        const res = await fetch(`/api/guilds/${this.currentGuildId}/simulate/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: name,
            inviterId: '111111111111111111',
            inviteCode: activeCode,
            isFake
          })
        });

        const data = await res.json();
        if (data.success) {
          window.Mochi.showToast(`⚡ Dispatched simulated ${isFake ? 'fake join' : 'join'} event for <b>${name}</b>`, 'success');
        }
      } else if (type === 'leave') {
        const res = await fetch(`/api/guilds/${this.currentGuildId}/simulate/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'mem_111111111111111111_0' })
        });

        const data = await res.json();
        if (data.success) {
          window.Mochi.showToast(`⚡ Dispatched simulated departure event`, 'leave');
        }
      }
    } catch (err) {
      console.error('Error simulating event:', err);
      window.Mochi.showToast('Failed to trigger simulation event', 'leave');
    }
  }

  async simulateAutoMod() {
    const guildId = this.currentGuildId || window.Mochi?.currentGuildId || '999888777666555444';
    try {
      const res = await fetch(`/api/guilds/${guildId}/simulate/automod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ruleName: '🛡️ Block Scam Links & Malicious URLs',
          triggerType: 1,
          username: 'PhishingBot_' + Math.floor(Math.random() * 900 + 100),
          channelName: 'general-chat',
          content: 'Free Discord Nitro 1 Year! Visit https://discord-nitro-claim.gift now!!',
          matchedKeyword: 'discord-nitro-claim.gift',
          actionType: 1
        })
      });

      const data = await res.json();
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
