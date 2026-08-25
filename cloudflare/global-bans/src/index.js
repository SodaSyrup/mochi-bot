const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const USER_ID = /^\d{5,25}$/;
const STATES = new Set(['pending', 'active', 'revoked', 'expired', 'rejected']);
const ADMIN_STATE_ORDER_SQL = `CASE state
  WHEN 'pending' THEN 0
  WHEN 'active' THEN 1
  WHEN 'revoked' THEN 2
  WHEN 'rejected' THEN 3
  WHEN 'expired' THEN 4
  ELSE 5 END`;

function adminStateRank(state) {
  return { pending: 0, active: 1, revoked: 2, rejected: 3, expired: 4 }[state] ?? 5;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function errorResponse(code, message, status = 400) {
  return json({ success: false, error: { code, message } }, status);
}

function requestId(request) {
  return request.headers.get('cf-ray') || crypto.randomUUID();
}

function authorized(request, env, kind) {
  const expected = kind === 'admin' ? env.ADMIN_TOKEN : env.SYNC_TOKEN;
  if (!expected) return false;
  const actual = request.headers.get('authorization') || '';
  return constantTimeEqual(actual, `Bearer ${expected}`);
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let result = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) result |= (a[index] || 0) ^ (b[index] || 0);
  return result === 0;
}

async function body(request) {
  try { return await request.json(); } catch { return null; }
}

function rowPayload(row) {
  if (!row) return null;
  return {
    user_id: row.user_id,
    state: row.state,
    severity: row.severity,
    reason_code: row.reason_code,
    public_reason: row.public_reason,
    activated_at: row.activated_at,
    expires_at: row.expires_at,
    version: row.version,
  };
}

function adminRowPayload(row) {
  return {
    ...rowPayload(row),
    evidence_reference: row.evidence_reference,
    created_by: row.created_by,
    reviewed_by: row.reviewed_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    revoked_at: row.revoked_at,
  };
}

function encodeCursor(value) {
  return btoa(JSON.stringify(value));
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(atob(value));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function expectedVersion(payload, current) {
  const expected = Number(payload?.expectedVersion || current.version);
  return Number.isInteger(expected) && expected > 0 ? expected : null;
}

function validateMutation(current, payload, allowedStates) {
  if (!allowedStates.includes(current.state)) return errorResponse('INVALID_TRANSITION', `Cannot perform this operation while the entry is ${current.state}.`, 409);
  const expected = expectedVersion(payload, current);
  if (expected === null) return errorResponse('INVALID_RECORD', 'expectedVersion must be a positive integer.');
  if (expected !== current.version) return errorResponse('VERSION_CONFLICT', 'The registry entry changed; reload it before editing.', 409);
  return null;
}

async function audit(env, request, operation, actorId, targetUserId, result) {
  await env.DB.prepare(`INSERT INTO api_audit_log (request_id, actor_id, operation, target_user_id, result) VALUES (?, ?, ?, ?, ?)`)
    .bind(requestId(request), actorId || null, operation, targetUserId || null, result).run();
}

async function eventMutation(env, request, { userId, action, actorId, idempotencyKey, updateSql, updateArgs, nextRow, guardVersion = null }) {
  if (!idempotencyKey) return errorResponse('IDEMPOTENCY_REQUIRED', 'Idempotency-Key is required.', 400);
  const existingEvent = await env.DB.prepare('SELECT * FROM global_ban_events WHERE idempotency_key = ?').bind(idempotencyKey).first();
  if (existingEvent) return json({ success: true, eventId: existingEvent.event_id, record: JSON.parse(existingEvent.record_payload), replayed: true });
  const eventUuid = crypto.randomUUID();
  const payload = rowPayload(nextRow);
  const eventStatement = guardVersion === null
    ? env.DB.prepare(`INSERT INTO global_ban_events (event_uuid, idempotency_key, user_id, action, actor_id, record_version, record_payload) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(eventUuid, idempotencyKey, userId, action, actorId, Number(nextRow.version), JSON.stringify(payload))
    : env.DB.prepare(`INSERT INTO global_ban_events (event_uuid, idempotency_key, user_id, action, actor_id, record_version, record_payload)
        SELECT ?, ?, ?, ?, ?, ?, ? FROM global_bans WHERE user_id = ? AND version = ?`).bind(eventUuid, idempotencyKey, userId, action, actorId, Number(nextRow.version), JSON.stringify(payload), userId, guardVersion + 1);
  const result = await env.DB.batch([
    env.DB.prepare(updateSql).bind(...updateArgs),
    eventStatement,
    env.DB.prepare(`INSERT INTO api_audit_log (request_id, actor_id, operation, target_user_id, result) VALUES (?, ?, ?, ?, ?)`)
      .bind(requestId(request), actorId, action, userId, 'success'),
  ]);
  if (guardVersion !== null && !(result?.[1]?.meta?.changes > 0)) return errorResponse('VERSION_CONFLICT', 'The registry entry changed; reload it before editing.', 409);
  const eventId = result?.[1]?.meta?.last_row_id || null;
  return json({ success: true, eventId, record: payload });
}

async function handleSnapshot(request, env, url) {
  if (!authorized(request, env, 'sync')) return errorResponse('UNAUTHORIZED', 'Invalid synchronization credentials.', 401);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 500), 1), 1000);
  const after = url.searchParams.get('after_user_id') || '';
  const cursorRow = await env.DB.prepare('SELECT COALESCE(MAX(event_id), 0) AS cursor FROM global_ban_events').first();
  const rows = await env.DB.prepare(`SELECT user_id, state, severity, reason_code, public_reason, activated_at, expires_at, version
    FROM global_bans WHERE state = 'active' AND user_id > ? ORDER BY user_id LIMIT ?`).bind(after, limit + 1).all();
  const values = rows.results || [];
  const hasMore = values.length > limit;
  const records = (hasMore ? values.slice(0, limit) : values).map(rowPayload);
  return json({ records, snapshotCursor: Number(cursorRow?.cursor || 0), nextUserId: hasMore ? records.at(-1)?.user_id : null, hasMore, generatedAt: new Date().toISOString() });
}

async function handleChanges(request, env, url) {
  if (!authorized(request, env, 'sync')) return errorResponse('UNAUTHORIZED', 'Invalid synchronization credentials.', 401);
  const after = Math.max(0, Number(url.searchParams.get('after_event_id') || 0));
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 500), 1), 1000);
  const rows = await env.DB.prepare(`SELECT event_id, user_id, action, record_payload, created_at FROM global_ban_events WHERE event_id > ? ORDER BY event_id LIMIT ?`).bind(after, limit + 1).all();
  const values = rows.results || [];
  const hasMore = values.length > limit;
  const events = (hasMore ? values.slice(0, limit) : values).map((row) => ({ event_id: row.event_id, user_id: row.user_id, action: row.action, record_payload: JSON.parse(row.record_payload), created_at: row.created_at }));
  return json({ events, nextCursor: events.length ? events.at(-1).event_id : after, hasMore, generatedAt: new Date().toISOString() });
}

async function handleAdmin(request, env, url) {
  if (!authorized(request, env, 'admin')) return errorResponse('UNAUTHORIZED', 'Invalid administrative credentials.', 401);
  const actorId = request.headers.get('x-operator-id') || 'operator';
  const parts = url.pathname.split('/').filter(Boolean);
  const userId = parts[3] || '';
  const payload = await body(request);
  if (request.method === 'GET' && url.pathname === '/v1/admin/summary') {
    const rows = await env.DB.prepare('SELECT state, COUNT(*) AS count FROM global_bans GROUP BY state').all();
    const counts = Object.fromEntries((rows.results || []).map((row) => [row.state, Number(row.count || 0)]));
    return json({ success: true, counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) });
  }
  if (request.method === 'GET' && url.pathname === '/v1/admin/events') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
    const cursor = Math.max(0, Number(url.searchParams.get('cursor') || 0));
    const rows = cursor
      ? await env.DB.prepare('SELECT event_id, event_uuid, user_id, action, actor_id, record_version, record_payload, created_at FROM global_ban_events WHERE event_id < ? ORDER BY event_id DESC LIMIT ?').bind(cursor, limit + 1).all()
      : await env.DB.prepare('SELECT event_id, event_uuid, user_id, action, actor_id, record_version, record_payload, created_at FROM global_ban_events ORDER BY event_id DESC LIMIT ?').bind(limit + 1).all();
    const values = rows.results || [];
    const hasMore = values.length > limit;
    const events = (hasMore ? values.slice(0, limit) : values).map((row) => ({ ...row, record_payload: JSON.parse(row.record_payload) }));
    return json({ success: true, events, nextCursor: hasMore ? events.at(-1)?.event_id : null, hasMore });
  }
  if (request.method === 'GET' && url.pathname === '/v1/admin/bans') {
    const state = url.searchParams.get('state');
    if (state && !STATES.has(state)) return errorResponse('INVALID_STATE', 'Invalid registry state.');
    const excludeState = url.searchParams.get('exclude_state') || '';
    if (excludeState && !STATES.has(excludeState)) return errorResponse('INVALID_STATE', 'Invalid excluded registry state.');
    const search = String(url.searchParams.get('search') || '').trim().slice(0, 80);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    if (url.searchParams.get('cursor') && (!cursor?.updatedAt || !cursor?.userId || !Number.isInteger(cursor?.stateRank))) return errorResponse('INVALID_CURSOR', 'Invalid registry cursor.');
    const conditions = [];
    const binds = [];
    if (state) { conditions.push('state = ?'); binds.push(state); }
    if (excludeState) { conditions.push('state != ?'); binds.push(excludeState); }
    if (search) { conditions.push('user_id LIKE ?'); binds.push(`${search}%`); }
    if (cursor) {
      conditions.push(`(${ADMIN_STATE_ORDER_SQL} > ? OR (${ADMIN_STATE_ORDER_SQL} = ? AND (updated_at < ? OR (updated_at = ? AND user_id < ?))))`);
      binds.push(cursor.stateRank, cursor.stateRank, cursor.updatedAt, cursor.updatedAt, cursor.userId);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const rows = await env.DB.prepare(`SELECT * FROM global_bans${where} ORDER BY ${ADMIN_STATE_ORDER_SQL} ASC, updated_at DESC, user_id DESC LIMIT ?`).bind(...binds, limit + 1).all();
    const values = rows.results || [];
    const hasMore = values.length > limit;
    const records = (hasMore ? values.slice(0, limit) : values).map(adminRowPayload);
    const last = values[limit - 1];
    return json({ success: true, records, nextCursor: hasMore && last ? encodeCursor({ stateRank: adminStateRank(last.state), updatedAt: last.updated_at, userId: last.user_id }) : null, hasMore });
  }
  if (request.method === 'POST' && url.pathname === '/v1/admin/bans') {
    const id = String(payload?.userId || payload?.user_id || '').trim();
    if (!USER_ID.test(id)) return errorResponse('INVALID_USER_ID', 'A valid Discord user ID is required.');
    if (!payload?.reasonCode || !payload?.publicReason) return errorResponse('INVALID_RECORD', 'reasonCode and publicReason are required.');
    const existing = await env.DB.prepare('SELECT * FROM global_bans WHERE user_id = ?').bind(id).first();
    if (existing) return errorResponse('CONFLICT', 'A registry entry already exists for this user. Reopen or edit the existing entry.', 409);
    const row = { user_id: id, state: 'pending', severity: payload.severity || null, reason_code: String(payload.reasonCode).slice(0, 80), public_reason: String(payload.publicReason).slice(0, 500), activated_at: null, expires_at: payload.expiresAt || null, version: 1 };
    return eventMutation(env, request, { userId: id, action: 'proposed', actorId, idempotencyKey: request.headers.get('idempotency-key'), updateSql: `INSERT INTO global_bans (user_id, state, severity, reason_code, public_reason, evidence_reference, created_by, expires_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, updateArgs: [id, row.state, row.severity, row.reason_code, row.public_reason, payload.evidenceReference || null, actorId, row.expires_at, 1], nextRow: row });
  }
  if (!USER_ID.test(userId)) return errorResponse('INVALID_USER_ID', 'A valid Discord user ID is required.');
  const current = await env.DB.prepare('SELECT * FROM global_bans WHERE user_id = ?').bind(userId).first();
  if (!current) return errorResponse('NOT_FOUND', 'Registry entry not found.', 404);
  if (request.method === 'POST' && url.pathname.endsWith('/activate')) {
    const invalid = validateMutation(current, payload, ['pending']);
    if (invalid) return invalid;
    const next = { ...current, state: 'active', activated_at: current.activated_at || new Date().toISOString(), version: current.version + 1 };
    return eventMutation(env, request, { userId, action: 'activated', actorId, idempotencyKey: request.headers.get('idempotency-key'), updateSql: `UPDATE global_bans SET state = 'active', reviewed_by = ?, activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP, version = version + 1 WHERE user_id = ? AND version = ?`, updateArgs: [actorId, userId, current.version], guardVersion: current.version, nextRow: next });
  }
  if (request.method === 'POST' && url.pathname.endsWith('/reject')) {
    const invalid = validateMutation(current, payload, ['pending']);
    if (invalid) return invalid;
    const next = { ...current, state: 'rejected', version: current.version + 1 };
    return eventMutation(env, request, { userId, action: 'rejected', actorId, idempotencyKey: request.headers.get('idempotency-key'), updateSql: `UPDATE global_bans SET state = 'rejected', reviewed_by = ?, updated_at = CURRENT_TIMESTAMP, version = version + 1 WHERE user_id = ? AND version = ?`, updateArgs: [actorId, userId, current.version], guardVersion: current.version, nextRow: next });
  }
  if (request.method === 'POST' && url.pathname.endsWith('/revoke')) {
    const invalid = validateMutation(current, payload, ['active']);
    if (invalid) return invalid;
    const next = { ...current, state: 'revoked', version: current.version + 1 };
    return eventMutation(env, request, { userId, action: 'revoked', actorId, idempotencyKey: request.headers.get('idempotency-key'), updateSql: `UPDATE global_bans SET state = 'revoked', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, version = version + 1 WHERE user_id = ? AND version = ?`, updateArgs: [userId, current.version], guardVersion: current.version, nextRow: next });
  }
  if (request.method === 'POST' && url.pathname.endsWith('/reopen')) {
    const invalid = validateMutation(current, payload, ['revoked', 'rejected', 'expired']);
    if (invalid) return invalid;
    const next = { ...current, state: 'pending', version: current.version + 1 };
    return eventMutation(env, request, { userId, action: 'reopened', actorId, idempotencyKey: request.headers.get('idempotency-key'), updateSql: `UPDATE global_bans SET state = 'pending', reviewed_by = NULL, revoked_at = NULL, updated_at = CURRENT_TIMESTAMP, version = version + 1 WHERE user_id = ? AND version = ?`, updateArgs: [userId, current.version], guardVersion: current.version, nextRow: next });
  }
  if (request.method === 'PATCH') {
    const invalid = validateMutation(current, payload, ['pending', 'active', 'revoked', 'expired', 'rejected']);
    if (invalid) return invalid;
    const publicReason = payload?.publicReason === undefined ? current.public_reason : String(payload.publicReason).trim();
    const reasonCode = payload?.reasonCode === undefined ? current.reason_code : String(payload.reasonCode).trim();
    if (publicReason.length < 3 || publicReason.length > 500 || !reasonCode || reasonCode.length > 80) return errorResponse('INVALID_RECORD', 'reasonCode and publicReason are invalid.');
    const next = { ...current, public_reason: publicReason, reason_code: reasonCode, expires_at: payload?.expiresAt === undefined ? current.expires_at : (payload.expiresAt || null), version: current.version + 1 };
    return eventMutation(env, request, { userId, action: 'updated', actorId, idempotencyKey: request.headers.get('idempotency-key'), updateSql: `UPDATE global_bans SET reason_code = ?, public_reason = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP, version = version + 1 WHERE user_id = ? AND version = ?`, updateArgs: [reasonCode, publicReason, next.expires_at, userId, current.version], guardVersion: current.version, nextRow: next });
  }
  if (request.method === 'GET') return json({ success: true, record: adminRowPayload(current) });
  return errorResponse('NOT_FOUND', 'Administrative operation not found.', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,idempotency-key,x-operator-id' } });
      if (url.pathname === '/v1/status' && authorized(request, env, 'sync')) return json({ status: 'ok', schemaVersion: env.API_VERSION || '1' });
      if (url.pathname === '/v1/snapshot') return handleSnapshot(request, env, url);
      if (url.pathname === '/v1/changes') return handleChanges(request, env, url);
      if (url.pathname.startsWith('/v1/admin/')) return handleAdmin(request, env, url);
      return errorResponse('NOT_FOUND', 'Endpoint not found.', 404);
    } catch (error) {
      console.error('global-ban-worker error', { code: error.code || error.name });
      return errorResponse('INTERNAL', 'Internal server error.', 500);
    }
  },
};
