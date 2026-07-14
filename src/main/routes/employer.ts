import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { z } from 'zod';
import { authMiddleware } from '../modules/auth/middleware.js';
import { roleGate } from '../modules/auth/role-gate.js';
import { createRateLimitMiddleware } from '../modules/rate-limit/middleware.js';
import { createConfigCache } from '../modules/config-cache.js';
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
  GetJobResponseSchema, UpdateJobRequestSchema, UpdateJobResponseSchema,
  JobActionResponseSchema,
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

const JobIdParamSchema = z.object({ id: z.string().min(1).max(64) });

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
  // R1.C2 / T10 — only the merged 'pm' role (formerly 'employer') is allowed
  // on these endpoints. Handler modules' `assertPm(user)` remains the source of
  // truth; this is the layered first-line defense.
  router.use(roleGate('pm'));
  router.use(createRateLimitMiddleware(db, createConfigCache(db)));

  const commissionHandler = createCommissionHandler(db, encryptionKey, notifTrigger);

  router.post('/placements', async (req, res, next) => {
    try {
      const parsed = CreatePlacementSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const placement = await commissionHandler.createPlacement((req as typeof req & { user?: User }).user!, parsed.data);
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
  // Compatibility route for Task 8 / Employer Panel plan:
  // POST /v1/employer/pending-claims/:id/claim.
  router.post('/pending-claims/:id/claim', (req, res, next) => {
    try {
      const job_id = String(req.params.id);
      if (!job_id || job_id.length === 0) throw Errors.invalidParams('job id required');
      const job = handler.claimJob((req as typeof req & { user?: User }).user!, { job_id });
      respond(res, ClaimJobResponseSchema, { ok: true, data: job });
    } catch (e) { next(e); }
  });

  // v009: reject (spec §5.3)
  // Compatibility route for Task 8 / Employer Panel plan:
  // POST /v1/employer/pending-claims/:id/reject.
  router.post('/pending-claims/:id/reject', (req, res, next) => {
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

  // v009: claim (legacy route retained for existing clients)
  router.post('/claim-jobs/:id', (req, res, next) => {
    try {
      const job_id = String(req.params.id);
      if (!job_id || job_id.length === 0) throw Errors.invalidParams('job id required');
      const job = handler.claimJob((req as typeof req & { user?: User }).user!, { job_id });
      respond(res, ClaimJobResponseSchema, { ok: true, data: job });
    } catch (e) { next(e); }
  });

  // v009: reject (legacy route retained for existing clients)
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

  // -------------------------------------------------------------------------
  // Task 5 backend gap fill: GET / PATCH / pause / resume / close
  // -------------------------------------------------------------------------

  // GET /v1/employer/jobs/:id — single-job detail. Owner-only.
  router.get('/jobs/:id', (req, res, next) => {
    try {
      const parsed = JobIdParamSchema.safeParse({ id: req.params.id });
      if (!parsed.success) throw Errors.invalidParams('Invalid job id');
      const job = handler.getJob((req as typeof req & { user?: User }).user!, parsed.data);
      respond(res, GetJobResponseSchema, { ok: true, data: job });
    } catch (e) { next(e); }
  });

  // PATCH /v1/employer/jobs/:id — partial edit. Owner-only.
  router.patch('/jobs/:id', (req, res, next) => {
    try {
      const idParsed = JobIdParamSchema.safeParse({ id: req.params.id });
      if (!idParsed.success) throw Errors.invalidParams('Invalid job id');
      const bodyParsed = UpdateJobRequestSchema.safeParse(req.body ?? {});
      if (!bodyParsed.success) throw Errors.invalidParams('Invalid request body', { issues: bodyParsed.error.issues });
      // Reject empty bodies — there's nothing to apply; surfacing as 400 is
      // louder than a silent no-op and lines up with the spec's "any subset".
      if (Object.keys(bodyParsed.data).length === 0) {
        throw Errors.invalidParams('No fields to update');
      }
      const job = handler.updateJob(
        (req as typeof req & { user?: User }).user!,
        { id: idParsed.data.id, fields: bodyParsed.data },
      );
      respond(res, UpdateJobResponseSchema, { ok: true, data: job });
    } catch (e) { next(e); }
  });

  // POST /v1/employer/jobs/:id/pause — flip open → paused. Owner-only.
  router.post('/jobs/:id/pause', (req, res, next) => {
    try {
      const parsed = JobIdParamSchema.safeParse({ id: req.params.id });
      if (!parsed.success) throw Errors.invalidParams('Invalid job id');
      const result = handler.pauseJob((req as typeof req & { user?: User }).user!, parsed.data);
      respond(res, JobActionResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // POST /v1/employer/jobs/:id/resume — flip paused → open. Owner-only.
  router.post('/jobs/:id/resume', (req, res, next) => {
    try {
      const parsed = JobIdParamSchema.safeParse({ id: req.params.id });
      if (!parsed.success) throw Errors.invalidParams('Invalid job id');
      const result = handler.resumeJob((req as typeof req & { user?: User }).user!, parsed.data);
      respond(res, JobActionResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // POST /v1/employer/jobs/:id/close — hard-close from open or paused. Owner-only.
  router.post('/jobs/:id/close', (req, res, next) => {
    try {
      const parsed = JobIdParamSchema.safeParse({ id: req.params.id });
      if (!parsed.success) throw Errors.invalidParams('Invalid job id');
      const result = handler.closeJob((req as typeof req & { user?: User }).user!, parsed.data);
      respond(res, JobActionResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  return router;
}
