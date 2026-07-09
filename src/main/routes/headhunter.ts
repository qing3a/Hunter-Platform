import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { z } from 'zod';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createRateLimitMiddleware } from '../modules/rate-limit/middleware.js';
import { createConfigCache } from '../modules/config-cache.js';
import { createHeadhunterHandler } from '../modules/headhunter/handler.js';
import { createCandidatesAnonymizedRepo } from '../db/repositories/candidates-anonymized.js';
import { createQuotaManager } from '../modules/quota/manager.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import {
  UploadCandidateResponseSchema, RecommendResponseSchema,
  WithdrawResponseSchema, PublishResponseSchema,
  ListRecommendationsResponseSchema, ListMyCandidatesResponseSchema,
  CreateJobForEmployerResponseSchema, ListMyCreatedJobsResponseSchema,
} from '../schemas/headhunter.js';
import type { User } from '../../shared/types.js';
import { QUOTA_COSTS } from '../../shared/constants.js';
import { createHeadhunterPickup } from '../modules/candidate-portal/headhunter-pickup.js';
import { EnvelopeSchema, IdString } from '../schemas/common.js';

const UploadSchema = z.object({
  candidate_user_id: z.string().min(1),
  name: z.string().min(1).max(100),
  phone: z.string().min(1).max(50),
  email: z.string().email(),
  current_company: z.string().min(1).max(200),
  current_title: z.string().max(100).optional(),
  expected_salary: z.number().int().positive().optional(),
  years_experience: z.number().int().min(0).max(60).optional(),
  education_school: z.string().max(200).optional(),
  skills: z.array(z.string()).optional(),
});

// Inline response schemas for the candidate-portal pickup endpoints (Task 9).
// Full schema definitions will move to src/main/schemas/headhunter.ts in Task 11
// (router wiring). For now we keep them minimal so respond() can validate the
// envelope shape.
const PendingPickupItemSchema = z.object({
  id: z.number().int(),
  recommendation_id: IdString,
  candidate_user_id: IdString,
  job_id: IdString,
  pickup_headhunter_id: IdString.nullable(),
  candidate_note: z.string().nullable(),
  withdrawn_at: z.number().int().nullable(),
  created_at: z.number().int(),
  job_title: z.string().nullable(),
  candidate_display_name: z.string().nullable(),
  recommendation_status: z.string(),
});
const PendingPickupResponseSchema = EnvelopeSchema(
  z.object({
    items: z.array(PendingPickupItemSchema),
    next_cursor: z.null(),
  }),
);
const PickupResponseSchema = EnvelopeSchema(
  z.object({
    recommendation_id: IdString,
    status: z.literal('pending'),
  }),
);

export function createHeadhunterRouter(db: DB, encryptionKey: Buffer): Router {
  const router = Router();
  const handler = createHeadhunterHandler(db, encryptionKey);
  const quota = createQuotaManager(db);
  const anonRepo = createCandidatesAnonymizedRepo(db);

  router.use(authMiddleware(db));
  router.use(createRateLimitMiddleware(db, createConfigCache(db)));

  router.post('/candidates', async (req, res, next) => {
    try {
      const parsed = UploadSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const result = await handler.uploadCandidate((req as typeof req & { user?: User }).user!, parsed.data);
      // action_history 审计：把 handler 返回的 __audit 写到 res.locals
      const audit = (result as any).__audit;
      if (audit) {
        res.locals.ahTargetType = audit.target_type;
        res.locals.ahTargetId = audit.target_id;
        res.locals.ahResSummary = audit.res_summary;
      }
      // 不向 API 客户端暴露 __audit
      respond(res, UploadCandidateResponseSchema, { ok: true, data: { anonymized_id: result.anonymized_id, preview: result.preview } });
    } catch (e) { next(e); }
  });

  const RecommendSchema = z.object({
    anonymized_candidate_id: z.string().min(1),
    job_id: z.string().min(1),
    commission_split: z.object({ hunter: z.number(), referrer: z.number() }).optional(),
    referrer_headhunter_id: z.string().optional(),
  });

  const WithdrawSchema = z.object({
    recommendation_id: z.string().min(1),
  });

  const PublishSchema = z.object({
    anonymized_candidate_id: z.string().min(1),
  });

  // v009: 猎头代雇主建岗 (spec §5.1)
  const CreateJobForEmployerSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    required_skills: z.array(z.string().min(1).max(100)).max(20).optional(),
    salary_min: z.number().int().positive().optional(),
    salary_max: z.number().int().positive().optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    deadline: z.string().optional(),
    industry: z.string().max(100).optional(),
    created_for_employer_id: z.string().min(1).optional(),
  });

  router.post('/recommendations', (req, res, next) => {
    try {
      const parsed = RecommendSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const rec = handler.recommendCandidate((req as typeof req & { user?: User }).user!, parsed.data as any);
      respond(res, RecommendResponseSchema, { ok: true, data: rec });
    } catch (e) { next(e); }
  });

  router.post('/recommendations/:id/withdraw', (req, res, next) => {
    try {
      const parsed = WithdrawSchema.safeParse({ recommendation_id: req.params.id });
      if (!parsed.success) throw Errors.invalidParams('Invalid request body');
      handler.withdrawRecommendation((req as typeof req & { user?: User }).user!, parsed.data);
      respond(res, WithdrawResponseSchema, { ok: true, data: { status: 'withdrawn' } });
    } catch (e) { next(e); }
  });

  router.post('/candidates/:id/publish-to-pool', (req, res, next) => {
    try {
      const parsed = PublishSchema.safeParse({ anonymized_candidate_id: req.params.id });
      if (!parsed.success) throw Errors.invalidParams('Invalid request body');
      handler.publishToPool((req as typeof req & { user?: User }).user!, parsed.data);
      respond(res, PublishResponseSchema, { ok: true, data: { published: true } });
    } catch (e) { next(e); }
  });

  router.get('/recommendations', (req, res, next) => {
    try {
      const list = handler.listMyRecommendations((req as typeof req & { user?: User }).user!, { status: req.query.status as any });
      respond(res, ListRecommendationsResponseSchema, { ok: true, data: list });
    } catch (e) { next(e); }
  });

  // GET /v1/headhunter/candidates — list this headhunter's uploaded candidates
  router.get('/candidates', (req, res, next) => {
    try {
      const user = (req as typeof req & { user?: User }).user!;
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can list candidates');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.list_my_candidates ?? 1);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      const list = anonRepo.findByHeadhunterId(user.id);

      // Convention A: drop raw `id`, expose as `anonymized_id`; parse skills_json
      const data = list.map((c) => {
        const { id, skills_json, ...rest } = c;
        return {
          ...rest,
          anonymized_id: id,
          skills: skills_json ? JSON.parse(skills_json) as string[] : [],
        };
      });

      respond(res, ListMyCandidatesResponseSchema, { ok: true, data });
    } catch (e) { next(e); }
  });

  // v009: 猎头代雇主建岗 (POST /v1/headhunter/jobs)
  router.post('/jobs', (req, res, next) => {
    try {
      const parsed = CreateJobForEmployerSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const job = handler.createJobForEmployer((req as typeof req & { user?: User }).user!, parsed.data);
      respond(res, CreateJobForEmployerResponseSchema, { ok: true, data: job });
    } catch (e) { next(e); }
  });

  // v009: 列出我创建的 job (GET /v1/headhunter/jobs)
  router.get('/jobs', (req, res, next) => {
    try {
const list = handler.listMyCreatedJobs((req as typeof req & { user?: User }).user!);
    respond(res, ListMyCreatedJobsResponseSchema, { ok: true, data: list });
    } catch (e) { next(e); }
  });

  // -------------------------------------------------------------------------
  // Candidate Portal Phase 1: headhunter pickup endpoints (Task 9)
  // -------------------------------------------------------------------------
  const pickup = createHeadhunterPickup(db);

  // GET /v1/headhunter/recommendations/pending-pickup
  // — list self-applied recommendations awaiting pickup
  router.get('/recommendations/pending-pickup', (req, res, next) => {
    try {
      const user = (req as typeof req & { user?: User }).user!;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const offset = req.query.offset ? Number(req.query.offset) : undefined;
      // Build a query object without `undefined` keys so we satisfy
      // exactOptionalPropertyTypes=true.
      const query: { limit?: number; offset?: number } = {};
      if (limit !== undefined) query.limit = limit;
      if (offset !== undefined) query.offset = offset;
      const result = pickup.listPendingPickup(user, query);
      respond(res, PendingPickupResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // POST /v1/headhunter/recommendations/:id/pickup
  // — claim a pending_pickup recommendation
  router.post('/recommendations/:id/pickup', (req, res, next) => {
    try {
      const user = (req as typeof req & { user?: User }).user!;
      const result = pickup.pickup(user, req.params.id);
      respond(res, PickupResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  return router;
}
