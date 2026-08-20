// Demo fixtures. All hard-coded demo IDs, names, users, channels, roles,
// AutoMod rules and sample invite codes live here and nowhere else in the
// application. Live/demo selection happens exactly once at composition time.

const DEMO_GUILD_ID = '999888777666555444';
const DEMO_ADMIN_ID = '123456789012345678';

const DEMO_GUILD = Object.freeze({
  id: DEMO_GUILD_ID,
  name: 'Mochi Hangout [Demo]',
  icon: 'https://cdn.discordapp.com/embed/avatars/1.png',
  memberCount: 248,
  ownerId: DEMO_ADMIN_ID,
  isSimulated: true,
  features: ['COMMUNITY', 'AUTO_MODERATION', 'INVITE_SPLASH'],
});

const DEMO_USERS = Object.freeze({
  [DEMO_ADMIN_ID]: { id: DEMO_ADMIN_ID, username: 'MochiAdmin', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png' },
  '111111111111111111': { id: '111111111111111111', username: 'TopInviter_Sakura', avatar: 'https://cdn.discordapp.com/embed/avatars/1.png' },
  '222222222222222222': { id: '222222222222222222', username: 'Luna_Star', avatar: 'https://cdn.discordapp.com/embed/avatars/2.png' },
});

const DEMO_CHANNELS = Object.freeze([
  { id: 'chan_welcome', name: 'welcome', type: 0, position: 0 },
  { id: 'chan_general', name: 'general-chat', type: 0, position: 1 },
  { id: 'chan_announcements', name: 'announcements', type: 5, position: 2 },
  { id: 'chan_community', name: 'community-lounge', type: 0, position: 3 },
  { id: 'chan_giveaways', name: 'giveaways', type: 0, position: 4 },
]);

const DEMO_ROLES = Object.freeze([
  { id: 'role_admin', name: 'Server Admin', color: '#f43f5e', position: 10, managed: false },
  { id: 'role_mod', name: 'Moderator', color: '#8b5cf6', position: 8, managed: false },
  { id: 'role_vip', name: 'VIP Supporter', color: '#eab308', position: 5, managed: false },
  { id: 'role_bots', name: 'Verified Bots', color: '#06b6d4', position: 3, managed: true },
  { id: 'role_member', name: 'Community Member', color: '#10b981', position: 1, managed: false },
]);

const DEMO_INVITES = Object.freeze([
  {
    code: 'mochi-welcome',
    uses: 48,
    maxUses: 0,
    maxAge: 0,
    temporary: false,
    inviterId: '111111111111111111',
    channelId: 'chan_welcome',
    channelName: 'welcome',
    createdAt: null,
    expiresAt: null,
  },
  {
    code: 'mochi-twitter',
    uses: 32,
    maxUses: 100,
    maxAge: 0,
    temporary: false,
    inviterId: DEMO_ADMIN_ID,
    channelId: 'chan_general',
    channelName: 'general-chat',
    createdAt: null,
    expiresAt: null,
  },
  {
    code: 'mochi-partner',
    uses: 12,
    maxUses: 50,
    maxAge: 0,
    temporary: false,
    inviterId: DEMO_ADMIN_ID,
    channelId: 'chan_community',
    channelName: 'community-lounge',
    createdAt: null,
    expiresAt: null,
  },
]);

const DEMO_LABELS = Object.freeze({
  'mochi-welcome': { label: 'Official Welcome Link', channelId: 'chan_welcome', channelName: 'welcome' },
  'mochi-twitter': { label: 'Twitter Campaign', channelId: 'chan_general', channelName: 'general-chat' },
  'mochi-partner': { label: 'Partner Sponsorship', channelId: 'chan_community', channelName: 'community-lounge' },
});

const DEMO_MEMBERS = Object.freeze([
  { id: '111111111111111111', username: 'TopInviter_Sakura', bot: false },
  { id: '222222222222222222', username: 'Luna_Star', bot: false },
  { id: DEMO_ADMIN_ID, username: 'MochiAdmin', bot: false },
  { id: '333333333333333333', username: 'NekoDev', bot: false },
  { id: '444444444444444444', username: 'MatchaQueen', bot: false },
  { id: '555555555555555555', username: 'AstroCat', bot: false },
  { id: '666666666666666666', username: 'RamenRider', bot: false },
]);

const DEMO_AUTOMOD_RULES = Object.freeze([
  {
    id: 'automod_rule_1',
    name: 'Block Scam Links and Malicious URLs',
    enabled: true,
    eventType: 1,
    triggerType: 1,
    triggerMetadata: {
      keywordFilter: ['*discord.gg/*', '*nitro-drop*.ru*', '*steamcommunity.gift*'],
      regexPatterns: ['https?:\\/\\/(?:www\\.)?dis[c|k]ord-(?:gift|nitro)\\.[a-z]{2,8}'],
      presets: [],
      allowList: ['discord.gg/mochihangout'],
      mentionTotalLimit: 0,
      mentionRaidProtectionEnabled: false,
    },
    actions: [
      { type: 1, metadata: { customMessage: 'Posting unauthorized invite links or malicious domains is forbidden.' } },
      { type: 2, metadata: { channelId: 'chan_announcements' } },
    ],
    exemptRoles: ['role_admin', 'role_mod'],
    exemptChannels: ['chan_community'],
    creatorId: DEMO_ADMIN_ID,
  },
  {
    id: 'automod_rule_2',
    name: 'Anti-Spam and Profanity Filter',
    enabled: true,
    eventType: 1,
    triggerType: 4,
    triggerMetadata: {
      keywordFilter: [],
      regexPatterns: [],
      presets: [1, 2, 3],
      allowList: [],
      mentionTotalLimit: 0,
      mentionRaidProtectionEnabled: false,
    },
    actions: [
      { type: 1, metadata: { customMessage: 'Message blocked due to server safety policy.' } },
      { type: 3, metadata: { durationSeconds: 300 } },
    ],
    exemptRoles: ['role_admin'],
    exemptChannels: [],
    creatorId: DEMO_ADMIN_ID,
  },
  {
    id: 'automod_rule_3',
    name: 'Anti-Mention Raid Protection (Limit 5)',
    enabled: true,
    eventType: 1,
    triggerType: 5,
    triggerMetadata: {
      keywordFilter: [],
      regexPatterns: [],
      presets: [],
      allowList: [],
      mentionTotalLimit: 5,
      mentionRaidProtectionEnabled: true,
    },
    actions: [
      { type: 1, metadata: { customMessage: 'Excessive mentions detected and blocked.' } },
      { type: 3, metadata: { durationSeconds: 600 } },
    ],
    exemptRoles: ['role_admin', 'role_mod'],
    exemptChannels: [],
    creatorId: DEMO_ADMIN_ID,
  },
  {
    id: 'automod_rule_4',
    name: 'Impersonation and Profile Blocker',
    enabled: false,
    eventType: 2,
    triggerType: 6,
    triggerMetadata: {
      keywordFilter: ['free nitro', 'airdrop bot', 'discord mod', 'official mochi staff'],
      regexPatterns: [],
      presets: [],
      allowList: [],
      mentionTotalLimit: 0,
      mentionRaidProtectionEnabled: false,
    },
    actions: [{ type: 4, metadata: {} }],
    exemptRoles: ['role_admin'],
    exemptChannels: [],
    creatorId: DEMO_ADMIN_ID,
  },
]);

module.exports = {
  DEMO_GUILD_ID,
  DEMO_ADMIN_ID,
  DEMO_GUILD,
  DEMO_USERS,
  DEMO_CHANNELS,
  DEMO_ROLES,
  DEMO_INVITES,
  DEMO_LABELS,
  DEMO_MEMBERS,
  DEMO_AUTOMOD_RULES,
};
