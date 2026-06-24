import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { z } from 'zod';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createRateLimitMiddleware } from '../modules/rate-limit/middleware.js';
import { createEmployerHandler } from '../modules/employer/handler.js';
import { createNotificationTrigger } from '../modules/notification/trigger.js';
import { createCommissionHandler } from '../modules/commission/handler.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import {
  CreatePlacementResponseSchema, ListPlacementsResponseSchema,
  CreateJobResponseSchema, ListMyJobsResponseSchema,
  BrowseTalentResponseSchema, ExpressInterestResponseSchema,
  UnlockContactResponseSchema, PendingClaimsResponseSchema,
  ClaimJobResponseSchema, RejectJobResponseSchema,
} from '../schemas/employer.js';
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

// v009: claim / reject / pending
const RejectJobSchema = z.object({
  reason: z.string().max(500).optional(),
});

export function createEmployerRouter(db: DB, encryptionKey: Buffer): Router {
  const router = Router();
  const notifTrigger = createNotificationTrigger(db);
  const handler = createEmployerHandler(db, notifTrigger);
  router.use(authMiddleware(db));
  router.use(createRateLimitMiddleware(db));

  const commissionHandler = createCommissionHandler(db, encryptionKey);

  router.post('/placements', (req, res, next) => {
    try {
      const parsed = CreatePlacementSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const placement = commissionHandler.createPlacement((req as typeof req & { user?: User }).user!, parsed.data);
      respond(res, CreatePlacementResponseSchema, { ok: true, data: placement });
    } catch (e) { next(e); }
  });

  router.get('/placements', (req, res, next) => {
    try {
      const list = commissionHandler.listPlacements((req as typeof req & { user?: User }).user!, { status: req.query.status as any });
      respond(res, ListPlacementsResponseSchema, { ok: true, data: list });
    } catch (e) { next(e); }
  });

  router.post('/jobs', (req, res, next) => {
    try {
      const parsed = CreateJobSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const job = handler.createJob((req as typeof req & { user?: User }).user!, parsed.data as any);
      respond(res, CreateJobResponseSchema, { ok: true, data: job });
    } catch (e) { next(e); }
  });

  router.get('/jobs', (req, res, next) => {
    try {
      const list = handler.listMyJobs((req as typeof req & { user?: User }).user!, { status: req.query.status as any });
      respond(res, ListMyJobsResponseSchema, { ok: true, data: list });
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
      if (req.query.min_salary) filters.min_salary = Number(req.query.min_salary);
      if (req.query.max_salary) filters.max_salary = Number(req.query.max_salary);
      const list = handler.browseTalent((req as typeof req & { user?: User }).user!, filters);
      respond(res, BrowseTalentResponseSchema, { ok: true, data: list });
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
      respond(res, ExpressInterestResponseSchema, { ok: true, data: { status: 'employer_interested' } });
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
      respond(res, UnlockContactResponseSchema, { ok: true, data: { status: 'unlocked' } });
    } catch (e) { next(e); }
  });

  // v009: 待认领列表 (spec §5.1)
  router.get('/pending-claims', (req, res, next) => {
    try {
const list = handler.listPendingClaims((req as typeof req & { user?: User }).user!);
    respond(res, PendingClaimsResponseSchema, { ok: true, data: list });
    } catch (e) { next(e); }
  });

  // v009: claim (spec §5.2)
  router.post('/claim-jobs/:id', (req, res, next) => {
    try {
      const job_id = String(req.params.id);
      if (!job_id || job_id.length === 0) throw Errors.invalidParams('job id required');
      const job = handler.claimJob((req as typeof req & { user?: User }).user!, { job_id });
      respond(res, ClaimJobResponseSchema, { ok: true, data: job });
    } catch (e) { next(e); }
  });

  // v009: reject (spec §5.3)
  router.post('/reject-jobs/:id', (req, res, next) => {
    try {
      const parsed = RejectJobSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const result = handler.rejectJob(
        (req as typeof req & { user?: User }).user!,
        { job_id: String(req.params.id), reason: parsed.data.reason ?? null },
      );
      respond(res, RejectJobResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  return router;
}
