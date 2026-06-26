import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createRateLimitMiddleware } from '../modules/rate-limit/middleware.js';
import { createConfigCache } from '../modules/config-cache.js';
import { createUsersRepo } from '../db/repositories/users.js';
import { createActionHistoryRepo } from '../db/repositories/action-history.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import { UserStatusResponseSchema, UserHistoryResponseSchema } from '../schemas/users.js';
import type { User } from '../../shared/types.js';

export function createUsersRouter(db: DB): Router {
  const router = Router();
  const users = createUsersRepo(db);
  const actionHistory = createActionHistoryRepo(db);

  router.use(authMiddleware(db));
  router.use(createRateLimitMiddleware(db, createConfigCache(db)));

  // GET /v1/users/:id/status — 查询用户状态（配额/待办/信誉）
  router.get('/:id/status', (req, res, next) => {
    try {
      const u = users.findById(req.params.id);
      if (!u) throw Errors.notFound('User not found');
      // Strip sensitive fields (api_key_hash, contact, agent_endpoint)
      respond(res, UserStatusResponseSchema, {
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
  // 支持 ?limit= (≤200, default 50) 和 ?since= (ISO 8601)
  router.get('/:id/history', (req, res, next) => {
    try {
      const u = users.findById(req.params.id);
      if (!u) throw Errors.notFound('User not found');
      // Auth: must be the user themselves
      if ((req as typeof req & { user?: User }).user!.id !== u.id) {
        throw Errors.forbidden('Can only view your own history');
      }

      // Parse ?limit (clamped to [1, 200], default 50)
      const rawLimit = req.query.limit;
      let limit = 50;
      if (rawLimit !== undefined) {
        const n = Number(rawLimit);
        if (!Number.isFinite(n) || n < 1) {
          throw Errors.invalidParams('limit must be a positive integer');
        }
        limit = Math.min(Math.floor(n), 200);
      }

      // Parse ?since (ISO 8601; rejected if invalid)
      const rawSince = req.query.since;
      let since: string | undefined;
      if (typeof rawSince === 'string' && rawSince.length > 0) {
        const parsed = new Date(rawSince);
        if (Number.isNaN(parsed.getTime())) {
          throw Errors.invalidParams('since must be a valid ISO 8601 timestamp');
        }
        since = parsed.toISOString();
      }

      const offset = req.query.offset ? Number(req.query.offset) : 0;
      const list = actionHistory.listByUserSince(
        u.id,
        since !== undefined ? { limit, offset, since } : { limit, offset },
      );
      respond(res, UserHistoryResponseSchema, { ok: true, data: list });
    } catch (e) { next(e); }
  });

  return router;
}