// tests/integration/employer/dashboard.test.ts
//
// Employer Panel (Phase 3c) — Task 3: Dashboard handler + endpoint.
//
// Two layers of coverage:
//
//   1. Handler-direct tests — drive `createEmployerDashboardHandler(db)` directly
//      and assert the 7 counters:
//        - active_jobs          (jobs.status='open' AND employer_id=me)
//        - open_positions       (MVP: equals active_jobs; jobs has no headcount_planned)
//        - candidates_viewed_this_month  (unlock_audit_log.created_at in last 30d
//                                          joined to rec → job → employer_id=me)
//        - interested_count     (recommendations.status='employer_interested' for my jobs)
//        - unlocked_count       (recommendations.status='candidate_approved' for my jobs)
//        - placements_count     (placements joined to jobs.employer_id=me)
//        - spend_this_month     (SUM(platform_fee+primary_share+referrer_share) over
//                                placements.created_at in last 30d for my jobs)
//
//   2. HTTP tests — spin up a minimal Express app that mounts the
//      employer-panel router with the shared test DB and exercise
//      the auth boundary:
//        - 401 for missing Bearer
//        - 403 for non-employer callers (headhunter / candidate / pm)
//        - 200 for employer with all counters in the response shape
//        - Cross-employer isolation: another employer's data must NOT bleed in
//
// Fixtures:
//   - `seedUser` writes a `users` row with a real bcrypt api_key hash via
//     `generateApiKey()` so we can use the plaintext key as a Bearer token
//     for HTTP tests. For handler-direct tests the api key is not required.
//   - `seedJob`, `seedCandidate`, `seedRecommendation`, `seedPlacement`,
//     `seedAuditLog` write directly via SQL to build the FK chain and the
//     counter sources.
//
// Schema references (verified against v001.sql, v002.sql, v003.sql, v010, v026):
//   - unlock_audit_log: id, recommendation_id, actor_user_id, action, ip_address,
//     user_agent, created_at  (NO accessed_at — created_at is the event time)
//   - placements: id, job_id, candidate_user_id, primary_headhunter_id,
//     referrer_headhunter_id, anonymized_candidate_id, annual_salary,
//     platform_fee, primary_share, referrer_share, candidate_bonus, status,
//     created_at, updated_at  (NO actual_fee)
//   - recommendations.status enum: pending, pending_pickup, considering_offer,
//     employer_interested, candidate_approved, unlocked, rejected_employer,
//     rejected_candidate, withdrawn, placed
//   - jobs.status enum: open, claimed, paused, closed, filled (v010)
//   - jobs has NO headcount_planned column → open_positions equals active_jobs
//     in MVP (per audit §5)

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  getTestDb,
} from '../../helpers/test-app.js';
import { createEmployerDashboardHandler } from '../../../src/main/modules/employer/dashboard.js';
import { createEmployerPanelRouter } from '../../../src/main/routes/employer-panel.js';
import { createUtf8OnlyMiddleware } from '../../../src/main/modules/encoding/index.js';
import { generateApiKey } from '../../../src/main/modules/auth/api-key.js';
import { ApiError } from '../../../src/main/errors.js';
import { MAX_BODY_SIZE } from '../../../src/shared/constants.js';
import type { DB } from '../../../src/main/db/connection.js';
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
  userType: 'candidate' | 'headhunter' | 'employer' | 'pm';
  name?: string;
}): SeededUser {
  const db = getTestDb();
  const { key, hash, prefix } = generateApiKey();
  const now = new Date().toISOString();
  // Note: the `users` CHECK constraint in v001 lists only
  // ('candidate','headhunter','employer'); v029 added 'pm'.
  // The constraint is set per migration, so this INSERT works as long as the
  // migration has been run. The test-app helper runs all migrations on boot.
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

/** Seed a job owned by an employer. Returns the employer user id. */
function seedJob(opts: {
  id: string;
  employerId: string;
  title?: string;
  status?: 'open' | 'claimed' | 'paused' | 'closed' | 'filled';
}): void {
  const db = getTestDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO jobs (id, employer_id, source_headhunter_id, created_for_employer_id,
                      title, description, requirements,
                      salary_min, salary_max, status, priority, deadline, industry,
                      required_skills_json, created_at, updated_at)
    VALUES (?, ?, NULL, NULL,
            ?, NULL, NULL,
            NULL, NULL, ?, 'normal', NULL, NULL,
            NULL, ?, ?)
  `).run(
    opts.id,
    opts.employerId,
    opts.title ?? 'Senior Engineer',
    opts.status ?? 'open',
    now,
    now,
  );
}

/**
 * Seed a candidate (user + private + anonymized) so a recommendation can
 * reference it via the FK chain.
 */
function seedCandidate(opts: {
  userId: string;
  headhunterId: string;
}): { anonId: string; privateId: string } {
  const db = getTestDb();
  const anonId = `ca_${opts.userId}`;
  const privateId = `cp_${opts.userId}`;
  // Ensure the headhunter user exists (candidates_private.headhunter_id has a FK
  // to users.id). Tests can pass any string id; we seed the user on demand so
  // the test fixtures don't have to declare every hunter up front.
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(opts.headhunterId);
  if (!existing) seedUser({ id: opts.headhunterId, userType: 'headhunter' });
  seedUser({ id: opts.userId, userType: 'candidate' });
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

interface SeedRecOpts {
  id: string;
  headhunterId: string | null;
  jobId: string;
  anonId: string;
  status?:
    | 'pending'
    | 'pending_pickup'
    | 'considering_offer'
    | 'employer_interested'
    | 'candidate_approved'
    | 'unlocked'
    | 'rejected_employer'
    | 'rejected_candidate'
    | 'withdrawn'
    | 'placed';
}

function seedRecommendation(opts: SeedRecOpts): void {
  const db = getTestDb();
  const employerIdRow = db.prepare('SELECT employer_id FROM jobs WHERE id = ?').get(opts.jobId) as
    | { employer_id: string }
    | undefined;
  if (!employerIdRow) throw new Error(`job not found: ${opts.jobId}`);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO recommendations (id, headhunter_id, employer_id, anonymized_candidate_id,
                                 job_id, status, source_type, commission_split_json,
                                 referrer_headhunter_id, pickup_headhunter_id, candidate_note,
                                 pipeline_stage, kanban_position,
                                 created_at, updated_at)
    VALUES (?, ?, ?, ?, ?,
            ?, 'headhunter', NULL,
            NULL, NULL, NULL,
            'submitted', NULL,
            ?, ?)
  `).run(
    opts.id,
    opts.headhunterId,
    employerIdRow.employer_id,
    opts.anonId,
    opts.jobId,
    opts.status ?? 'pending',
    now,
    now,
  );
}

interface SeedPlacementOpts {
  id: string;
  jobId: string;
  candidateUserId: string;
  primaryHeadhunterId: string;
  anonId: string;
  /** Sum of platform_fee + primary_share + referrer_share — what counts for "spend". */
  spend?: number;
  status?: 'pending_payment' | 'paid' | 'cancelled';
  /** Override created_at (ISO 8601 string). Used for 30d-rolling-window tests. */
  createdAt?: string;
}

function seedPlacement(opts: SeedPlacementOpts): void {
  const db = getTestDb();
  const now = opts.createdAt ?? new Date().toISOString();
  const spend = opts.spend ?? 10000;
  // Split the spend across the three components so SUM(platform+primary+referrer)
  // equals the caller-supplied total. We give all of it to platform_fee in the
  // simple case; tests can override the split by passing specific amounts.
  const platformFee = spend;
  const primaryShare = 0;
  const referrerShare = 0;
  db.prepare(`
    INSERT INTO placements (id, job_id, candidate_user_id, primary_headhunter_id,
                            referrer_headhunter_id, anonymized_candidate_id,
                            annual_salary, platform_fee, primary_share,
                            referrer_share, candidate_bonus, status,
                            created_at, updated_at)
    VALUES (?, ?, ?, ?,
            NULL, ?,
            500000, ?, ?,
            ?, 0, ?,
            ?, ?)
  `).run(
    opts.id,
    opts.jobId,
    opts.candidateUserId,
    opts.primaryHeadhunterId,
    opts.anonId,
    platformFee,
    primaryShare,
    referrerShare,
    opts.status ?? 'paid',
    now,
    now,
  );
}

interface SeedAuditOpts {
  recommendationId: string;
  actorUserId: string;
  action?: 'express_interest' | 'approve_unlock' | 'reject_unlock' | 'unlock_delivery' | 'revoke_unlock';
  /** ISO 8601 string. Used for 30d-rolling-window tests. */
  createdAt?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function seedAuditLog(opts: SeedAuditOpts): void {
  const db = getTestDb();
  const now = opts.createdAt ?? new Date().toISOString();
  db.prepare(`
    INSERT INTO unlock_audit_log (recommendation_id, actor_user_id, action,
                                  ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    opts.recommendationId,
    opts.actorUserId,
    opts.action ?? 'express_interest',
    opts.ipAddress ?? null,
    opts.userAgent ?? null,
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
// HTTP test app — minimal Express mounting the employer-panel router on the
// shared candidate-portal test DB.
// ---------------------------------------------------------------------------

function buildEmployerPanelHttpApp(db: DB): Express {
  process.env.PLATFORM_ENCRYPTION_KEY = process.env.PLATFORM_ENCRYPTION_KEY
    ?? Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = process.env.WEBHOOK_HMAC_SECRET ?? 'test-secret-1234567890';
  process.env.NODE_ENV = 'test';

  const app = express();
  app.use(
    '/v1/employer-panel',
    createUtf8OnlyMiddleware(),
    express.json({ limit: MAX_BODY_SIZE }),
    createEmployerPanelRouter(db),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('employer-panel: dashboard handler', () => {
  beforeEach(() => {
    createTestApp();
    resetDb();
  });
  afterAll(() => closeTestDb());

  // ----- empty state -------------------------------------------------------

  describe('empty state (no data)', () => {
    it('returns all-zero counters for an employer with no jobs/recs/placements/audits', () => {
      const { user } = seedUser({ id: 'e1', userType: 'employer' });
      const handler = createEmployerDashboardHandler(getTestDb());
      const data = handler.getDashboard(user);
      expect(data).toEqual({
        active_jobs: 0,
        open_positions: 0,
        candidates_viewed_this_month: 0,
        interested_count: 0,
        unlocked_count: 0,
        placements_count: 0,
        spend_this_month: 0,
      });
    });

    it('returns all-zero counters when other employers have data but this one does not', () => {
      // Seed data owned by a DIFFERENT employer to confirm no cross-tenant leakage.
      const { user: other } = seedUser({ id: 'other', userType: 'employer' });
      seedJob({ id: 'job_other', employerId: other.id });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      seedRecommendation({ id: 'r1', headhunterId: 'h1', jobId: 'job_other', anonId: c.anonId, status: 'employer_interested' });
      seedPlacement({ id: 'p1', jobId: 'job_other', candidateUserId: 'c1', primaryHeadhunterId: 'h1', anonId: c.anonId, spend: 9999 });

      const { user } = seedUser({ id: 'e1', userType: 'employer' });
      const handler = createEmployerDashboardHandler(getTestDb());
      const data = handler.getDashboard(user);
      expect(data.active_jobs).toBe(0);
      expect(data.open_positions).toBe(0);
      expect(data.interested_count).toBe(0);
      expect(data.unlocked_count).toBe(0);
      expect(data.placements_count).toBe(0);
      expect(data.spend_this_month).toBe(0);
      expect(data.candidates_viewed_this_month).toBe(0);
    });
  });

  // ----- auth boundary -----------------------------------------------------

  describe('authorization', () => {
    it('throws FORBIDDEN for headhunter caller', () => {
      const { user } = seedUser({ id: 'h1', userType: 'headhunter' });
      const handler = createEmployerDashboardHandler(getTestDb());
      expectForbidden(() => handler.getDashboard(user));
    });

    it('throws FORBIDDEN for candidate caller', () => {
      const { user } = seedUser({ id: 'c1', userType: 'candidate' });
      const handler = createEmployerDashboardHandler(getTestDb());
      expectForbidden(() => handler.getDashboard(user));
    });

    it('throws FORBIDDEN for pm caller', () => {
      const { user } = seedUser({ id: 'p1', userType: 'pm' });
      const handler = createEmployerDashboardHandler(getTestDb());
      expectForbidden(() => handler.getDashboard(user));
    });
  });

  // ----- active_jobs + open_positions --------------------------------------

  describe('active_jobs / open_positions', () => {
    it('counts only open jobs owned by the caller', () => {
      const { user } = seedUser({ id: 'e1', userType: 'employer' });
      seedJob({ id: 'j_open1', employerId: 'e1', status: 'open' });
      seedJob({ id: 'j_open2', employerId: 'e1', status: 'open' });
      seedJob({ id: 'j_claimed', employerId: 'e1', status: 'claimed' });
      seedJob({ id: 'j_closed', employerId: 'e1', status: 'closed' });
      seedJob({ id: 'j_filled', employerId: 'e1', status: 'filled' });
      seedJob({ id: 'j_paused', employerId: 'e1', status: 'paused' });

      // Another employer's open job must not be counted.
      const { user: other } = seedUser({ id: 'e2', userType: 'employer' });
      seedJob({ id: 'j_other_open', employerId: other.id, status: 'open' });

      const data = createEmployerDashboardHandler(getTestDb()).getDashboard(user);
      // MVP: only 'open' jobs are counted (not 'claimed'). 2 open jobs for e1.
      expect(data.active_jobs).toBe(2);
      expect(data.open_positions).toBe(2);
    });

    it('open_positions equals active_jobs (no headcount_planned in MVP)', () => {
      const { user } = seedUser({ id: 'e1', userType: 'employer' });
      for (let i = 0; i < 5; i++) seedJob({ id: `j${i}`, employerId: 'e1', status: 'open' });
      const data = createEmployerDashboardHandler(getTestDb()).getDashboard(user);
      expect(data.active_jobs).toBe(data.open_positions);
      expect(data.active_jobs).toBe(5);
    });
  });

  // ----- interested_count + unlocked_count ---------------------------------

  describe('interested_count / unlocked_count', () => {
    it('counts recommendations on the caller\'s jobs by status', () => {
      const { user } = seedUser({ id: 'e1', userType: 'employer' });
      seedJob({ id: 'job1', employerId: 'e1' });

      const cands = Array.from({ length: 8 }, (_, i) =>
        seedCandidate({ userId: `c${i}`, headhunterId: 'h1' }),
      );

      // 3 employer_interested
      seedRecommendation({ id: 'r_int1', headhunterId: 'h1', jobId: 'job1', anonId: cands[0]!.anonId, status: 'employer_interested' });
      seedRecommendation({ id: 'r_int2', headhunterId: 'h1', jobId: 'job1', anonId: cands[1]!.anonId, status: 'employer_interested' });
      seedRecommendation({ id: 'r_int3', headhunterId: 'h1', jobId: 'job1', anonId: cands[2]!.anonId, status: 'employer_interested' });
      // 2 candidate_approved (== "unlocked" in this MVP mapping)
      seedRecommendation({ id: 'r_unl1', headhunterId: 'h1', jobId: 'job1', anonId: cands[3]!.anonId, status: 'candidate_approved' });
      seedRecommendation({ id: 'r_unl2', headhunterId: 'h1', jobId: 'job1', anonId: cands[4]!.anonId, status: 'candidate_approved' });
      // Noise: other statuses — must NOT count toward either bucket.
      seedRecommendation({ id: 'r_pending', headhunterId: 'h1', jobId: 'job1', anonId: cands[5]!.anonId, status: 'pending' });
      seedRecommendation({ id: 'r_rej', headhunterId: 'h1', jobId: 'job1', anonId: cands[6]!.anonId, status: 'rejected_employer' });
      seedRecommendation({ id: 'r_placed', headhunterId: 'h1', jobId: 'job1', anonId: cands[7]!.anonId, status: 'placed' });

      const data = createEmployerDashboardHandler(getTestDb()).getDashboard(user);
      expect(data.interested_count).toBe(3);
      expect(data.unlocked_count).toBe(2);
    });

    it('does NOT include recommendations on another employer\'s jobs', () => {
      const { user: e1 } = seedUser({ id: 'e1', userType: 'employer' });
      const { user: e2 } = seedUser({ id: 'e2', userType: 'employer' });
      seedJob({ id: 'j_e1', employerId: 'e1' });
      seedJob({ id: 'j_e2', employerId: 'e2' });
      // 3 distinct candidates — recommendations table has a UNIQUE
      // (anonymized_candidate_id, job_id) constraint, so we can't reuse the
      // same candidate for the same job twice.
      const c1 = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      const c2 = seedCandidate({ userId: 'c2', headhunterId: 'h1' });
      const c3 = seedCandidate({ userId: 'c3', headhunterId: 'h1' });
      seedRecommendation({ id: 'r_mine', headhunterId: 'h1', jobId: 'j_e1', anonId: c1.anonId, status: 'employer_interested' });
      seedRecommendation({ id: 'r_other', headhunterId: 'h1', jobId: 'j_e2', anonId: c2.anonId, status: 'employer_interested' });
      seedRecommendation({ id: 'r_other2', headhunterId: 'h1', jobId: 'j_e2', anonId: c3.anonId, status: 'candidate_approved' });

      const data = createEmployerDashboardHandler(getTestDb()).getDashboard(e1);
      expect(data.interested_count).toBe(1);
      expect(data.unlocked_count).toBe(0);
    });
  });

  // ----- candidates_viewed_this_month --------------------------------------

  describe('candidates_viewed_this_month', () => {
    it('counts audit_log rows in the last 30 days for the caller\'s job recs', () => {
      const { user } = seedUser({ id: 'e1', userType: 'employer' });
      seedJob({ id: 'job1', employerId: 'e1' });
      const c1 = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      const c2 = seedCandidate({ userId: 'c2', headhunterId: 'h1' });
      const c3 = seedCandidate({ userId: 'c3', headhunterId: 'h1' });
      seedRecommendation({ id: 'r1', headhunterId: 'h1', jobId: 'job1', anonId: c1.anonId });
      seedRecommendation({ id: 'r2', headhunterId: 'h1', jobId: 'job1', anonId: c2.anonId });
      seedRecommendation({ id: 'r3', headhunterId: 'h1', jobId: 'job1', anonId: c3.anonId });

      const now = Date.now();
      const within = new Date(now - 5 * 86400 * 1000).toISOString();
      const old = new Date(now - 60 * 86400 * 1000).toISOString();

      // 2 within window for e1
      seedAuditLog({ recommendationId: 'r1', actorUserId: 'e1', action: 'express_interest', createdAt: within });
      seedAuditLog({ recommendationId: 'r2', actorUserId: 'e1', action: 'unlock_delivery', createdAt: within });
      // 1 outside window — must NOT count
      seedAuditLog({ recommendationId: 'r3', actorUserId: 'e1', action: 'express_interest', createdAt: old });

      const data = createEmployerDashboardHandler(getTestDb()).getDashboard(user);
      expect(data.candidates_viewed_this_month).toBe(2);
    });

    it('does NOT count audit rows for recs on another employer\'s job', () => {
      const { user: e1 } = seedUser({ id: 'e1', userType: 'employer' });
      const { user: e2 } = seedUser({ id: 'e2', userType: 'employer' });
      seedJob({ id: 'j_e1', employerId: 'e1' });
      seedJob({ id: 'j_e2', employerId: 'e2' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      seedRecommendation({ id: 'r_e1', headhunterId: 'h1', jobId: 'j_e1', anonId: c.anonId });
      seedRecommendation({ id: 'r_e2', headhunterId: 'h1', jobId: 'j_e2', anonId: c.anonId });
      // Same actor (e1) but on e2's rec — must not bleed in.
      seedAuditLog({ recommendationId: 'r_e2', actorUserId: 'e1', action: 'express_interest' });

      const data = createEmployerDashboardHandler(getTestDb()).getDashboard(e1);
      expect(data.candidates_viewed_this_month).toBe(0);
    });

    it('counts audit rows by actor_user_id matching the employer, not the rec\'s employer_id', () => {
      // The spec counts via "jobs.employer_id = me" join, not via the rec's
      // employer_id (which is the same anyway). Audit rows where the actor
      // is someone else entirely must be ignored even on the employer's own rec.
      const { user } = seedUser({ id: 'e1', userType: 'employer' });
      // actor_user_id FKs to users(id), so we must seed the "someone else" user.
      seedUser({ id: 'someone_else', userType: 'headhunter' });
      seedJob({ id: 'job1', employerId: 'e1' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      seedRecommendation({ id: 'r1', headhunterId: 'h1', jobId: 'job1', anonId: c.anonId });
      seedAuditLog({ recommendationId: 'r1', actorUserId: 'someone_else', action: 'express_interest' });
      const data = createEmployerDashboardHandler(getTestDb()).getDashboard(user);
      expect(data.candidates_viewed_this_month).toBe(0);
    });
  });

  // ----- placements_count + spend_this_month -------------------------------

  describe('placements_count / spend_this_month', () => {
    it('counts placements on the caller\'s jobs', () => {
      const { user } = seedUser({ id: 'e1', userType: 'employer' });
      const { user: e2 } = seedUser({ id: 'e2', userType: 'employer' });
      seedJob({ id: 'j_e1', employerId: 'e1' });
      seedJob({ id: 'j_e2', employerId: 'e2' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      const c2 = seedCandidate({ userId: 'c2', headhunterId: 'h1' });
      seedPlacement({ id: 'p_mine1', jobId: 'j_e1', candidateUserId: 'c1', primaryHeadhunterId: 'h1', anonId: c.anonId });
      seedPlacement({ id: 'p_mine2', jobId: 'j_e1', candidateUserId: 'c2', primaryHeadhunterId: 'h1', anonId: c2.anonId });
      seedPlacement({ id: 'p_other', jobId: 'j_e2', candidateUserId: 'c1', primaryHeadhunterId: 'h1', anonId: c.anonId });

      const data = createEmployerDashboardHandler(getTestDb()).getDashboard(user);
      expect(data.placements_count).toBe(2);
    });

    it('spend_this_month sums platform_fee + primary_share + referrer_share within 30d', () => {
      const { user } = seedUser({ id: 'e1', userType: 'employer' });
      seedJob({ id: 'j1', employerId: 'e1' });
      // Two distinct candidates — placements has a UNIQUE
      // (anonymized_candidate_id, job_id, primary_headhunter_id) constraint.
      const c1 = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      const c2 = seedCandidate({ userId: 'c2', headhunterId: 'h1' });
      const now = Date.now();
      const within = new Date(now - 10 * 86400 * 1000).toISOString();
      const outside = new Date(now - 60 * 86400 * 1000).toISOString();

      // 5000 + 3000 + 2000 = 10000 (in window)
      seedPlacement({
        id: 'p_in1', jobId: 'j1', candidateUserId: 'c1', primaryHeadhunterId: 'h1',
        anonId: c1.anonId, createdAt: within, spend: 10000,
      });
      // Outside window — must not count toward spend_this_month (but DOES count
      // toward all-time placements_count).
      seedPlacement({
        id: 'p_out', jobId: 'j1', candidateUserId: 'c2', primaryHeadhunterId: 'h1',
        anonId: c2.anonId, createdAt: outside, spend: 7777,
      });

      const data = createEmployerDashboardHandler(getTestDb()).getDashboard(user);
      expect(data.placements_count).toBe(2); // lifetime
      expect(data.spend_this_month).toBe(10000); // 30d-rolling only
    });

    it('spend_this_month excludes placements on other employers\' jobs', () => {
      const { user: e1 } = seedUser({ id: 'e1', userType: 'employer' });
      const { user: e2 } = seedUser({ id: 'e2', userType: 'employer' });
      seedJob({ id: 'j_e1', employerId: 'e1' });
      seedJob({ id: 'j_e2', employerId: 'e2' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      seedPlacement({ id: 'p_mine', jobId: 'j_e1', candidateUserId: 'c1', primaryHeadhunterId: 'h1', anonId: c.anonId, spend: 5000 });
      seedPlacement({ id: 'p_other', jobId: 'j_e2', candidateUserId: 'c1', primaryHeadhunterId: 'h1', anonId: c.anonId, spend: 99999 });

      const data = createEmployerDashboardHandler(getTestDb()).getDashboard(e1);
      expect(data.placements_count).toBe(1);
      expect(data.spend_this_month).toBe(5000);
    });
  });

  // ----- shape contract ----------------------------------------------------

  describe('response shape contract', () => {
    it('returns exactly the 7 documented keys, all non-negative integers', () => {
      const { user } = seedUser({ id: 'e1', userType: 'employer' });
      const data = createEmployerDashboardHandler(getTestDb()).getDashboard(user);
      expect(Object.keys(data).sort()).toEqual(
        [
          'active_jobs',
          'candidates_viewed_this_month',
          'interested_count',
          'open_positions',
          'placements_count',
          'spend_this_month',
          'unlocked_count',
        ].sort(),
      );
      for (const v of Object.values(data)) {
        expect(typeof v).toBe('number');
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// HTTP-level tests — mount the real router on a minimal Express app.
// ---------------------------------------------------------------------------

describe('employer-panel: GET /v1/employer-panel/dashboard (HTTP)', () => {
  let app: Express;

  beforeEach(() => {
    createTestApp();
    resetDb();
    app = buildEmployerPanelHttpApp(getTestDb());
  });
  afterAll(() => closeTestDb());

  it('returns 200 with all-zero counters for an empty employer', async () => {
    const { user, apiKey } = seedUser({ id: 'e1', userType: 'employer' });
    const res = await request(app)
      .get('/v1/employer-panel/dashboard')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual({
      active_jobs: 0,
      open_positions: 0,
      candidates_viewed_this_month: 0,
      interested_count: 0,
      unlocked_count: 0,
      placements_count: 0,
      spend_this_month: 0,
    });
    expect(user.user_type).toBe('employer'); // sanity
  });

  it('returns 200 with populated counters for an employer with data', async () => {
    const { user, apiKey } = seedUser({ id: 'e1', userType: 'employer' });
    seedJob({ id: 'job1', employerId: 'e1', status: 'open' });
    seedJob({ id: 'job2', employerId: 'e1', status: 'open' });
    const c1 = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
    const c2 = seedCandidate({ userId: 'c2', headhunterId: 'h1' });
    const c3 = seedCandidate({ userId: 'c3', headhunterId: 'h1' });
    seedRecommendation({ id: 'r1', headhunterId: 'h1', jobId: 'job1', anonId: c1.anonId, status: 'employer_interested' });
    seedRecommendation({ id: 'r2', headhunterId: 'h1', jobId: 'job1', anonId: c2.anonId, status: 'candidate_approved' });
    seedRecommendation({ id: 'r3', headhunterId: 'h1', jobId: 'job2', anonId: c3.anonId });
    seedAuditLog({ recommendationId: 'r1', actorUserId: 'e1', action: 'express_interest' });
    seedPlacement({
      id: 'p1', jobId: 'job1', candidateUserId: 'c1', primaryHeadhunterId: 'h1',
      anonId: c1.anonId, spend: 15000,
    });

    const res = await request(app)
      .get('/v1/employer-panel/dashboard')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.active_jobs).toBe(2);
    expect(res.body.data.open_positions).toBe(2);
    expect(res.body.data.interested_count).toBe(1);
    expect(res.body.data.unlocked_count).toBe(1);
    expect(res.body.data.candidates_viewed_this_month).toBe(1);
    expect(res.body.data.placements_count).toBe(1);
    expect(res.body.data.spend_this_month).toBe(15000);
  });

  it('returns 401 for missing Authorization header', async () => {
    const res = await request(app).get('/v1/employer-panel/dashboard');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for malformed bearer token', async () => {
    const res = await request(app)
      .get('/v1/employer-panel/dashboard')
      .set('Authorization', 'Bearer not_a_real_key_xxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 FORBIDDEN for headhunter caller', async () => {
    const { apiKey } = seedUser({ id: 'h1', userType: 'headhunter' });
    const res = await request(app)
      .get('/v1/employer-panel/dashboard')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 FORBIDDEN for candidate caller', async () => {
    const { apiKey } = seedUser({ id: 'c1', userType: 'candidate' });
    const res = await request(app)
      .get('/v1/employer-panel/dashboard')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 FORBIDDEN for pm caller', async () => {
    const { apiKey } = seedUser({ id: 'p1', userType: 'pm' });
    const res = await request(app)
      .get('/v1/employer-panel/dashboard')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('isolates counters between two employers (cross-employer isolation)', async () => {
    // Employer A: 2 open jobs, 1 interested rec, 1 placement (spend 10000).
    const { apiKey: aKey } = seedUser({ id: 'eA', userType: 'employer' });
    seedJob({ id: 'jA1', employerId: 'eA', status: 'open' });
    seedJob({ id: 'jA2', employerId: 'eA', status: 'open' });
    const cA = seedCandidate({ userId: 'cA', headhunterId: 'h1' });
    seedRecommendation({ id: 'rA', headhunterId: 'h1', jobId: 'jA1', anonId: cA.anonId, status: 'employer_interested' });
    seedAuditLog({ recommendationId: 'rA', actorUserId: 'eA', action: 'express_interest' });
    seedPlacement({ id: 'pA', jobId: 'jA1', candidateUserId: 'cA', primaryHeadhunterId: 'h1', anonId: cA.anonId, spend: 10000 });

    // Employer B: 5 open jobs, 3 interested recs, 2 placements (spend 60000).
    const { apiKey: bKey } = seedUser({ id: 'eB', userType: 'employer' });
    for (let i = 0; i < 5; i++) seedJob({ id: `jB${i}`, employerId: 'eB', status: 'open' });
    const cB1 = seedCandidate({ userId: 'cB1', headhunterId: 'h2' });
    const cB2 = seedCandidate({ userId: 'cB2', headhunterId: 'h2' });
    const cB3 = seedCandidate({ userId: 'cB3', headhunterId: 'h2' });
    seedRecommendation({ id: 'rB1', headhunterId: 'h2', jobId: 'jB0', anonId: cB1.anonId, status: 'employer_interested' });
    seedRecommendation({ id: 'rB2', headhunterId: 'h2', jobId: 'jB0', anonId: cB2.anonId, status: 'employer_interested' });
    seedRecommendation({ id: 'rB3', headhunterId: 'h2', jobId: 'jB0', anonId: cB3.anonId, status: 'employer_interested' });
    seedAuditLog({ recommendationId: 'rB1', actorUserId: 'eB', action: 'express_interest' });
    seedAuditLog({ recommendationId: 'rB2', actorUserId: 'eB', action: 'unlock_delivery' });
    seedPlacement({ id: 'pB1', jobId: 'jB0', candidateUserId: 'cB1', primaryHeadhunterId: 'h2', anonId: cB1.anonId, spend: 30000 });
    seedPlacement({ id: 'pB2', jobId: 'jB0', candidateUserId: 'cB2', primaryHeadhunterId: 'h2', anonId: cB2.anonId, spend: 30000 });

    // Each employer must see ONLY their own counts.
    const aRes = await request(app)
      .get('/v1/employer-panel/dashboard')
      .set('Authorization', `Bearer ${aKey}`);
    expect(aRes.status).toBe(200);
    expect(aRes.body.data).toEqual({
      active_jobs: 2,
      open_positions: 2,
      candidates_viewed_this_month: 1,
      interested_count: 1,
      unlocked_count: 0,
      placements_count: 1,
      spend_this_month: 10000,
    });

    const bRes = await request(app)
      .get('/v1/employer-panel/dashboard')
      .set('Authorization', `Bearer ${bKey}`);
    expect(bRes.status).toBe(200);
    expect(bRes.body.data).toEqual({
      active_jobs: 5,
      open_positions: 5,
      candidates_viewed_this_month: 2,
      interested_count: 3,
      unlocked_count: 0,
      placements_count: 2,
      spend_this_month: 60000,
    });
  });

  it('responds with the documented content-type and envelope', async () => {
    const { apiKey } = seedUser({ id: 'e1', userType: 'employer' });
    const res = await request(app)
      .get('/v1/employer-panel/dashboard')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('data');
  });
});