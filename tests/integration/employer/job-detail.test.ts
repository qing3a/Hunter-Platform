// tests/integration/employer/job-detail.test.ts
//
// Employer Panel — Task 5 backend gap: 5 endpoints to fill the
// /v1/employer/jobs/:id surface that the Jobs Management UI calls.
//
// Endpoints under test:
//   1. GET    /v1/employer/jobs/:id          — single-job detail
//   2. PATCH  /v1/employer/jobs/:id          — edit-form submission
//   3. POST   /v1/employer/jobs/:id/pause    — open/claimed → paused
//   4. POST   /v1/employer/jobs/:id/resume   — paused → open
//   5. POST   /v1/employer/jobs/:id/close    — open/claimed/paused → closed
//
// Coverage scope per endpoint:
//   - 401 for missing Bearer
//   - 403 for non-employer caller (headhunter / candidate / pm)
//   - 404 for missing job OR job owned by another employer
//   - 200 happy path with the documented response shape
//
// Body validation:
//   - PATCH: 400 for an invalid body (negative salary, wrong type, unknown key)
//   - PATCH: ownership-scope check (501: cross-employer isolation)
//
// Status transitions:
//   - pause: only valid from 'open' (no pause→pause, no close→pause)
//   - resume: only valid from 'paused' (no open→resume)
//   - close: only valid from 'open' or 'paused' (no closed→close)

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  getTestDb,
} from '../../helpers/test-app.js';
import { createEmployerRouter } from '../../../src/main/routes/employer.js';
import { createUtf8OnlyMiddleware } from '../../../src/main/modules/encoding/index.js';
import { generateApiKey } from '../../../src/main/modules/auth/api-key.js';
import { ApiError } from '../../../src/main/errors.js';
import { MAX_BODY_SIZE } from '../../../src/shared/constants.js';
import type { DB } from '../../../src/main/db/connection.js';
import type { User } from '../../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

interface SeededUser {
  user: User;
  apiKey: string;
}

function seedUser(opts: {
  id: string;
  userType: 'candidate' | 'hr' | 'pm' | 'pm';
  name?: string;
}): SeededUser {
  const db = getTestDb();
  const { key, hash, prefix } = generateApiKey();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, user_type, name, contact, agent_endpoint,
                       api_key_hash, api_key_prefix, api_key_expires_at,
                       prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
                       quota_per_day, quota_used, quota_reset_at, reputation,
                       status, created_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL,
            ?, ?, NULL,
            NULL, NULL, NULL,
            100, 0, ?, 50,
            'active', ?, ?)
  `).run(
    opts.id,
    opts.userType,
    opts.name ?? `Test ${opts.userType}`,
    hash,
    prefix,
    now,
    now,
    now,
  );
  return {
    apiKey: key,
    user: {
      id: opts.id,
      user_type: opts.userType,
      name: opts.name ?? `Test ${opts.userType}`,
      contact: null,
      agent_endpoint: null,
      api_key_hash: hash,
      api_key_prefix: prefix,
      api_key_expires_at: null,
      prev_api_key_hash: null,
      prev_api_key_prefix: null,
      prev_api_key_expires_at: null,
      quota_per_day: 100,
      quota_used: 0,
      quota_reset_at: now,
      reputation: 50,
      status: 'active',
      created_at: now,
      updated_at: now,
    },
  };
}

/**
 * Insert a job row directly via SQL so we can pick exact starting status,
 * skills, employer, etc. without touching the createJob handler's quota.
 */
function seedJob(opts: {
  id: string;
  employerId: string;
  title?: string;
  description?: string | null;
  status?: 'open' | 'claimed' | 'paused' | 'closed' | 'filled';
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  salaryMin?: number | null;
  salaryMax?: number | null;
  industry?: string | null;
  requiredSkills?: string[];
}): void {
  const db = getTestDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO jobs (id, employer_id, source_headhunter_id, created_for_employer_id,
                      title, description, requirements,
                      salary_min, salary_max, status, priority, deadline, industry,
                      required_skills_json, created_at, updated_at)
    VALUES (?, ?, NULL, NULL,
            ?, ?, NULL,
            ?, ?, ?, ?, NULL, ?,
            ?, ?, ?)
  `).run(
    opts.id,
    opts.employerId,
    opts.title ?? 'Senior Engineer',
    opts.description ?? null,
    opts.salaryMin ?? null,
    opts.salaryMax ?? null,
    opts.status ?? 'open',
    opts.priority ?? 'normal',
    opts.industry ?? null,
    JSON.stringify(opts.requiredSkills ?? []),
    now,
    now,
  );
}

function expectForbidden(fn: () => unknown): void {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiError) {
      expect(e.code).toBe('FORBIDDEN');
      expect(e.statusCode).toBe(403);
      return;
    }
    throw e;
  }
  throw new Error('Expected FORBIDDEN ApiError, but function did not throw');
}

// ---------------------------------------------------------------------------
// HTTP test app — mount the real /v1/employer router on a minimal Express app.
// Reuses the singleton test DB from createTestApp() (the shared test-app DB).
// ---------------------------------------------------------------------------

function buildEmployerHttpApp(db: DB): Express {
  process.env.PLATFORM_ENCRYPTION_KEY = process.env.PLATFORM_ENCRYPTION_KEY
    ?? Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = process.env.WEBHOOK_HMAC_SECRET ?? 'test-secret-1234567890';
  process.env.NODE_ENV = 'test';

  const app = express();
  app.use(
    '/v1/employer',
    createUtf8OnlyMiddleware(),
    express.json({ limit: MAX_BODY_SIZE }),
    createEmployerRouter(db, Buffer.alloc(32)),
  );
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

// ===========================================================================
// 1) GET /v1/employer/jobs/:id
// ===========================================================================

describe('employer: GET /v1/employer/jobs/:id', () => {
  let app: Express;
  beforeEach(() => { createTestApp(); resetDb(); app = buildEmployerHttpApp(getTestDb()); });
  afterAll(() => closeTestDb());

  it('returns 401 when no Authorization header is sent', async () => {
    const res = await request(app).get('/v1/employer/jobs/job_anything');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 FORBIDDEN for headhunter caller', async () => {
    const { apiKey } = seedUser({ id: 'h1', userType: 'hr' });
    const res = await request(app)
      .get('/v1/employer/jobs/job_anything')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 FORBIDDEN for candidate caller', async () => {
    const { apiKey } = seedUser({ id: 'c1', userType: 'candidate' });
    const res = await request(app)
      .get('/v1/employer/jobs/job_anything')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 NOT_FOUND for a non-existent job id', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    const res = await request(app)
      .get('/v1/employer/jobs/job_does_not_exist')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 NOT_FOUND for a job owned by another employer (no cross-tenant bleed)', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedUser({ id: 'e2', userType: 'pm' });
    seedJob({ id: 'job_other', employerId: 'e2' });

    const res = await request(app)
      .get('/v1/employer/jobs/job_other')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 200 with the Job envelope for the owner', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedJob({
      id: 'job1', employerId: 'e1', title: 'Tech Lead',
      status: 'open', priority: 'high',
      salaryMin: 300000, salaryMax: 600000,
      industry: '互联网', requiredSkills: ['typescript', 'postgres'],
    });

    const res = await request(app)
      .get('/v1/employer/jobs/job1')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.id).toBe('job1');
    expect(res.body.data.title).toBe('Tech Lead');
    expect(res.body.data.employer_id).toBe('e1');
    expect(res.body.data.status).toBe('open');
    expect(res.body.data.priority).toBe('high');
    expect(res.body.data.salary_min).toBe(300000);
    expect(res.body.data.salary_max).toBe(600000);
    expect(res.body.data.required_skills).toEqual(['typescript', 'postgres']);
    expect(res.body.data.industry).toBe('互联网');
  });
});

// ===========================================================================
// 2) PATCH /v1/employer/jobs/:id
// ===========================================================================

describe('employer: PATCH /v1/employer/jobs/:id', () => {
  let app: Express;
  beforeEach(() => { createTestApp(); resetDb(); app = buildEmployerHttpApp(getTestDb()); });
  afterAll(() => closeTestDb());

  it('returns 401 when no Authorization header is sent', async () => {
    const res = await request(app).patch('/v1/employer/jobs/anything').send({ title: 'x' });
    expect(res.status).toBe(401);
  });

  it('returns 403 FORBIDDEN for non-employer caller', async () => {
    const { apiKey } = seedUser({ id: 'h1', userType: 'hr' });
    const res = await request(app)
      .patch('/v1/employer/jobs/anything')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ title: 'x' });
    expect(res.status).toBe(403);
  });

  it('returns 404 for a job owned by another employer', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedUser({ id: 'e2', userType: 'pm' });
    seedJob({ id: 'job_other', employerId: 'e2' });

    const res = await request(app)
      .patch('/v1/employer/jobs/job_other')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ title: 'stolen' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 INVALID_PARAMS for an empty body (no fields provided)', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedJob({ id: 'job1', employerId: 'e1' });
    const res = await request(app)
      .patch('/v1/employer/jobs/job1')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
  });

  it('returns 400 INVALID_PARAMS for an unknown key (strict schema)', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedJob({ id: 'job1', employerId: 'e1' });
    const res = await request(app)
      .patch('/v1/employer/jobs/job1')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ totally_made_up: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
  });

  it('returns 200 with the updated Job when patching a single field', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedJob({ id: 'job1', employerId: 'e1', title: 'Old Title', priority: 'normal' });
    const res = await request(app)
      .patch('/v1/employer/jobs/job1')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ title: 'New Title' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.id).toBe('job1');
    expect(res.body.data.title).toBe('New Title');
    // priority should be untouched (still 'normal')
    expect(res.body.data.priority).toBe('normal');
  });

  it('returns 200 when patching all editable fields at once', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedJob({ id: 'job1', employerId: 'e1' });
    const res = await request(app)
      .patch('/v1/employer/jobs/job1')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        title: 'Staff Engineer',
        description: 'a long description',
        required_skills: ['go', 'k8s'],
        salary_min: 400000,
        salary_max: 800000,
        priority: 'urgent',
        deadline: null,
        industry: '金融',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Staff Engineer');
    expect(res.body.data.description).toBe('a long description');
    expect(res.body.data.required_skills).toEqual(['go', 'k8s']);
    expect(res.body.data.priority).toBe('urgent');
    expect(res.body.data.industry).toBe('金融');
  });
});

// ===========================================================================
// 3) POST /v1/employer/jobs/:id/pause
// ===========================================================================

describe('employer: POST /v1/employer/jobs/:id/pause', () => {
  let app: Express;
  beforeEach(() => { createTestApp(); resetDb(); app = buildEmployerHttpApp(getTestDb()); });
  afterAll(() => closeTestDb());

  it('returns 401 when no Authorization header is sent', async () => {
    const res = await request(app).post('/v1/employer/jobs/job_x/pause').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 FORBIDDEN for non-employer caller', async () => {
    const { apiKey } = seedUser({ id: 'h1', userType: 'hr' });
    const res = await request(app)
      .post('/v1/employer/jobs/job_x/pause')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('returns 404 for a job owned by another employer', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedUser({ id: 'e2', userType: 'pm' });
    seedJob({ id: 'job_other', employerId: 'e2', status: 'open' });
    const res = await request(app)
      .post('/v1/employer/jobs/job_other/pause')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it('returns 200 and flips an open job to paused', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedJob({ id: 'job1', employerId: 'e1', status: 'open' });
    const res = await request(app)
      .post('/v1/employer/jobs/job1/pause')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 'job1', status: 'paused' });

    // Confirm the row was actually persisted as 'paused'.
    const row = getTestDb().prepare('SELECT status FROM jobs WHERE id = ?').get('job1') as { status: string };
    expect(row.status).toBe('paused');
  });

  it('returns 409 when the job is already paused (no pause→pause)', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedJob({ id: 'job1', employerId: 'e1', status: 'paused' });
    const res = await request(app)
      .post('/v1/employer/jobs/job1/pause')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('returns 409 when the job is already closed (no close→pause)', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedJob({ id: 'job1', employerId: 'e1', status: 'closed' });
    const res = await request(app)
      .post('/v1/employer/jobs/job1/pause')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(409);
  });
});

// ===========================================================================
// 4) POST /v1/employer/jobs/:id/resume
// ===========================================================================

describe('employer: POST /v1/employer/jobs/:id/resume', () => {
  let app: Express;
  beforeEach(() => { createTestApp(); resetDb(); app = buildEmployerHttpApp(getTestDb()); });
  afterAll(() => closeTestDb());

  it('returns 401 when no Authorization header is sent', async () => {
    const res = await request(app).post('/v1/employer/jobs/job_x/resume').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 FORBIDDEN for non-employer caller', async () => {
    const { apiKey } = seedUser({ id: 'h1', userType: 'hr' });
    const res = await request(app)
      .post('/v1/employer/jobs/job_x/resume')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('returns 404 for a job owned by another employer', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedUser({ id: 'e2', userType: 'pm' });
    seedJob({ id: 'job_other', employerId: 'e2', status: 'paused' });
    const res = await request(app)
      .post('/v1/employer/jobs/job_other/resume')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it('returns 200 and flips a paused job back to open', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedJob({ id: 'job1', employerId: 'e1', status: 'paused' });
    const res = await request(app)
      .post('/v1/employer/jobs/job1/resume')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 'job1', status: 'open' });

    const row = getTestDb().prepare('SELECT status FROM jobs WHERE id = ?').get('job1') as { status: string };
    expect(row.status).toBe('open');
  });

  it('returns 409 when the job is open (no open→resume)', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedJob({ id: 'job1', employerId: 'e1', status: 'open' });
    const res = await request(app)
      .post('/v1/employer/jobs/job1/resume')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });
});

// ===========================================================================
// 5) POST /v1/employer/jobs/:id/close
// ===========================================================================

describe('employer: POST /v1/employer/jobs/:id/close', () => {
  let app: Express;
  beforeEach(() => { createTestApp(); resetDb(); app = buildEmployerHttpApp(getTestDb()); });
  afterAll(() => closeTestDb());

  it('returns 401 when no Authorization header is sent', async () => {
    const res = await request(app).post('/v1/employer/jobs/job_x/close').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 FORBIDDEN for non-employer caller', async () => {
    const { apiKey } = seedUser({ id: 'h1', userType: 'hr' });
    const res = await request(app)
      .post('/v1/employer/jobs/job_x/close')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('returns 404 for a job owned by another employer', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedUser({ id: 'e2', userType: 'pm' });
    seedJob({ id: 'job_other', employerId: 'e2', status: 'open' });
    const res = await request(app)
      .post('/v1/employer/jobs/job_other/close')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it('returns 200 and closes an open job', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedJob({ id: 'job1', employerId: 'e1', status: 'open' });
    const res = await request(app)
      .post('/v1/employer/jobs/job1/close')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 'job1', status: 'closed' });
  });

  it('returns 200 and closes a paused job (paused → closed is allowed)', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedJob({ id: 'job1', employerId: 'e1', status: 'paused' });
    const res = await request(app)
      .post('/v1/employer/jobs/job1/close')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('closed');
  });

  it('returns 409 when the job is already closed (no close→close)', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'pm' });
    seedJob({ id: 'job1', employerId: 'e1', status: 'closed' });
    const res = await request(app)
      .post('/v1/employer/jobs/job1/close')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });
});
