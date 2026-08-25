const migration001 = {
  version: 1,
  name: 'permission-groups',
  up(db) {
    db.exec(`
      CREATE TABLE permission_groups (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_permission_groups_guild ON permission_groups(guild_id);

      CREATE TABLE permission_group_categories (
        group_id TEXT NOT NULL,
        category_id TEXT NOT NULL UNIQUE,
        PRIMARY KEY (group_id, category_id),
        FOREIGN KEY (group_id) REFERENCES permission_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE permission_group_rules (
        group_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        allow_bits TEXT NOT NULL DEFAULT '0',
        deny_bits TEXT NOT NULL DEFAULT '0',
        PRIMARY KEY (group_id, role_id),
        FOREIGN KEY (group_id) REFERENCES permission_groups(id) ON DELETE CASCADE
      );
    `);
  },
};

const migration002 = {
  version: 2,
  name: 'channel-level-rules',
  up(db) {
    db.exec(`
      ALTER TABLE permission_group_rules RENAME TO permission_group_rules_v1;
      CREATE TABLE permission_group_rules (
        group_id TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT 'category',
        target_id TEXT NOT NULL DEFAULT '',
        role_id TEXT NOT NULL,
        allow_bits TEXT NOT NULL DEFAULT '0',
        deny_bits TEXT NOT NULL DEFAULT '0',
        PRIMARY KEY (group_id, target_type, target_id, role_id),
        FOREIGN KEY (group_id) REFERENCES permission_groups(id) ON DELETE CASCADE
      );
      INSERT INTO permission_group_rules (group_id, target_type, target_id, role_id, allow_bits, deny_bits)
        SELECT group_id, 'category', '', role_id, allow_bits, deny_bits FROM permission_group_rules_v1;
      DROP TABLE permission_group_rules_v1;
    `);
  },
};

module.exports = {
  manifest: {
    id: 'permission-groups',
    name: 'Permission Groups',
    version: '1.1.0',
    apiVersion: 1,
    description: 'Manage shared role permissions across multiple Discord categories.',
    requires: [],
  },
  migrations: [migration001, migration002],
  register(context) {
    const services = context.baseServices;
    context.services.register('permissionGroups', services.permissionGroups);
    context.services.register('permissionGroupRepository', services.permissionGroupRepository);
    context.services.register('permissionGroupGateway', services.permissionGroupGateway);
    context.dashboardApi.register({
      id: 'permission-groups-api',
      mountPath: '/guilds/:guildId/permission-groups',
      scope: 'guild-manage',
      install(router) {
        router.use(require('../../../dashboard/routes/permissionGroupRoutes').createPermissionGroupRoutes({
          permissionGroupService: services.permissionGroups,
        }));
      },
    });
    context.pages.register({ id: 'permission-groups', path: '/permission-groups', file: 'permission-groups.html' });
  },
};
