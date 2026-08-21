const DISCORD_API_BASE_URL = 'https://discord.com/api';
const DISCORD_INVITE_BASE_URL = 'https://discord.gg';
const DISCORD_CDN_BASE_URL = 'https://cdn.discordapp.com';

function discordInviteUrl(code) {
  return `${DISCORD_INVITE_BASE_URL}/${encodeURIComponent(code)}`;
}

function discordDefaultAvatar(index = 0) {
  const safeIndex = Number.isInteger(Number(index)) ? Number(index) : 0;
  return `${DISCORD_CDN_BASE_URL}/embed/avatars/${Math.max(0, safeIndex)}.png`;
}

function discordUserAvatarUrl(userId, avatarHash) {
  if (!userId || !avatarHash) return discordDefaultAvatar(0);
  return `${DISCORD_CDN_BASE_URL}/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(avatarHash)}.png`;
}

module.exports = {
  DISCORD_API_BASE_URL,
  DISCORD_INVITE_BASE_URL,
  DISCORD_CDN_BASE_URL,
  discordInviteUrl,
  discordDefaultAvatar,
  discordUserAvatarUrl,
};
