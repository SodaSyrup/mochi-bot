const { ChannelType, OverwriteType } = require('discord.js');
const { CATEGORY_PERMISSIONS, decodePermissions } = require('../../features/permissionGroups/permissions');

async function fetchCollection(manager) {
  if (!manager) return new Map();
  if (typeof manager.fetch === 'function') {
    try {
      const fetched = await manager.fetch();
      if (fetched?.values) return fetched;
    } catch {
      // Use the ready cache when Discord's refresh is temporarily unavailable.
    }
  }
  return manager.cache || new Map();
}

class DiscordPermissionGroupGateway {
  constructor({ client }) {
    this.client = client;
  }

  #guild(guildId) {
    return this.client?.guilds?.cache?.get(guildId) || null;
  }

  async getConfiguration(guildId) {
    const guild = this.#guild(guildId);
    if (!guild?.channels || !guild?.roles) return null;
    const channelsCollection = await fetchCollection(guild.channels);
    const rolesCollection = await fetchCollection(guild.roles);
    const guildChannels = Array.from(channelsCollection.values())
      .filter((channel) => !channel.isThread?.());
    const categories = guildChannels
      .filter((channel) => channel.type === ChannelType.GuildCategory)
      .map((channel) => ({ id: channel.id, name: channel.name, position: channel.position || 0 }))
      .sort((a, b) => a.position - b.position);
    const channels = guildChannels
      .filter((channel) => channel.type !== ChannelType.GuildCategory)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parentId || null,
        position: channel.position || 0,
      }))
      .sort((a, b) => a.position - b.position);
    const roles = Array.from(rolesCollection.values())
      .filter((role) => !role.managed)
      .map((role) => ({
        id: role.id,
        name: role.id === guild.id ? '@everyone' : role.name,
        color: role.hexColor !== '#000000' ? role.hexColor : '#99aab5',
        position: role.position || 0,
      }))
      .sort((a, b) => b.position - a.position);
    const roleNames = new Map(Array.from(rolesCollection.values()).map((role) => [role.id, role.id === guild.id ? '@everyone' : role.name]));
    const categoryIds = new Set(categories.map((category) => category.id));
    const targets = [...categories, ...channels];
    const overwrites = [];
    for (const target of targets) {
      const discordTarget = channelsCollection.get(target.id);
      for (const overwrite of discordTarget?.permissionOverwrites?.cache?.values?.() || []) {
        // Group management is role-based. Member overwrites remain visible in
        // Discord and are deliberately left untouched by this feature.
        if (overwrite.type !== OverwriteType.Role) continue;
        const allow = BigInt(overwrite.allow?.bitfield ?? overwrite.allow ?? 0).toString();
        const deny = BigInt(overwrite.deny?.bitfield ?? overwrite.deny ?? 0).toString();
        if (allow === '0' && deny === '0') continue;
        overwrites.push({
          targetId: target.id,
          targetType: categoryIds.has(target.id) ? 'category' : 'channel',
          targetName: target.name,
          roleId: overwrite.id,
          roleName: roleNames.get(overwrite.id) || overwrite.id,
          allow,
          deny,
        });
      }
    }
    return { categories, channels, roles, overwrites };
  }

  async apply(guildId, previous, desired) {
    const guild = this.#guild(guildId);
    if (!guild?.channels?.cache) return null;
    if (!guild.members?.me?.permissions?.has('ManageRoles')) throw new Error('Bot lacks Manage Roles permission.');

    const expandRules = (group) => {
      const expanded = new Map();
      for (const rule of group?.rules || []) {
        const targetType = rule.targetType || 'category';
        const targetIds = targetType === 'channel'
          ? (rule.targetId ? [rule.targetId] : [])
          : (group?.categoryIds || []);
        for (const targetId of targetIds) {
          if (!expanded.has(targetId)) expanded.set(targetId, new Map());
          expanded.get(targetId).set(rule.roleId, rule);
        }
      }
      return expanded;
    };

    const previousTargets = expandRules(previous);
    const desiredTargets = expandRules(desired);
    const allTargetIds = new Set([...previousTargets.keys(), ...desiredTargets.keys()]);

    for (const targetId of allTargetIds) {
      const target = guild.channels.cache.get(targetId);
      if (!target || (target.type === ChannelType.GuildCategory ? false : target.isThread?.())) continue;
      const previousRules = previousTargets.get(targetId) || new Map();
      const desiredRules = desiredTargets.get(targetId) || new Map();
      const allRoleIds = new Set([...previousRules.keys(), ...desiredRules.keys()]);
      for (const roleId of allRoleIds) {
        const oldRule = previousRules.get(roleId);
        const newRule = desiredRules.get(roleId) || null;
        const permissions = {};
        const oldStates = oldRule ? decodePermissions(oldRule.allow, oldRule.deny) : {};
        const newStates = newRule ? decodePermissions(newRule.allow, newRule.deny) : {};
        for (const { key } of CATEGORY_PERMISSIONS) {
          const wasManaged = oldStates[key] && oldStates[key] !== 'inherit';
          const next = newStates[key] || 'inherit';
          if (wasManaged || next !== 'inherit') permissions[key] = next === 'allow' ? true : next === 'deny' ? false : null;
        }
        // A role with an all-Inherit rule is still an intentional group
        // member. Send an empty overwrite so Discord creates the role entry;
        // removing an old all-Inherit rule does not create a new entry.
        if (Object.keys(permissions).length > 0 || newRule) {
          await target.permissionOverwrites.edit(roleId, permissions, {
            type: OverwriteType.Role,
            reason: 'Synced from a Mochi permission group',
          });
        }
      }
    }
    return true;
  }
}

module.exports = { DiscordPermissionGroupGateway };
