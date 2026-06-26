import { Router, type Request, type Response } from 'express';
import { optionalAuthMiddleware } from '../modules/auth/middleware.js';
import type { DB } from '../db/connection.js';
import { loadIndustryMap, TITLE_LEVEL_PATTERNS, SALARY_BANDS } from '../modules/desensitize/mapping.js';
import { createQuotaManager } from '../modules/quota/manager.js';
import { createAdminConfigHandler } from '../modules/admin/handlers/config.js';
import { QUOTA_COSTS } from '../../shared/constants.js';
import { respond } from '../responses.js';
import {
  IndustriesResponseSchema, TitleLevelsResponseSchema, SalaryBandsResponseSchema,
} from '../schemas/config.js';
import { ListRateLimitsResponseSchema } from '../schemas/admin.js';

export function createConfigRouter(db: DB): Router {
  const router = Router();
  const quota = createQuotaManager(db);

  // skill.md §5.6: /v1/config/* is in the "unlimited, no auth" list.
  // Use optional auth so we can still see who is calling in metrics, but
  // never block anonymous callers.
  router.use(optionalAuthMiddleware(db));

  // GET /v1/config/industries — list industry categories with company counts
  router.get('/industries', (req: Request, res: Response) => {
    const authedUser = (req as any).user;
    if (authedUser) {
      const r = quota.tryConsume(authedUser.id, QUOTA_COSTS.config_lookup ?? 1);
      if (!r.ok && r.reason === 'INSUFFICIENT_QUOTA') {
        return res.status(429).json({ ok: false, error: { code: 'INSUFFICIENT_QUOTA', message: 'Daily quota exceeded' } });
      }
    }
    const { cfg } = loadIndustryMap(db);
    const data = cfg.categories.map((c: { id: string; companies?: string[] }) => ({
      id: c.id,
      companies_count: (c.companies ?? []).length,
    }));
    respond(res, IndustriesResponseSchema, { ok: true, data });
  });

  // GET /v1/config/title_levels — list title-level regex patterns
  router.get('/title_levels', (req: Request, res: Response) => {
    const authedUser = (req as any).user;
    if (authedUser) {
      const r = quota.tryConsume(authedUser.id, QUOTA_COSTS.config_lookup ?? 1);
      if (!r.ok && r.reason === 'INSUFFICIENT_QUOTA') {
        return res.status(429).json({ ok: false, error: { code: 'INSUFFICIENT_QUOTA', message: 'Daily quota exceeded' } });
      }
    }
    const data = TITLE_LEVEL_PATTERNS.map((t: { regex: RegExp; level: string }) => ({
      code: t.level,
      match: t.regex.source,
    }));
    respond(res, TitleLevelsResponseSchema, { ok: true, data });
  });

  // GET /v1/config/salary_bands — list salary band buckets
  router.get('/salary_bands', (req: Request, res: Response) => {
    const authedUser = (req as any).user;
    if (authedUser) {
      const r = quota.tryConsume(authedUser.id, QUOTA_COSTS.config_lookup ?? 1);
      if (!r.ok && r.reason === 'INSUFFICIENT_QUOTA') {
        return res.status(429).json({ ok: false, error: { code: 'INSUFFICIENT_QUOTA', message: 'Daily quota exceeded' } });
      }
    }
    respond(res, SalaryBandsResponseSchema, { ok: true, data: SALARY_BANDS });
  });

  // GET /v1/config/rate-limits — public rate-limit thresholds (Sub-G)
  router.get('/rate-limits', async (req: Request, res: Response) => {
    const authedUser = (req as any).user;
    if (authedUser) {
      const r = quota.tryConsume(authedUser.id, QUOTA_COSTS.config_lookup ?? 1);
      if (!r.ok && r.reason === 'INSUFFICIENT_QUOTA') {
        return res.status(429).json({ ok: false, error: { code: 'INSUFFICIENT_QUOTA', message: 'Daily quota exceeded' } });
      }
    }
    const adminConfig = createAdminConfigHandler(db);
    const data = await adminConfig.getRateLimits();
    respond(res, ListRateLimitsResponseSchema, { ok: true, data });
  });

  return router;
}