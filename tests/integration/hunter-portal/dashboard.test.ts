// tests/integration/hunter-portal/dashboard.test.ts
//
// Integration tests for the Hunter Workspace (Phase 3a, Task 6):
//   - createHunterDashboard handler module (composition of stats + tasks +
//     kanban + recommendations into a single HunterWorkspacePage payload)
//
// The dashboard has NO new tables / repos. It composes four existing
// pieces (stats, tasks, kanban, raw recommendations SQL) into one payload
// for the workspace page. These tests cover:
//   - Empty dashboard: zero KPIs, empty top_tasks, kanban_summary with
//     5 zero-count entries, empty recent_recommendations
//   - Populated dashboard: counts add up, top_tasks ordered by
//     due_at ASC NULLS LAST (≤5), kanban_summary has 5 entries with the
//     correct per-stage counts, recent_recommendations has ≤5 most recent
//   - Filter semantics:
//       - top_tasks: only `status='pending'` rows; completed tasks are
//         excluded
//       - recent_recommendations: only non-rejected recs; rejected recs
//         are excluded
//   - Authorization: non-headhunter callers get FORBIDDEN
//
// Pattern mirrors tasks.test.ts / stats.test.ts / kanban.test.ts: seed
// users + recommendations + tasks directly via SQL on the shared
// `getTestDb()`, then call `createHunterDashboard(db).getDashboard(user)`
// directly (HTTP routes are wired in Task 7).
//
// candidate_name: we use `users.name` (plaintext) and pass it through
// `maskName` to produce the desensitized form (e.g. '张三' → '张*',
// 'Alice' → 'A***ce'). The dashboard module does NOT need the encryption
// key — it never decrypts PII, just masks whatever name is on the user
// row. This is GDPR-safe: a user who has cleared their name (v008) shows
// up as `null` and is rendered as "—" by the workspace page.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  getTestDb,
} from '../../helpers/test-app.js';
import { createHunterDashboard } from '../../../src/main/modules/headhunter/dashboard.js';
import { ApiError } from '../../../src/main/errors.js';
import { maskName } from '../../../src/main/lib/mask.js';
import type { User } from '../../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function seedUser(opts: {
  id: string;
  userType: 'headhunter' | 'candidate' | 'employer';
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

/** Seed an employer + claimed job. */
function seedJob(opts: {
  id: string;
  employerId?: string;
  title?: string;
}): string {
  const db = getTestDb();
  const employerId = opts.employerId ?? `emp_${opts.id}`;
  seedUser({ id: employerId, userType: 'employer' });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO jobs (id, employer_id, title, description, requirements,
                      salary_min, salary_max, status, priority, deadline, industry,
                      required_skills_json, created_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL,
            NULL, NULL, 'open', 'normal', NULL, NULL,
            NULL, ?, ?)
  `).run(opts.id, employerId, opts.title ?? 'Senior Engineer', now, now);
  return employerId;
}

/**
 * Seed a candidate (user + private + anonymized) so a recommendation can
 * reference it via the FK chain. Optionally set the user-visible `name`
 * (used for masked display in recent_recommendations).
 */
function seedCandidate(opts: {
  userId: string;
  headhunterId: string;
  name?: string;
}): { anonId: string; privateId: string } {
  const db = getTestDb();
  const anonId = `ca_${opts.userId}`;
  const privateId = `cp_${opts.userId}`;
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
            ?, 'headhunter', NULL,
            NULL, NULL, NULL,
            ?, NULL,
            ?, ?)
  `).run(
    opts.id,
    opts.headhunterId,
    employerIdRow.employer_id,
    opts.anonId,
    opts.jobId,
    opts.status ?? 'pending',
    opts.pipelineStage ?? 'submitted',
    createdIso,
    updatedIso,
  );
}

/** Seed a hunter_task row directly via SQL. */
function seedTask(opts: {
  id: string;
  hunterId: string;
  title?: string;
  dueAt?: number | null;
  completedAt?: number | null;
  /** unix ms */
  createdAt?: number;
}): void {
  const db = getTestDb();
  const now = Date.now();
  const createdAt = opts.createdAt ?? now;
  db.prepare(`
    INSERT INTO hunter_tasks (id, hunter_user_id, title, description,
                              related_recommendation_id, related_candidate_user_id,
                              due_at, completed_at, priority,
                              created_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, 'normal', ?, ?)
  `).run(
    opts.id,
    opts.hunterId,
    opts.title ?? 'task',
    opts.dueAt ?? null,
    opts.completedAt ?? null,
    createdAt,
    now,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hunter-portal: dashboard (handler integration)', () => {
  beforeEach(() => {
    createTestApp();
    resetDb();
  });
  afterAll(() => closeTestDb());

  // -------- empty dashboard ----------

  describe('empty dashboard', () => {
    it('returns all-zero KPI, empty top_tasks, 5 zero-count kanban entries, empty recent_recs', () => {
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      const dash = createHunterDashboard(getTestDb()).getDashboard(hunter);

      // KPI — every field zero.
      expect(dash.kpi.onboards_this_month).toBe(0);
      expect(dash.kpi.active_recommendations).toBe(0);
      expect(dash.kpi.placements_count).toBe(0);
      expect(dash.kpi.pending_pickup_count).toBe(0);
      expect(dash.kpi.conversion_rate).toBe(0);

      // top_tasks: empty.
      expect(dash.top_tasks).toEqual([]);

      // kanban_summary: 5 entries, one per non-terminal stage, all 0.
      expect(dash.kanban_summary).toHaveLength(5);
      expect(dash.kanban_summary.map((s) => s.stage)).toEqual([
        'submitted',
        'screen_passed',
        'interview',
        'offer',
        'onboarded',
      ]);
      expect(dash.kanban_summary.every((s) => s.count === 0)).toBe(true);

      // recent_recommendations: empty.
      expect(dash.recent_recommendations).toEqual([]);
    });
  });

  // -------- populated dashboard ----------

  describe('populated dashboard', () => {
    it('sums up KPI counts across mixed recs', () => {
      const h1 = seedUser({ id: 'h1', userType: 'headhunter' });
      seedJob({ id: 'job1' });
      seedJob({ id: 'job2' });
      const cs = Array.from({ length: 7 }, (_, i) =>
        seedCandidate({ userId: `c${i}`, headhunterId: 'h1' }),
      );
      // 5 active + 1 placed + 1 rejected (mirrors stats.test.ts shape)
      seedRecommendation({ id: 'r1', headhunterId: 'h1', jobId: 'job1', anonId: cs[0]!.anonId, pipelineStage: 'submitted' });
      seedRecommendation({ id: 'r2', headhunterId: 'h1', jobId: 'job1', anonId: cs[1]!.anonId, pipelineStage: 'submitted' });
      seedRecommendation({ id: 'r3', headhunterId: 'h1', jobId: 'job1', anonId: cs[2]!.anonId, pipelineStage: 'screen_passed' });
      seedRecommendation({ id: 'r4', headhunterId: 'h1', jobId: 'job1', anonId: cs[3]!.anonId, pipelineStage: 'interview' });
      seedRecommendation({ id: 'r5', headhunterId: 'h1', jobId: 'job1', anonId: cs[4]!.anonId, pipelineStage: 'offer' });
      seedRecommendation({
        id: 'r_placed', headhunterId: 'h1', jobId: 'job2', anonId: cs[5]!.anonId,
        status: 'placed', pipelineStage: 'onboarded',
      });
      seedRecommendation({
        id: 'r_rej', headhunterId: 'h1', jobId: 'job2', anonId: cs[6]!.anonId,
        status: 'rejected_employer', pipelineStage: 'rejected',
      });

      const dash = createHunterDashboard(getTestDb()).getDashboard(h1);
      expect(dash.kpi.active_recommendations).toBe(5);
      expect(dash.kpi.placements_count).toBe(1);
      expect(dash.kpi.onboards_this_month).toBe(1);
      // 1/7 = 0.14 (2-dp rounded)
      expect(dash.kpi.conversion_rate).toBe(0.14);
    });

    it('kanban_summary: one entry per non-terminal stage with the correct card count', () => {
      const h1 = seedUser({ id: 'h1', userType: 'headhunter' });
      // Touch getBoard() at least once (via dashboard or directly) to seed
      // the 5 default columns. The dashboard impl calls seedDefaultColumns
      // internally so this isn't required, but seed via kanban repo to be
      // explicit. We can rely on the dashboard handler to do it though —
      // see kanban.test.ts "first call seeds the 5 default columns".
      seedJob({ id: 'job1' });
      seedJob({ id: 'job2' });
      seedJob({ id: 'job3' });
      seedJob({ id: 'job4' });
      const cs = Array.from({ length: 6 }, (_, i) =>
        seedCandidate({ userId: `c${i}`, headhunterId: 'h1' }),
      );
      // Distribution: 2 submitted, 1 screen_passed, 1 interview, 1 offer, 1 onboarded
      seedRecommendation({ id: 'r1', headhunterId: 'h1', jobId: 'job1', anonId: cs[0]!.anonId, pipelineStage: 'submitted' });
      seedRecommendation({ id: 'r2', headhunterId: 'h1', jobId: 'job2', anonId: cs[1]!.anonId, pipelineStage: 'submitted' });
      seedRecommendation({ id: 'r3', headhunterId: 'h1', jobId: 'job3', anonId: cs[2]!.anonId, pipelineStage: 'screen_passed' });
      seedRecommendation({ id: 'r4', headhunterId: 'h1', jobId: 'job4', anonId: cs[3]!.anonId, pipelineStage: 'interview' });
      seedRecommendation({
        id: 'r5', headhunterId: 'h1', jobId: 'job1', anonId: cs[4]!.anonId,
        status: 'placed', pipelineStage: 'offer',
      });
      seedRecommendation({
        id: 'r6', headhunterId: 'h1', jobId: 'job2', anonId: cs[5]!.anonId,
        status: 'placed', pipelineStage: 'onboarded',
      });

      const dash = createHunterDashboard(getTestDb()).getDashboard(h1);
      const byStage = Object.fromEntries(dash.kanban_summary.map((s) => [s.stage, s.count]));
      expect(byStage.submitted).toBe(2);
      expect(byStage.screen_passed).toBe(1);
      expect(byStage.interview).toBe(1);
      expect(byStage.offer).toBe(1);
      expect(byStage.onboarded).toBe(1);
    });

    it('top_tasks: returns at most 5 pending tasks ordered by due_at ASC NULLS LAST', () => {
      const h1 = seedUser({ id: 'h1', userType: 'headhunter' });
      // 7 pending tasks + 2 completed. Seeded in mixed order to exercise
      // the sort (no due_at, due_at=tomorrow, due_at=next-week, etc.)
      const now = Date.now();
      const day = 86_400_000;
      seedTask({ id: 't_nodue', hunterId: 'h1', title: 'no due date' });
      seedTask({ id: 't_due1d', hunterId: 'h1', title: 'due in 1d', dueAt: now + 1 * day });
      seedTask({ id: 't_due7d', hunterId: 'h1', title: 'due in 7d', dueAt: now + 7 * day });
      seedTask({ id: 't_due2d', hunterId: 'h1', title: 'due in 2d', dueAt: now + 2 * day });
      seedTask({ id: 't_due3d', hunterId: 'h1', title: 'due in 3d', dueAt: now + 3 * day });
      seedTask({ id: 't_due4d', hunterId: 'h1', title: 'due in 4d', dueAt: now + 4 * day });
      seedTask({ id: 't_due5d', hunterId: 'h1', title: 'due in 5d', dueAt: now + 5 * day });
      // completed — must NOT appear in top_tasks
      seedTask({ id: 't_done', hunterId: 'h1', title: 'done', completedAt: now });

      const dash = createHunterDashboard(getTestDb()).getDashboard(h1);
      // Capped at 5.
      expect(dash.top_tasks).toHaveLength(5);
      // Sorted by due_at ASC NULLS LAST. The 5 with due_at are 1d, 2d, 3d, 4d, 5d.
      // The 7d + no-due fall off the end (NULLS LAST) — only the first 5 with
      // due_at fit in the limit.
      expect(dash.top_tasks.map((t) => t.id)).toEqual([
        't_due1d', 't_due2d', 't_due3d', 't_due4d', 't_due5d',
      ]);
      // None of the 5 returned are completed.
      for (const t of dash.top_tasks) {
        expect(t.completed_at).toBeNull();
      }
    });

    it('top_tasks: when tasks have no due_at, they sort by created_at DESC, then by the NULLS-LAST tiebreak', () => {
      const h1 = seedUser({ id: 'h1', userType: 'headhunter' });
      const seedAt = (suffix: string, now: number) =>
        seedTask({ id: `t_${suffix}`, hunterId: 'h1', createdAt: now });
      const base = Date.now();
      seedAt('oldest', base);
      seedAt('middle', base + 100);
      seedAt('newest', base + 200);
      const dash = createHunterDashboard(getTestDb()).getDashboard(h1);
      // All 3 are pending (no due_at), order is created_at DESC.
      expect(dash.top_tasks.map((t) => t.id)).toEqual(['t_newest', 't_middle', 't_oldest']);
    });

    it('recent_recommendations: at most 5 most-recent non-rejected, ordered by updated_at DESC', () => {
      const h1 = seedUser({ id: 'h1', userType: 'headhunter' });
      const now = Date.now();
      const day = 86_400_000;
      seedJob({ id: 'job1' });
      seedJob({ id: 'job2' });
      seedJob({ id: 'job3' });
      seedJob({ id: 'job4' });
      seedJob({ id: 'job5' });
      seedJob({ id: 'job6' });
      seedJob({ id: 'job7' });
      const cs = Array.from({ length: 7 }, (_, i) =>
        seedCandidate({ userId: `c${i}`, headhunterId: 'h1' }),
      );
      // 7 recs spread across last 7 days. The 5 most recent should appear.
      seedRecommendation({ id: 'r_d6', headhunterId: 'h1', jobId: 'job1', anonId: cs[0]!.anonId, pipelineStage: 'submitted', updatedAt: now - 6 * day });
      seedRecommendation({ id: 'r_d5', headhunterId: 'h1', jobId: 'job2', anonId: cs[1]!.anonId, pipelineStage: 'submitted', updatedAt: now - 5 * day });
      seedRecommendation({ id: 'r_d4', headhunterId: 'h1', jobId: 'job3', anonId: cs[2]!.anonId, pipelineStage: 'screen_passed', updatedAt: now - 4 * day });
      seedRecommendation({ id: 'r_d3', headhunterId: 'h1', jobId: 'job4', anonId: cs[3]!.anonId, pipelineStage: 'interview', updatedAt: now - 3 * day });
      seedRecommendation({ id: 'r_d2', headhunterId: 'h1', jobId: 'job5', anonId: cs[4]!.anonId, pipelineStage: 'offer', updatedAt: now - 2 * day });
      seedRecommendation({ id: 'r_d1', headhunterId: 'h1', jobId: 'job6', anonId: cs[5]!.anonId, pipelineStage: 'onboarded', updatedAt: now - 1 * day });
      // r_d0 is most recent — must appear in top 5.
      seedRecommendation({ id: 'r_d0', headhunterId: 'h1', jobId: 'job7', anonId: cs[6]!.anonId, pipelineStage: 'submitted', updatedAt: now });

      const dash = createHunterDashboard(getTestDb()).getDashboard(h1);
      // Capped at 5.
      expect(dash.recent_recommendations).toHaveLength(5);
      // Ordered most-recent first: d0, d1, d2, d3, d4. (d5, d6 fall off.)
      expect(dash.recent_recommendations.map((r) => r.recommendation_id)).toEqual([
        'r_d0', 'r_d1', 'r_d2', 'r_d3', 'r_d4',
      ]);
    });

    it('recent_recommendations: candidate_name is the desensitized (masked) user name', () => {
      const h1 = seedUser({ id: 'h1', userType: 'headhunter' });
      seedJob({ id: 'job1' });
      const c1 = seedCandidate({ userId: 'c1', headhunterId: 'h1', name: '张三' });
      const c2 = seedCandidate({ userId: 'c2', headhunterId: 'h1', name: 'Alice' });
      const c3 = seedCandidate({ userId: 'c3', headhunterId: 'h1', name: 'Bo' });
      seedRecommendation({ id: 'r1', headhunterId: 'h1', jobId: 'job1', anonId: c1.anonId, pipelineStage: 'submitted' });
      seedRecommendation({ id: 'r2', headhunterId: 'h1', jobId: 'job1', anonId: c2.anonId, pipelineStage: 'screen_passed' });
      seedRecommendation({ id: 'r3', headhunterId: 'h1', jobId: 'job1', anonId: c3.anonId, pipelineStage: 'interview' });

      const dash = createHunterDashboard(getTestDb()).getDashboard(h1);
      const r1 = dash.recent_recommendations.find((r) => r.recommendation_id === 'r1')!;
      const r2 = dash.recent_recommendations.find((r) => r.recommendation_id === 'r2')!;
      const r3 = dash.recent_recommendations.find((r) => r.recommendation_id === 'r3')!;
      expect(r1.candidate_name).toBe(maskName('张三'));   // '张*'
      expect(r2.candidate_name).toBe(maskName('Alice'));  // 'A***ce'
      expect(r3.candidate_name).toBe(maskName('Bo'));     // 'B*'
    });

    it('recent_recommendations: job_title is sourced from the joined jobs row', () => {
      const h1 = seedUser({ id: 'h1', userType: 'headhunter' });
      seedJob({ id: 'job1', title: 'Staff Engineer' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      seedRecommendation({ id: 'r1', headhunterId: 'h1', jobId: 'job1', anonId: c.anonId, pipelineStage: 'submitted' });

      const dash = createHunterDashboard(getTestDb()).getDashboard(h1);
      expect(dash.recent_recommendations[0]!.job_id).toBe('job1');
      expect(dash.recent_recommendations[0]!.job_title).toBe('Staff Engineer');
    });
  });

  // -------- filter semantics ----------

  describe('filter semantics', () => {
    it('top_tasks: only pending tasks are returned (completed tasks are excluded)', () => {
      const h1 = seedUser({ id: 'h1', userType: 'headhunter' });
      seedTask({ id: 't_a', hunterId: 'h1', title: 'A' });
      seedTask({ id: 't_b', hunterId: 'h1', title: 'B', completedAt: Date.now() });
      seedTask({ id: 't_c', hunterId: 'h1', title: 'C' });
      seedTask({ id: 't_d', hunterId: 'h1', title: 'D', completedAt: Date.now() });
      seedTask({ id: 't_e', hunterId: 'h1', title: 'E' });

      const dash = createHunterDashboard(getTestDb()).getDashboard(h1);
      const ids = dash.top_tasks.map((t) => t.id).sort();
      expect(ids).toEqual(['t_a', 't_c', 't_e']);
      for (const t of dash.top_tasks) {
        expect(t.completed_at).toBeNull();
      }
    });

    it('top_tasks: when only completed tasks exist, the array is empty', () => {
      const h1 = seedUser({ id: 'h1', userType: 'headhunter' });
      seedTask({ id: 't_done1', hunterId: 'h1', title: 'done 1', completedAt: Date.now() });
      seedTask({ id: 't_done2', hunterId: 'h1', title: 'done 2', completedAt: Date.now() });

      const dash = createHunterDashboard(getTestDb()).getDashboard(h1);
      expect(dash.top_tasks).toEqual([]);
    });

    it('recent_recommendations: rejected recs are excluded', () => {
      const h1 = seedUser({ id: 'h1', userType: 'headhunter' });
      // Seed h2 so we can build a candidate that points to h2 as the
      // headhunter (candidates_private.headhunter_id is FK→users.id).
      seedUser({ id: 'h2', userType: 'headhunter' });
      seedJob({ id: 'job1' });
      seedJob({ id: 'job2' });
      const cs = Array.from({ length: 3 }, (_, i) =>
        seedCandidate({ userId: `c${i}`, headhunterId: 'h1' }),
      );
      seedRecommendation({
        id: 'r_rej', headhunterId: 'h1', jobId: 'job1', anonId: cs[0]!.anonId,
        status: 'rejected_employer', pipelineStage: 'rejected',
      });
      seedRecommendation({
        id: 'r_active', headhunterId: 'h1', jobId: 'job2', anonId: cs[1]!.anonId,
        pipelineStage: 'submitted',
      });
      // Also exclude: pending_pickup unclaimed (headhunter_id NULL, status pending_pickup).
      // These aren't owned by the hunter, so they don't show up in the
      // recent_recommendations query (headhunter_id filter excludes them).
      const c3 = seedCandidate({ userId: 'c3', headhunterId: 'h2' });
      seedRecommendation({
        id: 'r_unclaimed', headhunterId: null, jobId: 'job2', anonId: c3.anonId,
        status: 'pending_pickup', pipelineStage: 'submitted',
      });

      const dash = createHunterDashboard(getTestDb()).getDashboard(h1);
      expect(dash.recent_recommendations.map((r) => r.recommendation_id)).toEqual(['r_active']);
    });

    it('recent_recommendations: when only rejected recs exist, the array is empty', () => {
      const h1 = seedUser({ id: 'h1', userType: 'headhunter' });
      seedJob({ id: 'job1' });
      const c1 = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      seedRecommendation({
        id: 'r_rej', headhunterId: 'h1', jobId: 'job1', anonId: c1.anonId,
        status: 'rejected_employer', pipelineStage: 'rejected',
      });

      const dash = createHunterDashboard(getTestDb()).getDashboard(h1);
      expect(dash.recent_recommendations).toEqual([]);
    });
  });

  // -------- auth ----------

  describe('auth', () => {
    it('rejects non-headhunter callers with FORBIDDEN', () => {
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const employer = seedUser({ id: 'e1', userType: 'employer' });
      const dash = createHunterDashboard(getTestDb());
      expectErrorCode(() => dash.getDashboard(candidate), 'FORBIDDEN');
      expectErrorCode(() => dash.getDashboard(employer), 'FORBIDDEN');
    });
  });
});
