import { Router } from 'express';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createUsersRepo } from '../db/repositories/users.js';
import type { DB } from '../db/connection.js';
import {
  getAllCapabilitySets,
  getCapabilitiesForRole,
  findCapabilityByAlias,
} from '../capabilities/index.js';
import { canInvoke, type Capability } from '../capabilities/types.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import {
  AliasResponseSchema,
  CapabilitiesResponseSchema,
  MeCapabilitiesResponseSchema,
} from '../schemas/capabilities.js';

function describeCapability(c: Capability) {
  return {
    name: c.name,
    description: c.description,
    method: c.method,
    path: c.path,
    quota_cost: c.quota_cost,
    preconditions: c.preconditions,
    effects: c.effects,
  };
}

export function createCapabilitiesRouter(db: DB): Router {
  const router = Router();
  const users = createUsersRepo(db);

  // GET /v1/capabilities — public, lists all capability sets (no quota info)
  router.get('/v1/capabilities', (_req, res, next) => {
    try {
      const sets = getAllCapabilitySets().map((s) => ({
        role: s.role,
        capabilities: s.capabilities.map(describeCapability),
      }));
      respond(res, CapabilitiesResponseSchema, { ok: true, data: { sets } });
    } catch (e) { next(e); }
  });

  // GET /v1/capabilities/by-alias/:name — public, R1.C4.
  // Resolves an external skill alias (e.g. `ow_recruit.advance_candidate`)
  // to the internal canonical capability's HTTP binding. Mirrors the
  // server-side `findCapabilityByAlias` helper but exposed for external
  // clients (ow-recruit et al.) that want to look up the canonical
  // `{ method, path }` before issuing a request, so they can address it
  // by canonical name in `x-capability-name` headers and quota lookups.
  router.get('/v1/capabilities/by-alias/:name', (req, res, next) => {
    try {
      const cap = findCapabilityByAlias(req.params.name);
      if (!cap) {
        throw Errors.notFound(`No capability alias '${req.params.name}'`);
      }
      respond(res, AliasResponseSchema, {
        ok: true,
        data: { canonical: cap.name, method: cap.method, path: cap.path },
      });
    } catch (e) { next(e); }
  });

  // GET /v1/capabilities/me — auth required, returns THIS user's available capabilities
  router.get('/v1/capabilities/me', authMiddleware(db, users), (req, res, next) => {
    try {
      const user = (req as { user?: { id: string; user_type: string; status: 'active' | 'suspended' | 'deleted'; quota_per_day: number; quota_used: number } }).user;
      if (!user) throw Errors.unauthorized();

      const set = getCapabilitiesForRole(user.user_type);
      const basePayload = {
        user_id: user.id,
        user_type: user.user_type,
        status: user.status,
        quota_per_day: user.quota_per_day,
        quota_used: user.quota_used,
        quota_remaining: user.quota_per_day - user.quota_used,
      };

      if (!set) {
        respond(res, MeCapabilitiesResponseSchema, { ok: true, data: { ...basePayload, capabilities: [] } });
        return;
      }

      const userCtx = {
        status: user.status,
        quota_used: user.quota_used,
        quota_per_day: user.quota_per_day,
      };

      const capabilities = set.capabilities.map((c) => {
        const result = canInvoke(c, userCtx);
        const entry: {
          name: string; description: string; method: string; path: string;
          quota_cost: number; available: boolean; reason?: string;
        } = {
          name: c.name,
          description: c.description,
          method: c.method,
          path: c.path,
          quota_cost: c.quota_cost,
          available: result.ok,
        };
        if (!result.ok) entry.reason = result.reason;
        return entry;
      });

      respond(res, MeCapabilitiesResponseSchema, { ok: true, data: { ...basePayload, capabilities } });
    } catch (e) { next(e); }
  });

  return router;
}