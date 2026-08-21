/** Shared browser-side contract and presentation constants. */
(function (global) {
  'use strict';

  const constants = Object.freeze({
    storage: Object.freeze({ selectedGuild: 'mochi_selected_guild' }),
    events: Object.freeze([
      'memberJoin', 'memberLeave', 'inviteCreated', 'inviteLabelUpdated',
      'inviteDeleted', 'autoModExecution', 'autoModRuleUpdated', 'honeypotTriggered',
    ]),
    limits: Object.freeze({
      analyticsDays: 7,
      analyticsPageSize: 15,
      overviewLeaderboard: 5,
      overviewHistory: 6,
      leaderboardPageSize: 25,
      recentHoneypotKicks: 10,
      incidentBuffer: 20,
      toastDurationMs: 4000,
      toastExitMs: 200,
      searchDebounceMs: 250,
    }),
    discord: Object.freeze({
      defaultAvatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
      inviteBaseUrl: 'https://discord.gg',
    }),
    colors: Object.freeze({
      success: '#3ba55d',
      danger: '#d9534f',
      warning: '#d9a441',
      textSecondary: '#b5bac1',
      textMuted: '#80848e',
      chartGrid: 'rgba(255, 255, 255, 0.05)',
    }),
    autoMod: Object.freeze({
      eventMessageSend: 1,
      eventMemberUpdate: 2,
      triggerKeyword: 1,
      triggerSpam: 3,
      triggerKeywordPreset: 4,
      triggerMentionSpam: 5,
      triggerMemberProfile: 6,
      actionBlockMessage: 1,
      actionAlert: 2,
      actionTimeout: 3,
      actionBlockProfile: 4,
      presetProfanity: 1,
      presetSexual: 2,
      presetSlurs: 3,
      mentionMin: 1,
      mentionMax: 50,
      defaultMentionLimit: 5,
      defaultTimeoutSeconds: 300,
    }),
  });

  global.MochiConstants = constants;
  if (typeof module !== 'undefined' && module.exports) module.exports = constants;
})(typeof window !== 'undefined' ? window : globalThis);
