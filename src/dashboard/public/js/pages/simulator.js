/**
 * WebSocket Event Simulator Page Script
 */

class SimulatorPage {
  constructor() {
    this.currentGuildId = null;
    // The join endpoint generates the simulated member ID when the caller
    // does not provide one. Keep the returned ID so the leave action targets
    // the member that was actually created, rather than a made-up ID.
    this.lastSimulatedMemberIds = new Map();

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
      window.Mochi.showToast('Select a guild first.', 'leave');
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
          const simulatedUserId = data.event?.user?.id;
          if (simulatedUserId) {
            this.lastSimulatedMemberIds.set(this.currentGuildId, simulatedUserId);
          }
          window.Mochi.showToast([{ text: `Dispatched simulated ${isFake ? 'suspicious join' : 'join'} for ` }, { b: name }], 'success');
        } else {
          window.Mochi.showToast('Simulated join was a duplicate or no-op.', 'leave');
        }
      } else if (type === 'leave') {
        const userId = this.lastSimulatedMemberIds.get(this.currentGuildId);
        if (!userId) {
          window.Mochi.showToast('Simulate a member join first.', 'leave');
          return;
        }

        const data = await apiFetch(`/api/guilds/${this.currentGuildId}/simulate/leave`, {
          method: 'POST',
          body: { userId }
        });

        if (data.success) {
          this.lastSimulatedMemberIds.delete(this.currentGuildId);
          window.Mochi.showToast('Dispatched simulated leave.', 'leave');
        } else {
          window.Mochi.showToast('Simulated leave was a duplicate or no-op.', 'leave');
        }
      }
    } catch (err) {
      console.error('Error simulating event:', err);
      window.Mochi.showToast(err.status === 403 ? 'You do not have permission to simulate events.' : 'Could not trigger simulation.', 'leave');
    }
  }

  async simulateAutoMod() {
    const guildId = this.currentGuildId || window.Mochi?.currentGuildId;
    if (!guildId) return;
    try {
      const data = await apiFetch(`/api/guilds/${guildId}/simulate/automod`, {
        method: 'POST',
        body: {
          ruleName: 'Block scam links',
          triggerType: 1,
          username: 'PhishingBot',
          channelName: 'general-chat',
          content: 'Free Discord Nitro 1 Year! Visit https://discord-nitro-claim.gift now!!',
          matchedKeyword: 'discord-nitro-claim.gift',
          actionType: 1
        }
      });

      if (data.success) {
        window.Mochi.showToast('Dispatched simulated AutoMod action.', 'leave');
      }
    } catch (err) {
      console.error('Error simulating AutoMod:', err);
      window.Mochi.showToast('Could not trigger AutoMod simulation.', 'leave');
    }
  }
}

window.simulatorPage = new SimulatorPage();
