const { DEMO_GUILD_ID, DEMO_ROLES } = require('./fixtures');

class DemoPermissionGroupGateway {
  constructor() {
    this.categories = [
      { id: 'cat_project_one', name: 'Project One', position: 1 },
      { id: 'cat_project_two', name: 'Project Two', position: 2 },
      { id: 'cat_project_three', name: 'Project Three', position: 3 },
    ];
    this.channels = [
      { id: 'project_one_info', name: 'project-info', type: 0, parentId: 'cat_project_one', position: 1 },
      { id: 'project_one_chat', name: 'project-chat', type: 0, parentId: 'cat_project_one', position: 2 },
      { id: 'project_one_voice', name: 'Project Voice', type: 2, parentId: 'cat_project_one', position: 3 },
      { id: 'project_two_info', name: 'project-info', type: 0, parentId: 'cat_project_two', position: 1 },
      { id: 'project_two_forum', name: 'development', type: 15, parentId: 'cat_project_two', position: 2 },
      { id: 'welcome', name: 'welcome', type: 0, parentId: null, position: 0 },
    ];
    this.applied = [];
  }

  async getConfiguration(guildId) {
    if (guildId !== DEMO_GUILD_ID) return null;
    return {
      categories: this.categories.map((category) => ({ ...category })),
      channels: this.channels.map((channel) => ({ ...channel })),
      roles: DEMO_ROLES.filter((role) => !role.managed).map((role) => ({ ...role })),
    };
  }

  async apply(guildId, previous, desired) {
    if (guildId !== DEMO_GUILD_ID) return null;
    this.applied.push({ guildId, previous, desired });
    return true;
  }
}

module.exports = { DemoPermissionGroupGateway };
