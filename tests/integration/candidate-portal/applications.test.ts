import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  __resetRateLimits,
  getTestDb,
} from '../../helpers/test-app.js';
import { createCandidatePortalApplications } from '../../../src/main/modules/candidate-portal/applications.js';
import { authMiddleware } from '../../../src/main/modules/auth/middleware.js';
import { Errors, ApiError } from '../../../src/main/errors.js';
import { createUtf8OnlyMiddleware } from '../../../src/main/modules/encoding/index.js';
import { MAX_BODY_SIZE } from '../../../src/shared/constants.js';
import type { User } from '../../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal router for the applications endpoints under test. Mirrors the
 *  Task 6/7 pattern: we mount only the routes the test exercises and build
 *  the response envelope inline. Task 12 will fold this into the unified
 *  candidate-portal router. */
function buildApplicationsRouter(): express.Router {
  const router = express.Router();

  // POST /v1/candidate-portal/jobs/:jobId/apply
  router.post(
    '/v1/candidate-portal/jobs/:jobId/apply',
    authMiddleware(getTestDb()),
    (req, res, next) => {
      try {
        const user = (req as typeof req & { user?: User }).user;
        if (!user) throw Errors.unauthorized();
        const result = createCandidatePortalApplications(getTestDb()).apply(user, req.params.jobId, {
          note: (req.body as { note?: string }).note,
        });
        res.json({ ok: true, data: result });
      } catch (e) { next(e); }
    },
  );

  // GET /v1/candidate-portal/applications
  router.get(
    '/v1/candidate-portal/applications',
    authMiddleware(getTestDb()),
    (req, res, next) => {
      try {
        const user = (req as typeof req & { user?: User }).user;
        if (!user) throw Errors.unauthorized();
        const limit = req.query.limit ? Number(req.query.limit) : undefined;
        const offset = req.query.offset ? Number(req.query.offset) : undefined;
        const items = createCandidatePortalApplications(getTestDb()).list(user, { limit, offset });
        res.json({ ok: true, data: { items } });
      } catch (e) { next(e); }
    },
  );

  // GET /v1/candidate-portal/applications/:id
  router.get(
    '/v1/candidate-portal/applications/:id',
    authMiddleware(getTestDb()),
    (req, res, next) => {
      try {
        const user = (req as typeof req & { user?: User }).user;
        if (!user) throw Errors.unauthorized();
        const app = createCandidatePortalApplications(getTestDb()).detail(user, Number(req.params.id));
        res.json({ ok: true, data: app });
      } catch (e) { next(e); }
    },
  );

  // POST /v1/candidate-portal/applications/:id/respond
  router.post(
    '/v1/candidate-portal/applications/:id/respond',
    authMiddleware(getTestDb()),
    (req, res, next) => {
      try {
        const user = (req as typeof req & { user?: User }).user;
        if (!user) throw Errors.unauthorized();
        const body = req.body as { action?: string };
        if (!body.action) throw Errors.invalidParams('action is required');
        const result = createCandidatePortalApplications(getTestDb()).respond(
          user,
          Number(req.params.id),
          body.action as 'withdraw' | 'consider_offer' | 'accept_offer' | 'decline_offer',
        );
        res.json({ ok: true, data: result });
      } catch (e) { next(e); }
    },
  );

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

/** Seed a complete candidate profile (users + candidates_private + candidates_anonymized). */
function seedCandidateProfile(opts: {
  userId: string;
  anonId?: string;
  privateId?: string;
  skills?: string[];
  industry?: string | null;
  titleLevel?: string | null;
  visibility?: 'public' | 'invitation_only' | 'hidden';
  expectations?: object;
  currentCompany?: string | null;
  educationTier?: string | null;
}): void {
  const db = getTestDb();
  const now = new Date().toISOString();
  const anonId = opts.anonId ?? `anon_${opts.userId.slice(5)}`;
  const privateId = opts.privateId ?? `priv_${opts.userId.slice(5)}`;
  const headhunterId = `h_${anonId}`;
  // Per-test unique hash so resetDb() + new headhunter insert is collision-free
  // even if a previous test in the same run somehow left a row behind.
  const headhunterHash = `h_hash_${anonId}`;

  db.prepare(`
    INSERT OR IGNORE INTO users (id, user_type, name, contact, agent_endpoint,
      api_key_hash, api_key_prefix, api_key_expires_at,
      prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
      quota_per_day, quota_used, quota_reset_at, reputation,
      status, created_at, updated_at)
    VALUES (?, 'hr', 'H', NULL, NULL,
      ?, 'h_prefix', NULL,
      NULL, NULL, NULL,
      200, 0, ?, 50,
      'active', ?, ?)
  `).run(headhunterId, headhunterHash, now, now, now);

  db.prepare(`
    INSERT INTO candidates_private (id, headhunter_id, candidate_user_id, name_enc, phone_enc, email_enc,
      current_company_raw, current_title_raw, expected_salary, years_experience,
      education_school, resume_url, skills_json, raw_payload_json,
      created_at, updated_at)
    VALUES (?, ?, ?, 'n', 'p', 'e', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
  `).run(privateId, headhunterId, opts.userId, opts.currentCompany ?? null, now, now);

  db.prepare(`
    INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id,
      industry, title_level, years_experience, salary_range, education_tier,
      skills_json, is_public_pool, unlock_status, visibility, expectations_json,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 5, '30-50万', ?,
      ?, 1, 'locked', ?, ?,
      ?, ?)
  `).run(
    anonId,
    privateId,
    headhunterId,
    opts.industry ?? '互联网',
    opts.titleLevel ?? 'P6',
    opts.educationTier ?? '985',
    JSON.stringify(opts.skills ?? []),
    opts.visibility ?? 'public',
    opts.expectations ? JSON.stringify(opts.expectations) : null,
    now,
    now,
  );
}

/** Seed an employer user (FK target for jobs.employer_id). */
function seedEmployer(employerId: string, name = 'Test Employer'): void {
  const db = getTestDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, user_type, name, contact, agent_endpoint,
      api_key_hash, api_key_prefix, api_key_expires_at,
      prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
      quota_per_day, quota_used, quota_reset_at, reputation,
      status, created_at, updated_at)
    VALUES (?, 'pm', ?, NULL, NULL,
      ?, 'e_prefix', NULL,
      NULL, NULL, NULL,
      200, 0, ?, 50,
      'active', ?, ?)
  `).run(employerId, name, `e_${employerId}_hash`, now, now, now);
}

/** Seed a headhunter user. */
function seedHeadhunter(id: string, name = 'Test Hunter'): void {
  const db = getTestDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, user_type, name, contact, agent_endpoint,
      api_key_hash, api_key_prefix, api_key_expires_at,
      prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
      quota_per_day, quota_used, quota_reset_at, reputation,
      status, created_at, updated_at)
    VALUES (?, 'hr', ?, NULL, NULL,
      ?, 'h_prefix', NULL,
      NULL, NULL, NULL,
      200, 0, ?, 50,
      'active', ?, ?)
  `).run(id, name, `h_${id}_hash`, now, now, now);
}

/** Seed a job row. */
function seedJob(opts: {
  id: string;
  employerId?: string;
  title: string;
  status?: 'open' | 'paused' | 'closed' | 'filled';
  industry?: string | null;
}): void {
  const db = getTestDb();
  const employerId = opts.employerId ?? `emp_default_${opts.id}`;
  seedEmployer(employerId);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO jobs (id, employer_id, title, description, requirements,
      salary_min, salary_max, status, priority, deadline, industry,
      required_skills_json, created_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL,
      NULL, NULL, ?, 'normal', NULL, ?,
      NULL, ?, ?)
  `).run(
    opts.id,
    employerId,
    opts.title,
    opts.status ?? 'open',
    opts.industry ?? null,
    now,
    now,
  );
}

/** Mount the applications router + auth + error handler on a fresh Express app. */
function buildAppWithApplicationsRouter(): express.Express {
  createTestApp();
  const app = express();
  app.use(
    createUtf8OnlyMiddleware(),
    express.json({ limit: MAX_BODY_SIZE }),
  );
  app.use(buildApplicationsRouter());
  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'No route matched' } });
  });
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
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('candidate-portal: applications (handler integration)', () => {
  beforeEach(() => {
    resetDb();
    __resetRateLimits();
  });
  afterAll(() => closeTestDb());

  // -----------------------------------------------------------------------
  // Auth gating
  // -----------------------------------------------------------------------
  describe('auth gating', () => {
    it('POST /apply returns 401 without bearer token', async () => {
      const app = buildAppWithApplicationsRouter();
      const res = await request(app).post('/v1/candidate-portal/jobs/job1/apply').send({});
      expect(res.status).toBe(401);
    });

    it('GET /applications returns 401 without bearer token', async () => {
      const app = buildAppWithApplicationsRouter();
      const res = await request(app).get('/v1/candidate-portal/applications');
      expect(res.status).toBe(401);
    });

    it('GET /applications/:id returns 401 without bearer token', async () => {
      const app = buildAppWithApplicationsRouter();
      const res = await request(app).get('/v1/candidate-portal/applications/1');
      expect(res.status).toBe(401);
    });

    it('POST /applications/:id/respond returns 401 without bearer token', async () => {
      const app = buildAppWithApplicationsRouter();
      const res = await request(app).post('/v1/candidate-portal/applications/1/respond').send({ action: 'withdraw' });
      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // apply
  // -----------------------------------------------------------------------
  describe('POST /jobs/:jobId/apply', () => {
    it('creates a pending_pickup recommendation + candidate_application + notifies all hunters', async () => {
      const { apiKey, userId } = await makeCandidate(`apply-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({ userId });
      seedJob({ id: 'job_apply_1', title: 'Senior Rust Engineer' });
      seedHeadhunter('h_a');
      seedHeadhunter('h_b');

      const app = buildAppWithApplicationsRouter();
      const res = await request(app)
        .post('/v1/candidate-portal/jobs/job_apply_1/apply')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ note: 'I am interested' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.status).toBe('pending_pickup');
      const applicationId = res.body.data.application_id as number;
      const recommendationId = res.body.data.recommendation_id as string;
      expect(applicationId).toBeGreaterThan(0);
      expect(recommendationId).toMatch(/^rec_/);

      // Verify recommendation row.
      const rec = getTestDb().prepare('SELECT * FROM recommendations WHERE id = ?').get(recommendationId) as any;
      expect(rec.status).toBe('pending_pickup');
      expect(rec.headhunter_id).toBeNull();
      expect(rec.source_type).toBe('candidate_self_apply');
      expect(rec.candidate_note).toBe('I am interested');

      // Verify application row.
      const app1 = getTestDb().prepare('SELECT * FROM candidate_applications WHERE id = ?').get(applicationId) as any;
      expect(app1.candidate_user_id).toBe(userId);
      expect(app1.job_id).toBe('job_apply_1');
      expect(app1.candidate_note).toBe('I am interested');

      // Verify notifications. The seedCandidateProfile function also creates
      // a headhunter user (for the candidate's private record owner), so we
      // expect 3 notifications: the 2 explicit hunters + the auto-created one.
      const notifs = getTestDb().prepare(
        "SELECT user_id, category, dedup_key FROM notifications WHERE category = 'candidate_pending_pickup' ORDER BY user_id",
      ).all() as any[];
      expect(notifs.length).toBe(3);
      const notifiedHunters = notifs.map(n => n.user_id).sort();
      expect(notifiedHunters).toContain('h_a');
      expect(notifiedHunters).toContain('h_b');
      // The auto-created headhunter is `h_anon_<userId-tail>`.
      const autoHunterId = `h_anon_${userId.slice(5)}`;
      expect(notifiedHunters).toContain(autoHunterId);
      // Dedup key shape is `apply:<recId>:<hunterId>`.
      for (const n of notifs) {
        expect(n.dedup_key).toBe(`apply:${recommendationId}:${n.user_id}`);
      }
    });

    it('returns 404 when job does not exist', async () => {
      const { apiKey, userId } = await makeCandidate(`apply404-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({ userId });

      const app = buildAppWithApplicationsRouter();
      const res = await request(app)
        .post('/v1/candidate-portal/jobs/does_not_exist/apply')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({});
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when job is not open', async () => {
      const { apiKey, userId } = await makeCandidate(`applyclosed-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({ userId });
      seedJob({ id: 'job_closed_apply', title: 'Closed Job', status: 'closed' });

      const app = buildAppWithApplicationsRouter();
      const res = await request(app)
        .post('/v1/candidate-portal/jobs/job_closed_apply/apply')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAMS');
      expect(res.body.error.message).toMatch(/JOB_NOT_OPEN/);
    });

    it('returns 404 when candidate has no profile (not onboarded)', async () => {
      const { apiKey } = await makeCandidate(`noprofile-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedJob({ id: 'job_noprofile', title: 'Job' });

      const app = buildAppWithApplicationsRouter();
      const res = await request(app)
        .post('/v1/candidate-portal/jobs/job_noprofile/apply')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({});
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toMatch(/Profile not found/);
    });

    it('returns 409 on duplicate active application (same job)', async () => {
      const { apiKey, userId } = await makeCandidate(`dup-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({ userId });
      seedJob({ id: 'job_dup', title: 'Job' });

      const app = buildAppWithApplicationsRouter();
      const r1 = await request(app)
        .post('/v1/candidate-portal/jobs/job_dup/apply')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({});
      expect(r1.status).toBe(200);

      const r2 = await request(app)
        .post('/v1/candidate-portal/jobs/job_dup/apply')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({});
      expect(r2.status).toBe(409);
      expect(r2.body.error.message).toMatch(/ALREADY_APPLIED/);
    });

    it('re-apply is rejected because UNIQUE(anonymized_candidate_id, job_id) blocks it', async () => {
      // NOTE: The legacy UNIQUE(anonymized_candidate_id, job_id) constraint on
      // the recommendations table (v002) prevents re-applying to the same job
      // even after the prior rec was withdrawn. The active-rec guard in
      // findActiveByCandidateAndJob would let re-application through, but the
      // DB-level UNIQUE blocks the INSERT. This test documents that contract
      // so a future migration can lift the constraint to allow re-apply.
      const { apiKey, userId } = await makeCandidate(`reapply-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({ userId });
      seedJob({ id: 'job_reapply', title: 'Job' });

      const app = buildAppWithApplicationsRouter();
      const r1 = await request(app)
        .post('/v1/candidate-portal/jobs/job_reapply/apply')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({});
      expect(r1.status).toBe(200);
      const appId = r1.body.data.application_id as number;

      // Withdraw the first application.
      const w = await request(app)
        .post(`/v1/candidate-portal/applications/${appId}/respond`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ action: 'withdraw' });
      expect(w.status).toBe(200);

      // Re-apply is blocked by the UNIQUE constraint.
      const r2 = await request(app)
        .post('/v1/candidate-portal/jobs/job_reapply/apply')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({});
      expect(r2.status).toBe(500);
    });

    it('forbids non-candidate user types from applying (handler-level)', () => {
      const headhunter: User = {
        id: 'h_x',
        user_type: 'hr',
        name: 'H',
        contact: null,
        agent_endpoint: null,
        api_key_hash: '',
        api_key_prefix: '',
        api_key_expires_at: null,
        prev_api_key_hash: null,
        prev_api_key_prefix: null,
        prev_api_key_expires_at: null,
        quota_per_day: 200,
        quota_used: 0,
        quota_reset_at: '',
        reputation: 50,
        status: 'active',
        created_at: '',
        updated_at: '',
      };
      const apps = createCandidatePortalApplications(getTestDb());
      expect(() => apps.apply(headhunter, 'job1', { note: 'no' })).toThrow(/Only candidates/);
    });
  });

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------
  describe('GET /applications', () => {
    it('returns the candidate own applications, newest first', async () => {
      const { apiKey, userId } = await makeCandidate(`list-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({ userId });
      seedJob({ id: 'job_l_1', title: 'Job 1' });
      seedJob({ id: 'job_l_2', title: 'Job 2' });

      const app = buildAppWithApplicationsRouter();
      const r1 = await request(app).post('/v1/candidate-portal/jobs/job_l_1/apply')
        .set('Authorization', `Bearer ${apiKey}`).send({});
      expect(r1.status).toBe(200);
      // Backdate the first application's created_at by 1 second so the
      // ordering is deterministic regardless of millisecond clock resolution
      // on the test host. The real production ordering relies on user-side
      // delay between applies, which we cannot assume in tests.
      getTestDb().prepare(
        'UPDATE candidate_applications SET created_at = ? WHERE id = ?',
      ).run(Date.now() - 1000, r1.body.data.application_id);
      const r2 = await request(app).post('/v1/candidate-portal/jobs/job_l_2/apply')
        .set('Authorization', `Bearer ${apiKey}`).send({});
      expect(r2.status).toBe(200);

      const res = await request(app)
        .get('/v1/candidate-portal/applications')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      const items = res.body.data.items as any[];
      expect(items.length).toBe(2);
      // Newest first by created_at DESC
      expect(items[0].job_id).toBe('job_l_2');
      expect(items[1].job_id).toBe('job_l_1');
      // Joined fields present
      expect(items[0].job_title).toBe('Job 2');
      expect(items[0].recommendation_status).toBe('pending_pickup');
    });

    it('returns empty list for a candidate with no applications', async () => {
      const { apiKey } = await makeCandidate(`empty-${Math.random().toString(36).slice(2, 8)}@example.com`);

      const app = buildAppWithApplicationsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/applications')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // detail
  // -----------------------------------------------------------------------
  describe('GET /applications/:id', () => {
    it('returns the application for the owner', async () => {
      const { apiKey, userId } = await makeCandidate(`detail-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({ userId });
      seedJob({ id: 'job_d_1', title: 'Job' });

      const app = buildAppWithApplicationsRouter();
      const r = await request(app).post('/v1/candidate-portal/jobs/job_d_1/apply')
        .set('Authorization', `Bearer ${apiKey}`).send({ note: 'hi' });
      const appId = r.body.data.application_id as number;

      const res = await request(app)
        .get(`/v1/candidate-portal/applications/${appId}`)
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(appId);
      expect(res.body.data.candidate_user_id).toBe(userId);
      expect(res.body.data.candidate_note).toBe('hi');
    });

    it('returns 403 when the application belongs to a different candidate', async () => {
      const owner = await makeCandidate(`owner-${Math.random().toString(36).slice(2, 8)}@example.com`);
      const other = await makeCandidate(`other-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({ userId: owner.userId });
      seedJob({ id: 'job_priv', title: 'Job' });

      const app = buildAppWithApplicationsRouter();
      const r = await request(app).post('/v1/candidate-portal/jobs/job_priv/apply')
        .set('Authorization', `Bearer ${owner.apiKey}`).send({});
      const appId = r.body.data.application_id as number;

      const res = await request(app)
        .get(`/v1/candidate-portal/applications/${appId}`)
        .set('Authorization', `Bearer ${other.apiKey}`);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/APPLICATION_NOT_OWNED/);
    });

    it('returns 404 for non-existent application', async () => {
      const { apiKey } = await makeCandidate(`nf-${Math.random().toString(36).slice(2, 8)}@example.com`);

      const app = buildAppWithApplicationsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/applications/99999')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // respond (withdraw / consider / accept / decline)
  // -----------------------------------------------------------------------
  describe('POST /applications/:id/respond', () => {
    it('withdraw transitions pending_pickup → withdrawn', async () => {
      const { apiKey, userId } = await makeCandidate(`wd-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({ userId });
      seedJob({ id: 'job_w', title: 'Job' });

      const app = buildAppWithApplicationsRouter();
      const r = await request(app).post('/v1/candidate-portal/jobs/job_w/apply')
        .set('Authorization', `Bearer ${apiKey}`).send({});
      const appId = r.body.data.application_id as number;

      const res = await request(app)
        .post(`/v1/candidate-portal/applications/${appId}/respond`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ action: 'withdraw' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('withdrawn');

      // Verify the application row got withdrawn_at set
      const row = getTestDb().prepare('SELECT withdrawn_at FROM candidate_applications WHERE id = ?').get(appId) as any;
      expect(row.withdrawn_at).toBeGreaterThan(0);
    });

    it('REJECTS consider_offer from pending_pickup (must go via employer_interested first)', async () => {
      const { apiKey, userId } = await makeCandidate(`reject-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({ userId });
      seedJob({ id: 'job_rej', title: 'Job' });

      const app = buildAppWithApplicationsRouter();
      const r = await request(app).post('/v1/candidate-portal/jobs/job_rej/apply')
        .set('Authorization', `Bearer ${apiKey}`).send({});
      const appId = r.body.data.application_id as number;

      const res = await request(app)
        .post(`/v1/candidate-portal/applications/${appId}/respond`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ action: 'consider_offer' });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/APPLICATION_INVALID_STATE/);
    });

    it('full consider/accept/decline flow', async () => {
      const { apiKey, userId } = await makeCandidate(`full-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({ userId });
      seedJob({ id: 'job_full', title: 'Job' });
      // Need a real headhunter user for the FK when we set headhunter_id below.
      const hunterId = `h_full_${Math.random().toString(36).slice(2, 8)}`;
      seedHeadhunter(hunterId);

      const app = buildAppWithApplicationsRouter();
      const r = await request(app).post('/v1/candidate-portal/jobs/job_full/apply')
        .set('Authorization', `Bearer ${apiKey}`).send({});
      const appId = r.body.data.application_id as number;

      // Move the rec into employer_interested directly via raw SQL (simulating
      // the hunter pickup + employer interest path). This is how the test
      // simulates the upstream flow without exercising the headhunter
      // pickup endpoint (which is in Task 9).
      const recommendationId = r.body.data.recommendation_id as string;
      getTestDb().prepare(
        "UPDATE recommendations SET status = 'employer_interested', headhunter_id = ? WHERE id = ?",
      ).run(hunterId, recommendationId);

      // 1. consider_offer: employer_interested → considering_offer
      const c = await request(app)
        .post(`/v1/candidate-portal/applications/${appId}/respond`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ action: 'consider_offer' });
      expect(c.status).toBe(200);
      expect(c.body.data.status).toBe('considering_offer');

      // 2. accept_offer: considering_offer → candidate_approved
      const a = await request(app)
        .post(`/v1/candidate-portal/applications/${appId}/respond`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ action: 'accept_offer' });
      expect(a.status).toBe(200);
      expect(a.body.data.status).toBe('candidate_approved');
    });

    it('decline_offer from considering_offer transitions to rejected_candidate', async () => {
      const { apiKey, userId } = await makeCandidate(`dec-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({ userId });
      seedJob({ id: 'job_dec', title: 'Job' });

      const app = buildAppWithApplicationsRouter();
      const r = await request(app).post('/v1/candidate-portal/jobs/job_dec/apply')
        .set('Authorization', `Bearer ${apiKey}`).send({});
      const appId = r.body.data.application_id as number;
      const recommendationId = r.body.data.recommendation_id as string;
      getTestDb().prepare(
        "UPDATE recommendations SET status = 'considering_offer' WHERE id = ?",
      ).run(recommendationId);

      const d = await request(app)
        .post(`/v1/candidate-portal/applications/${appId}/respond`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ action: 'decline_offer' });
      expect(d.status).toBe(200);
      expect(d.body.data.status).toBe('rejected_candidate');
    });
  });
});
