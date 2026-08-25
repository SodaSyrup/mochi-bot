const express = require('express');
const { ValidationError, ConflictError, NotFoundError, ExternalServiceError, AppError } = require('../errors');
const { getCsrfToken, requireCsrf } = require('../auth/csrf');
const { requireGuildAccess } = require('../auth/requireGuildAccess');
const { GlobalBanRemoteError } = require('../../features/globalBans/infrastructure/cloudflareGlobalBanClient');

const USER_ID = /^\d{5,25}$/;
const STATES = new Set(['pending', 'active', 'revoked', 'expired', 'rejected']);

function validateUserId(value) {
  const userId = String(value || '').trim();
  if (!USER_ID.test(userId)) throw new ValidationError('A valid Discord user ID is required.');
  return userId;
}

function validatePayload(body, { partial = false } = {}) {
  const payload = body || {};
  if (!partial || payload.reasonCode !== undefined) {
    const reasonCode = String(payload.reasonCode || '').trim();
    if (!reasonCode || reasonCode.length > 80) throw new ValidationError('reasonCode is required and must be at most 80 characters.');
    payload.reasonCode = reasonCode;
  }
  if (!partial || payload.publicReason !== undefined) {
    const publicReason = String(payload.publicReason || '').trim();
    if (publicReason.length < 3 || publicReason.length > 500) throw new ValidationError('publicReason must be between 3 and 500 characters.');
    payload.publicReason = publicReason;
  }
  if (payload.severity !== undefined && payload.severity !== null && String(payload.severity).length > 32) {
    throw new ValidationError('severity must be at most 32 characters.');
  }
  if (payload.evidenceReference !== undefined && payload.evidenceReference !== null && String(payload.evidenceReference).length > 1000) {
    throw new ValidationError('evidenceReference must be at most 1000 characters.');
  }
  if (payload.expiresAt !== undefined && payload.expiresAt !== null && payload.expiresAt !== '') {
    const timestamp = Date.parse(String(payload.expiresAt));
    if (!Number.isFinite(timestamp)) throw new ValidationError('expiresAt must be a valid ISO date.');
    payload.expiresAt = new Date(timestamp).toISOString();
  } else if (payload.expiresAt !== undefined) payload.expiresAt = null;
  if (payload.expectedVersion !== undefined && (!Number.isInteger(Number(payload.expectedVersion)) || Number(payload.expectedVersion) < 1)) {
    throw new ValidationError('expectedVersion must be a positive integer.');
  }
  return payload;
}

function mapRemoteError(error) {
  if (!(error instanceof GlobalBanRemoteError)) return error;
  if (error.status === 400) return new ValidationError(error.message);
  if (error.status === 404) return new NotFoundError(error.message);
  if (error.status === 409) return new ConflictError(error.message);
  if (error.status === 401 || error.status === 403) return new ExternalServiceError('Global-ban administrative credentials were rejected.');
  return new AppError(502, 'GLOBAL_BAN_REMOTE_ERROR', error.message);
}

function wrap(call) {
  return Promise.resolve().then(call).catch((error) => { throw mapRemoteError(error); });
}

function createGlobalBanRegistryRoutes({ adminClient, config, guildAccess, recommendationService = null, userResolver = null }) {
  const router = express.Router();
  const mutations = requireCsrf(config);
  const recommendationsGuildAccess = guildAccess
    ? requireGuildAccess(guildAccess, { access: 'manage' })
    : (req, res, next) => next(new ExternalServiceError('Guild authorization is not configured.'));

  router.get('/csrf', (req, res) => res.json({ token: getCsrfToken(req) }));

  router.get('/summary', async (req, res) => res.json(await wrap(() => adminClient.getSummary())));

  router.get('/bans', async (req, res) => {
    const state = req.query.state ? String(req.query.state) : '';
    if (state && !STATES.has(state)) throw new ValidationError('Invalid registry state.');
    const excludeState = req.query.exclude_state ? String(req.query.exclude_state) : '';
    if (excludeState && !STATES.has(excludeState)) throw new ValidationError('Invalid excluded registry state.');
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const search = String(req.query.search || '').trim().slice(0, 80);
    const cursor = String(req.query.cursor || '').slice(0, 300);
    const result = await wrap(() => adminClient.getBans({ state, excludeState, search, cursor, limit }));
    return res.json(await enrichRecords(result, userResolver));
  });

  router.get('/guilds/:guildId/recommendations', recommendationsGuildAccess, async (req, res) => {
    if (!recommendationService) throw new ExternalServiceError('Global-ban recommendations are not configured.');
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 25);
    const after = String(req.query.after || '').trim().slice(0, 32);
    return res.json(await recommendationService.list({
      guildId: String(req.params.guildId),
      after: after || null,
      limit,
    }));
  });

  router.get('/bans/:userId', async (req, res) => res.json(await wrap(() => adminClient.getBan(validateUserId(req.params.userId)))));

  router.get('/events', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    return res.json(await wrap(() => adminClient.getEvents({ limit, cursor: String(req.query.cursor || '').slice(0, 300) })));
  });

  router.post('/bans', mutations, async (req, res) => {
    const userId = validateUserId(req.body?.userId);
    const payload = validatePayload({ ...req.body, userId });
    const result = await wrap(() => adminClient.createBan(payload, req.session.user.id));
    recommendationService?.clearCache?.();
    return res.status(201).json(result);
  });

  router.patch('/bans/:userId', mutations, async (req, res) => {
    const payload = validatePayload({ ...req.body }, { partial: true });
    payload.expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 1) throw new ValidationError('expectedVersion is required.');
    const result = await wrap(() => adminClient.updateBan(validateUserId(req.params.userId), payload, req.session.user.id));
    recommendationService?.clearCache?.();
    return res.json(result);
  });

  async function action(req, res, method) {
    const userId = validateUserId(req.params.userId);
    const payload = { expectedVersion: Number(req.body?.expectedVersion) };
    if (!Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 1) throw new ValidationError('expectedVersion is required.');
    const result = await wrap(() => adminClient[method](userId, payload, req.session.user.id));
    recommendationService?.clearCache?.();
    return res.json(result);
  }

  router.post('/bans/:userId/activate', mutations, (req, res) => action(req, res, 'activateBan'));
  router.post('/bans/:userId/reject', mutations, (req, res) => action(req, res, 'rejectBan'));
  router.post('/bans/:userId/revoke', mutations, (req, res) => action(req, res, 'revokeBan'));
  router.post('/bans/:userId/reopen', mutations, (req, res) => action(req, res, 'reopenBan'));

  return router;
}

async function enrichRecords(result, userResolver) {
  if (!result || !Array.isArray(result.records) || typeof userResolver?.resolveUsers !== 'function') return result;
  try {
    const users = await userResolver.resolveUsers(result.records.map((record) => record.user_id));
    return {
      ...result,
      records: result.records.map((record) => ({
        ...record,
        username: users.get(record.user_id)?.username || null,
        avatar: users.get(record.user_id)?.avatar || null,
      })),
    };
  } catch {
    return {
      ...result,
      records: result.records.map((record) => ({ ...record, username: null, avatar: null })),
    };
  }
}

module.exports = { createGlobalBanRegistryRoutes, validateUserId, validatePayload };
