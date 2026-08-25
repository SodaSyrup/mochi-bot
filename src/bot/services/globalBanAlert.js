const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  escapeMarkdown,
  MessageFlags,
  resolveColor,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');

const ALERT_BUTTON_PREFIX = 'global-ban:ban:';
const NORMAL_ACCENT = '#ef4444';
const STALE_ACCENT = '#f59e0b';

function clip(value, maxLength, fallback = '') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function safeText(value, maxLength, fallback = '') {
  return escapeMarkdown(clip(value, maxLength, fallback));
}

function globalBanButtonId(userId) {
  return `${ALERT_BUTTON_PREFIX}${userId}`;
}

function parseGlobalBanButtonId(customId) {
  const value = String(customId || '');
  if (!value.startsWith(ALERT_BUTTON_PREFIX)) return null;
  const userId = value.slice(ALERT_BUTTON_PREFIX.length);
  return /^\d{5,25}$/.test(userId) ? userId : null;
}

function buildGlobalBanAlert({
  userId,
  username,
  globalName = null,
  avatarUrl = null,
  reason = null,
  stale = false,
} = {}) {
  const id = String(userId || '').trim();
  const handle = safeText(username || id, 100, id);
  const displayName = safeText(globalName, 100, '');
  const identity = displayName && displayName !== handle
    ? `**${displayName}** (\`@${handle}\`)`
    : `**@${handle}**`;
  const reasonText = safeText(reason, 900, 'No public reason provided.');
  const textDisplays = [
    new TextDisplayBuilder().setContent(stale ? '## GLOBAL BAN MATCH — REVIEW REQUIRED' : '## GLOBAL BAN MATCH JOINED'),
    new TextDisplayBuilder().setContent([
      `${identity} has joined this server.`,
      `**User ID:** \`${id}\``,
      `**Reason:** ${reasonText}`,
      stale ? '\n⚠️ The registry cache is stale. The Ban button is unavailable until synchronization recovers.' : null,
    ].filter(Boolean).join('\n'))
  ];

  let section = null;
  if (avatarUrl) {
    section = new SectionBuilder().addTextDisplayComponents(...textDisplays);
    section.setThumbnailAccessory(
      new ThumbnailBuilder().setURL(String(avatarUrl)).setDescription(`Profile picture for ${handle}`)
    );
  }

  const button = new ButtonBuilder()
    .setCustomId(globalBanButtonId(id))
    .setLabel(stale ? 'Ban unavailable' : 'Ban')
    .setStyle(stale ? ButtonStyle.Secondary : ButtonStyle.Danger)
    .setDisabled(stale);

  const container = new ContainerBuilder()
    .setAccentColor(resolveColor(stale ? STALE_ACCENT : NORMAL_ACCENT))
    .addTextDisplayComponents(...(section ? [] : textDisplays))
    .addSectionComponents(...(section ? [section] : []))
    .addActionRowComponents(new ActionRowBuilder().addComponents(button));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function asComponentJson(component) {
  if (typeof component?.toJSON === 'function') return component.toJSON();
  return JSON.parse(JSON.stringify(component));
}

function buildGlobalBanResolvedUpdate(message, { moderatorUsername = null, outcome = 'banned' } = {}) {
  const components = (message?.components || []).map(asComponentJson);
  const label = outcome === 'already_banned' ? 'Already banned' : 'Banned';
  let changed = false;

  for (const container of components) {
    if (container?.type !== 17 || !Array.isArray(container.components)) continue;
    const actionRow = container.components.find((component) => component?.type === 1);
    const button = actionRow?.components?.find((component) => parseGlobalBanButtonId(component?.custom_id));
    if (button) {
      button.disabled = true;
      button.label = label;
      button.style = ButtonStyle.Success;
      changed = true;
    }
    if (changed && moderatorUsername) {
      const status = new TextDisplayBuilder()
        .setContent(`-# ${label} by ${safeText(moderatorUsername, 100, 'a moderator')}`)
        .toJSON();
      const actionIndex = container.components.indexOf(actionRow);
      container.components.splice(actionIndex < 0 ? container.components.length : actionIndex, 0, status);
      break;
    }
  }

  return changed
    ? { components, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }
    : null;
}

module.exports = {
  ALERT_BUTTON_PREFIX,
  buildGlobalBanAlert,
  buildGlobalBanResolvedUpdate,
  globalBanButtonId,
  parseGlobalBanButtonId,
};
