import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { z } from 'zod';
import { createRegisterHandler } from '../modules/register/handler.js';
import { Errors } from '../errors.js';

const RegisterSchema = z.object({
  user_type: z.enum(['candidate', 'headhunter', 'employer']),
  name: z.string().min(1).max(100),
  contact: z.string().min(1).max(200).optional(),
  agent_endpoint: z.string().url().optional(),
});

export function createAuthRouter(db: DB, isProduction: boolean): Router {
  const router = Router();
  const handler = createRegisterHandler(db);

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
      res.json({
        ok: true,
        data: {
          id: user.id,
          api_key: user.api_key,
          quota_per_day: user.quota_per_day,
          user_type: user.user_type,
        },
      });
    } catch (e) { next(e); }
  });

  return router;
}
