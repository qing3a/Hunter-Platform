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
  ActionHistoryListResponseSchema,
  AdminLoginRequestSchema, AdminLoginResponseSchema, AdminMeResponseSchema, AdminRotateKeyResponseSchema,
  ListUsersEnvelopeSchema, ListCandidatesEnvelopeSchema,
  LoginEventsListResponseSchema,
  ListJobsResponseSchema,
} from '../schemas/admin.js';
import { createAdminUsersHandler } from '../modules/admin/handlers/users.js';
import { createAdminCandidatesHandler } from '../modules/admin/handlers/candidates.js';
import { createAdminAuditHandler } from '../modules/admin/handlers/audit.js';
import { createAdminWebhooksHandler } from '../modules/admin/handlers/webhooks.js';
import { createAdminRateLimitHandler } from '../modules/admin/handlers/rate-limit.js';
import { createAdminConfigHandler } from '../modules/admin/handlers/config.js';
import { createAdminPlacementsHandler } from '../modules/admin/handlers/placements.js';
import { createAdminAdminLogHandler } from '../modules/admin/handlers/admin-log.js';
import { createAdminActionHistoryHandler } from '../modules/admin/handlers/action-history.js';
import { makeAdminDashboardHandler } from '../modules/admin/handlers/dashboard.js';
import { createAdminAuthHandler } from '../modules/admin/handlers/auth.js';
import { createAdminLoginEventsHandler } from '../modules/admin/handlers/login-events.js';
import { createAdminJobsHandler } from '../modules/admin/handlers/jobs.js';

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
  const actionHistory = createAdminActionHistoryHandler(db);
  const dashboard = makeAdminDashboardHandler(db);
  const auth = createAdminAuthHandler(db);
  const loginEvents = createAdminLoginEventsHandler(db);
  const jobs = createAdminJobsHandler(db);

  // Auth (login is public; rotate-key + me require bearer)
  router.post('/auth/login', (req, res, next) => auth.login(req, res, next));
  router.post('/auth/rotate-key', (req, res, next) => auth.rotateKey(req, res, next));
  router.get('/me', (req, res, next) => auth.me(req, res, next));

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
    try {
      const s = dashboard.getStats();
      // Flatten the IPC nested shape to the 7-field schema. The handler
      // is unchanged because dashboardIpc + e2e-m3-admin.test.ts depend
      // on the nested shape. Two scalars aren't in getStats(); compute
      // them inline (3 small SELECTs).
      const candidateCount = (db.prepare('SELECT COUNT(*) AS c FROM candidates_anonymized').get() as { c: number }).c;
      const activePlacementCount = (db.prepare("SELECT COUNT(*) AS c FROM placements WHERE status IN ('pending_payment','paid')").get() as { c: number }).c;
      const dailyQuotaUsed = (db.prepare('SELECT COALESCE(SUM(quota_used), 0) AS s FROM users').get() as { s: number }).s;
      respond(res, DashboardStatsResponseSchema, {
        ok: true,
        data: {
          total_users: s.users.total,
          total_candidates: candidateCount,
          total_jobs: s.jobs.total,
          open_jobs: s.jobs.open,
          active_placements: activePlacementCount,
          daily_quota_used: dailyQuotaUsed,
          webhook_dead_letters: s.webhooks.dead_letter,
          today_new_users: s.today_new_users,
          trend_30d: s.trend_30d,
        },
      }, { strict: true });
    } catch (e) { next(e); }
  });

  // Users
  router.get('/users', (req, res, next) => {
    try {
      const filter: { user_type?: string; status?: string; keyword?: string; limit?: number; offset?: number } = {};
      if (typeof req.query.user_type === 'string') filter.user_type = req.query.user_type;
      if (typeof req.query.status === 'string') filter.status = req.query.status;
      if (typeof req.query.keyword === 'string' && req.query.keyword.length > 0) filter.keyword = req.query.keyword;
      const page = req.query.page ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
      if (!Number.isFinite(page) || page < 1) throw Errors.invalidParams('page must be a positive integer');
      if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
        throw Errors.invalidParams('pageSize must be 1-100');
      }
      filter.limit = pageSize;
      filter.offset = (page - 1) * pageSize;
      const { rows, total } = users.list(filter);
      respond(res, ListUsersEnvelopeSchema, {
        ok: true,
        data: rows,
        pagination: { total, page, pageSize, has_more: page * pageSize < total },
      }, { strict: true });
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
      const filter: { in_pool?: boolean; unlock_status?: string; keyword?: string; limit?: number; offset?: number } = {};
      if (req.query.in_pool === 'true' || req.query.in_pool === '1') filter.in_pool = true;
      else if (req.query.in_pool === 'false' || req.query.in_pool === '0') filter.in_pool = false;
      if (typeof req.query.unlock_status === 'string') filter.unlock_status = req.query.unlock_status;
      if (typeof req.query.keyword === 'string' && req.query.keyword.length > 0) filter.keyword = req.query.keyword;
      const page = req.query.page ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
      if (!Number.isFinite(page) || page < 1) throw Errors.invalidParams('page must be a positive integer');
      if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
        throw Errors.invalidParams('pageSize must be 1-100');
      }
      filter.limit = pageSize;
      filter.offset = (page - 1) * pageSize;
      const { rows, total } = candidates.list(filter);
      respond(res, ListCandidatesEnvelopeSchema, {
        ok: true,
        data: rows,
        pagination: { total, page, pageSize, has_more: page * pageSize < total },
      }, { strict: true });
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
      respond(res, AuditListResponseSchema, { ok: true, data: audit.list(filter) }, { strict: true });
    } catch (e) { next(e); }
  });

  // Action history (business action audit log — distinct from /audit which
  // reads unlock_audit_log). See spec §2 in
  // docs/superpowers/specs/2026-06-23-admin-action-history-endpoint-design.md
  router.get('/action-history', (req, res, next) => {
    try {
      const status = req.query.status;
      if (status !== undefined && status !== 'success' && status !== 'error') {
        throw Errors.invalidParams('status must be "success" or "error"');
      }
      const limit = req.query.limit !== undefined ? Number(req.query.limit) : 100;
      const offset = req.query.offset !== undefined ? Number(req.query.offset) : 0;
      if (!Number.isFinite(limit) || limit < 1 || limit > 1000) {
        throw Errors.invalidParams('limit must be a number 1-1000');
      }
      if (!Number.isFinite(offset) || offset < 0) {
        throw Errors.invalidParams('offset must be a number >= 0');
      }
      const filter: { user_id?: string; capability_name?: string; status?: 'success' | 'error'; since?: string; until?: string; limit?: number; offset?: number } = { limit, offset };
      if (typeof req.query.user_id === 'string')         filter.user_id = req.query.user_id;
      if (typeof req.query.capability_name === 'string') filter.capability_name = req.query.capability_name;
      if (status === 'success' || status === 'error')     filter.status = status;
      if (typeof req.query.since === 'string')           filter.since = req.query.since;
      if (typeof req.query.until === 'string')           filter.until = req.query.until;
      const { rows, total } = actionHistory.list(filter);
      respond(res, ActionHistoryListResponseSchema, {
        ok: true,
        data: rows,
        pagination: { total, limit, offset, has_more: offset + rows.length < total },
      }, { strict: true });
    } catch (e) { next(e); }
  });

  // Webhooks
  router.get('/webhooks/dead-letter', (req, res, next) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      respond(res, DeadLetterListResponseSchema, { ok: true, data: webhooks.listDeadLetter(limit) }, { strict: true });
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
      respond(res, RateLimitBucketsResponseSchema, { ok: true, data: rateLimit.listBuckets(user_id) }, { strict: true });
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

  // Jobs
  router.get('/jobs', (req, res, next) => {
    try {
      const filter: { status?: 'open' | 'claimed' | 'paused' | 'closed' | 'filled'; keyword?: string; limit?: number; offset?: number } = {};
      const validStatuses = ['open', 'claimed', 'paused', 'closed', 'filled'] as const;
      if (typeof req.query.status === 'string') {
        if (!(validStatuses as readonly string[]).includes(req.query.status)) {
          throw Errors.invalidParams('status must be open/claimed/paused/closed/filled');
        }
        filter.status = req.query.status as typeof validStatuses[number];
      }
      if (typeof req.query.keyword === 'string' && req.query.keyword.length > 0) {
        filter.keyword = req.query.keyword;
      }
      const page = req.query.page ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
      if (!Number.isFinite(page) || page < 1) throw Errors.invalidParams('page must be a positive integer');
      if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
        throw Errors.invalidParams('pageSize must be 1-100');
      }
      filter.limit = pageSize;
      filter.offset = (page - 1) * pageSize;
      const { rows, total } = jobs.list(filter);
      respond(res, ListJobsResponseSchema, {
        ok: true,
        data: rows,
        pagination: { total, page, pageSize, has_more: page * pageSize < total },
      }, { strict: true });
    } catch (e) { next(e); }
  });

  // Placements
  router.get('/placements', (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const validStatus = (status === 'pending_payment' || status === 'paid' || status === 'cancelled')
        ? status : undefined;
      const filter: { status?: 'pending_payment' | 'paid' | 'cancelled' } = {};
      if (validStatus) filter.status = validStatus;
      respond(res, AdminPlacementsListResponseSchema, { ok: true, data: placements.list(filter) }, { strict: true });
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
      respond(res, AdminLogListResponseSchema, { ok: true, data: adminLog.list(filter) }, { strict: true });
    } catch (e) { next(e); }
  });

  // Admin login events (Sub-D1)
  router.get('/login-events', (req, res, next) => {
    try {
      const adminId = typeof req.query.admin_id === 'string' ? req.query.admin_id : undefined;
      const successFilter = req.query.success === '1' || req.query.success === '0'
        ? Number(req.query.success) as 0 | 1 : undefined;
      const email = typeof req.query.email === 'string' ? req.query.email : undefined;
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const until = typeof req.query.until === 'string' ? req.query.until : undefined;
      const page = req.query.page !== undefined ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize !== undefined ? Number(req.query.pageSize) : 50;
      if (!Number.isFinite(page) || page < 1) throw Errors.invalidParams('page must be a positive integer');
      if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 200) {
        throw Errors.invalidParams('pageSize must be 1-200');
      }
      const filter: { admin_user_id?: string; success?: 0 | 1; email?: string; from?: string; until?: string; limit: number; offset: number } = {
        limit: pageSize,
        offset: (page - 1) * pageSize,
      };
      if (adminId) filter.admin_user_id = adminId;
      if (successFilter !== undefined) filter.success = successFilter;
      if (email) filter.email = email;
      if (from) filter.from = from;
      if (until) filter.until = until;
      const { rows, total } = loginEvents.list(filter);
      respond(res, LoginEventsListResponseSchema, {
        ok: true,
        data: rows,
        pagination: { total, page, pageSize, has_more: page * pageSize < total },
      }, { strict: true });
    } catch (e) { next(e); }
  });

  return router;
}