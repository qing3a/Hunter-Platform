import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createCandidateHandler } from '../modules/candidate/handler.js';
import { Errors } from '../errors.js';
import type { User } from '../../shared/types.js';

export function createCandidateRouter(db: DB): Router {
  const router = Router();
  const handler = createCandidateHandler(db);
  router.use(authMiddleware(db));

  router.get('/opportunities', (req, res, next) => {
    try {
      const list = handler.viewOpportunities((req as typeof req & { user?: User }).user!, { status: req.query.status as any });
      res.json({ ok: true, data: list });
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
