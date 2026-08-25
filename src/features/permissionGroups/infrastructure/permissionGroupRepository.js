const { randomUUID } = require('node:crypto');

class PermissionGroupRepository {
  constructor(db) {
    this.db = db;
  }

  list(guildId) {
    const groups = this.db.prepare(`
      SELECT id, guild_id, name, created_at, updated_at
      FROM permission_groups WHERE guild_id = ? ORDER BY name COLLATE NOCASE, id
    `).all(guildId);
    return groups.map((group) => this.#hydrate(group));
  }

  get(guildId, groupId) {
    const group = this.db.prepare(`
      SELECT id, guild_id, name, created_at, updated_at
      FROM permission_groups WHERE guild_id = ? AND id = ?
    `).get(guildId, groupId);
    return group ? this.#hydrate(group) : null;
  }

  categoryOwner(guildId, categoryId, excludingGroupId = '') {
    return this.db.prepare(`
      SELECT g.id, g.name FROM permission_group_categories c
      JOIN permission_groups g ON g.id = c.group_id
      WHERE g.guild_id = ? AND c.category_id = ? AND g.id != ?
    `).get(guildId, categoryId, excludingGroupId) || null;
  }

  create({ guildId, name, categoryIds, rules }) {
    const id = randomUUID();
    this.#write({ id, guildId, name, categoryIds, rules, create: true });
    return this.get(guildId, id);
  }

  update({ guildId, id, name, categoryIds, rules }) {
    this.#write({ id, guildId, name, categoryIds, rules, create: false });
    return this.get(guildId, id);
  }

  delete(guildId, id) {
    return this.db.prepare('DELETE FROM permission_groups WHERE guild_id = ? AND id = ?').run(guildId, id).changes > 0;
  }

  #write({ id, guildId, name, categoryIds, rules, create }) {
    this.db.transaction(() => {
      if (create) {
        this.db.prepare('INSERT INTO permission_groups (id, guild_id, name) VALUES (?, ?, ?)').run(id, guildId, name);
      } else {
        this.db.prepare("UPDATE permission_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND id = ?").run(name, guildId, id);
        this.db.prepare('DELETE FROM permission_group_categories WHERE group_id = ?').run(id);
        this.db.prepare('DELETE FROM permission_group_rules WHERE group_id = ?').run(id);
      }
      const insertCategory = this.db.prepare('INSERT INTO permission_group_categories (group_id, category_id) VALUES (?, ?)');
      for (const categoryId of categoryIds) insertCategory.run(id, categoryId);
      const insertRule = this.db.prepare(`
        INSERT INTO permission_group_rules (group_id, target_type, target_id, role_id, allow_bits, deny_bits)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const rule of rules) insertRule.run(
        id, rule.targetType || 'category', rule.targetId || '', rule.roleId, rule.allow, rule.deny
      );
    })();
  }

  #hydrate(group) {
    return {
      ...group,
      categoryIds: this.db.prepare(
        'SELECT category_id FROM permission_group_categories WHERE group_id = ? ORDER BY category_id'
      ).all(group.id).map((row) => row.category_id),
      rules: this.db.prepare(`
        SELECT target_type AS targetType, target_id AS targetId, role_id AS roleId, allow_bits AS allow, deny_bits AS deny
        FROM permission_group_rules WHERE group_id = ? ORDER BY target_type, target_id, role_id
      `).all(group.id),
    };
  }
}

module.exports = { PermissionGroupRepository };
