const migration = {
  version: 1,
  name: 'global-ban-cache-and-enforcement',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS global_ban_cache (
        user_id TEXT PRIMARY KEY, state TEXT NOT NULL, severity TEXT, reason_code TEXT,
        public_reason TEXT, activated_at TEXT, expires_at TEXT, last_event_id INTEGER NOT NULL DEFAULT 0,
        record_version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_global_ban_cache_state ON global_ban_cache (state);
      CREATE INDEX IF NOT EXISTS idx_global_ban_cache_event ON global_ban_cache (last_event_id);
      CREATE TABLE IF NOT EXISTS global_ban_sync_state (
        id INTEGER PRIMARY KEY CHECK (id = 1), cursor INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT, last_success_at TEXT, snapshot_completed_at TEXT,
        status TEXT NOT NULL DEFAULT 'never_synced', consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT
      );
      INSERT OR IGNORE INTO global_ban_sync_state (id) VALUES (1);
      CREATE TABLE IF NOT EXISTS guild_global_ban_settings (
        guild_id TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'disabled' CHECK (mode IN ('disabled', 'alert', 'enforce')),
        log_channel_id TEXT, delete_message_seconds INTEGER NOT NULL DEFAULT 0, updated_by TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS global_ban_exemptions (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL, created_by TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS global_ban_enforcement_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
        source_event_id INTEGER NOT NULL DEFAULT 0, action TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        outcome_code TEXT, last_error_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (guild_id, user_id, source_event_id, action)
      );
      CREATE INDEX IF NOT EXISTS idx_global_ban_jobs_due ON global_ban_enforcement_jobs (status, next_attempt_at);
      CREATE TABLE IF NOT EXISTS global_ban_enforcement_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
        source_event_id INTEGER NOT NULL DEFAULT 0, action TEXT NOT NULL, outcome TEXT NOT NULL,
        details_code TEXT, occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  },
};

const memberGuard = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    const service = client.services?.globalBans;
    if (!service || member?.user?.bot) return null;
    return service.evaluateMember(member);
  },
};

const ready = {
  name: 'ready',
  once: false,
  async execute(client) {
    const service = client.services?.globalBans;
    if (!service) return;
    for (const guild of client.guilds?.cache?.values?.() || []) {
      if (client.services.pluginSettings?.isEnabled(guild.id, 'global-bans')) await service.ensureGuild(guild.id);
    }
  },
};

const guildCreate = {
  name: 'guildCreate',
  async execute(guild, client) {
    if (client.services?.globalBans) await client.services.globalBans.ensureGuild(guild.id);
  },
};

const guildDelete = {
  name: 'guildDelete',
  async execute(guild, client) {
    client.services?.globalBans?.forgetGuild(guild.id);
  },
};

module.exports = {
  manifest: {
    id: 'global-bans',
    name: 'Global Protection',
    version: '1.0.0',
    apiVersion: 1,
    description: 'Synchronizes a centrally managed ban registry with opted-in guilds.',
    requires: [],
  },
  migrations: [migration],
  async start(context) {
    await context.baseServices.globalBans?.start();
  },
  async stop(context) {
    await context.baseServices.globalBans?.stop();
  },
  register(context) {
    const services = context.baseServices;
    context.services.register('globalBans', services.globalBans);
    context.services.register('globalBanRepository', services.globalBanRepository);
    context.services.register('globalBanGateway', services.globalBanGateway);
    context.services.register('globalBanSync', services.globalBanSync);
    context.discordEvents.register(memberGuard, { source: 'src/plugins/builtins/global-bans/index.js', phase: 'guard', priority: -100 });
    context.discordEvents.register(ready, { source: 'src/plugins/builtins/global-bans/index.js', phase: 'normal', priority: -100 });
    context.discordEvents.register(guildCreate, { source: 'src/plugins/builtins/global-bans/index.js', phase: 'normal', priority: -100 });
    context.discordEvents.register(guildDelete, { source: 'src/plugins/builtins/global-bans/index.js', phase: 'cleanup', runWhenGuildPluginDisabled: true });
    context.dashboardApi.register({
      id: 'global-bans-api',
      mountPath: '/guilds/:guildId/global-bans',
      scope: 'guild-manage',
      install(router) {
        router.use(require('../../../dashboard/routes/globalBanRoutes').createGlobalBanRoutes({ globalBanService: services.globalBans, guildService: services.guilds }));
      },
    });
    context.pages.register({ id: 'global-bans', path: '/global-bans', file: 'global-bans.html' });
    const { GlobalBanEvents } = require('../../../app/eventBus');
    const { mapGlobalBanEvent } = require('../../../dashboard/realtime/eventMappers');
    context.realtime.register({ id: 'global-ban-enforcement', applicationEvent: GlobalBanEvents.Enforcement, socketEvent: 'globalBanEnforcement', map: mapGlobalBanEvent });
    context.realtime.register({ id: 'global-ban-settings', applicationEvent: GlobalBanEvents.SettingsUpdated, socketEvent: 'globalBanSettingsUpdated', map: mapGlobalBanEvent });
  },
};
