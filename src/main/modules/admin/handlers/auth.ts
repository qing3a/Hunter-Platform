import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Errors } from '../../../errors.js';
import type { DB } from '../../../db/connection.js';
import { createAdminUsersRepo, type AdminUserRow } from '../../../db/repositories/admin-users.js';
import { createAdminLoginEventsRepo } from '../../../db/repositories/admin-login-events.js';
import { respond } from '../../../responses.js';
import {
  AdminLoginRequestSchema,
  AdminLoginResponseSchema,
  AdminMeResponseSchema,
  AdminRotateKeyResponseSchema,
} from '../../../schemas/admin.js';

const API_KEY_PREFIX_LEN = 18; // 'hp_admin_' + first 8 chars of random hex
const BCRYPT_COST = 10;

async function generateAdminApiKey(): Promise<{ hash: string; key: string; prefix: string }> {
  const random = crypto.randomBytes(32).toString('hex');
  const key = `hp_admin_${random}`;
  const prefix = key.slice(0, API_KEY_PREFIX_LEN);
  const hash = await bcrypt.hash(key, BCRYPT_COST);
  return { hash, key, prefix };
}

export function createAdminAuthHandler(db: DB) {
  const repo = createAdminUsersRepo(db);
  const loginEventsRepo = createAdminLoginEventsRepo(db);

  // Helper that NEVER throws (so it can't break login main flow)
  const recordLoginEvent = (
    success: boolean,
    adminUserId: string | null,
    email: string,
    reason: string | null,
    req: Request,
  ) => {
    try {
      loginEventsRepo.insert({
        admin_user_id: adminUserId,
        email,
        success: success ? 1 : 0,
        failure_reason: reason,
        ip: req.ip ?? null,
        user_agent: (req.headers['user-agent'] as string | undefined) ?? null,
      });
    } catch (e) {
      console.warn('[admin-login-events] failed to record login event:', (e as Error).message);
    }
  };

  return {
    /** POST /v1/admin/auth/login */
    async login(req: Request, res: Response, next: (e?: any) => void) {
      try {
        const parsed = AdminLoginRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          recordLoginEvent(false, null, String(req.body?.email ?? ''), 'invalid_request', req);
          throw Errors.invalidParams('email and password required');
        }
        const { email, password } = parsed.data;

        const row = repo.findByEmail(email);
        if (!row) {
          recordLoginEvent(false, null, email, 'unknown_email', req);
          throw Errors.unauthorized('Invalid email or password');
        }
        if (row.status === 'suspended') {
          recordLoginEvent(false, row.id, email, 'suspended', req);
          throw Errors.forbidden('Admin account suspended');
        }

        const ok = await bcrypt.compare(password, row.password_hash);
        if (!ok) {
          recordLoginEvent(false, row.id, email, 'invalid_password', req);
          throw Errors.unauthorized('Invalid email or password');
        }

        // Always generate a fresh api_key on login (clients should rotate on demand anyway)
        const { hash, key, prefix } = await generateAdminApiKey();
        repo.updateApiKey(row.id, hash, prefix, new Date().toISOString());
        repo.updateLastLogin(row.id, new Date().toISOString());
        recordLoginEvent(true, row.id, email, null, req);

        respond(res, AdminLoginResponseSchema, {
          ok: true,
          data: {
            admin_user_id: row.id,
            name: row.name,
            email: row.email,
            role: row.role,
            api_key: key,
          },
        });
      } catch (e) { next(e); }
    },

    /** POST /v1/admin/auth/rotate-key */
    async rotateKey(req: Request, res: Response, next: (e?: any) => void) {
      try {
        const admin = (req as any).admin as AdminUserRow | undefined;
        if (!admin) throw Errors.unauthorized('Missing admin context');
        const { hash, key, prefix } = await generateAdminApiKey();
        repo.updateApiKey(admin.id, hash, prefix, new Date().toISOString());
        respond(res, AdminRotateKeyResponseSchema, {
          ok: true,
          data: { api_key: key },
        });
      } catch (e) { next(e); }
    },

    /** GET /v1/admin/me */
    me(req: Request, res: Response, next: (e?: any) => void) {
      try {
        const admin = (req as any).admin as AdminUserRow | undefined;
        if (!admin) throw Errors.unauthorized('Missing admin context');
        respond(res, AdminMeResponseSchema, {
          ok: true,
          data: {
            id: admin.id,
            name: admin.name,
            email: admin.email,
            role: admin.role,
            status: admin.status,
            last_login_at: admin.last_login_at,
            created_at: admin.created_at,
          },
        });
      } catch (e) { next(e); }
    },
  };
}