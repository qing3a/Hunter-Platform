import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  __resetRateLimits,
  getTestDb,
} from '../../helpers/test-app.js';
import { createCandidatePortalProfile } from '../../../src/main/modules/candidate-portal/profile.js';
import { authMiddleware } from '../../../src/main/modules/auth/middleware.js';
import { respond } from '../../../src/main/responses.js';
import { EnvelopeSchema } from '../../../src/main/schemas/common.js';
import { Errors, ApiError } from '../../../src/main/errors.js';
import { createUtf8OnlyMiddleware } from '../../../src/main/modules/encoding/index.js';
import { MAX_BODY_SIZE } from '../../../src/shared/constants.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal router that mounts GET/PUT /v1/candidate-portal/profile + audit log.
 *  Reconstructed here (instead of imported from src/main/routes) because the
 *  full candidate-portal router is built in Task 12; this test is the
 *  end-to-end proof that the profile module is HTTP-correct. */
function buildProfileRouter(): express.Router {
  const router = express.Router();
  router.get('/v1/candidate-portal/profile', authMiddleware(getTestDb()), (req, res, next) => {
    try {
      const user = (req as typeof req & { user?: import('../../../src/shared/types.js').User }).user;
      if (!user) throw Errors.unauthorized();
      const profile = createCandidatePortalProfile(getTestDb()).getProfile(user);
      const schema = EnvelopeSchema(
        z.object({
          id: z.string(),
          industry: z.string().nullable(),
          title_level: z.string().nullable(),
          years_experience: z.number().nullable(),
          skills: z.array(z.string()),
          visibility: z.enum(['public', 'invitation_only', 'hidden']),
          expectations: z.unknown().nullable(),
          pii: z.object({
            name: z.string().nullable(),
            current_company: z.string().nullable(),
            education_tier: z.string().nullable(),
          }),
        })
      );
      respond(res, schema, { ok: true, data: profile });
    } catch (e) { next(e); }
  });

  router.put('/v1/candidate-portal/profile', authMiddleware(getTestDb()), (req, res, next) => {
    try {
      const user = (req as typeof req & { user?: import('../../../src/shared/types.js').User }).user;
      if (!user) throw Errors.unauthorized();
      const body = req.body as Record<string, unknown>;
      // Strict whitelist: reject any unknown field at the router layer.
      const allowed = new Set(['skills', 'expectations', 'visibility']);
      for (const key of Object.keys(body)) {
        if (!allowed.has(key)) {
          throw Errors.invalidParams(`Field not allowed: ${key}`, { field: key });
        }
      }
      const input: { skills?: string[]; expectations?: object; visibility?: 'public' | 'invitation_only' | 'hidden' } = {};
      if ('skills' in body) input.skills = body.skills as string[];
      if ('expectations' in body) input.expectations = body.expectations as object;
      if ('visibility' in body) input.visibility = body.visibility as 'public' | 'invitation_only' | 'hidden';
      createCandidatePortalProfile(getTestDb()).updateProfile(user, input);
      const schema = EnvelopeSchema(z.object({ ok: z.literal(true) }));
      respond(res, schema, { ok: true, data: { ok: true } });
    } catch (e) { next(e); }
  });

  router.get('/v1/candidate-portal/profile/audit-log', authMiddleware(getTestDb()), (req, res, next) => {
    try {
      const user = (req as typeof req & { user?: import('../../../src/shared/types.js').User }).user;
      if (!user) throw Errors.unauthorized();
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const offset = req.query.offset ? Number(req.query.offset) : undefined;
      const entries = createCandidatePortalProfile(getTestDb()).listAuditLog(user, { limit, offset });
      const schema = EnvelopeSchema(
        z.object({
          entries: z.array(
            z.object({
              created_at: z.string(),
              action: z.string(),
              actor_user_id: z.string(),
              viewer_type: z.string().nullable(),
              viewer_name: z.string().nullable(),
            })
          ),
        })
      );
      respond(res, schema, { ok: true, data: { entries } });
    } catch (e) { next(e); }
  });

  return router;
}

/** Create a fully-OTP'd candidate user and return { apiKey, userId }. */
async function makeCandidate(email: string): Promise<{ apiKey: string; userId: string }> {
  const app = createTestApp();
  const req1 = await request(app)
    .post('/v1/candidate-portal/auth/otp/request')
    .send({ email });
  expect(req1.status).toBe(200);
  const code = req1.body.data.dev_code as string;
  const verify = await request(app)
    .post('/v1/candidate-portal/auth/otp/verify')
    .send({ email, code });
  expect(verify.status).toBe(200);
  return {
    apiKey: verify.body.data.api_key as string,
    userId: verify.body.data.user_id as string,
  };
}

/** Seed a candidates_private + candidates_anonymized row for an existing user. */
function seedCandidateProfile(opts: {
  userId: string;
  anonId?: string;
  privateId?: string;
  skills?: string[];
  visibility?: 'public' | 'invitation_only' | 'hidden';
  expectations?: object;
  currentCompany?: string | null;
  educationTier?: string | null;
}): void {
  const db = getTestDb();
  const now = new Date().toISOString();
  const anonId = opts.anonId ?? `anon_${opts.userId.slice(5)}`;
  const privateId = opts.privateId ?? `priv_${opts.userId.slice(5)}`;

  db.prepare(`
    INSERT OR IGNORE INTO users (id, user_type, name, contact, agent_endpoint,
      api_key_hash, api_key_prefix, api_key_expires_at,
      prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
      quota_per_day, quota_used, quota_reset_at, reputation,
      status, created_at, updated_at)
    VALUES (?, 'headhunter', 'H', NULL, NULL,
      'h_hash', 'h_prefix', NULL,
      NULL, NULL, NULL,
      200, 0, ?, 50,
      'active', ?, ?)
  `).run(`h_${anonId}`, now, now, now);

  db.prepare(`
    INSERT INTO candidates_private (id, headhunter_id, candidate_user_id, name_enc, phone_enc, email_enc,
      current_company_raw, current_title_raw, expected_salary, years_experience,
      education_school, resume_url, skills_json, raw_payload_json,
      created_at, updated_at)
    VALUES (?, ?, ?, 'n', 'p', 'e', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
  `).run(privateId, `h_${anonId}`, opts.userId, opts.currentCompany ?? null, now, now);

  db.prepare(`
    INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id,
      industry, title_level, years_experience, salary_range, education_tier,
      skills_json, is_public_pool, unlock_status, visibility, expectations_json,
      created_at, updated_at)
    VALUES (?, ?, ?, '互联网', 'P6', 5, '30-50万', ?,
      ?, 1, 'locked', ?, ?,
      ?, ?)
  `).run(
    anonId,
    privateId,
    `h_${anonId}`,
    opts.educationTier ?? '985',
    JSON.stringify(opts.skills ?? []),
    opts.visibility ?? 'public',
    opts.expectations ? JSON.stringify(opts.expectations) : null,
    now,
    now,
  );
}

/** Mount the profile router + auth + error handler on a fresh Express app.
 *  Builds from scratch (instead of layering onto createTestApp) because
 *  createTestApp() installs a 404 catch-all at the END of the middleware
 *  chain; mounting another router via app.use() afterwards would put it
 *  AFTER the 404 and never be reached. */
function buildAppWithProfileRouter(): express.Express {
  // Ensure the shared DB is initialized.
  createTestApp();
  const db = getTestDb();
  const app = express();
  app.use(
    createUtf8OnlyMiddleware(),
    express.json({ limit: MAX_BODY_SIZE })
  );
  // Mount profile router BEFORE the 404 catch-all so the routes are reached.
  app.use(buildProfileRouter());
  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'No route matched' } });
  });
  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({
        ok: false,
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    // eslint-disable-next-line no-console
    console.error('Unhandled test error:', err);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });
  });
  // Suppress unused-var lint on db (it's used by closures inside the router).
  void db;
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('candidate-portal: profile (handler + repo integration)', () => {
  beforeEach(() => {
    resetDb();
    __resetRateLimits();
  });
  afterAll(() => closeTestDb());

  describe('auth gating', () => {
    it('GET /profile returns 401 without bearer token', async () => {
      const app = buildAppWithProfileRouter();
      const res = await request(app).get('/v1/candidate-portal/profile');
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });

    it('PUT /profile returns 401 without bearer token', async () => {
      const app = buildAppWithProfileRouter();
      const res = await request(app)
        .put('/v1/candidate-portal/profile')
        .send({ skills: ['vue'] });
      expect(res.status).toBe(401);
    });

    it('GET /profile/audit-log returns 401 without bearer token', async () => {
      const app = buildAppWithProfileRouter();
      const res = await request(app).get('/v1/candidate-portal/profile/audit-log');
      expect(res.status).toBe(401);
    });

    it('returns 401 with malformed bearer token', async () => {
      const app = buildAppWithProfileRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/profile')
        .set('Authorization', 'Bearer not-a-real-key');
      expect(res.status).toBe(401);
    });
  });

  describe('happy path — authenticated candidate', () => {
    it('GET /profile returns 200 with public fields + PII mirror', async () => {
      const { apiKey, userId } = await makeCandidate(`get-${Math.random().toString(36).slice(2, 10)}@example.com`);
      seedCandidateProfile({
        userId,
        skills: ['React', 'TypeScript'],
        visibility: 'public',
        expectations: { desired_roles: ['前端架构师'], open_to_remote: true },
        currentCompany: '字节跳动',
        educationTier: '985',
      });

      const app = buildAppWithProfileRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/profile')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toMatchObject({
        industry: '互联网',
        title_level: 'P6',
        years_experience: 5,
        skills: ['React', 'TypeScript'],
        visibility: 'public',
        expectations: { desired_roles: ['前端架构师'], open_to_remote: true },
        pii: {
          current_company: '字节跳动',
          education_tier: '985',
        },
      });
      // pii.name comes from users.name (auto-created by OTP)
      expect(typeof res.body.data.pii.name).toBe('string');
      expect(res.body.data.pii.name.length).toBeGreaterThan(0);
    });

    it('GET /profile returns 404 when candidate has no anonymized record', async () => {
      const { apiKey } = await makeCandidate(`no-profile-${Date.now()}@example.com`);

      const app = buildAppWithProfileRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/profile')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(404);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('PUT /profile updates skills and returns 200', async () => {
      const { apiKey, userId } = await makeCandidate(`put-${Math.random().toString(36).slice(2, 10)}@example.com`);
      seedCandidateProfile({ userId, skills: ['React'] });

      const app = buildAppWithProfileRouter();
      const res = await request(app)
        .put('/v1/candidate-portal/profile')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ skills: ['Vue', 'Node.js'] });
      expect(res.status).toBe(200);

      // Confirm DB-side change via second GET.
      const res2 = await request(app)
        .get('/v1/candidate-portal/profile')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res2.status).toBe(200);
      expect(res2.body.data.skills).toEqual(['Vue', 'Node.js']);
    });

    it('PUT /profile updates visibility and persists the change', async () => {
      const { apiKey, userId } = await makeCandidate(`vis-${Math.random().toString(36).slice(2, 10)}@example.com`);
      seedCandidateProfile({ userId, visibility: 'public' });

      const app = buildAppWithProfileRouter();
      const res = await request(app)
        .put('/v1/candidate-portal/profile')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ visibility: 'hidden' });
      expect(res.status).toBe(200);

      const get = await request(app)
        .get('/v1/candidate-portal/profile')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(get.body.data.visibility).toBe('hidden');
    });

    it('PUT /profile updates expectations object', async () => {
      const { apiKey, userId } = await makeCandidate(`exp-${Math.random().toString(36).slice(2, 10)}@example.com`);
      seedCandidateProfile({ userId });

      const app = buildAppWithProfileRouter();
      const res = await request(app)
        .put('/v1/candidate-portal/profile')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          expectations: {
            desired_roles: ['Tech Lead'],
            expected_salary_min: 600000,
            expected_salary_max: 900000,
            open_to_remote: false,
          },
        });
      expect(res.status).toBe(200);

      const get = await request(app)
        .get('/v1/candidate-portal/profile')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(get.body.data.expectations).toEqual({
        desired_roles: ['Tech Lead'],
        expected_salary_min: 600000,
        expected_salary_max: 900000,
        open_to_remote: false,
      });
    });
  });

  describe('PII protection', () => {
    it('PUT /profile rejects PII field at the router (strict whitelist)', async () => {
      const { apiKey, userId } = await makeCandidate(`pii-${Math.random().toString(36).slice(2, 10)}@example.com`);
      seedCandidateProfile({ userId });

      const app = buildAppWithProfileRouter();
      const res = await request(app)
        .put('/v1/candidate-portal/profile')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ current_company: 'Should Not Persist', name: 'Hacker' });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('INVALID_PARAMS');
    });

    it('PUT /profile cannot mutate the read-only pii.* fields even if accepted', async () => {
      const { apiKey, userId } = await makeCandidate(`no-pii-${Math.random().toString(36).slice(2, 10)}@example.com`);
      seedCandidateProfile({ userId, currentCompany: 'OriginalCo', educationTier: '985' });

      const app = buildAppWithProfileRouter();
      // Only send public fields; verify pii.* is unchanged afterward.
      const res = await request(app)
        .put('/v1/candidate-portal/profile')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ skills: ['Go'] });
      expect(res.status).toBe(200);

      const get = await request(app)
        .get('/v1/candidate-portal/profile')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(get.body.data.pii.current_company).toBe('OriginalCo');
      expect(get.body.data.pii.education_tier).toBe('985');
    });

    it('PUT /profile with invalid visibility returns 400', async () => {
      const { apiKey, userId } = await makeCandidate(`badvis-${Math.random().toString(36).slice(2, 10)}@example.com`);
      seedCandidateProfile({ userId });

      const app = buildAppWithProfileRouter();
      const res = await request(app)
        .put('/v1/candidate-portal/profile')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ visibility: 'private' });
      expect(res.status).toBe(400);
    });
  });

  describe('audit log', () => {
    it('returns empty array when no recommendations exist', async () => {
      const { apiKey } = await makeCandidate(`audit-empty-${Date.now()}@example.com`);

      const app = buildAppWithProfileRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/profile/audit-log')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(res.body.data.entries).toEqual([]);
    });

    it('returns audit entries joined through recommendations', async () => {
      const { apiKey, userId } = await makeCandidate(`audit-${Math.random().toString(36).slice(2, 10)}@example.com`);
      seedCandidateProfile({ userId, anonId: `anon_${userId}`, privateId: `priv_${userId}` });

      // Seed a headhunter (required for FK on candidates_private.headhunter_id
      // and to act as audit actor) and an employer (also needed as FK on
      // recommendations.employer_id).
      const db = getTestDb();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO users (id, user_type, name, contact, agent_endpoint,
          api_key_hash, api_key_prefix, api_key_expires_at,
          prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
          quota_per_day, quota_used, quota_reset_at, reputation,
          status, created_at, updated_at)
        VALUES (?, 'headhunter', 'HH', NULL, NULL,
          'h1_hash', 'h1_prefix', NULL,
          NULL, NULL, NULL,
          200, 0, ?, 50,
          'active', ?, ?)
      `).run('h_audit_test', now, now, now);
      db.prepare(`
        INSERT INTO users (id, user_type, name, contact, agent_endpoint,
          api_key_hash, api_key_prefix, api_key_expires_at,
          prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
          quota_per_day, quota_used, quota_reset_at, reputation,
          status, created_at, updated_at)
        VALUES (?, 'employer', 'Emp', NULL, NULL,
          'e1_hash', 'e1_prefix', NULL,
          NULL, NULL, NULL,
          200, 0, ?, 50,
          'active', ?, ?)
      `).run('emp_audit_test', now, now, now);
      db.prepare(`
        INSERT INTO jobs (id, employer_id, title, description, requirements,
          salary_min, salary_max, status, priority, deadline, industry,
          created_at, updated_at)
        VALUES (?, ?, 'Frontend', NULL, NULL, NULL, NULL, 'open', 'normal', NULL, '互联网', ?, ?)
      `).run('job_audit_test', 'emp_audit_test', now, now);
      db.prepare(`
        INSERT INTO recommendations (id, headhunter_id, employer_id, anonymized_candidate_id,
          job_id, status, commission_split_json, referrer_headhunter_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
      `).run('rec_audit_test', 'h_audit_test', 'emp_audit_test', `anon_${userId}`, 'job_audit_test', now, now);
      db.prepare(`
        INSERT INTO unlock_audit_log (recommendation_id, actor_user_id, action,
          ip_address, user_agent, created_at)
        VALUES (?, ?, 'express_interest', '127.0.0.1', 'vitest', ?)
      `).run('rec_audit_test', 'emp_audit_test', now);

      const app = buildAppWithProfileRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/profile/audit-log')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(res.body.data.entries.length).toBe(1);
      expect(res.body.data.entries[0]).toMatchObject({
        action: 'express_interest',
        actor_user_id: 'emp_audit_test',
        viewer_type: 'employer',
        viewer_name: 'Emp',
      });
      expect(typeof res.body.data.entries[0].created_at).toBe('string');
    });
  });

  describe('non-candidate users are forbidden', () => {
    it('403 when a headhunter tries to view a candidate profile (handler-level guard)', async () => {
      // Directly exercise the handler with a synthetic headhunter User.
      const { createCandidatePortalProfile } = await import(
        '../../../src/main/modules/candidate-portal/profile.js'
      );
      const module_ = createCandidatePortalProfile(getTestDb());
      expect(() =>
        module_.getProfile({
          id: 'h_x', user_type: 'headhunter', name: 'X', contact: null,
          agent_endpoint: null, api_key_hash: '', api_key_prefix: '',
          api_key_expires_at: null, prev_api_key_hash: null,
          prev_api_key_prefix: null, prev_api_key_expires_at: null,
          quota_per_day: 100, quota_used: 0, quota_reset_at: '',
          reputation: 50, status: 'active', created_at: '', updated_at: '',
        })
      ).toThrow(/Only candidates/);
    });
  });
});