import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import {
  PingResponseSchema, DashboardStatsResponseSchema, ListUsersResponseSchema,
  SuspendUserResponseSchema, UnsuspendUserResponseSchema, AdjustQuotaResponseSchema,
  ListCandidatesResponseSchema, RemoveFromPoolResponseSchema, AuditListResponseSchema,
  DeadLetterListResponseSchema, RetryWebhookResponseSchema,
  RateLimitBucketsResponseSchema, ClearRateLimitResponseSchema,
  ConfigGetResponseSchema, ConfigPutResponseSchema, AdminPlacementsListResponseSchema,
  MarkPaidResponseSchema, CancelPlacementResponseSchema,
  PlacementsSummaryResponseSchema, AdminLogListResponseSchema,
} from '../schemas/admin.js';
import { createAdminUsersHandler } from '../modules/admin/handlers/users.js';
import { createAdminCandidatesHandler } from '../modules/admin/handlers/candidates.js';
import { createAdminAuditHandler } from '../modules/admin/handlers/audit.js';
import { createAdminWebhooksHandler } from '../modules/admin/handlers/webhooks.js';
import { createAdminRateLimitHandler } from '../modules/admin/handlers/rate-limit.js';
import { createAdminConfigHandler } from '../modules/admin/handlers/config.js';
import { createAdminPlacementsHandler } from '../modules/admin/handlers/placements.js';
import { createAdminAdminLogHandler } from '../modules/admin/handlers/admin-log.js';
import { makeAdminDashboardHandler } from '../modules/admin/handlers/dashboard.js';

export function createAdminRouter(db: DB, encryptionKey: Buffer): Router {
  const router = Router();
  const users = createAdminUsersHandler(db);
  const candidates = createAdminCandidatesHandler(db);
  const audit = createAdminAuditHandler(db);
  const webhooks = createAdminWebhooksHandler(db);
  const rateLimit = createAdminRateLimitHandler(db);
  const config = createAdminConfigHandler();
  const placements = createAdminPlacementsHandler(db, encryptionKey);
  const adminLog = createAdminAdminLogHandler(db);
  const dashboard = makeAdminDashboardHandler(db);

  // Ping — admin-gated liveness check. Returns the same shape as before so
  // ops dashboards that hit this endpoint can keep using it; the difference
  // is that callers must now provide the admin bearer token (the broader
  // admin auth middleware is mounted in server.ts for the whole /v1/admin
  // prefix).
  router.get('/ping', (_req, res, next) => {
    try { respond(res, PingResponseSchema, { ok: true, data: { message: 'admin pong' } }); } catch (e) { next(e); }
  });

  // Dashboard
  router.get('/dashboard/stats', (_req, res, next) => {
    try { respond(res, DashboardStatsResponseSchema, { ok: true, data: dashboard.getStats() }); } catch (e) { next(e); }
  });

  // Users
  router.get('/users', (req, res, next) => {
    try {
      const filter: { user_type?: string; status?: string; limit?: number } = {};
      if (typeof req.query.user_type === 'string') filter.user_type = req.query.user_type;
      if (typeof req.query.status === 'string') filter.status = req.query.status;
      if (req.query.limit) filter.limit = Number(req.query.limit);
      respond(res, ListUsersResponseSchema, { ok: true, data: users.list(filter) });
    } catch (e) { next(e); }
  });
  router.post('/users/:id/suspend', (req, res, next) => {
    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
      if (!reason) throw Errors.invalidParams('reason is required');
      const adminUserId = (req as any).user?.id ?? 'admin';
      respond(res, SuspendUserResponseSchema, { ok: true, data: users.suspend(adminUserId, req.params.id, reason) });
    } catch (e) { next(e); }
  });
  router.post('/users/:id/unsuspend', (req, res, next) => {
    try {
      const adminUserId = (req as any).user?.id ?? 'admin';
      respond(res, UnsuspendUserResponseSchema, { ok: true, data: users.unsuspend(adminUserId, req.params.id) });
    } catch (e) { next(e); }
  });
  router.post('/users/:id/adjust-quota', (req, res, next) => {
    try {
      const new_quota = Number(req.body?.new_quota);
      if (!Number.isFinite(new_quota)) throw Errors.invalidParams('new_quota must be a number');
      respond(res, AdjustQuotaResponseSchema, { ok: true, data: users.adjustQuota(req.params.id, new_quota) });
    } catch (e) { next(e); }
  });

  // Candidates
  router.get('/candidates', (req, res, next) => {
    try {
      const filter: { in_pool?: boolean; unlock_status?: string; limit?: number } = {};
      if (req.query.in_pool === 'true' || req.query.in_pool === '1') filter.in_pool = true;
      else if (req.query.in_pool === 'false' || req.query.in_pool === '0') filter.in_pool = false;
      if (typeof req.query.unlock_status === 'string') filter.unlock_status = req.query.unlock_status;
      if (req.query.limit) filter.limit = Number(req.query.limit);
      respond(res, ListCandidatesResponseSchema, { ok: true, data: candidates.list(filter) });
    } catch (e) { next(e); }
  });
  router.post('/candidates/:id/remove-from-pool', (req, res, next) => {
    try { respond(res, RemoveFromPoolResponseSchema, { ok: true, data: candidates.removeFromPool(req.params.id) }); } catch (e) { next(e); }
  });

  // Audit
  router.get('/audit', (req, res, next) => {
    try {
      const filter: { actor_user_id?: string; recommendation_id?: string; limit?: number } = {};
      if (typeof req.query.actor_user_id === 'string') filter.actor_user_id = req.query.actor_user_id;
      if (typeof req.query.recommendation_id === 'string') filter.recommendation_id = req.query.recommendation_id;
      if (req.query.limit) filter.limit = Number(req.query.limit);
      respond(res, AuditListResponseSchema, { ok: true, data: audit.list(filter) });
    } catch (e) { next(e); }
  });

  // Webhooks
  router.get('/webhooks/dead-letter', (req, res, next) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      respond(res, DeadLetterListResponseSchema, { ok: true, data: webhooks.listDeadLetter(limit) });
    } catch (e) { next(e); }
  });
  router.post('/webhooks/:id/retry', (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) throw Errors.invalidParams('id must be a number');
      respond(res, RetryWebhookResponseSchema, { ok: true, data: webhooks.retry(id) });
    } catch (e) { next(e); }
  });

  // Rate limit
  router.get('/rate-limit/buckets', (req, res, next) => {
    try {
      const user_id = typeof req.query.user_id === 'string' ? req.query.user_id : undefined;
      respond(res, RateLimitBucketsResponseSchema, { ok: true, data: rateLimit.listBuckets(user_id) });
    } catch (e) { next(e); }
  });
  router.post('/rate-limit/users/:id/clear', (req, res, next) => {
    try { respond(res, ClearRateLimitResponseSchema, { ok: true, data: rateLimit.clearForUser(req.params.id) }); } catch (e) { next(e); }
  });

  // Config
  router.get('/config', (_req, res, next) => {
    try { respond(res, ConfigGetResponseSchema, { ok: true, data: config.get() }); } catch (e) { next(e); }
  });
  router.put('/config/:key', (req, res, next) => {
    try { respond(res, ConfigPutResponseSchema, { ok: true, data: config.set(req.params.key, req.body) }); } catch (e) { next(e); }
  });

  // Placements
  router.get('/placements', (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const validStatus = (status === 'pending_payment' || status === 'paid' || status === 'cancelled')
        ? status : undefined;
      const filter: { status?: 'pending_payment' | 'paid' | 'cancelled' } = {};
      if (validStatus) filter.status = validStatus;
      respond(res, AdminPlacementsListResponseSchema, { ok: true, data: placements.list(filter) });
    } catch (e) { next(e); }
  });
  router.post('/placements/:id/mark-paid', (req, res, next) => {
    try { respond(res, MarkPaidResponseSchema, { ok: true, data: placements.markPaid('admin', req.params.id) }); } catch (e) { next(e); }
  });
  router.post('/placements/:id/cancel', (req, res, next) => {
    try { respond(res, CancelPlacementResponseSchema, { ok: true, data: placements.cancel('admin', req.params.id) }); } catch (e) { next(e); }
  });
  router.get('/placements/summary', (_req, res, next) => {
    try { respond(res, PlacementsSummaryResponseSchema, { ok: true, data: placements.summary() }); } catch (e) { next(e); }
  });

  // Admin log
  router.get('/admin-log', (req, res, next) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const filter: { limit?: number } = {};
      if (limit !== undefined) filter.limit = limit;
      respond(res, AdminLogListResponseSchema, { ok: true, data: adminLog.list(filter) });
    } catch (e) { next(e); }
  });

  return router;
}