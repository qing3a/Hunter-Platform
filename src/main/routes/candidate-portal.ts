import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DB } from '../db/connection.js';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createCandidatePortalAuth } from '../modules/candidate-portal/auth.js';
import { createCandidatePortalJobs } from '../modules/candidate-portal/jobs.js';
import { createCandidatePortalApplications } from '../modules/candidate-portal/applications.js';
import { createCandidatePortalMessages } from '../modules/candidate-portal/messages.js';
import { createCandidatePortalProfile } from '../modules/candidate-portal/profile.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import type { User } from '../../shared/types.js';
import {
  OtpRequestSchema, OtpRequestResponseSchema,
  OtpVerifySchema, OtpVerifyResponseSchema,
  JobsBrowseResponseSchema, RecommendedJobsResponseSchema, JobDetailResponseSchema,
  ApplySchema, ApplyResponseSchema,
  ApplicationsListResponseSchema, RespondSchema, RespondResponseSchema,
  ProfileViewResponseSchema, ProfileUpdateSchema, ProfileUpdateResponseSchema,
  MessageSendSchema, MessageSendResponseSchema, MessagesListResponseSchema,
} from '../schemas/candidate-portal.js';

// Candidate Portal Phase 1 — public router.
//
// Mounted by server.ts at `/v1/candidate-portal`:
//   - Public (OTP): `/auth/otp/{request,verify}`
//   - Authenticated (Bearer token): `/jobs/*`, `/applications/*`, `/profile/*`, `/messages/*`
//
// Auth boundary is enforced at the router level: `router.use(authMiddleware(db))`
// is mounted AFTER the public OTP endpoints, so the OTP routes never see the
// `user` object. Authenticated handlers cast `(req as Request & { user: User }).user`
// to satisfy TS — `authMiddleware` populates `req.user` before calling `next`.
//
// Note: per-router express.json + utf8-only body parsers are attached by the
// mounting caller (server.ts and tests/helpers/test-app.ts). The router itself
// only registers route handlers.
export function createCandidatePortalRouter(
  db: DB,
  opts: {
    otpLength: number;
    otpTtlSeconds: number;
    otpMaxAttempts: number;
    consoleOnly: boolean;
  }
): Router {
  const router = Router();
  const auth = createCandidatePortalAuth(db, opts);
  const jobs = createCandidatePortalJobs(db);
  const applications = createCandidatePortalApplications(db);
  const messages = createCandidatePortalMessages(db);
  const profile = createCandidatePortalProfile(db);

  // ===== Public (OTP) =====
  // These MUST be registered before `router.use(authMiddleware(db))` below;
  // re-ordering would break the no-auth-required contract for first-time
  // candidate login.

  // POST /v1/candidate-portal/auth/otp/request
  router.post('/auth/otp/request', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = OtpRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const xff = req.headers['x-forwarded-for'];
      const ip =
        (typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined) ||
        req.socket.remoteAddress ||
        'unknown';

      // Re-shape to satisfy exactOptionalPropertyTypes on OtpRequestInput —
      // only set `user_type` when the client actually provided one. The auth
      // module defaults undefined to 'candidate' so legacy callers keep working.
      const requestInput: { email: string; user_type?: 'candidate' | 'headhunter' | 'pm'; ip: string } = {
        email: parsed.data.email,
        ip,
      };
      if (parsed.data.user_type !== undefined) {
        requestInput.user_type = parsed.data.user_type;
      }

      const result = await auth.requestOtp(requestInput);
      respond(res, OtpRequestResponseSchema, { ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // POST /v1/candidate-portal/auth/otp/verify
  router.post
('/auth/otp/verify', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = OtpVerifySchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      // Re-shape to satisfy exactOptionalPropertyTypes on OtpVerifyInput —
      // only set `user_type` when defined. The auth module defaults missing
      // to 'candidate' so existing candidate login flows are unaffected.
      const verifyInput: { email: string; code: string; user_type?: 'candidate' | 'headhunter' | 'pm' } = {
        email: parsed.data.email,
        code: parsed.data.code,
      };
      if (parsed.data.user_type !== undefined) {
        verifyInput.user_type = parsed.data.user_type;
      }

      const result = await auth.verifyOtp(verifyInput);
      respond(res, OtpVerifyResponseSchema, { ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // ===== Authenticated =====
  // Scope auth to specific path groups so unknown paths fall through to the
  // router's 404 handler instead of being rejected with 401. This is
  // consistent with the e2e test: "rejects requests to unknown paths under
  // /v1/candidate-portal" expects 404, not 401.
  const requireAuth = authMiddleware(db);
  router.use('/jobs', requireAuth);
  router.use('/applications', requireAuth);
  router.use('/profile', requireAuth);
  router.use('/messages', requireAuth);

  // ----- Jobs -----

  // GET /v1/candidate-portal/jobs/browse
  router.get('/jobs/browse', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      // Build filter with only defined fields — JobsListFilter is declared
      // with exactOptionalPropertyTypes so passing explicit `undefined`
      // would fail the type check.
      const filter: { industry?: string; keyword?: string; cursor?: number; limit?: number } = {};
      if (typeof req.query.industry === 'string') filter.industry = req.query.industry;
      if (typeof req.query.keyword === 'string') filter.keyword = req.query.keyword;
      if (typeof req.query.cursor === 'string') filter.cursor = Number(req.query.cursor);
      if (typeof req.query.limit === 'string') filter.limit = Number(req.query.limit);
      const result = jobs.browse(user, filter);
      respond(res, JobsBrowseResponseSchema, { ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // GET /v1/candidate-portal/jobs/recommended
  router.get('/jobs/recommended', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const result = jobs.recommended(user, {
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : 20,
      });
      respond(res, RecommendedJobsResponseSchema, { ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // GET /v1/candidate-portal/jobs/:id
  router.get('/jobs/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const jobId = String(req.params.id);
      const result = jobs.detail(user, jobId);
      respond(res, JobDetailResponseSchema, { ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // POST /v1/candidate-portal/jobs/:id/apply
  router.post('/jobs/:id/apply', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const jobId = String(req.params.id);
      const parsed = ApplySchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      // Re-shape to satisfy exactOptionalPropertyTypes on ApplyInput — only
      // set `note` when defined.
      const applyInput: { note?: string } = {};
      if (parsed.data.note !== undefined) applyInput.note = parsed.data.note;
      const result = applications.apply(user, jobId, applyInput);
      respond(res, ApplyResponseSchema, { ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // ----- Applications -----

  // GET /v1/candidate-portal/applications
  router.get('/applications', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const query: { limit?: number; offset?: number } = {};
      if (typeof req.query.limit === 'string') query.limit = Number(req.query.limit);
      if (typeof req.query.offset === 'string') query.offset = Number(req.query.offset);
      const items = applications.list(user, query);
      respond(res, ApplicationsListResponseSchema, { ok: true, data: items });
    } catch (e) {
      next(e);
    }
  });

  // GET /v1/candidate-portal/applications/:id
  router.get('/applications/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw Errors.invalidParams('application_id must be a positive integer');
      }
      const app = applications.detail(user, id);
      respond(res, ApplicationsListResponseSchema, { ok: true, data: app });
    } catch (e) {
      next(e);
    }
  });

  // POST /v1/candidate-portal/applications/:id/respond
  router.post('/applications/:id/respond', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw Errors.invalidParams('application_id must be a positive integer');
      }
      const parsed = RespondSchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      applications.respond(user, id, parsed.data.action);
      respond(res, RespondResponseSchema, { ok: true, data: { status: 'responded' } });
    } catch (e) {
      next(e);
    }
  });

  // ----- Profile -----

  // GET /v1/candidate-portal/profile
  router.get('/profile', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const result = profile.getProfile(user);
      respond(res, ProfileViewResponseSchema, { ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // PUT /v1/candidate-portal/profile
  router.put('/profile', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = ProfileUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      // Re-shape parsed.data to satisfy exactOptionalPropertyTypes on
      // ProfileUpdateInput — only spread keys whose values are not undefined.
      const update: { skills?: string[]; visibility?: 'public' | 'invitation_only' | 'hidden'; expectations?: Record<string, unknown> } = {};
      if (parsed.data.skills !== undefined) update.skills = parsed.data.skills;
      if (parsed.data.visibility !== undefined) update.visibility = parsed.data.visibility;
      if (parsed.data.expectations !== undefined) update.expectations = parsed.data.expectations;
      profile.updateProfile(user, update);
      respond(res, ProfileUpdateResponseSchema, { ok: true, data: { updated: true } });
    } catch (e) {
      next(e);
    }
  });

  // GET /v1/candidate-portal/profile/audit-log
  router.get('/profile/audit-log', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const query: { limit?: number; offset?: number } = {};
      if (typeof req.query.limit === 'string') query.limit = Number(req.query.limit);
      if (typeof req.query.offset === 'string') query.offset = Number(req.query.offset);
      const items = profile.listAuditLog(user, query);
      respond(res, ApplicationsListResponseSchema, { ok: true, data: items });
    } catch (e) {
      next(e);
    }
  });

  // ----- Messages -----

  // GET /v1/candidate-portal/messages
  router.get('/messages', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const box = req.query.box;
      const query: { box?: 'inbox' | 'sent'; unread_only?: boolean; limit?: number; offset?: number } = {};
      if (box === 'inbox' || box === 'sent') query.box = box;
      if (req.query.unread_only === 'true') query.unread_only = true;
      if (typeof req.query.limit === 'string') query.limit = Number(req.query.limit);
      if (typeof req.query.offset === 'string') query.offset = Number(req.query.offset);
      const result = messages.list(user, query);
      respond(res, MessagesListResponseSchema, { ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // POST /v1/candidate-portal/messages
  router.post('/messages', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = MessageSendSchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      // Re-shape to match MessageSendInput (application_id?: number | null).
      const input: { to_user_id: string; content: string; application_id?: number | null } = {
        to_user_id: parsed.data.to_user_id,
        content: parsed.data.content,
      };
      if (parsed.data.application_id !== undefined) {
        input.application_id = parsed.data.application_id;
      }
      const result = messages.send(user, input);
      respond(res, MessageSendResponseSchema, { ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // 404 fallback for any unmatched path under /v1/candidate-portal.
  // Without this, Express's default HTML 404 would leak out (or the app-level
  // JSON 404 in server.ts would handle it, but in the test app the 404 is
  // also JSON, so we get consistent behavior across both mounts).
  router.use((req: Request, res: Response) => {
    res.status(404).json({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: `No route matched ${req.method} ${req.path}`,
        details: { method: req.method, path: req.path },
      },
    });
  });

  return router;
}
