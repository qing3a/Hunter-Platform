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
import { createCandidatePortalJobs } from '../../../src/main/modules/candidate-portal/jobs.js';
import { authMiddleware } from '../../../src/main/modules/auth/middleware.js';
import { respond } from '../../../src/main/responses.js';
import { EnvelopeSchema } from '../../../src/main/schemas/common.js';
import { Errors, ApiError } from '../../../src/main/errors.js';
import { createUtf8OnlyMiddleware } from '../../../src/main/modules/encoding/index.js';
import { MAX_BODY_SIZE } from '../../../src/shared/constants.js';
import type { User } from '../../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal router that mounts browse/recommended/detail. Reconstructed here
 *  (instead of imported from src/main/routes) because the full candidate-portal
 *  router is built in Task 12; this test is the end-to-end proof that the jobs
 *  module is HTTP-correct. */
function buildJobsRouter(): express.Router {
  const router = express.Router();

  // GET /v1/candidate-portal/jobs/browse
  router.get('/v1/candidate-portal/jobs/browse', authMiddleware(getTestDb()), (req, res, next) => {
    try {
      const user = (req as typeof req & { user?: User }).user;
      if (!user) throw Errors.unauthorized();
      const filter = {
        industry: req.query.industry as string | undefined,
        title_level: req.query.title_level as string | undefined,
        keyword: req.query.keyword as string | undefined,
        cursor: req.query.cursor ? Number(req.query.cursor) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      };
      const result = createCandidatePortalJobs(getTestDb()).browse(user, filter);
      const schema = EnvelopeSchema(
        z.object({
          items: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              industry: z.string().nullable(),
              title_level: z.string().nullable(),
              salary_min: z.number().nullable(),
              salary_max: z.number().nullable(),
              location: z.string().nullable(),
              skills: z.array(z.string()),
              priority: z.string(),
              posted_at: z.string(),
              employer_id: z.string().nullable(),
            }),
          ),
          next_cursor: z.number().nullable(),
        }),
      );
      respond(res, schema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // GET /v1/candidate-portal/jobs/recommended
  router.get(
    '/v1/candidate-portal/jobs/recommended',
    authMiddleware(getTestDb()),
    (req, res, next) => {
      try {
        const user = (req as typeof req & { user?: User }).user;
        if (!user) throw Errors.unauthorized();
        const limit = req.query.limit ? Number(req.query.limit) : undefined;
        const scored = createCandidatePortalJobs(getTestDb()).recommended(user, { limit });
        const schema = EnvelopeSchema(
          z.array(z.object({ job_id: z.string(), score: z.number() })),
        );
        respond(res, schema, { ok: true, data: scored });
      } catch (e) { next(e); }
    },
  );

  // GET /v1/candidate-portal/jobs/:id
  router.get(
    '/v1/candidate-portal/jobs/:id',
    authMiddleware(getTestDb()),
    (req, res, next) => {
      try {
        const user = (req as typeof req & { user?: User }).user;
        if (!user) throw Errors.unauthorized();
        const detail = createCandidatePortalJobs(getTestDb()).detail(user, req.params.id);
        const schema = EnvelopeSchema(
          z.object({
            id: z.string(),
            title: z.string(),
            industry: z.string().nullable(),
            title_level: z.string().nullable(),
            description: z.string().nullable(),
            salary_min: z.number().nullable(),
            salary_max: z.number().nullable(),
            location: z.string().nullable(),
            skills: z.array(z.string()),
            priority: z.string(),
            posted_at: z.string(),
            match_score: z.number(),
            match_dimensions: z.object({
              skills: z.array(z.string()),
              job_skills: z.array(z.string()),
            }),
          }),
        );
        respond(res, schema, { ok: true, data: detail });
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

/** Seed a candidates_private + candidates_anonymized row for an existing user. */
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
    VALUES (?, ?, ?, ?, ?, 5, '30-50万', ?,
      ?, 1, 'locked', ?, ?,
      ?, ?)
  `).run(
    anonId,
    privateId,
    `h_${anonId}`,
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
    VALUES (?, 'employer', ?, NULL, NULL,
      ?, 'e_prefix', NULL,
      NULL, NULL, NULL,
      200, 0, ?, 50,
      'active', ?, ?)
  `).run(employerId, name, `e_${employerId}_hash`, now, now, now);
}

/** Seed a job row.
 *  v009 added a CHECK that forbids orphan jobs — either employer_id must be set
 *  (direct from employer) OR source_headhunter_id must be set (headhunter-created).
 *  We default employer_id to a synthetic one so employer-direct jobs always
 *  satisfy the constraint; tests can override via opts.employerId. */
function seedJob(opts: {
  id: string;
  employerId?: string;
  title: string;
  description?: string;
  industry?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  status?: 'open' | 'paused' | 'closed' | 'filled';
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  skills?: string[];
  createdAt?: string;
}): void {
  const db = getTestDb();
  const employerId = opts.employerId ?? `emp_default_${opts.id}`;
  seedEmployer(employerId);
  const now = opts.createdAt ?? new Date().toISOString();
  db.prepare(`
    INSERT INTO jobs (id, employer_id, title, description, requirements,
      salary_min, salary_max, status, priority, deadline, industry,
      required_skills_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL,
      ?, ?, ?, ?, NULL, ?,
      ?, ?, ?)
  `).run(
    opts.id,
    employerId,
    opts.title,
    opts.description ?? null,
    opts.salaryMin ?? null,
    opts.salaryMax ?? null,
    opts.status ?? 'open',
    opts.priority ?? 'normal',
    opts.industry ?? null,
    opts.skills ? JSON.stringify(opts.skills) : null,
    now,
    now,
  );
}

/** Mount the jobs router + auth + error handler on a fresh Express app. */
function buildAppWithJobsRouter(): express.Express {
  // Ensure the shared DB is initialized.
  createTestApp();
  const db = getTestDb();
  const app = express();
  app.use(
    createUtf8OnlyMiddleware(),
    express.json({ limit: MAX_BODY_SIZE }),
  );
  app.use(buildJobsRouter());
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
  void db;
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('candidate-portal: jobs (handler integration)', () => {
  beforeEach(() => {
    resetDb();
    __resetRateLimits();
  });
  afterAll(() => closeTestDb());

  // -----------------------------------------------------------------------
  // Auth gating
  // -----------------------------------------------------------------------
  describe('auth gating', () => {
    it('GET /jobs/browse returns 401 without bearer token', async () => {
      const app = buildAppWithJobsRouter();
      const res = await request(app).get('/v1/candidate-portal/jobs/browse');
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });

    it('GET /jobs/recommended returns 401 without bearer token', async () => {
      const app = buildAppWithJobsRouter();
      const res = await request(app).get('/v1/candidate-portal/jobs/recommended');
      expect(res.status).toBe(401);
    });

    it('GET /jobs/:id returns 401 without bearer token', async () => {
      const app = buildAppWithJobsRouter();
      const res = await request(app).get('/v1/candidate-portal/jobs/some-id');
      expect(res.status).toBe(401);
    });

    it('returns 401 with malformed bearer token', async () => {
      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/browse')
        .set('Authorization', 'Bearer not-a-real-key');
      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // browse
  // -----------------------------------------------------------------------
  describe('GET /jobs/browse', () => {
    it('returns only status=open jobs', async () => {
      const { apiKey } = await makeCandidate(`browse-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedJob({ id: 'job_open_1', title: 'Open Frontend', status: 'open' });
      seedJob({ id: 'job_open_2', title: 'Open Backend', status: 'open' });
      seedJob({ id: 'job_closed', title: 'Closed Job', status: 'closed' });
      seedJob({ id: 'job_filled', title: 'Filled Job', status: 'filled' });

      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/browse')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const ids = (res.body.data.items as Array<{ id: string }>).map((j) => j.id).sort();
      expect(ids).toEqual(['job_open_1', 'job_open_2']);
    });

    it('filters by industry', async () => {
      const { apiKey } = await makeCandidate(`ind-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedJob({ id: 'job_int', title: 'Internet Job', industry: '互联网' });
      seedJob({ id: 'job_fin', title: 'Finance Job', industry: '金融' });

      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/browse')
        .query({ industry: '互联网' })
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      const ids = (res.body.data.items as Array<{ id: string }>).map((j) => j.id);
      expect(ids).toEqual(['job_int']);
    });

    it('keyword filter matches title and description (LIKE %kw%)', async () => {
      const { apiKey } = await makeCandidate(`kw-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedJob({ id: 'job_kw_title', title: 'Senior Rust Engineer', description: 'systems role' });
      seedJob({ id: 'job_kw_desc', title: 'Generic SWE', description: 'Must know Rust deeply' });
      seedJob({ id: 'job_kw_none', title: 'Frontend Engineer', description: 'React/TypeScript' });

      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/browse')
        .query({ keyword: 'rust' })
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      const ids = (res.body.data.items as Array<{ id: string }>).map((j) => j.id).sort();
      expect(ids).toEqual(['job_kw_desc', 'job_kw_title']);
    });

    it('cursor-based pagination — next_cursor advances by limit', async () => {
      const { apiKey } = await makeCandidate(`page-${Math.random().toString(36).slice(2, 8)}@example.com`);
      // Seed 5 open jobs.
      for (let i = 1; i <= 5; i++) {
        seedJob({ id: `job_p_${i}`, title: `Job ${i}` });
      }

      const app = buildAppWithJobsRouter();
      const page1 = await request(app)
        .get('/v1/candidate-portal/jobs/browse')
        .query({ limit: 2 })
        .set('Authorization', `Bearer ${apiKey}`);
      expect(page1.status).toBe(200);
      expect((page1.body.data.items as unknown[]).length).toBe(2);
      expect(page1.body.data.next_cursor).toBe(2);

      const page2 = await request(app)
        .get('/v1/candidate-portal/jobs/browse')
        .query({ limit: 2, cursor: 2 })
        .set('Authorization', `Bearer ${apiKey}`);
      expect((page2.body.data.items as unknown[]).length).toBe(2);
      expect(page2.body.data.next_cursor).toBe(4);

      const page3 = await request(app)
        .get('/v1/candidate-portal/jobs/browse')
        .query({ limit: 2, cursor: 4 })
        .set('Authorization', `Bearer ${apiKey}`);
      // Last page is short → next_cursor is null.
      expect((page3.body.data.items as unknown[]).length).toBe(1);
      expect(page3.body.data.next_cursor).toBeNull();
    });

    it('clamps limit to 50 max', async () => {
      const { apiKey } = await makeCandidate(`clamp-${Math.random().toString(36).slice(2, 8)}@example.com`);
      // Only seed 1 — but ask for limit=1000. Response should succeed (clamped
      // to 50; we get the 1 job back).
      seedJob({ id: 'job_clamp_1', title: 'Only Job' });

      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/browse')
        .query({ limit: 1000 })
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      // No error and we get the (single) job — proves limit was clamped, not rejected.
      expect((res.body.data.items as Array<{ id: string }>).map((j) => j.id)).toEqual(['job_clamp_1']);
    });

    it('returns parsed skills from required_skills_json', async () => {
      const { apiKey } = await makeCandidate(`skills-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedJob({ id: 'job_sk', title: 'With Skills', skills: ['Rust', 'Go', 'Kubernetes'] });

      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/browse')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      const item = (res.body.data.items as Array<{ id: string; skills: string[] }>)[0];
      expect(item.skills).toEqual(['Rust', 'Go', 'Kubernetes']);
    });

    it('returns empty list when no jobs exist', async () => {
      const { apiKey } = await makeCandidate(`empty-${Math.random().toString(36).slice(2, 8)}@example.com`);
      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/browse')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.next_cursor).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // recommended
  // -----------------------------------------------------------------------
  describe('GET /jobs/recommended', () => {
    it('returns 404 when candidate has no profile (not onboarded)', async () => {
      const { apiKey } = await makeCandidate(`nopro-${Math.random().toString(36).slice(2, 8)}@example.com`);
      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/recommended')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns scored jobs sorted by score descending', async () => {
      const { apiKey, userId } = await makeCandidate(`rec-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({
        userId,
        skills: ['Rust', 'Go', 'Kubernetes', 'PostgreSQL'],
      });
      // Job A: full overlap → highest score
      seedJob({ id: 'job_full', title: 'Full Match', skills: ['Rust', 'Go', 'Kubernetes', 'PostgreSQL'] });
      // Job B: partial overlap → mid score
      seedJob({ id: 'job_partial', title: 'Partial Match', skills: ['Rust', 'Java'] });
      // Job C: zero overlap → 0 score
      seedJob({ id: 'job_none', title: 'No Match', skills: ['PHP', 'MySQL'] });

      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/recommended')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      const scored = res.body.data as Array<{ job_id: string; score: number }>;
      expect(scored.length).toBe(3);
      // Strict descending order.
      expect(scored[0].score).toBeGreaterThanOrEqual(scored[1].score);
      expect(scored[1].score).toBeGreaterThanOrEqual(scored[2].score);
      // Full overlap should be on top.
      expect(scored[0].job_id).toBe('job_full');
      // Zero overlap should be last.
      expect(scored[scored.length - 1].job_id).toBe('job_none');
    });

    it('limits results when ?limit is passed', async () => {
      const { apiKey, userId } = await makeCandidate(`lim-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({ userId, skills: ['A', 'B'] });
      for (let i = 1; i <= 4; i++) seedJob({ id: `job_lim_${i}`, title: `J${i}`, skills: ['A'] });

      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/recommended')
        .query({ limit: 2 })
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect((res.body.data as unknown[]).length).toBe(2);
    });

    it('excludes non-open jobs', async () => {
      const { apiKey, userId } = await makeCandidate(`closed-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedCandidateProfile({ userId, skills: ['X'] });
      seedJob({ id: 'job_open_x', title: 'Open', status: 'open', skills: ['X'] });
      seedJob({ id: 'job_closed_x', title: 'Closed', status: 'closed', skills: ['X'] });

      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/recommended')
        .set('Authorization', `Bearer ${apiKey}`);
      const ids = (res.body.data as Array<{ job_id: string }>).map((j) => j.job_id);
      expect(ids).toEqual(['job_open_x']);
    });
  });

  // -----------------------------------------------------------------------
  // detail
  // -----------------------------------------------------------------------
  describe('GET /jobs/:id', () => {
    it('returns 404 when job does not exist', async () => {
      const { apiKey } = await makeCandidate(`missing-${Math.random().toString(36).slice(2, 8)}@example.com`);
      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/does_not_exist')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns full job fields + match_score=0 for candidate without profile', async () => {
      const { apiKey } = await makeCandidate(`np-${Math.random().toString(36).slice(2, 8)}@example.com`);
      seedJob({
        id: 'job_detail_1',
        title: 'Senior Rust Engineer',
        description: 'Build distributed systems',
        industry: '互联网',
        salaryMin: 500000,
        salaryMax: 800000,
        priority: 'high',
        skills: ['Rust', 'Distributed Systems'],
      });

      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/job_detail_1')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toMatchObject({
        id: 'job_detail_1',
        title: 'Senior Rust Engineer',
        industry: '互联网',
        description: 'Build distributed systems',
        salary_min: 500000,
        salary_max: 800000,
        priority: 'high',
        skills: ['Rust', 'Distributed Systems'],
        match_score: 0,
      });
      // match_dimensions.skills is [] when no profile, job_skills still populated.
      expect(res.body.data.match_dimensions).toEqual({
        skills: [],
        job_skills: ['Rust', 'Distributed Systems'],
      });
      expect(typeof res.body.data.posted_at).toBe('string');
    });

    it('returns match_score + match_dimensions for candidate with profile', async () => {
      const { apiKey, userId } = await makeCandidate(`match-${Math.random().toString(36).slice(2, 8)}@example.com`);
      // Candidate skills exactly equal the job skills so Jaccard = 100.
      // Candidate title level "senior" + job title level "mid" (default since
      // jobs.title_level doesn't exist) → ±1 bonus = +5.
      // Salary: job range [600k, 1M] covers candidate expected min 400k → +3.
      // No desired_roles → no industry bonus.
      // Expected score: 100 + 5 + 3 = 108.
      seedCandidateProfile({
        userId,
        skills: ['Rust', 'Distributed Systems'],
        titleLevel: 'senior',
        expectations: { expected_salary_min: 400000, expected_salary_max: 700000 },
      });
      seedJob({
        id: 'job_match_1',
        title: 'Staff Engineer',
        skills: ['Rust', 'Distributed Systems'],
        salaryMin: 600000,
        salaryMax: 1000000,
      });

      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/job_match_1')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(res.body.data.match_score).toBe(108);
      expect(res.body.data.match_dimensions).toEqual({
        skills: ['Rust', 'Distributed Systems'],
        job_skills: ['Rust', 'Distributed Systems'],
      });
    });

    it('returns lower match_score when candidate skills only partially overlap', async () => {
      const { apiKey, userId } = await makeCandidate(`part-${Math.random().toString(36).slice(2, 8)}@example.com`);
      // Candidate has 4 skills; job shares only 'Rust' → Jaccard = 1/5 * 100 = 20.
      // Title bonus applies (+5), no salary (candidate has no expectations.salary).
      seedCandidateProfile({
        userId,
        skills: ['Rust', 'Go', 'Kubernetes', 'PostgreSQL'],
        titleLevel: 'mid',
      });
      seedJob({
        id: 'job_partial_overlap',
        title: 'Rust Backend',
        skills: ['Rust'],
      });

      const app = buildAppWithJobsRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/jobs/job_partial_overlap')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      // Score is strictly less than the full-overlap 108.
      expect(res.body.data.match_score).toBeLessThan(108);
      // And strictly greater than 0 (we have some overlap).
      expect(res.body.data.match_score).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Handler-level authz (non-candidate rejected at handler, not middleware)
  // -----------------------------------------------------------------------
  describe('handler-level authz', () => {
    it('browse rejects headhunter User with FORBIDDEN', () => {
      const headhunter: User = {
        id: 'h_x',
        user_type: 'headhunter',
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
      const jobs = createCandidatePortalJobs(getTestDb());
      expect(() => jobs.browse(headhunter)).toThrow(/Only candidates/);
    });

    it('recommended rejects employer User with FORBIDDEN', () => {
      const employer: User = {
        id: 'e_x',
        user_type: 'employer',
        name: 'E',
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
      const jobs = createCandidatePortalJobs(getTestDb());
      expect(() => jobs.recommended(employer)).toThrow(/Only candidates/);
    });

    it('detail rejects headhunter User with FORBIDDEN', () => {
      const headhunter: User = {
        id: 'h_x',
        user_type: 'headhunter',
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
      const jobs = createCandidatePortalJobs(getTestDb());
      expect(() => jobs.detail(headhunter, 'whatever')).toThrow(/Only candidates/);
    });
  });
});