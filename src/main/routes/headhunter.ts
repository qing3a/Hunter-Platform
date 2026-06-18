import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { z } from 'zod';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createHeadhunterHandler } from '../modules/headhunter/handler.js';
import { createCandidatesAnonymizedRepo } from '../db/repositories/candidates-anonymized.js';
import { createQuotaManager } from '../modules/quota/manager.js';
import { Errors } from '../errors.js';
import type { User } from '../../shared/types.js';
import { QUOTA_COSTS } from '../../shared/constants.js';

const UploadSchema = z.object({
  candidate_user_id: z.string().min(1),
  name: z.string().min(1).max(100),
  phone: z.string().min(1).max(50),
  email: z.string().email(),
  current_company: z.string().max(200).optional(),
  current_title: z.string().max(100).optional(),
  expected_salary: z.number().int().positive().optional(),
  years_experience: z.number().int().min(0).max(60).optional(),
  education_school: z.string().max(200).optional(),
  skills: z.array(z.string()).optional(),
});

export function createHeadhunterRouter(db: DB, encryptionKey: Buffer): Router {
  const router = Router();
  const handler = createHeadhunterHandler(db, encryptionKey);
  const quota = createQuotaManager(db);
  const anonRepo = createCandidatesAnonymizedRepo(db);

  router.use(authMiddleware(db));

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
      res.json({ ok: true, data: { anonymized_id: result.anonymized_id, preview: result.preview } });
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

  router.post('/recommendations', (req, res, next) => {
    try {
      const parsed = RecommendSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const rec = handler.recommendCandidate((req as typeof req & { user?: User }).user!, parsed.data as any);
      res.json({ ok: true, data: rec });
    } catch (e) { next(e); }
  });

  router.post('/recommendations/:id/withdraw', (req, res, next) => {
    try {
      const parsed = WithdrawSchema.safeParse({ recommendation_id: req.params.id });
      if (!parsed.success) throw Errors.invalidParams('Invalid request body');
      handler.withdrawRecommendation((req as typeof req & { user?: User }).user!, parsed.data);
      res.json({ ok: true, data: { status: 'withdrawn' } });
    } catch (e) { next(e); }
  });

  router.post('/candidates/:id/publish-to-pool', (req, res, next) => {
    try {
      const parsed = PublishSchema.safeParse({ anonymized_candidate_id: req.params.id });
      if (!parsed.success) throw Errors.invalidParams('Invalid request body');
      handler.publishToPool((req as typeof req & { user?: User }).user!, parsed.data);
      res.json({ ok: true, data: { published: true } });
    } catch (e) { next(e); }
  });

  router.get('/recommendations', (req, res, next) => {
    try {
      const list = handler.listMyRecommendations((req as typeof req & { user?: User }).user!, { status: req.query.status as any });
      res.json({ ok: true, data: list });
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

      res.json({ ok: true, data });
    } catch (e) { next(e); }
  });

  return router;
}
