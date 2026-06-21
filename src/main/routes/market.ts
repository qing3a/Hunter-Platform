import { Router, type Request, type Response } from 'express';
import { optionalAuthMiddleware } from '../modules/auth/middleware.js';
import type { DB } from '../db/connection.js';
import { createQuotaManager } from '../modules/quota/manager.js';
import { createJobsRepo } from '../db/repositories/jobs.js';
import { QUOTA_COSTS } from '../../shared/constants.js';
import { respond } from '../responses.js';
import { LeaderboardResponseSchema, JobsListResponseSchema } from '../schemas/market.js';

export function createMarketRouter(db: DB): Router {
  const router = Router();
  const quota = createQuotaManager(db);

  // skill.md §5.6: /v1/market/leaderboard is in the "unlimited, no auth" list.
  router.use(optionalAuthMiddleware(db));

  // GET /v1/market/leaderboard — top 10 active headhunters by reputation DESC
  router.get('/leaderboard', (req: Request, res: Response) => {
    const authedUser = (req as any).user;
    if (authedUser) {
      const r = quota.tryConsume(authedUser.id, QUOTA_COSTS.config_lookup ?? 1);
      if (!r.ok && r.reason === 'INSUFFICIENT_QUOTA') {
        return res.status(429).json({ ok: false, error: { code: 'INSUFFICIENT_QUOTA', message: 'Daily quota exceeded' } });
      }
    }
    const rows = db.prepare(
      `SELECT id, name, reputation FROM users
       WHERE user_type = ? AND status = ?
       ORDER BY reputation DESC, created_at ASC
       LIMIT 10`
    ).all('headhunter', 'active') as { id: string; name: string; reputation: number }[];

    const data = rows.map((row, idx) => ({
      rank: idx + 1,
      id: row.id,
      name: row.name,
      reputation: row.reputation,
    }));
    respond(res, LeaderboardResponseSchema, { ok: true, data });
  });

  // GET /v1/market/jobs — public job marketplace (v1.3)
  // skill.md §5.6: /v1/market/* is "unlimited, no auth" — optional auth only.
  // Authenticated callers pay `browse_jobs` quota; anonymous callers skip quota.
  router.get('/jobs', (req: Request, res: Response) => {
    const authedUser = (req as Request & { user?: { id: string } }).user;
    if (authedUser) {
      const r = quota.tryConsume(authedUser.id, QUOTA_COSTS.browse_jobs);
      if (!r.ok && r.reason === 'INSUFFICIENT_QUOTA') {
        return res.status(429).json({ ok: false, error: { code: 'INSUFFICIENT_QUOTA', message: 'Daily quota exceeded' } });
      }
    }
    // Query params (optional, AND 组合)
    const industry = typeof req.query.industry === 'string' ? req.query.industry : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    // 使用已存在的 listPublic (src/main/db/repositories/jobs.ts)
    const listOpts: { industry?: string; limit: number; offset: number } = { limit, offset };
    if (industry !== undefined) listOpts.industry = industry;
    const jobs = createJobsRepo(db).listPublic(listOpts);

    respond(res, JobsListResponseSchema, { ok: true, data: jobs });
  });

  return router;
}
