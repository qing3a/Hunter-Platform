import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { z } from 'zod';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createHeadhunterHandler } from '../modules/headhunter/handler.js';
import { Errors } from '../errors.js';
import type { User } from '../../shared/types.js';

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

  router.use(authMiddleware(db));

  router.post('/candidates', async (req, res, next) => {
    try {
      const parsed = UploadSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const result = await handler.uploadCandidate((req as typeof req & { user?: User }).user!, parsed.data);
      res.json({ ok: true, data: result });
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

  return router;
}
