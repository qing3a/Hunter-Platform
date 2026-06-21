import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createRateLimitMiddleware } from '../modules/rate-limit/middleware.js';
import { createCandidateHandler } from '../modules/candidate/handler.js';
import { createCandidateExport } from '../modules/candidate/export.js';
import { createGdprHandler } from '../modules/candidate/gdpr-handler.js';
import { createUnlockAuditLogRepo } from '../db/repositories/unlock-audit-log.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import {
  ListOpportunitiesResponseSchema, AccessLogResponseSchema,
  ExportMyDataResponseSchema, ApproveUnlockResponseSchema,
  RejectUnlockResponseSchema, DeleteMyDataResponseSchema,
} from '../schemas/candidate.js';
import type { User } from '../../shared/types.js';

export function createCandidateRouter(db: DB, encryptionKey: Buffer): Router {
  const router = Router();
  const handler = createCandidateHandler(db, encryptionKey);
  const exporter = createCandidateExport(db, encryptionKey);
  const gdpr = createGdprHandler(db);
  const audit = createUnlockAuditLogRepo(db);
  router.use(authMiddleware(db));
  router.use(createRateLimitMiddleware(db));

  router.get('/opportunities', (req, res, next) => {
    try {
      const list = handler.viewOpportunities((req as typeof req & { user?: User }).user!, { status: req.query.status as any });
      respond(res, ListOpportunitiesResponseSchema, { ok: true, data: list });
    } catch (e) { next(e); }
  });

  router.get('/access-log', (req, res, next) => {
    try {
      const user = (req as typeof req & { user?: User }).user!;
      // Only candidates can view their own access log
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can view access log');
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const offset = req.query.offset ? Number(req.query.offset) : 0;
      const list = audit.listByCandidate(user.id, { limit, offset });
      respond(res, AccessLogResponseSchema, { ok: true, data: list });
    } catch (e) { next(e); }
  });

  router.get('/export-my-data', (req, res, next) => {
    try {
      const data = exporter.exportMyData((req as typeof req & { user?: User }).user!);
      res.setHeader('Content-Disposition', 'attachment; filename="my-data.json"');
      respond(res, ExportMyDataResponseSchema, { ok: true, data });
    } catch (e) { next(e); }
  });

  router.post('/recommendations/:id/approve-unlock', (req, res, next) => {
    try {
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress;
      const ctx: any = {};
      if (ip) ctx.ip = ip;
      if (req.headers['user-agent']) ctx.userAgent = req.headers['user-agent'];
      handler.approveUnlock((req as typeof req & { user?: User }).user!, { recommendation_id: req.params.id }, ctx);
      respond(res, ApproveUnlockResponseSchema, { ok: true, data: { status: 'candidate_approved' } });
    } catch (e) { next(e); }
  });

  router.post('/recommendations/:id/reject-unlock', (req, res, next) => {
    try {
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress;
      const ctx: any = {};
      if (ip) ctx.ip = ip;
      if (req.headers['user-agent']) ctx.userAgent = req.headers['user-agent'];
      handler.rejectUnlock((req as typeof req & { user?: User }).user!, { recommendation_id: req.params.id }, ctx);
      respond(res, RejectUnlockResponseSchema, { ok: true, data: { status: 'rejected_candidate' } });
    } catch (e) { next(e); }
  });

  // POST /v1/candidate/delete-my-data — GDPR / data-subject erasure
  // 鉴权：authMiddleware (any active user); handler 内部再校验 candidate
  // 配额：1 次（gdpr-handler 内部 tryConsume）
  // 行为：见 modules/candidate/gdpr-handler.ts
  router.post('/delete-my-data', (req, res, next) => {
    try {
      const user = (req as typeof req & { user?: User }).user;
      if (!user) throw Errors.unauthorized();
      const summary = gdpr.deleteMyData(user);

      // audit: 标记 target 是 user 自己，type='user'
      res.locals.ahTargetType = 'user';
      res.locals.ahTargetId = user.id;

      respond(res, DeleteMyDataResponseSchema, { ok: true, data: summary });
    } catch (e) { next(e); }
  });

  return router;
}