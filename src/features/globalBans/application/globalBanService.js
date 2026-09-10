const { ValidationError } = require('../../../dashboard/errors');
const { GlobalBanEvents } = require('../../../app/eventBus');
const { normalizeUserId, isActiveRecord } = require('../domain/globalBanPolicy');
const { OUTCOMES } = require('../domain/outcomes');

const STOP_PROPAGATION = Symbol('globalBan.stopPropagation');

class GlobalBanService {
  constructor({ repository, gateway, sync, client, eventBus, logger = console, config = {}, clock = () => Date.now() }) {
    this.repository = repository;
    this.gateway = gateway;
    this.sync = sync;
    this.client = client;
    this.eventBus = eventBus;
    this.logger = logger || console;
    this.config = config.globalBans || {};
    this.clock = clock;
    this.workerTimer = null;
    this.workerRunning = false;
    this.processingPromise = null;
    this.alertBanQueues = new Map();
    this.pluginSettings = null;
  }

  setPluginSettings(pluginSettings) {
    this.pluginSettings = pluginSettings;
    return this;
  }

  isPluginEnabled(guildId) {
    return !this.pluginSettings || this.pluginSettings.isEnabled(guildId, 'global-bans');
  }

  async start() {
    await this.sync?.start();
    this.workerRunning = true;
    for (const guild of this.client?.guilds?.cache?.values?.() || []) {
      if (this.isPluginEnabled(guild.id)) await this.reconcileGuild(guild.id).catch((error) => this.logger.warn?.('global-bans', 'reconcile', 'Initial enforcement reconciliation failed.', { guildId: guild.id, errorCode: error.code || error.name }));
    }
    this.workerTimer = setInterval(() => this.processJobs().catch(() => {}), 1000);
    this.workerTimer.unref?.();
  }

  async stop() {
    this.workerRunning = false;
    if (this.workerTimer) clearInterval(this.workerTimer);
    this.workerTimer = null;
    await this.processingPromise?.catch(() => {});
    await this.sync?.stop();
  }

  isFreshEnough() {
    const state = this.repository.getSyncState();
    if (!state.last_success_at) return false;
    const age = Date.now() - Date.parse(state.last_success_at);
    return Number.isFinite(age) && age <= (Number(this.config.maxCacheStalenessSeconds) || 86400) * 1000;
  }

  getCached(userId) {
    return this.repository.getCache(userId);
  }

  async onSyncEvent(result, event) {
    const record = result.state;
    if (!record) return;
    if (isActiveRecord(record)) {
      const guilds = [...(this.client?.guilds?.cache?.values?.() || [])];
      for (const guild of guilds) {
        if (!this.isPluginEnabled(guild.id)) continue;
        const settings = this.repository.getGuildSettings(guild.id);
        if (settings.mode === 'enforce' && this.config.enforcementEnabled !== false && !this.repository.getExemption(guild.id, record.user_id)) {
          this.repository.enqueue({ guildId: guild.id, userId: record.user_id, sourceEventId: event.event_id || record.last_event_id, action: 'ban' });
        }
      }
    } else {
      this.repository.cancelForUser(record.user_id);
    }
    this.eventBus?.emit(GlobalBanEvents.SyncChanged, { userId: record.user_id, state: record.state, eventId: event.event_id || null, occurredAt: new Date().toISOString() });
  }

  async evaluateMember(member) {
    const guildId = member?.guild?.id || member?.guildId;
    const userId = normalizeUserId(member?.id || member?.user?.id);
    if (!guildId || !userId) return { outcome: OUTCOMES.DISABLED };
    const settings = this.repository.getGuildSettings(guildId);
    if (settings.mode === 'disabled' || this.config.enforcementEnabled === false || !this.isPluginEnabled(guildId)) return { outcome: OUTCOMES.DISABLED };
    const record = this.repository.getCache(userId);
    if (!isActiveRecord(record)) return { outcome: OUTCOMES.DISABLED };
    if (this.repository.getExemption(guildId, userId)) return { outcome: OUTCOMES.EXEMPT, record };
    if (!this.isFreshEnough()) {
      await this.#alert(settings, guildId, member, record, OUTCOMES.STALE);
      return { outcome: OUTCOMES.STALE, record };
    }
    if (settings.mode === 'alert') {
      await this.#alert(settings, guildId, member, record, OUTCOMES.ALERTED);
      return { outcome: OUTCOMES.ALERTED, record };
    }
    const result = await this.#ban({ guildId, userId, member, record, settings, source: 'join' });
    return { ...result, record, ...(result.outcome === OUTCOMES.BANNED || result.outcome === OUTCOMES.ALREADY_BANNED ? { [STOP_PROPAGATION]: true } : {}) };
  }

  async #alert(settings, guildId, member, record, outcome) {
    if (!settings.log_channel_id) return { outcome: 'no_log_channel' };
    try {
      await this.gateway.sendAlert({
        guildId,
        channelId: settings.log_channel_id,
        userId: member.id,
        username: member.user?.username,
        globalName: member.user?.globalName,
        avatarUrl: member.user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null,
        reason: record.public_reason || record.reason_code,
        outcome,
      });
    } catch (error) {
      this.logger.warn?.('global-bans', 'alert', 'Could not send global-ban alert.', { guildId, userId: member.id, errorCode: error.code || error.name });
    }
  }

  async #ban({ guildId, userId, record, settings, source, moderatorId = null }) {
    try {
      const moderatorSuffix = moderatorId ? ` | moderator=${moderatorId}` : '';
      const result = await this.gateway.banUser({
        guildId,
        userId,
        deleteMessageSeconds: settings.delete_message_seconds,
        reason: `Mochi global protection | event=${record.last_event_id} | code=${record.reason_code || 'listed'}${moderatorSuffix}`,
      });
      this.eventBus?.emit(GlobalBanEvents.Enforcement, { guildId, userId, outcome: result.outcome, source, moderatorId: moderatorId || null, occurredAt: new Date().toISOString() });
      return result;
    } catch (error) {
      const outcome = error?.status >= 500 || error?.status === 429 ? OUTCOMES.TRANSIENT_ERROR : OUTCOMES.PERMANENT_ERROR;
      this.logger.error?.('global-bans', 'ban', 'Global-ban enforcement failed.', { guildId, userId, outcome, errorCode: error.code || error.name });
      return { outcome };
    }
  }

  async banFromAlert({ guildId, userId, moderatorId } = {}) {
    const id = normalizeUserId(userId);
    if (!guildId || !id || !normalizeUserId(moderatorId)) return { outcome: OUTCOMES.POLICY_CHANGED };
    const key = `${guildId}:${id}`;
    const previous = this.alertBanQueues.get(key) || Promise.resolve();
    const operation = previous.catch(() => {}).then(() => this.#banFromAlert({ guildId, userId: id, moderatorId }));
    this.alertBanQueues.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.alertBanQueues.get(key) === operation) this.alertBanQueues.delete(key);
    }
  }

  async #banFromAlert({ guildId, userId, moderatorId }) {
    const settings = this.repository.getGuildSettings(guildId);
    if (settings.mode !== 'alert' || this.config.enforcementEnabled === false || !this.isPluginEnabled(guildId)) return { outcome: OUTCOMES.POLICY_CHANGED };
    const record = this.repository.getCache(userId);
    if (!isActiveRecord(record)) return { outcome: OUTCOMES.NOT_LISTED };
    if (this.repository.getExemption(guildId, userId)) return { outcome: OUTCOMES.EXEMPT, record };
    if (!this.isFreshEnough()) return { outcome: OUTCOMES.STALE, record };

    const result = await this.#ban({ guildId, userId, record, settings, source: 'alert_button', moderatorId });
    this.repository.recordEnforcementEvent?.({
      guildId,
      userId,
      sourceEventId: record.last_event_id,
      action: 'moderator_ban',
      outcome: result.outcome,
      detailsCode: `MODERATOR_${moderatorId}`,
    });
    return { ...result, record };
  }

  async processJobs() {
    if (!this.workerRunning || !this.config.enforcementEnabled) return;
    if (this.processingPromise) return this.processingPromise;
    this.processingPromise = this.#processJobs();
    try { return await this.processingPromise; } finally { this.processingPromise = null; }
  }

  async #processJobs() {
    this.repository.recoverExpiredJobs?.(this.clock());
    for (const guildId of this.repository.listExpiredExemptionGuilds?.(this.clock()) || []) {
      if (this.repository.getGuildSettings(guildId).mode === 'enforce' && this.isPluginEnabled(guildId)) this.repository.enqueueForGuild(guildId, 0, { force: true });
    }
    const jobs = this.repository.claimDueJobs(Math.max(1, Number(this.config.guildConcurrency) || 3));
    for (const job of jobs) {
      const settings = this.repository.getGuildSettings(job.guild_id);
      const record = this.repository.getCache(job.user_id);
      if (job.action !== 'ban') {
        this.repository.completeJob(job, { outcome: 'skipped', detailsCode: 'UNSUPPORTED_ACTION' });
        continue;
      }
      if (!this.isPluginEnabled(job.guild_id) || settings.mode !== 'enforce' || !record || !isActiveRecord(record) || this.repository.getExemption(job.guild_id, job.user_id)) {
        this.repository.completeJob(job, { outcome: 'skipped', detailsCode: 'POLICY_CHANGED' });
        continue;
      }
      if (!this.isFreshEnough()) {
        this.repository.completeJob(job, { outcome: 'failed', retry: true, errorCode: 'CACHE_STALE', retryAfterSeconds: 300 });
        continue;
      }
      try {
        const result = await this.gateway.banUser({ guildId: job.guild_id, userId: job.user_id, deleteMessageSeconds: settings.delete_message_seconds, reason: `Mochi global protection | event=${job.source_event_id} | code=${record.reason_code || 'listed'}` });
        const retry = result.outcome === 'guild_unavailable' || result.outcome === 'transient_error';
        const exhausted = job.attempts >= (Number(this.config.maxJobAttempts) || 8);
        this.repository.completeJob(job, { outcome: result.outcome, retry: retry && !exhausted, terminal: retry && exhausted, errorCode: retry ? result.outcome : null, retryAfterSeconds: Math.min(3600, 30 * (2 ** Math.min(job.attempts, 6))) });
        this.eventBus?.emit(GlobalBanEvents.Enforcement, { guildId: job.guild_id, userId: job.user_id, outcome: result.outcome, source: 'queue', occurredAt: new Date().toISOString() });
      } catch (error) {
        const retry = error?.status === 429 || error?.status >= 500 || error?.code === 'NETWORK_ERROR';
        const exhausted = job.attempts >= (Number(this.config.maxJobAttempts) || 8);
        this.repository.completeJob(job, { outcome: retry && !exhausted ? 'transient_error' : 'permanent_error', retry: retry && !exhausted, errorCode: error.code || error.name, retryAfterSeconds: Math.min(3600, 30 * (2 ** Math.min(job.attempts, 6))) });
      }
    }
  }

  async reconcileGuild(guildId) {
    const settings = this.repository.getGuildSettings(guildId);
    if (settings.mode !== 'enforce' || !this.isPluginEnabled(guildId)) return 0;
    return this.repository.enqueueForGuild(guildId);
  }

  async getDashboard(guildId) {
    const sync = this.repository.getSyncState();
    return {
      settings: this.repository.getGuildSettings(guildId),
      sync: { ...sync, cacheFresh: this.isFreshEnough() },
      activeCount: this.repository.listActiveCache().length,
      jobStats: this.repository.getJobStats(guildId),
      exemptions: this.repository.listExemptions(guildId),
      recentEvents: this.repository.getRecentEvents(guildId),
      permissions: await this.gateway.getPermissionStatus(guildId, this.repository.getGuildSettings(guildId).log_channel_id),
    };
  }

  async updateSettings(guildId, payload) {
    const settings = this.repository.setGuildSettings(guildId, payload);
    if (settings.mode === 'enforce') await this.reconcileGuild(guildId);
    this.eventBus?.emit(GlobalBanEvents.SettingsUpdated, { guildId, mode: settings.mode, occurredAt: new Date().toISOString() });
    return settings;
  }

  addExemption(guildId, userId, payload) {
    const id = normalizeUserId(userId);
    if (!id) throw new ValidationError('A valid Discord user ID is required.');
    if (!payload?.reason || String(payload.reason).trim().length < 3) throw new ValidationError('An exemption reason is required.');
    const expiresAt = payload.expiresAt || null;
    if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= this.clock())) throw new ValidationError('Exemption expiry must be a future date.');
    const exemption = this.repository.setExemption(guildId, id, { reason: String(payload.reason).trim().slice(0, 500), createdBy: payload.createdBy, expiresAt });
    this.repository.cancelForUser(id, guildId);
    return exemption;
  }

  deleteExemption(guildId, userId) {
    const id = normalizeUserId(userId);
    if (!id) throw new ValidationError('A valid Discord user ID is required.');
    this.repository.deleteExemption(guildId, id);
    if (this.repository.getGuildSettings(guildId).mode === 'enforce' && this.isPluginEnabled(guildId)) this.repository.enqueueForGuild(guildId, 0, { force: true });
    return { success: true };
  }

  async ensureGuild(guildId) {
    return this.reconcileGuild(guildId);
  }

  forgetGuild(guildId) {
    this.repository.forgetGuild(guildId);
  }
}

module.exports = { GlobalBanService, STOP_PROPAGATION };
