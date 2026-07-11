import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { z } from 'zod';
import { createRegisterHandler } from '../modules/register/handler.js';
import { authMiddleware } from '../modules/auth/middleware.js';
import { verifyApiKey } from '../modules/auth/api-key.js';
import { sessionService } from '../modules/auth/session.js';
import { generateApiKey } from '../modules/auth/api-key.js';
import { createQuotaManager } from '../modules/quota/manager.js';
import { createUsersRepo, rotateApiKey } from '../db/repositories/users.js';
import { userRolesRepo } from '../db/repositories/user-roles.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import {
  RegisterResponseSchema, RotateKeyResponseSchema,
  LoginSchema, LoginResponseSchema,
  RefreshResponseSchema, LogoutResponseSchema,
} from '../schemas/auth.js';
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
  const users = createUsersRepo(db);

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

  // POST /v1/auth/login — convert api_key → session_id (bearer token).
  // Per spec D5: returns session_id + active_role + available_roles + expires_at.
  // The active_role defaults to the user's registered user_type; the caller
  // may request a switch to any role in available_roles (must be granted).
  router.post('/login', (req, res, next) => {
    try {
      const parsed = LoginSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const { api_key, active_role: requestedRole } = parsed.data;

      // 1. Look up user by 12-char prefix (avoids full-table bcrypt scan).
      const user = users.findByApiKeyPrefix(api_key.slice(0, 12));
      if (!user || user.status !== 'active') throw Errors.unauthorized();

      // 2. Verify full key against bcrypt hash.
      if (!verifyApiKey(api_key, user.api_key_hash)) throw Errors.unauthorized();

      // 3. Pick active_role: requested → registered → fallback 'candidate'.
      //    If caller requested a role, it MUST be in user's available_roles.
      const availableRoles = userRolesRepo.list(db, user.id);
      const fallback = (availableRoles[0] ?? 'candidate') as typeof availableRoles[number];
      const activeRole = (requestedRole ?? user.user_type ?? fallback) as typeof availableRoles[number];
      if (!availableRoles.includes(activeRole)) {
        throw Errors.forbidden(`Role '${requestedRole}' not in this user's available roles`);
      }

      // 4. Create the session (168h sliding TTL).
      const xff = req.headers['x-forwarded-for'];
      const ip = (typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined) || req.socket.remoteAddress || null;
      const userAgent = (req.headers['user-agent'] as string | undefined) ?? null;
      const session = sessionService.create(db, user.id, activeRole, ip, userAgent);

      respond(res, LoginResponseSchema, {
        ok: true,
        data: {
          session_id: session.id,
          user_id: user.id,
          active_role: activeRole,
          available_roles: availableRoles,
          expires_at: session.expires_at,
        },
      });
    } catch (e) { next(e); }
  });

  // POST /v1/auth/refresh — slide the window + optional role switch.
  // Body: { session_id, active_role? }. The session_id may also be passed in
  // the Authorization header (`Bearer sess_…`) for clients that prefer that.
  router.post('/refresh', (req, res, next) => {
    try {
      const body = z.object({
        session_id: z.string().regex(/^sess_/).optional(),
        active_role: z.enum(['candidate', 'hr', 'pm']).optional(),
      }).safeParse(req.body);
      if (!body.success) throw Errors.invalidParams('Invalid request body', { issues: body.error.issues });

      const bearer = (req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
      const sessionId = body.data.session_id ?? (bearer.startsWith('sess_') ? bearer : undefined);
      if (!sessionId) throw Errors.unauthorized();

      const refreshed = sessionService.refresh(db, sessionId, body.data.active_role);
      if (!refreshed) throw Errors.unauthorized();
      const resolved = sessionService.resolve(db, sessionId) ?? null;
      if (!resolved) throw Errors.unauthorized();
      respond(res, RefreshResponseSchema, {
        ok: true,
        data: {
          session_id: refreshed.session_id,
          user_id: resolved.user_id,
          active_role: refreshed.active_role,
          available_roles: resolved.available_roles,
          expires_at: refreshed.expires_at,
        },
      });
    } catch (e) { next(e); }
  });

  // POST /v1/auth/logout — idempotent session revoke. Missing/invalid
  // sessions still return ok so retry-on-network-blip is safe.
  router.post('/logout', (req, res, next) => {
    try {
      const body = z.object({
        session_id: z.string().regex(/^sess_/).optional(),
      }).safeParse(req.body);
      if (!body.success) throw Errors.invalidParams('Invalid request body', { issues: body.error.issues });

      const bearer = (req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
      const sessionId = body.data.session_id ?? (bearer.startsWith('sess_') ? bearer : undefined);
      if (!sessionId) {
        // No session supplied — return ok anyway. "Logout is a noop when
        // there's no session" keeps the endpoint fully idempotent.
        respond(res, LogoutResponseSchema, { ok: true, data: { revoked: false } });
        return;
      }
      sessionService.revoke(db, sessionId);
      respond(res, LogoutResponseSchema, { ok: true, data: { revoked: true } });
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