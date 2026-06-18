import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createRateLimitMiddleware } from '../modules/rate-limit/middleware.js';
import { createUsersRepo } from '../db/repositories/users.js';
import { createActionHistoryRepo } from '../db/repositories/action-history.js';
import { Errors } from '../errors.js';
import type { User } from '../../shared/types.js';

export function createUsersRouter(db: DB): Router {
  const router = Router();
  const users = createUsersRepo(db);
  const actionHistory = createActionHistoryRepo(db);

  router.use(authMiddleware(db));
  router.use(createRateLimitMiddleware(db));

  // GET /v1/users/:id/status — 查询用户状态（配额/待办/信誉）
  router.get('/:id/status', (req, res, next) => {
    try {
      const u = users.findById(req.params.id);
      if (!u) throw Errors.notFound('User not found');
      // Strip sensitive fields (api_key_hash, contact, agent_endpoint)
      res.json({
        ok: true,
        data: {
          id: u.id,
          user_type: u.user_type,
          name: u.name,
          quota_per_day: u.quota_per_day,
          quota_used: u.quota_used,
          quota_reset_at: u.quota_reset_at,
          reputation: u.reputation,
          status: u.status,
          created_at: u.created_at,
        },
      });
    } catch (e) { next(e); }
  });

  // GET /v1/users/:id/history — 查询操作历史（仅本人）
  router.get('/:id/history', (req, res, next) => {
    try {
      const u = users.findById(req.params.id);
      if (!u) throw Errors.notFound('User not found');
      // Auth: must be the user themselves
      if ((req as typeof req & { user?: User }).user!.id !== u.id) {
        throw Errors.forbidden('Can only view your own history');
      }
      const list = actionHistory.listByUser(u.id, { limit: 100 });
      res.json({ ok: true, data: list });
    } catch (e) { next(e); }
  });

  return router;
}
