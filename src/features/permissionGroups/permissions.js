const { PermissionFlagsBits } = require('discord.js');

// Channel-level permissions that are useful on category overwrites. Keeping
// this list explicit also gives the dashboard stable labels and prevents
// arbitrary bitfields from being written through the API.
const CATEGORY_PERMISSIONS = Object.freeze([
  ['ViewChannel', 'View channel'],
  ['ManageChannels', 'Manage channels'],
  ['ManageRoles', 'Manage permissions'],
  ['CreateInstantInvite', 'Create invites'],
  ['SendMessages', 'Send messages'],
  ['SendMessagesInThreads', 'Send in threads'],
  ['CreatePublicThreads', 'Create public threads'],
  ['CreatePrivateThreads', 'Create private threads'],
  ['EmbedLinks', 'Embed links'],
  ['AttachFiles', 'Attach files'],
  ['AddReactions', 'Add reactions'],
  ['UseExternalEmojis', 'Use external emoji'],
  ['MentionEveryone', 'Mention everyone'],
  ['ManageMessages', 'Manage messages'],
  ['ManageThreads', 'Manage threads'],
  ['ReadMessageHistory', 'Read message history'],
  ['SendTTSMessages', 'Send text-to-speech'],
  ['UseApplicationCommands', 'Use app commands'],
  ['UseExternalStickers', 'Use external stickers'],
  ['UseEmbeddedActivities', 'Use activities'],
  ['UseExternalApps', 'Use external apps'],
  ['Connect', 'Connect to voice'],
  ['Speak', 'Speak'],
  ['Stream', 'Video / stream'],
  ['UseVAD', 'Use voice activity'],
  ['PrioritySpeaker', 'Priority speaker'],
  ['MuteMembers', 'Mute members'],
  ['DeafenMembers', 'Deafen members'],
  ['MoveMembers', 'Move members'],
  ['RequestToSpeak', 'Request to speak'],
  ['ManageEvents', 'Manage events'],
  ['CreateEvents', 'Create events'],
  ['SendVoiceMessages', 'Send voice messages'],
].filter(([key]) => PermissionFlagsBits[key] !== undefined).map(([key, label]) => Object.freeze({
  key,
  label,
  bit: PermissionFlagsBits[key],
})));

const CATEGORY_PERMISSION_BY_KEY = new Map(CATEGORY_PERMISSIONS.map((permission) => [permission.key, permission]));

function encodePermissions(states = {}) {
  let allow = 0n;
  let deny = 0n;
  for (const [key, state] of Object.entries(states || {})) {
    const permission = CATEGORY_PERMISSION_BY_KEY.get(key);
    if (!permission) throw new Error(`Unsupported category permission "${key}".`);
    if (state === 'allow') allow |= permission.bit;
    else if (state === 'deny') deny |= permission.bit;
    else if (state !== 'inherit' && state != null && state !== '') throw new Error(`Invalid state for permission "${key}".`);
  }
  return { allow: allow.toString(), deny: deny.toString() };
}

function decodePermissions(allowValue, denyValue) {
  const allow = BigInt(allowValue || '0');
  const deny = BigInt(denyValue || '0');
  return Object.fromEntries(CATEGORY_PERMISSIONS.map(({ key, bit }) => [
    key,
    (allow & bit) === bit ? 'allow' : (deny & bit) === bit ? 'deny' : 'inherit',
  ]));
}

module.exports = { CATEGORY_PERMISSIONS, CATEGORY_PERMISSION_BY_KEY, encodePermissions, decodePermissions };
