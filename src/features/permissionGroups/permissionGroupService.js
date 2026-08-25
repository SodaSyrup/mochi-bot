const { AppError, ConflictError, ExternalServiceError, NotFoundError, ValidationError } = require('../../dashboard/errors');
const { CATEGORY_PERMISSIONS, encodePermissions, decodePermissions } = require('./permissions');
const { GuildSerialQueue } = require('../invites/application/guildSerialQueue');

class PermissionGroupService {
  constructor({ repository, gateway, logger = console, queue = new GuildSerialQueue() }) {
    this.repository = repository;
    this.gateway = gateway;
    this.logger = logger;
    this.queue = queue;
  }

  async dashboard(guildId) {
    const configuration = await this.gateway.getConfiguration(guildId);
    if (!configuration) throw new NotFoundError('Guild categories are not available.');
    return {
      groups: this.repository.list(guildId).map((group) => this.#present(group)),
      categories: configuration.categories,
      channels: configuration.channels || [],
      roles: configuration.roles,
      existingOverwrites: (configuration.overwrites || []).map((overwrite) => ({
        ...overwrite,
        permissions: decodePermissions(overwrite.allow, overwrite.deny),
      })),
      permissions: CATEGORY_PERMISSIONS.map(({ key, label }) => ({ key, label })),
    };
  }

  async create(guildId, payload) {
    return this.queue.run(guildId, async () => {
      const desired = await this.#normalize(guildId, payload);
      await this.#apply(guildId, null, desired);
      return this.#present(this.repository.create({ guildId, ...desired }));
    });
  }

  async update(guildId, groupId, payload) {
    return this.queue.run(guildId, async () => {
      const previous = this.repository.get(guildId, groupId);
      if (!previous) throw new NotFoundError('Permission group not found.');
      const desired = await this.#normalize(guildId, payload, groupId);
      await this.#apply(guildId, previous, desired);
      return this.#present(this.repository.update({ guildId, id: groupId, ...desired }));
    });
  }

  async sync(guildId, groupId) {
    return this.queue.run(guildId, async () => {
      const group = this.repository.get(guildId, groupId);
      if (!group) throw new NotFoundError('Permission group not found.');
      await this.#apply(guildId, null, group);
      return this.#present(group);
    });
  }

  async delete(guildId, groupId) {
    return this.queue.run(guildId, async () => {
      const group = this.repository.get(guildId, groupId);
      if (!group) throw new NotFoundError('Permission group not found.');
      await this.#apply(guildId, group, { categoryIds: [], rules: [] });
      this.repository.delete(guildId, groupId);
    });
  }

  async #normalize(guildId, payload = {}, groupId = '') {
    const name = String(payload.name || '').trim();
    if (!name || name.length > 80) throw new ValidationError('Group name must be between 1 and 80 characters.');
    if (!Array.isArray(payload.categoryIds) || payload.categoryIds.length === 0) throw new ValidationError('Choose at least one category.');
    if (!Array.isArray(payload.rules)) throw new ValidationError('rules must be an array.');

    const config = await this.gateway.getConfiguration(guildId);
    if (!config) throw new NotFoundError('Guild categories are not available.');
    const categoryIds = [...new Set(payload.categoryIds.map(String))];
    const knownCategories = new Set(config.categories.map((category) => category.id));
    for (const categoryId of categoryIds) {
      if (!knownCategories.has(categoryId)) throw new ValidationError('Every selected category must belong to this guild.');
      const owner = this.repository.categoryOwner(guildId, categoryId, groupId);
      if (owner) throw new ConflictError(`That category already belongs to “${owner.name}”.`);
    }

    const knownRoles = new Set(config.roles.map((role) => role.id));
    const knownChannels = new Map((config.channels || []).map((channel) => [channel.id, channel]));
    const selectedCategoryIds = new Set(categoryIds);
    const seenRules = new Set();
    const rules = payload.rules.map((rule) => {
      const roleId = String(rule?.roleId || '');
      if (!knownRoles.has(roleId)) throw new ValidationError('Every shared rule must target a role in this guild.');
      const targetType = rule?.targetType === undefined ? 'category' : String(rule.targetType);
      if (targetType !== 'category' && targetType !== 'channel') throw new ValidationError('Rule targetType must be category or channel.');
      const targetId = targetType === 'channel' ? String(rule?.targetId || '') : '';
      if (targetType === 'channel') {
        const channel = knownChannels.get(targetId);
        if (!channel) throw new ValidationError('Every channel rule must target a channel in this guild.');
        if (!channel.parentId || !selectedCategoryIds.has(channel.parentId)) {
          throw new ValidationError('A channel rule must belong to a category selected in this group.');
        }
      }
      const ruleKey = `${targetType}:${targetId}:${roleId}`;
      if (seenRules.has(ruleKey)) throw new ValidationError('A role can only appear once per category or channel.');
      seenRules.add(ruleKey);
      try {
        return { targetType, targetId, roleId, ...encodePermissions(rule.permissions) };
      } catch (error) {
        throw new ValidationError(error.message);
      }
    });
    return { name, categoryIds, rules };
  }

  async #apply(guildId, previous, desired) {
    try {
      const applied = await this.gateway.apply(guildId, previous, desired);
      if (!applied) throw new NotFoundError('Guild categories are not available.');
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error?.('permission-groups', 'sync', 'Failed to sync category permissions', { guildId, error });
      throw new ExternalServiceError('Discord could not apply the grouped category permissions. Check Mochi’s role position and Manage Roles permission.');
    }
  }

  #present(group) {
    return {
      id: group.id,
      name: group.name,
      categoryIds: group.categoryIds,
      rules: group.rules.map((rule) => ({
        targetType: rule.targetType || 'category',
        targetId: rule.targetId || null,
        roleId: rule.roleId,
        permissions: decodePermissions(rule.allow, rule.deny),
      })),
      createdAt: group.created_at,
      updatedAt: group.updated_at,
    };
  }
}

module.exports = { PermissionGroupService };
