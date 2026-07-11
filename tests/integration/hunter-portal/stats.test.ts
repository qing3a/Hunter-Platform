// tests/integration/hunter-portal/stats.test.ts
//
// Integration tests for the Hunter Workspace (Phase 3a, Task 5):
//   - hunter-stats repository (getOverview, getFunnel)
//   - createHunterStats handler module (headhunter auth, pass-through scoping,
//     error semantics)
//
// Pattern follows messages.test.ts / tasks.test.ts / kanban.test.ts: seed users
// + recommendations directly via SQL on the shared `getTestDb()`, then call
// `createHunterStats(db).<method>(user, ...)` directly (HTTP routes are wired
// in Task 7).
//
// Onboard-date semantics:
//   - `onboards_this_month` uses `recommendations.updated_at >= <start of
//     current month>` because the schema has no dedicated `placed_at` column,
//     and updated_at is bumped on every pipeline_state transition. We seed
//     recs with chosen updated_at values to test the boundary deterministically.
//
// Funnel: empty-data choice.
//   When every stage count is 0 (no recs at all), we chose
//   `conversion_from_prev = 1.0` for every row. Rationale: matches the
//   "first stage always = 1.0" rule and reads cleanly to clients — a zero
//   ratio is harder to render in a funnel chart. Non-first stages with
//   count>0 fall through to the normal `count / prev_count` rule.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  getTestDb,
} from '../../helpers/test-app.js';
import { createHunterStats } from '../../../src/main/modules/headhunter/stats.js';
import { ApiError } from '../../../src/main/errors.js';
import type { User } from '../../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function seedUser(opts: {
  id: string;
  userType: 'hr' | 'candidate' | 'pm';
  name?: string;
}): User {
  const db = getTestDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, user_type, name, contact, agent_endpoint,
                       api_key_hash, api_key_prefix, api_key_expires_at,
                       prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
                       quota_per_day, quota_used, quota_reset_at, reputation,
                       status, created_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL,
            ?, 'hp_prefix_hx', NULL,
            NULL, NULL, NULL,
            200, 0, ?, 50,
            'active', ?, ?)
  `).run(
    opts.id,
    opts.userType,
    opts.name ?? `Test ${opts.userType}`,
    `hash_${opts.id}`,
    now,
    now,
    now,
  );
  return {
    id: opts.id,
    user_type: opts.userType,
    name: opts.name ?? `Test ${opts.userType}`,
    contact: null,
    agent_endpoint: null,
    api_key_hash: `hash_${opts.id}`,
    api_key_prefix: 'hp_prefix_hx',
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
  };
}

/** Seed an employer + claimed job (employer_id NOT NULL). */
function seedJob(opts: { id: string; employerId?: string }): string {
  const db = getTestDb();
  const employerId = opts.employerId ?? `emp_${opts.id}`;
  seedUser({ id: employerId, userType: 'pm' });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO jobs (id, employer_id, source_headhunter_id, created_for_employer_id,
                      title, description, requirements, salary_min, salary_max,
                      status, priority, deadline, industry, required_skills_json,
                      created_at, updated_at)
    VALUES (?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL,
            'open', 'normal', NULL, NULL, NULL,
            ?, ?)
  `).run(opts.id, employerId, 'Senior Engineer', now, now);
  return employerId;
}

/** Seed candidates_private + candidates_anonymized (FK chain for rec). */
function seedCandidate(opts: {
  userId: string;
  headhunterId: string;
  anonId?: string;
  privateId?: string;
}): { anonId: string; privateId: string } {
  const db = getTestDb();
  const anonId = opts.anonId ?? `ca_${opts.userId}`;
  const privateId = opts.privateId ?? `cp_${opts.userId}`;
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
  pipelineStage?: 'submitted' | 'screen_passed' | 'interview' | 'offer' | 'onboarded' | 'rejected';
  pickupHeadhunterId?: string | null;
  /** unix ms */
  createdAt?: number;
  /** unix ms */
  updatedAt?: number;
}

/** Seed a recommendation directly via SQL. */
function seedRecommendation(opts: SeedRecOpts): void {
  const db = getTestDb();
  const employerIdRow = db.prepare('SELECT employer_id FROM jobs WHERE id = ?').get(opts.jobId) as
    | { employer_id: string }
    | undefined;
  if (!employerIdRow) throw new Error(`job not found: ${opts.jobId}`);
  const nowIso = new Date().toISOString();
  const createdIso =
    opts.createdAt !== undefined ? new Date(opts.createdAt).toISOString() : nowIso;
  const updatedIso =
    opts.updatedAt !== undefined ? new Date(opts.updatedAt).toISOString() : nowIso;
  db.prepare(`
    INSERT INTO recommendations (id, headhunter_id, employer_id, anonymized_candidate_id,
                                 job_id, status, source_type, commission_split_json,
                                 referrer_headhunter_id, pickup_headhunter_id, candidate_note,
                                 pipeline_stage, kanban_position,
                                 created_at, updated_at)
    VALUES (?, ?, ?, ?, ?,
            ?, 'hr', NULL,
            NULL, ?, NULL,
            ?, NULL,
            ?, ?)
  `).run(
    opts.id,
    opts.headhunterId,
    employerIdRow.employer_id,
    opts.anonId,
    opts.jobId,
    opts.status ?? 'pending',
    opts.pickupHeadhunterId ?? null,
    opts.pipelineStage ?? 'submitted',
    createdIso,
    updatedIso,
  );
}

function expectErrorCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiError) {
      expect(e.code).toBe(code);
      return;
    }
    throw e;
  }
  throw new Error(`Expected function to throw an ApiError with code ${code}, but it did not throw`);
}

/**
 * The unix-ms timestamp at the start of the current month (local time).
 * Used to construct onboards-this-month tests deterministically.
 */
function startOfThisMonthMs(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
}

/** A time well inside last calendar month — used to seed "stale" onboarded recs. */
function lastMonthMs(): number {
  const now = new Date();
  // 15 days ago lands safely inside the previous month unless we're on day 1;
  // use the 1st of last month to guarantee cross-month.
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12, 0, 0, 0);
  return d.getTime();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hunter-portal: stats (handler + repo integration)', () => {
  beforeEach(() => {
    createTestApp();
    resetDb();
  });
  afterAll(() => closeTestDb());

  // -------- getOverview ----------

  describe('overview', () => {
    it('returns all-zero counts when the hunter has no recommendations', () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const ov = createHunterStats(getTestDb()).overview(hunter);
      expect(ov.active_recommendations).toBe(0);
      expect(ov.placements_count).toBe(0);
      expect(ov.onboards_this_month).toBe(0);
      expect(ov.pending_pickup_count).toBe(0);
      expect(ov.conversion_rate).toBe(0);
    });

    it('sums up active / placed / rejected counts across mixed recs', () => {
      const h1 = seedUser({ id: 'h1', userType: 'hr' });
      seedJob({ id: 'job1' });
      seedJob({ id: 'job2' });
      // Each rec gets its own (anonId, jobId) pair to satisfy the
      // UNIQUE(anonymized_candidate_id, job_id) constraint.
      const cs = Array.from({ length: 7 }, (_, i) =>
        seedCandidate({ userId: `c${i}`, headhunterId: 'h1' }),
      );
      // 5 recs in active stages (still in the funnel) — distinct jobs
      seedRecommendation({ id: 'r1', headhunterId: 'h1', jobId: 'job1', anonId: cs[0]!.anonId, pipelineStage: 'submitted' });
      seedRecommendation({ id: 'r2', headhunterId: 'h1', jobId: 'job1', anonId: cs[1]!.anonId, pipelineStage: 'submitted' });
      seedRecommendation({ id: 'r3', headhunterId: 'h1', jobId: 'job1', anonId: cs[2]!.anonId, pipelineStage: 'screen_passed' });
      seedRecommendation({ id: 'r4', headhunterId: 'h1', jobId: 'job1', anonId: cs[3]!.anonId, pipelineStage: 'interview' });
      seedRecommendation({ id: 'r5', headhunterId: 'h1', jobId: 'job1', anonId: cs[4]!.anonId, pipelineStage: 'offer' });
      // 1 placed (we use status='placed' as the canonical "placed" signal) — different job
      seedRecommendation({
        id: 'r_placed', headhunterId: 'h1', jobId: 'job2', anonId: cs[5]!.anonId,
        status: 'placed', pipelineStage: 'onboarded',
      });
      // 1 rejected (terminal) — different job again
      seedRecommendation({
        id: 'r_rej', headhunterId: 'h1', jobId: 'job2', anonId: cs[6]!.anonId,
        status: 'rejected_employer', pipelineStage: 'rejected',
      });

      const ov = createHunterStats(getTestDb()).overview(h1);
      // active excludes terminal onboarded + rejected.
      expect(ov.active_recommendations).toBe(5);
      // placements: status='placed' on this hunter.
      expect(ov.placements_count).toBe(1);
      // onboards_this_month: the placed rec's updated_at is "now".
      expect(ov.onboards_this_month).toBe(1);
      // conversion_rate: 1 placed / 7 recs total (5 active + 1 placed + 1 rejected).
      // 1 / 7 = 0.142857... rounded to 2 dp = 0.14.
      expect(ov.conversion_rate).toBe(0.14);
    });

    it('active_recommendations excludes the terminal stages onboarded + rejected', () => {
      const h1 = seedUser({ id: 'h1', userType: 'hr' });
      seedJob({ id: 'job1' });
      seedJob({ id: 'job2' });
      // 6 distinct (anonId, jobId) pairs to satisfy the UNIQUE constraint.
      const cs = Array.from({ length: 6 }, (_, i) =>
        seedCandidate({ userId: `c${i}`, headhunterId: 'h1' }),
      );
      seedRecommendation({ id: 'r_sub', headhunterId: 'h1', jobId: 'job1', anonId: cs[0]!.anonId, pipelineStage: 'submitted' });
      seedRecommendation({ id: 'r_scr', headhunterId: 'h1', jobId: 'job1', anonId: cs[1]!.anonId, pipelineStage: 'screen_passed' });
      seedRecommendation({ id: 'r_int', headhunterId: 'h1', jobId: 'job1', anonId: cs[2]!.anonId, pipelineStage: 'interview' });
      seedRecommendation({ id: 'r_off', headhunterId: 'h1', jobId: 'job1', anonId: cs[3]!.anonId, pipelineStage: 'offer' });
      // 2 terminal — neither should be counted in active_recommendations.
      // Use distinct jobs so the UNIQUE(anonymized_candidate_id, job_id)
      // constraint doesn't trip.
      seedRecommendation({ id: 'r_obo', headhunterId: 'h1', jobId: 'job2', anonId: cs[4]!.anonId, pipelineStage: 'onboarded' });
      seedRecommendation({ id: 'r_rej', headhunterId: 'h1', jobId: 'job2', anonId: cs[5]!.anonId, pipelineStage: 'rejected' });

      const ov = createHunterStats(getTestDb()).overview(h1);
      expect(ov.active_recommendations).toBe(4); // 4 active stages only
    });

    it('onboards_this_month only counts recs whose updated_at is in this calendar month', () => {
      const h1 = seedUser({ id: 'h1', userType: 'hr' });
      seedJob({ id: 'job1' });
      const cs = Array.from({ length: 4 }, (_, i) =>
        seedCandidate({ userId: `c${i}`, headhunterId: 'h1' }),
      );
      // 1 onboarded last month
      seedRecommendation({
        id: 'r_old', headhunterId: 'h1', jobId: 'job1', anonId: cs[0]!.anonId,
        pipelineStage: 'onboarded', updatedAt: lastMonthMs(),
      });
      // 1 onboarded this month
      seedRecommendation({
        id: 'r_new', headhunterId: 'h1', jobId: 'job1', anonId: cs[1]!.anonId,
        pipelineStage: 'onboarded', updatedAt: Date.now(),
      });
      // 1 active this month — must NOT count toward onboards_this_month
      seedRecommendation({
        id: 'r_active', headhunterId: 'h1', jobId: 'job1', anonId: cs[2]!.anonId,
        pipelineStage: 'interview', updatedAt: Date.now(),
      });
      // 1 rejected this month — must NOT count toward onboards_this_month
      seedRecommendation({
        id: 'r_rej', headhunterId: 'h1', jobId: 'job1', anonId: cs[3]!.anonId,
        pipelineStage: 'rejected', updatedAt: Date.now(),
      });

      const ov = createHunterStats(getTestDb()).overview(h1);
      expect(ov.onboards_this_month).toBe(1);
      // sanity-check: start-of-this-month is a real value, not garbage.
      expect(startOfThisMonthMs()).toBeGreaterThan(0);
    });

    it('conversion_rate is placements / total_recs, 2-dp rounded, 0 when total=0', () => {
      const h1 = seedUser({ id: 'h1', userType: 'hr' });
      seedJob({ id: 'job1' });
      // No recs yet — conversion is 0.
      expect(createHunterStats(getTestDb()).overview(h1).conversion_rate).toBe(0);

      const cs = Array.from({ length: 10 }, (_, i) =>
        seedCandidate({ userId: `c${i}`, headhunterId: 'h1' }),
      );
      // 7 active, 3 placed (status=placed). Total=10, placed=3 → 0.30.
      for (let i = 0; i < 7; i++) {
        seedRecommendation({
          id: `r_a${i}`, headhunterId: 'h1', jobId: 'job1', anonId: cs[i]!.anonId,
          pipelineStage: i % 2 === 0 ? 'submitted' : 'screen_passed',
        });
      }
      for (let i = 0; i < 3; i++) {
        seedRecommendation({
          id: `r_p${i}`, headhunterId: 'h1', jobId: 'job1', anonId: cs[7 + i]!.anonId,
          status: 'placed', pipelineStage: 'onboarded',
        });
      }

      const ov = createHunterStats(getTestDb()).overview(h1);
      expect(ov.placements_count).toBe(3);
      expect(ov.conversion_rate).toBe(0.30); // 3 / 10
    });

    it('pending_pickup_count is hunter-agnostic (counts unclaimed recs across all hunters)', () => {
      const h1 = seedUser({ id: 'h1', userType: 'hr' });
      const h2 = seedUser({ id: 'h2', userType: 'hr' });
      seedJob({ id: 'job1' });
      const c1 = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      const c2 = seedCandidate({ userId: 'c2', headhunterId: 'h2' });
      // 1 unclaimed pending_pickup (headhunter_id NULL) — counted globally
      seedRecommendation({
        id: 'r_pickup_unclaimed', headhunterId: null, jobId: 'job1', anonId: c1.anonId,
        status: 'pending_pickup', pipelineStage: 'submitted',
      });
      // 1 already-claimed pending_pickup — NOT counted (pickup_headhunter_id is set)
      seedRecommendation({
        id: 'r_pickup_claimed', headhunterId: 'h2', jobId: 'job1', anonId: c2.anonId,
        status: 'pending_pickup', pipelineStage: 'submitted',
        pickupHeadhunterId: 'h2',
      });

      const ov = createHunterStats(getTestDb()).overview(h1);
      // Both callers see the same global pending_pickup_count.
      expect(ov.pending_pickup_count).toBe(1);
      // Sanity: same number for h2.
      const ov2 = createHunterStats(getTestDb()).overview(h2);
      expect(ov2.pending_pickup_count).toBe(1);
    });
  });

  // -------- getFunnel ----------

  describe('funnel', () => {
    it('returns zero counts + 1.0 conversions for the first stage when there are no recs', () => {
      const h1 = seedUser({ id: 'h1', userType: 'hr' });
      const funnel = createHunterStats(getTestDb()).funnel(h1);
      // Always 5 stages in submitted → onboarded order.
      expect(funnel.map((s) => s.stage)).toEqual([
        'submitted',
        'screen_passed',
        'interview',
        'offer',
        'onboarded',
      ]);
      expect(funnel.every((s) => s.count === 0)).toBe(true);
      // All-zero choice: conversion_from_prev = 1.0 for every row.
      // See file-header comment for rationale.
      expect(funnel.every((s) => s.conversion_from_prev === 1)).toBe(true);
    });

    it('computes counts and conversion ratios across mixed recs', () => {
      const h1 = seedUser({ id: 'h1', userType: 'hr' });
      // We need 20 + 10 + 5 + 2 + 1 = 38 distinct (anonId, jobId) pairs.
      // Use one job per rec to keep this simple and the seed readable.
      const cs = Array.from({ length: 38 }, (_, i) =>
        seedCandidate({ userId: `c${i}`, headhunterId: 'h1' }),
      );
      // Distribution: 20 submitted, 10 screen_passed, 5 interview, 2 offer, 1 onboarded
      for (let i = 0; i < 20; i++) {
        seedJob({ id: `job_sub_${i}` });
        seedRecommendation({
          id: `r_sub_${i}`, headhunterId: 'h1', jobId: `job_sub_${i}`, anonId: cs[i]!.anonId,
          pipelineStage: 'submitted',
        });
      }
      for (let i = 0; i < 10; i++) {
        seedJob({ id: `job_scr_${i}` });
        seedRecommendation({
          id: `r_scr_${i}`, headhunterId: 'h1', jobId: `job_scr_${i}`, anonId: cs[20 + i]!.anonId,
          pipelineStage: 'screen_passed',
        });
      }
      for (let i = 0; i < 5; i++) {
        seedJob({ id: `job_int_${i}` });
        seedRecommendation({
          id: `r_int_${i}`, headhunterId: 'h1', jobId: `job_int_${i}`, anonId: cs[30 + i]!.anonId,
          pipelineStage: 'interview',
        });
      }
      for (let i = 0; i < 2; i++) {
        seedJob({ id: `job_off_${i}` });
        seedRecommendation({
          id: `r_off_${i}`, headhunterId: 'h1', jobId: `job_off_${i}`, anonId: cs[35 + i]!.anonId,
          pipelineStage: 'offer',
        });
      }
      seedJob({ id: 'job_obo_1' });
      seedRecommendation({
        id: 'r_obo_1', headhunterId: 'h1', jobId: 'job_obo_1', anonId: cs[37]!.anonId,
        pipelineStage: 'onboarded',
      });

      const funnel = createHunterStats(getTestDb()).funnel(h1);

      // 20 → 10 → 5 → 2 → 1
      // Ratios: 1.0, 0.5, 0.5, 0.4, 0.5
      const byStage = Object.fromEntries(funnel.map((s) => [s.stage, s]));
      expect(byStage.submitted!.count).toBe(20);
      expect(byStage.submitted!.conversion_from_prev).toBe(1);
      expect(byStage.screen_passed!.count).toBe(10);
      expect(byStage.screen_passed!.conversion_from_prev).toBe(0.5);
      expect(byStage.interview!.count).toBe(5);
      expect(byStage.interview!.conversion_from_prev).toBe(0.5);
      expect(byStage.offer!.count).toBe(2);
      expect(byStage.offer!.conversion_from_prev).toBeCloseTo(2 / 5, 5);
      expect(byStage.onboarded!.count).toBe(1);
      expect(byStage.onboarded!.conversion_from_prev).toBe(0.5);
    });

    it('respects the date range — counts only recs with created_at in [from, to]', () => {
      const h1 = seedUser({ id: 'h1', userType: 'hr' });
      seedJob({ id: 'job1' });
      const cs = Array.from({ length: 4 }, (_, i) =>
        seedCandidate({ userId: `c${i}`, headhunterId: 'h1' }),
      );
      const day = 86_400_000;
      const t0 = 1_700_000_000_000; // some fixed anchor in Nov 2023
      // 4 submitted recs spread across days 0..3
      seedRecommendation({
        id: 'r_d0', headhunterId: 'h1', jobId: 'job1', anonId: cs[0]!.anonId,
        pipelineStage: 'submitted', createdAt: t0,
      });
      seedRecommendation({
        id: 'r_d1', headhunterId: 'h1', jobId: 'job1', anonId: cs[1]!.anonId,
        pipelineStage: 'submitted', createdAt: t0 + 1 * day,
      });
      seedRecommendation({
        id: 'r_d2', headhunterId: 'h1', jobId: 'job1', anonId: cs[2]!.anonId,
        pipelineStage: 'submitted', createdAt: t0 + 2 * day,
      });
      seedRecommendation({
        id: 'r_d3', headhunterId: 'h1', jobId: 'job1', anonId: cs[3]!.anonId,
        pipelineStage: 'submitted', createdAt: t0 + 3 * day,
      });

      // Range [d1, d2] inclusive → expect 2 submitted.
      const funnel = createHunterStats(getTestDb()).funnel(h1, {
        from: t0 + 1 * day,
        to: t0 + 2 * day,
      });
      const submitted = funnel.find((s) => s.stage === 'submitted')!;
      expect(submitted.count).toBe(2);

      // Wide-open range → all 4.
      const funnelAll = createHunterStats(getTestDb()).funnel(h1, { from: 0, to: t0 + 10 * day });
      expect(funnelAll.find((s) => s.stage === 'submitted')!.count).toBe(4);

      // Range entirely in the past → 0 across all stages.
      const funnelPast = createHunterStats(getTestDb()).funnel(h1, {
        from: t0 - 100 * day,
        to: t0 - 1 * day,
      });
      for (const s of funnelPast) {
        expect(s.count).toBe(0);
      }
    });

    it('funnel ordering is always submitted → screen_passed → interview → offer → onboarded', () => {
      const h1 = seedUser({ id: 'h1', userType: 'hr' });
      const funnel = createHunterStats(getTestDb()).funnel(h1);
      expect(funnel.map((s) => s.stage)).toEqual([
        'submitted',
        'screen_passed',
        'interview',
        'offer',
        'onboarded',
      ]);
    });
  });

  // -------- auth ----------

  describe('auth', () => {
    it('rejects non-headhunter callers with FORBIDDEN on overview + funnel', () => {
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const employer = seedUser({ id: 'e1', userType: 'pm' });
      const stats = createHunterStats(getTestDb());
      expectErrorCode(() => stats.overview(candidate), 'FORBIDDEN');
      expectErrorCode(() => stats.overview(employer), 'FORBIDDEN');
      expectErrorCode(() => stats.funnel(candidate), 'FORBIDDEN');
      expectErrorCode(() => stats.funnel(employer), 'FORBIDDEN');
    });

    it('allows headhunter callers (no FORBIDDEN thrown)', () => {
      const h1 = seedUser({ id: 'h1', userType: 'hr' });
      const stats = createHunterStats(getTestDb());
      expect(() => stats.overview(h1)).not.toThrow();
      expect(() => stats.funnel(h1)).not.toThrow();
    });
  });
});
