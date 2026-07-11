import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { z } from 'zod';
import { createRegisterHandler } from '../modules/register/handler.js';
import { authMiddleware } from '../modules/auth/middleware.js';
import { generateApiKey } from '../modules/auth/api-key.js';
import { createQuotaManager } from '../modules/quota/manager.js';
import { rotateApiKey } from '../db/repositories/users.js';
import { userRolesRepo } from '../db/repositories/user-roles.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import { RegisterResponseSchema, RotateKeyResponseSchema } from '../schemas/auth.js';
import type { User } from '../../shared/types.js';

const RegisterSchema = z.object({
  user_type: z.enum(['candidate', 'hr', 'pm']),  // R1.C2: legacy 'hr'/'pm' accepted by handler with remap
  name: z.string().min(1).max(100),
  contact: z.string().min(1).max(200).optional(),
  agent_endpoint: z.string().url().optional(),
});

export function createAuthRouter(db: DB, isProduction: boolean): Router {
  const router = Router();
  const handler = createRegisterHandler(db);
  const quota = createQuotaManager(db);

  router.post('/register', (req, res, next) => {
    try {
      const parsed = RegisterSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const xff = req.headers['x-forwarded-for'];
      const ip = (typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined) || req.socket.remoteAddress || 'unknown';
      const user = handler.handle(parsed.data.user_type, parsed.data.name, parsed.data.contact, parsed.data.agent_endpoint, ip, isProduction);
      // action_history 审计：register 时 req.user 不存在（无 auth），
      // 通过 userIdForAudit 让中间件知道要写哪个 user_id
      res.locals.userIdForAudit = user.id;
      res.locals.ahTargetType = 'user';
      res.locals.ahTargetId = user.id;
      respond(res, RegisterResponseSchema, {
        ok: true,
        data: {
          id: user.id,
          api_key: user.api_key,
          quota_per_day: user.quota_per_day,
          user_type: user.user_type,
          // R1.C2 / T5 — every registered user is bootstrapped with all 3
          // roles; surface them so the client can render role-switch UI.
          available_roles: userRolesRepo.list(db, user.id),
        },
      });
    } catch (e) { next(e); }
  });

  // POST /v1/auth/rotate-key — 旋转当前用户的 API key
  // 鉴权：仅本人（通过 authMiddleware 拿到 req.user）
  // 配额：1 次
  // 行为：生成新 key，旧 key 立即失效（无 grace period）
  router.post('/rotate-key', authMiddleware(db), (req, res, next) => {
    try {
      const user = (req as typeof req & { user?: User }).user;
      if (!user) throw Errors.unauthorized();

      // 配额检查（rotate 算 1 次配额）
      const qResult = quota.tryConsume(user.id, 1);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      const { key, hash, prefix } = generateApiKey();
      const rotated = rotateApiKey(db, user.id, hash, prefix);
      if (!rotated) throw Errors.notFound('User not found');

      // audit summary 让 action_history 中间件记录 rotate 事件
      res.locals.ahTargetType = 'user';
      res.locals.ahTargetId = user.id;
      res.locals.ahResSummary = {
        action: 'rotate_api_key',
        new_prefix: prefix,
      };

      respond(res, RotateKeyResponseSchema, {
        ok: true,
        data: {
          new_api_key: key,
          new_prefix: prefix,
        },
      });
    } catch (e) { next(e); }
  });

  return router;
}