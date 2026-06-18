import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../modules/auth/middleware.js';
import type { DB } from '../db/connection.js';
import { createQuotaManager } from '../modules/quota/manager.js';
import { QUOTA_COSTS } from '../../shared/constants.js';

export function createMarketRouter(db: DB): Router {
  const router = Router();
  const quota = createQuotaManager(db);

  router.use(authMiddleware(db));

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
    res.json({ ok: true, data });
  });

  return router;
}
