import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createRateLimitMiddleware } from '../modules/rate-limit/middleware.js';
import { createCandidateHandler } from '../modules/candidate/handler.js';
import { createCandidateExport } from '../modules/candidate/export.js';
import { createUnlockAuditLogRepo } from '../db/repositories/unlock-audit-log.js';
import { Errors } from '../errors.js';
import type { User } from '../../shared/types.js';

export function createCandidateRouter(db: DB, encryptionKey: Buffer): Router {
  const router = Router();
  const handler = createCandidateHandler(db);
  const exporter = createCandidateExport(db, encryptionKey);
  const audit = createUnlockAuditLogRepo(db);
  router.use(authMiddleware(db));
  router.use(createRateLimitMiddleware(db));

  router.get('/opportunities', (req, res, next) => {
    try {
      const list = handler.viewOpportunities((req as typeof req & { user?: User }).user!, { status: req.query.status as any });
      res.json({ ok: true, data: list });
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
      res.json({ ok: true, data: list });
    } catch (e) { next(e); }
  });

  router.get('/export-my-data', (req, res, next) => {
    try {
      const data = exporter.exportMyData((req as typeof req & { user?: User }).user!);
      res.setHeader('Content-Disposition', 'attachment; filename="my-data.json"');
      res.json({ ok: true, data });
    } catch (e) { next(e); }
  });

  router.post('/recommendations/:id/approve-unlock', (req, res, next) => {
    try {
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress;
      const ctx: any = {};
      if (ip) ctx.ip = ip;
      if (req.headers['user-agent']) ctx.userAgent = req.headers['user-agent'];
      handler.approveUnlock((req as typeof req & { user?: User }).user!, { recommendation_id: req.params.id }, ctx);
      res.json({ ok: true, data: { status: 'candidate_approved' } });
    } catch (e) { next(e); }
  });

  router.post('/recommendations/:id/reject-unlock', (req, res, next) => {
    try {
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress;
      const ctx: any = {};
      if (ip) ctx.ip = ip;
      if (req.headers['user-agent']) ctx.userAgent = req.headers['user-agent'];
      handler.rejectUnlock((req as typeof req & { user?: User }).user!, { recommendation_id: req.params.id }, ctx);
      res.json({ ok: true, data: { status: 'rejected_candidate' } });
    } catch (e) { next(e); }
  });

  return router;
}