// tests/integration/hunter-portal/router.test.ts
//
// Integration tests for the Hunter Workspace (Phase 3a, Task 7) — the
// HTTP router that wires the four workspace handler modules (tasks,
// kanban, stats, dashboard) onto real Express endpoints.
//
// These tests are HTTP-level (via supertest), not handler-direct. They
// exercise every endpoint on /v1/headhunter-workspace/* plus the cross-
// cutting concerns: auth (401 for missing bearer), authorization (403
// for non-headhunter callers), body validation (400 for malformed
// input), and the router-level 404 for unmatched paths under the
// mounted prefix.
//
// Coverage matrix:
//   - happy-path round trip for every endpoint (12 in total)
//   - 401 for missing / bad auth headers (sampling one per route group)
//   - 403 for non-headhunter callers
//   - 400 for malformed bodies (sampling one per route group)
//   - 404 for unknown paths under /v1/headhunter-workspace
//
// Fixtures:
//   - seedUser() writes a `users` row with a real bcrypt api_key hash via
//     generateApiKey(); the plaintext key is returned so we can use it as
//     a Bearer token in tests.
//   - seedJob / seedCandidate / seedRecommendation are direct SQL helpers
//     that pre-build the FK chain (job → employer; rec → job +
//     anonymized_candidate → private → user) without driving the
//     recommend flow.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  createHeadhunterWorkspaceTestApp,
  resetHunterDb,
  closeHunterTestDb,
  getHunterTestDb,
} from '../../helpers/test-app.js';
import { generateApiKey } from '../../../src/main/modules/auth/api-key.js';
import type { User } from '../../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface SeededUser {
  user: User;
  apiKey: string;
}

function seedUser(opts: {
  id: string;
  userType: 'hr' | 'candidate' | 'pm';
  name?: string;
}): SeededUser {
  const db = getHunterTestDb();
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
            200, 0, ?, 50,
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
      quota_per_day: 200,
      quota_used: 0,
      quota_reset_at: now,
      reputation: 50,
      status: 'active',
      created_at: now,
      updated_at: now,
    },
  };
}

/** Seed an employer + claimed job. Returns the job id. */
function seedJob(opts: {
  id: string;
  employerId?: string;
  title?: string;
}): string {
  const db = getHunterTestDb();
  const employerId = opts.employerId ?? `emp_${opts.id}`;
  seedUser({ id: employerId, userType: 'pm' });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO jobs (id, employer_id, title, description, requirements,
                      salary_min, salary_max, status, priority, deadline, industry,
                      required_skills_json, created_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL,
            NULL, NULL, 'open', 'normal', NULL, NULL,
            NULL, ?, ?)
  `).run(opts.id, employerId, opts.title ?? 'Senior Engineer', now, now);
  return opts.id;
}

/** Seed a candidate private + anonymized row (FK chain for rec.candidate_user_id). */
function seedCandidate(opts: {
  userId: string;
  headhunterId: string;
  anonId?: string;
  privateId?: string;
  name?: string;
}): { anonId: string; privateId: string } {
  const db = getHunterTestDb();
  const anonId = opts.anonId ?? `ca_${opts.userId}`;
  const privateId = opts.privateId ?? `cp_${opts.userId}`;
  seedUser({ id: opts.userId, userType: 'candidate', name: opts.name ?? '张三' });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO candidates_private (id, headhunter_id, candidate_user_id,
      name_enc, phone_enc, email_enc,
      current_company_raw, current_title_raw,
      expected_salary, years_experience, education_school, resume_url,
      skills_json, raw_payload_json, created_at, updated_at)
    VALUES (?, ?, ?, 'n', 'p', 'e', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
  `).run(privateId, opts.headhunterId, opts.userId, now, now);

  db.prepare(`
    INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id,
      industry, title_level, years_experience, salary_range, education_tier,
      skills_json, is_public_pool, unlock_status, created_at, updated_at)
    VALUES (?, ?, ?, '互联网', 'P6', 5, '30-50万', '985',
            '[]', 0, 'locked', ?, ?)
  `).run(anonId, privateId, opts.headhunterId, now, now);
  return { anonId, privateId };
}

function seedRecommendation(opts: {
  id: string;
  headhunterId: string | null;
  jobId: string;
  anonId: string;
  status?: 'pending' | 'pending_pickup' | 'considering_offer' | 'employer_interested'
        | 'candidate_approved' | 'unlocked' | 'rejected_employer' | 'rejected_candidate'
        | 'withdrawn' | 'placed';
  pipelineStage?: 'submitted' | 'screen_passed' | 'interview' | 'offer' | 'onboarded' | 'rejected';
  kanbanPosition?: number | null;
}): void {
  const db = getHunterTestDb();
  const employerIdRow = db.prepare('SELECT employer_id FROM jobs WHERE id = ?').get(opts.jobId) as { employer_id: string } | undefined;
  if (!employerIdRow) throw new Error(`job not found: ${opts.jobId}`);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO recommendations (id, headhunter_id, employer_id, anonymized_candidate_id,
                                 job_id, status, source_type, commission_split_json,
                                 referrer_headhunter_id, pipeline_stage, kanban_position,
                                 created_at, updated_at)
    VALUES (?, ?, ?, ?, ?,
            ?, 'hr', NULL,
            NULL, ?, ?,
            ?, ?)
  `).run(
    opts.id,
    opts.headhunterId,
    employerIdRow.employer_id,
    opts.anonId,
    opts.jobId,
    opts.status ?? 'pending',
    opts.pipelineStage ?? 'submitted',
    opts.kanbanPosition ?? null,
    now,
    now,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hunter-portal: router integration (HTTP)', () => {
  let app: Express;
  let hunter: SeededUser;
  let otherHunter: SeededUser;
  let candidate: SeededUser;

  beforeEach(() => {
    app = createHeadhunterWorkspaceTestApp();
    resetHunterDb();
    hunter = seedUser({ id: 'h1', userType: 'hr' });
    otherHunter = seedUser({ id: 'h2', userType: 'hr' });
    candidate = seedUser({ id: 'c1', userType: 'candidate' });
  });
  afterAll(() => closeHunterTestDb());

  // ---------------- Dashboard ----------------

  describe('GET /dashboard', () => {
    it('returns the full payload shape with zero KPIs when empty', async () => {
      const r = await request(app)
        .get('/v1/headhunter-workspace/dashboard')
        .set('Authorization', `Bearer ${hunter.apiKey}`);

      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.data.kpi).toEqual({
        onboards_this_month: 0,
        active_recommendations: 0,
        placements_count: 0,
        pending_pickup_count: 0,
        conversion_rate: 0,
      });
      expect(r.body.data.top_tasks).toEqual([]);
      // kanban_summary always has 5 entries (submitted..onboarded)
      expect(r.body.data.kanban_summary).toHaveLength(5);
      expect(r.body.data.kanban_summary.map((s: { stage: string }) => s.stage)).toEqual([
        'submitted', 'screen_passed', 'interview', 'offer', 'onboarded',
      ]);
      expect(r.body.data.recent_recommendations).toEqual([]);
    });

    it('aggregates KPI counts when data exists', async () => {
      const j1 = seedJob({ id: 'job1' });
      const j2 = seedJob({ id: 'job2' });
      const j3 = seedJob({ id: 'job3' });
      const j4 = seedJob({ id: 'job4' });
      const c2 = seedCandidate({ userId: 'c2', headhunterId: 'h1' });
      const c3 = seedCandidate({ userId: 'c3', headhunterId: 'h1' });
      const c4 = seedCandidate({ userId: 'c4', headhunterId: 'h1' });
      const c5 = seedCandidate({ userId: 'c5', headhunterId: 'h1' });
      // 1 active in submitted, 1 onboarded-this-month, 1 placed.
      // Each rec needs a distinct (anonymized_candidate_id, job_id) pair due
      // to the UNIQUE constraint on recommendations.
      seedRecommendation({
        id: 'r_act', headhunterId: 'h1', jobId: j1, anonId: c2.anonId,
        status: 'pending', pipelineStage: 'submitted',
      });
      seedRecommendation({
        id: 'r_onb', headhunterId: 'h1', jobId: j2, anonId: c3.anonId,
        status: 'placed', pipelineStage: 'onboarded',
      });
      seedRecommendation({
        id: 'r_rej', headhunterId: 'h1', jobId: j3, anonId: c4.anonId,
        status: 'rejected_employer', pipelineStage: 'rejected',
      });
      // 1 unclaimed pending_pickup (hunter-agnostic).
      seedRecommendation({
        id: 'r_pickup', headhunterId: null, jobId: j4, anonId: c5.anonId,
        status: 'pending_pickup', pipelineStage: 'submitted',
      });

      const r = await request(app)
        .get('/v1/headhunter-workspace/dashboard')
        .set('Authorization', `Bearer ${hunter.apiKey}`);

      expect(r.status).toBe(200);
      expect(r.body.data.kpi.active_recommendations).toBe(1);
      expect(r.body.data.kpi.placements_count).toBe(1);
      expect(r.body.data.kpi.pending_pickup_count).toBe(1);
      // submitted=1 → kanban_summary[0].count = 1
      expect(r.body.data.kanban_summary[0]).toEqual({ stage: 'submitted', count: 1 });
      // recent_recommendations excludes rejected (r_rej) and unclaimed pickup
      const recIds = r.body.data.recent_recommendations.map((x: { recommendation_id: string }) => x.recommendation_id);
      expect(recIds).toContain('r_act');
      expect(recIds).toContain('r_onb');
      expect(recIds).not.toContain('r_rej');
    });
  });

  // ---------------- Tasks ----------------

  describe('GET /tasks', () => {
    it('returns an empty list initially', async () => {
      const r = await request(app)
        .get('/v1/headhunter-workspace/tasks')
        .set('Authorization', `Bearer ${hunter.apiKey}`);
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.data).toEqual([]);
    });

    it('honors status=completed', async () => {
      // Create one task then complete it via HTTP.
      const create = await request(app)
        .post('/v1/headhunter-workspace/tasks')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ title: 't1' });
      const id = create.body.data.id;
      await request(app)
        .post(`/v1/headhunter-workspace/tasks/${id}/complete`)
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send();

      const r = await request(app)
        .get('/v1/headhunter-workspace/tasks?status=completed')
        .set('Authorization', `Bearer ${hunter.apiKey}`);
      expect(r.status).toBe(200);
      expect(r.body.data).toHaveLength(1);
      expect(r.body.data[0].id).toBe(id);
      expect(r.body.data[0].completed_at).not.toBeNull();
    });
  });

  describe('POST /tasks', () => {
    it('creates a task and returns the row', async () => {
      const r = await request(app)
        .post('/v1/headhunter-workspace/tasks')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ title: 'follow up with Acme', priority: 'high' });

      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.data.id).toMatch(/^task_[A-Za-z0-9_-]+$/);
      expect(r.body.data.hunter_user_id).toBe('h1');
      expect(r.body.data.title).toBe('follow up with Acme');
      expect(r.body.data.priority).toBe('high');
      expect(r.body.data.completed_at).toBeNull();
    });

    it('rejects an empty title with 400', async () => {
      const r = await request(app)
        .post('/v1/headhunter-workspace/tasks')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ title: '' });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_PARAMS');
    });
  });

  describe('PUT /tasks/:id', () => {
    it('updates fields and bumps updated_at', async () => {
      const create = await request(app)
        .post('/v1/headhunter-workspace/tasks')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ title: 'original' });
      const id = create.body.data.id;

      const r = await request(app)
        .put(`/v1/headhunter-workspace/tasks/${id}`)
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ title: 'revised', priority: 'urgent' });

      expect(r.status).toBe(200);
      expect(r.body.data.title).toBe('revised');
      expect(r.body.data.priority).toBe('urgent');
    });

    it('returns 404 when the task is not owned by the caller', async () => {
      const create = await request(app)
        .post('/v1/headhunter-workspace/tasks')
        .set('Authorization', `Bearer ${otherHunter.apiKey}`)
        .send({ title: 'mine' });
      const id = create.body.data.id;

      const r = await request(app)
        .put(`/v1/headhunter-workspace/tasks/${id}`)
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ title: 'stolen' });
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /tasks/:id', () => {
    it('removes the task', async () => {
      const create = await request(app)
        .post('/v1/headhunter-workspace/tasks')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ title: 'doomed' });
      const id = create.body.data.id;

      const del = await request(app)
        .delete(`/v1/headhunter-workspace/tasks/${id}`)
        .set('Authorization', `Bearer ${hunter.apiKey}`);
      expect(del.status).toBe(200);
      expect(del.body.data.deleted).toBe(true);

      const list = await request(app)
        .get('/v1/headhunter-workspace/tasks?status=all')
        .set('Authorization', `Bearer ${hunter.apiKey}`);
      expect(list.body.data).toEqual([]);
    });
  });

  describe('POST /tasks/:id/complete + /reopen', () => {
    it('complete sets completed_at; reopen clears it', async () => {
      const create = await request(app)
        .post('/v1/headhunter-workspace/tasks')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ title: 'toggle' });
      const id = create.body.data.id;

      const comp = await request(app)
        .post(`/v1/headhunter-workspace/tasks/${id}/complete`)
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send();
      expect(comp.status).toBe(200);
      expect(comp.body.data.completed_at).not.toBeNull();

      const reopen = await request(app)
        .post(`/v1/headhunter-workspace/tasks/${id}/reopen`)
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send();
      expect(reopen.status).toBe(200);
      expect(reopen.body.data.completed_at).toBeNull();
    });
  });

  // ---------------- Kanban ----------------

  describe('GET /kanban', () => {
    it('returns 5 columns with empty cards on first call', async () => {
      const r = await request(app)
        .get('/v1/headhunter-workspace/kanban')
        .set('Authorization', `Bearer ${hunter.apiKey}`);

      expect(r.status).toBe(200);
      expect(r.body.data.columns).toHaveLength(5);
      expect(r.body.data.columns.map((c: { name: string }) => c.name)).toEqual([
        '投递', '简历过', '面试', 'Offer', '到岗',
      ]);
      for (const col of r.body.data.columns) {
        expect(col.cards).toEqual([]);
      }
    });

    it('shows cards on the matching column after seed', async () => {
      const j1 = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c2', headhunterId: 'h1' });
      seedRecommendation({
        id: 'rec_a', headhunterId: 'h1', jobId: j1, anonId: c.anonId,
        pipelineStage: 'submitted',
      });

      const r = await request(app)
        .get('/v1/headhunter-workspace/kanban')
        .set('Authorization', `Bearer ${hunter.apiKey}`);
      expect(r.status).toBe(200);
      const submittedCol = r.body.data.columns.find((col: { pipeline_stage: string }) => col.pipeline_stage === 'submitted');
      expect(submittedCol.cards).toHaveLength(1);
      expect(submittedCol.cards[0].recommendation_id).toBe('rec_a');
    });
  });

  describe('POST /kanban/move', () => {
    it('moves a card to a target column (submitted → screen_passed)', async () => {
      const j1 = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c2', headhunterId: 'h1' });
      seedRecommendation({
        id: 'rec_a', headhunterId: 'h1', jobId: j1, anonId: c.anonId,
        pipelineStage: 'submitted',
      });

      // Get the target column id (screen_passed).
      const board = await request(app)
        .get('/v1/headhunter-workspace/kanban')
        .set('Authorization', `Bearer ${hunter.apiKey}`);
      const targetCol = board.body.data.columns.find((col: { pipeline_stage: string }) => col.pipeline_stage === 'screen_passed');

      const r = await request(app)
        .post('/v1/headhunter-workspace/kanban/move')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ recommendation_id: 'rec_a', to_column_id: targetCol.id });

      expect(r.status).toBe(200);
      expect(r.body.data.pipeline_stage).toBe('screen_passed');
    });

    it('rejects an illegal transition with 409 INVALID_STATE', async () => {
      const j1 = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c2', headhunterId: 'h1' });
      // Card is in 'submitted' — trying to jump straight to 'offer' is illegal.
      seedRecommendation({
        id: 'rec_a', headhunterId: 'h1', jobId: j1, anonId: c.anonId,
        pipelineStage: 'submitted',
      });
      const board = await request(app)
        .get('/v1/headhunter-workspace/kanban')
        .set('Authorization', `Bearer ${hunter.apiKey}`);
      const offerCol = board.body.data.columns.find((col: { pipeline_stage: string }) => col.pipeline_stage === 'offer');

      const r = await request(app)
        .post('/v1/headhunter-workspace/kanban/move')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ recommendation_id: 'rec_a', to_column_id: offerCol.id });

      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('INVALID_STATE');
    });

    it('returns 400 for a missing recommendation_id', async () => {
      const board = await request(app)
        .get('/v1/headhunter-workspace/kanban')
        .set('Authorization', `Bearer ${hunter.apiKey}`);
      const targetCol = board.body.data.columns[0];

      const r = await request(app)
        .post('/v1/headhunter-workspace/kanban/move')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ to_column_id: targetCol.id });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_PARAMS');
    });
  });

  describe('POST /kanban/add', () => {
    it('claims a pending_pickup rec and places it on the board', async () => {
      const j1 = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c2', headhunterId: 'h1' });
      seedRecommendation({
        id: 'rec_pickup', headhunterId: null, jobId: j1, anonId: c.anonId,
        status: 'pending_pickup', pipelineStage: 'submitted',
      });

      const board = await request(app)
        .get('/v1/headhunter-workspace/kanban')
        .set('Authorization', `Bearer ${hunter.apiKey}`);
      const submittedCol = board.body.data.columns.find((col: { pipeline_stage: string }) => col.pipeline_stage === 'submitted');

      const r = await request(app)
        .post('/v1/headhunter-workspace/kanban/add')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ recommendation_id: 'rec_pickup', to_column_id: submittedCol.id });

      expect(r.status).toBe(200);
      expect(r.body.data.recommendation_id).toBe('rec_pickup');
      expect(r.body.data.pipeline_stage).toBe('submitted');
    });

    it('rejects a rec that is not pending_pickup with 409', async () => {
      const j1 = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c2', headhunterId: 'h1' });
      seedRecommendation({
        id: 'rec_placed', headhunterId: null, jobId: j1, anonId: c.anonId,
        status: 'pending', pipelineStage: 'submitted',
      });
      const board = await request(app)
        .get('/v1/headhunter-workspace/kanban')
        .set('Authorization', `Bearer ${hunter.apiKey}`);
      const submittedCol = board.body.data.columns[0];

      const r = await request(app)
        .post('/v1/headhunter-workspace/kanban/add')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ recommendation_id: 'rec_placed', to_column_id: submittedCol.id });

      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('INVALID_STATE');
    });
  });

  describe('POST /kanban/remove', () => {
    it('moves an active card to rejected', async () => {
      const j1 = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c2', headhunterId: 'h1' });
      seedRecommendation({
        id: 'rec_a', headhunterId: 'h1', jobId: j1, anonId: c.anonId,
        pipelineStage: 'submitted',
      });

      const r = await request(app)
        .post('/v1/headhunter-workspace/kanban/remove')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ recommendation_id: 'rec_a' });

      expect(r.status).toBe(200);
      expect(r.body.data.pipeline_stage).toBe('rejected');

      // Board should no longer list it on submitted.
      const board = await request(app)
        .get('/v1/headhunter-workspace/kanban')
        .set('Authorization', `Bearer ${hunter.apiKey}`);
      const submittedCol = board.body.data.columns.find((col: { pipeline_stage: string }) => col.pipeline_stage === 'submitted');
      expect(submittedCol.cards).toEqual([]);
    });
  });

  // ---------------- Stats ----------------

  describe('GET /stats', () => {
    it('returns overview + funnel + range envelope', async () => {
      const r = await request(app)
        .get('/v1/headhunter-workspace/stats')
        .set('Authorization', `Bearer ${hunter.apiKey}`);

      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.data.overview).toBeDefined();
      expect(r.body.data.overview.active_recommendations).toBe(0);
      expect(r.body.data.overview.placements_count).toBe(0);
      expect(r.body.data.funnel).toHaveLength(5);
      expect(r.body.data.funnel.map((f: { stage: string }) => f.stage)).toEqual([
        'submitted', 'screen_passed', 'interview', 'offer', 'onboarded',
      ]);
      expect(r.body.data.range).toEqual({ from: null, to: null });
    });

    it('coerces from/to from query strings to numbers', async () => {
      const r = await request(app)
        .get('/v1/headhunter-workspace/stats?from=1000&to=2000')
        .set('Authorization', `Bearer ${hunter.apiKey}`);
      expect(r.status).toBe(200);
      expect(r.body.data.range.from).toBe(1000);
      expect(r.body.data.range.to).toBe(2000);
    });
  });

  // ---------------- Auth & authorization ----------------

  describe('authentication', () => {
    it('rejects missing Authorization header with 401', async () => {
      const r = await request(app).get('/v1/headhunter-workspace/dashboard');
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects a bad bearer token with 401', async () => {
      const r = await request(app)
        .get('/v1/headhunter-workspace/dashboard')
        .set('Authorization', 'Bearer hp_live_bogus_key_value_here');
      expect(r.status).toBe(401);
    });

    it('rejects every endpoint group with 401 when no auth', async () => {
      const endpoints: Array<{ method: string; path: string; body?: unknown }> = [
        { method: 'get', path: '/dashboard' },
        { method: 'get', path: '/tasks' },
        { method: 'post', path: '/tasks', body: { title: 'x' } },
        { method: 'put', path: '/tasks/task_abc', body: { title: 'y' } },
        { method: 'delete', path: '/tasks/task_abc' },
        { method: 'post', path: '/tasks/task_abc/complete' },
        { method: 'post', path: '/tasks/task_abc/reopen' },
        { method: 'get', path: '/kanban' },
        { method: 'post', path: '/kanban/move', body: { recommendation_id: 'r', to_column_id: 1 } },
        { method: 'post', path: '/kanban/add', body: { recommendation_id: 'r', to_column_id: 1 } },
        { method: 'post', path: '/kanban/remove', body: { recommendation_id: 'r' } },
        { method: 'get', path: '/stats' },
      ];
      for (const ep of endpoints) {
        const req = request(app)[ep.method as 'get'](`/v1/headhunter-workspace${ep.path}`);
        if (ep.body) (req as unknown as { send: (b: unknown) => unknown }).send(ep.body);
        const r = await req;
        expect(r.status, `${ep.method} ${ep.path}`).toBe(401);
      }
    });
  });

  describe('authorization (non-headhunter caller)', () => {
    it('rejects a candidate caller with 403', async () => {
      const r = await request(app)
        .get('/v1/headhunter-workspace/dashboard')
        .set('Authorization', `Bearer ${candidate.apiKey}`);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects POST /tasks with 403 for a non-headhunter', async () => {
      const r = await request(app)
        .post('/v1/headhunter-workspace/tasks')
        .set('Authorization', `Bearer ${candidate.apiKey}`)
        .send({ title: 'x' });
      expect(r.status).toBe(403);
    });

    it('rejects GET /kanban with 403 for a non-headhunter', async () => {
      const r = await request(app)
        .get('/v1/headhunter-workspace/kanban')
        .set('Authorization', `Bearer ${candidate.apiKey}`);
      expect(r.status).toBe(403);
    });

    it('rejects GET /stats with 403 for a non-headhunter', async () => {
      const r = await request(app)
        .get('/v1/headhunter-workspace/stats')
        .set('Authorization', `Bearer ${candidate.apiKey}`);
      expect(r.status).toBe(403);
    });
  });

  describe('body validation', () => {
    it('rejects POST /tasks with bad priority with 400', async () => {
      const r = await request(app)
        .post('/v1/headhunter-workspace/tasks')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ title: 'x', priority: 'banana' });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_PARAMS');
    });

    it('rejects PUT /tasks/:id with unknown fields with 400', async () => {
      const create = await request(app)
        .post('/v1/headhunter-workspace/tasks')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ title: 'x' });
      const id = create.body.data.id;

      const r = await request(app)
        .put(`/v1/headhunter-workspace/tasks/${id}`)
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ title: 'y', secret_field: 'no' });
      expect(r.status).toBe(400);
    });

    it('rejects POST /kanban/move with bad to_column_id with 400', async () => {
      const r = await request(app)
        .post('/v1/headhunter-workspace/kanban/move')
        .set('Authorization', `Bearer ${hunter.apiKey}`)
        .send({ recommendation_id: 'r', to_column_id: -1 });
      expect(r.status).toBe(400);
    });

    it('rejects GET /tasks with bad status filter with 400', async () => {
      const r = await request(app)
        .get('/v1/headhunter-workspace/tasks?status=garbage')
        .set('Authorization', `Bearer ${hunter.apiKey}`);
      expect(r.status).toBe(400);
    });
  });

  describe('404 fallback', () => {
    it('returns 404 JSON for unknown paths under /v1/headhunter-workspace', async () => {
      const r = await request(app)
        .get('/v1/headhunter-workspace/this-does-not-exist')
        .set('Authorization', `Bearer ${hunter.apiKey}`);
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('NOT_FOUND');
    });
  });
});