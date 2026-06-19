import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { z } from 'zod';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createRateLimitMiddleware } from '../modules/rate-limit/middleware.js';
import { createEmployerHandler } from '../modules/employer/handler.js';
import { createCommissionHandler } from '../modules/commission/handler.js';
import { Errors } from '../errors.js';
import type { User } from '../../shared/types.js';

const CreateJobSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  required_skills: z.array(z.string().min(1).max(100)).max(20).optional(),
  salary_min: z.number().int().positive().optional(),
  salary_max: z.number().int().positive().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  deadline: z.string().optional(),
  industry: z.string().max(100).optional(),
});

const ExpressInterestSchema = z.object({
  recommendation_id: z.string().min(1),
});

const UnlockContactSchema = z.object({
  recommendation_id: z.string().min(1),
});

const CreatePlacementSchema = z.object({
  anonymized_candidate_id: z.string().min(1),
  job_id: z.string().min(1),
  annual_salary: z.number().int().positive(),
});

export function createEmployerRouter(db: DB, encryptionKey: Buffer): Router {
  const router = Router();
  const handler = createEmployerHandler(db);
  router.use(authMiddleware(db));
  router.use(createRateLimitMiddleware(db));

  const commissionHandler = createCommissionHandler(db);

  router.post('/placements', (req, res, next) => {
    try {
      const parsed = CreatePlacementSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const placement = commissionHandler.createPlacement((req as typeof req & { user?: User }).user!, parsed.data);
      res.json({ ok: true, data: placement });
    } catch (e) { next(e); }
  });

  router.get('/placements', (req, res, next) => {
    try {
      const list = commissionHandler.listPlacements((req as typeof req & { user?: User }).user!, { status: req.query.status as any });
      res.json({ ok: true, data: list });
    } catch (e) { next(e); }
  });

  router.post('/jobs', (req, res, next) => {
    try {
      const parsed = CreateJobSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const job = handler.createJob((req as typeof req & { user?: User }).user!, parsed.data as any);
      res.json({ ok: true, data: job });
    } catch (e) { next(e); }
  });

  router.get('/jobs', (req, res, next) => {
    try {
      const list = handler.listMyJobs((req as typeof req & { user?: User }).user!, { status: req.query.status as any });
      res.json({ ok: true, data: list });
    } catch (e) { next(e); }
  });

  router.get('/talent', (req, res, next) => {
    try {
      const filters: any = {};
      if (req.query.industry) filters.industry = req.query.industry as string;
      if (req.query.title_level) filters.title_level = req.query.title_level as string;
      if (req.query.min_years) filters.min_years = Number(req.query.min_years);
      if (req.query.max_years) filters.max_years = Number(req.query.max_years);
      if (req.query.skills) filters.skills = String(req.query.skills).split(',');
      const list = handler.browseTalent((req as typeof req & { user?: User }).user!, filters);
      res.json({ ok: true, data: list });
    } catch (e) { next(e); }
  });

  router.post('/recommendations/:id/express-interest', (req, res, next) => {
    try {
      const parsed = ExpressInterestSchema.safeParse({ recommendation_id: req.params.id });
      if (!parsed.success) throw Errors.invalidParams('Invalid request body');
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress;
      const ctx: any = { encryptionKey };
      if (ip) ctx.ip = ip;
      if (req.headers['user-agent']) ctx.userAgent = req.headers['user-agent'];
      const result = handler.expressInterest((req as typeof req & { user?: User }).user!, parsed.data, ctx);
      // action_history 审计
      const audit = (result as any).__audit;
      if (audit) {
        res.locals.ahTargetType = audit.target_type;
        res.locals.ahTargetId = audit.target_id;
      }
      res.json({ ok: true, data: { status: 'employer_interested' } });
    } catch (e) { next(e); }
  });

  router.post('/recommendations/:id/unlock-contact', (req, res, next) => {
    try {
      const parsed = UnlockContactSchema.safeParse({ recommendation_id: req.params.id });
      if (!parsed.success) throw Errors.invalidParams('Invalid request body');
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress;
      const ctx: any = { encryptionKey };
      if (ip) ctx.ip = ip;
      if (req.headers['user-agent']) ctx.userAgent = req.headers['user-agent'];
      const result = handler.unlockContact((req as typeof req & { user?: User }).user!, parsed.data, ctx);
      // action_history 审计
      const audit = (result as any).__audit;
      if (audit) {
        res.locals.ahTargetType = audit.target_type;
        res.locals.ahTargetId = audit.target_id;
      }
      res.json({ ok: true, data: { status: 'unlocked' } });
    } catch (e) { next(e); }
  });

  return router;
}
