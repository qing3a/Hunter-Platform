// tests/integration/pm/sandbox.test.ts
//
// PM Workbench (Phase 3b, Task 9) — Sandbox handler integration tests.
//
// Covers:
//   - Sandbox aggregation: recommendations grouped by pipeline_stage
//   - Stage ordering (submitted → screen_passed → interview → offer → onboarded)
//   - Risk flag computation (stuck_long >30d, stuck_very_long >60d)
//   - Per-stage candidate listing (anonymized display name, stage_entered_at, risk_flags)
//   - Empty position (no recommendations → all stages 0)
//   - Auth + ownership (FORBIDDEN for non-PM; NOT_FOUND for cross-PM)
//
// Pattern mirrors tests/integration/pm/positions.test.ts: seed users + projects
// + positions directly via SQL on the shared getTestDb(), then call the handler
// method directly (HTTP routing is wired later in Task 17).

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  getTestDb,
} from '../../helpers/test-app.js';
import { createProjectsHandler } from '../../../src/main/modules/pm/projects.js';
import { createPositionsHandler } from '../../../src/main/modules/pm/positions.js';
import { createSandboxHandler } from '../../../src/main/modules/pm/sandbox.js';
import { createRecommendationsRepo } from '../../../src/main/db/repositories/recommendations.js';
import { Errors, ApiError } from '../../../src/main/errors.js';
import type { User } from '../../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function seedUser(opts: {
  id: string;
  userType: 'pm' | 'hr' | 'candidate' | 'pm';
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
            ?, 'hp_prefix_pm', NULL,
            NULL, NULL, NULL,
            300, 0, ?, 50,
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
    api_key_prefix: 'hp_prefix_pm',
    api_key_expires_at: null,
    prev_api_key_hash: null,
    prev_api_key_prefix: null,
    prev_api_key_expires_at: null,
    quota_per_day: 300,
    quota_used: 0,
    quota_reset_at: now,
    reputation: 50,
    status: 'active',
    created_at: now,
    updated_at: now,
  };
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

/** Create a project for the given PM, returns the project row. */
function makeProject(pm: User, name = 'Test project'): {
  id: string;
  pm_user_id: string;
} {
  const handler = createProjectsHandler(getTestDb());
  return handler.createProject(pm, { name });
}

/** Create a position under a project. */
function makePosition(pm: User, projectId: string, title = 'Senior Engineer'): {
  id: string;
} {
  const handler = createPositionsHandler(getTestDb());
  return handler.createPosition(pm, projectId, { title });
}

/**
 * Seed a candidate user + private candidate + anonymized candidate.
 * Returns the candidate_user_id (used as the "candidate" identity on
 * the recommendation row).
 *
 * Also seeds the default headhunter (id='hh_default') and employer
 * (id='emp_default') on first invocation — both are FK targets for
 * `candidates_anonymized.source_headhunter_id` and `recommendations.*`.
 */
function seedCandidate(opts: { id: string; userName?: string }): {
  candidateUserId: string;
  anonymizedCandidateId: string;
} {
  const db = getTestDb();
  const now = new Date().toISOString();
  // Idempotent default headhunter (FK on candidates_anonymized.source_headhunter_id
  // and candidates_private.headhunter_id). Inserted once per test run.
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get('hh_default')) {
    db.prepare(`
      INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
                         quota_per_day, quota_used, quota_reset_at, reputation, status,
                         created_at, updated_at)
      VALUES ('hh_default', 'hr', 'Default Hunter', NULL, 'hash_hh_default', 'hp',
              200, 0, ?, 50, 'active',
              ?, ?)
    `).run(now, now, now);
  }
  // Idempotent default employer (FK on recommendations.employer_id).
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get('emp_default')) {
    db.prepare(`
      INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
                         quota_per_day, quota_used, quota_reset_at, reputation, status,
                         created_at, updated_at)
      VALUES ('emp_default', 'pm', 'Default Employer', NULL, 'hash_emp_default', 'hp',
              100, 0, ?, 50, 'active',
              ?, ?)
    `).run(now, now, now);
  }
  // Insert candidate user (user_type='candidate') — required FK for candidates_private.
  // Use UNIQUE api_key_hash so multiple candidates can coexist.
  db.prepare(`
    INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
                       quota_per_day, quota_used, quota_reset_at, reputation, status,
                       created_at, updated_at)
    VALUES (?, 'candidate', ?, NULL, ?, 'cp',
            50, 0, ?, 50, 'active',
            ?, ?)
  `).run(
    opts.id,
    opts.userName ?? `Candidate ${opts.id}`,
    `hash_${opts.id}`,
    now,
    now,
    now,
  );
  // Seed candidates_private (FK on candidates_anonymized.source_private_id).
  db.prepare(`
    INSERT INTO candidates_private (id, headhunter_id, candidate_user_id, name_enc, phone_enc, email_enc,
                                    current_company_raw, current_title_raw, expected_salary,
                                    years_experience, education_school, resume_url,
                                    skills_json, raw_payload_json, created_at, updated_at)
    VALUES (?, 'hh_default', ?, 'enc_name', 'enc_phone', 'enc_email',
            'Anon Co', 'Anon Title', 30000,
            5, 'Anon U', NULL,
            NULL, NULL, ?, ?)
  `).run(`cp_${opts.id}`, opts.id, now, now);
  // Seed candidates_anonymized (FK on recommendations.anonymized_candidate_id).
  db.prepare(`
    INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id,
                                       industry, title_level, years_experience,
                                       salary_range, education_tier, skills_json,
                                       is_public_pool, unlock_status,
                                       created_at, updated_at)
    VALUES (?, ?, 'hh_default',
            'Software', 'senior', 5,
            '30k-50k', 'tier1', NULL,
            0, 'locked',
            ?, ?)
  `).run(`cand_${opts.id}`, `cp_${opts.id}`, now, now);
  return {
    candidateUserId: opts.id,
    anonymizedCandidateId: `cand_${opts.id}`,
  };
}

/**
 * Seed a recommendation for a given (position, anonymized_candidate) pair.
 * Uses the recommendations repo's `insert` method (which sets
 * pipeline_stage='submitted' default + auto UUIDs).
 *
 * The schema (after v030 migration) adds a nullable `position_id` column
 * on recommendations; we update that column directly after insert so the
 * recommendation is linked to the PM's project_position.
 */
function seedRecommendation(opts: {
  positionId: string;
  anonymizedCandidateId: string;
  pipelineStage: 'submitted' | 'screen_passed' | 'interview' | 'offer' | 'onboarded' | 'rejected';
  stageEnteredAtMs?: number;
  recStatus?: string;
}): string {
  const db = getTestDb();
  // Ensure the default job exists (legacy FK on recommendations.job_id).
  if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get('job_default')) {
    db.prepare(`
      INSERT INTO jobs (id, employer_id, title, status, priority, created_at, updated_at)
      VALUES ('job_default', 'emp_default', 'Default Job', 'open', 'normal', ?, ?)
    `).run(new Date().toISOString(), new Date().toISOString());
  }
  const repo = createRecommendationsRepo(db);
  const id = `rec_${Math.random().toString(36).slice(2, 14)}`;
  const now = new Date().toISOString();
  repo.insert({
    id,
    headhunter_id: 'hh_default',
    employer_id: 'emp_default',
    anonymized_candidate_id: opts.anonymizedCandidateId,
    job_id: 'job_default', // legacy FK; PM sandbox reads via position_id (v030 column)
    status: (opts.recStatus ?? 'pending') as 'pending',
    source_type: 'hr',
    pickup_headhunter_id: null,
    candidate_note: null,
    commission_split_json: null,
    referrer_headhunter_id: null,
    created_at: now,
    updated_at: now,
  });
  // Patch position_id + pipeline_stage + stage_entered_at.
  // stage_entered_at is a convention we use here; we synthesise it from
  // updated_at by subtracting a delta when no explicit value is given.
  const stageEnteredAt = opts.stageEnteredAtMs ?? Date.now();
  db.prepare(
    'UPDATE recommendations SET position_id = ?, pipeline_stage = ?, stage_entered_at = ?, updated_at = ? WHERE id = ?'
  ).run(opts.positionId, opts.pipelineStage, stageEnteredAt, now, id);
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pm: sandbox (handler + repo integration)', () => {
  beforeEach(() => {
    createTestApp();
    resetDb();
  });
  afterAll(() => closeTestDb());

  // -------- Auth + ownership ----------

  describe('auth + ownership', () => {
    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const hh = seedUser({ id: 'hh1', userType: 'hr' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);
      const handler = createSandboxHandler(getTestDb());

      expectErrorCode(() => handler.getSandbox(hh, position.id), 'FORBIDDEN');
    });

    it('throws NOT_FOUND when the position does not exist', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createSandboxHandler(getTestDb());
      expectErrorCode(() => handler.getSandbox(pm, 'pos_nonexistent'), 'NOT_FOUND');
    });

    it('throws NOT_FOUND when the position belongs to another PM', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1);
      const position = makePosition(pm1, project.id);
      const handler = createSandboxHandler(getTestDb());
      expectErrorCode(() => handler.getSandbox(pm2, position.id), 'NOT_FOUND');
    });

    it('throws INVALID_PARAMS when position_id is empty', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createSandboxHandler(getTestDb());
      expectErrorCode(() => handler.getSandbox(pm, ''), 'INVALID_PARAMS');
    });
  });

  // -------- Empty position ----------

  describe('empty position', () => {
    it('returns the 6 pipeline stages with count=0 and no candidates', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);
      const handler = createSandboxHandler(getTestDb());

      const result = handler.getSandbox(pm, position.id);
      expect(result.position.id).toBe(position.id);
      expect(result.position.title).toBe('Senior Engineer');
      expect(result.total).toBe(0);
      expect(result.stages).toHaveLength(6);
      // Stage ordering
      expect(result.stages.map((s) => s.stage)).toEqual([
        'submitted', 'screen_passed', 'interview', 'offer', 'onboarded', 'rejected',
      ]);
      for (const s of result.stages) {
        expect(s.count).toBe(0);
        expect(s.candidates).toEqual([]);
      }
    });

    it('returns headcount_planned / headcount_filled alongside the position row', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const positions = createPositionsHandler(getTestDb());
      const pos = positions.createPosition(pm, project.id, { title: 'Eng', headcount_planned: 5 });
      const handler = createSandboxHandler(getTestDb());

      const result = handler.getSandbox(pm, pos.id);
      expect(result.position.total_headcount_planned).toBe(5);
      expect(result.position.total_headcount_filled).toBe(0);
    });
  });

  // -------- Aggregation ----------

  describe('aggregation', () => {
    it('groups recommendations by pipeline_stage with correct counts', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);

      // 3 candidates in 'submitted'
      // 2 candidates in 'screen_passed'
      // 1 candidate in 'interview'
      // 1 candidate in 'onboarded'
      // 1 candidate in 'rejected'
      for (let i = 1; i <= 3; i++) {
        const c = seedCandidate({ id: `c_sub_${i}` });
        seedRecommendation({
          positionId: position.id,
          anonymizedCandidateId: c.anonymizedCandidateId,
          pipelineStage: 'submitted',
        });
      }
      for (let i = 1; i <= 2; i++) {
        const c = seedCandidate({ id: `c_sp_${i}` });
        seedRecommendation({
          positionId: position.id,
          anonymizedCandidateId: c.anonymizedCandidateId,
          pipelineStage: 'screen_passed',
        });
      }
      for (let i = 1; i <= 1; i++) {
        const c = seedCandidate({ id: `c_iv_${i}` });
        seedRecommendation({
          positionId: position.id,
          anonymizedCandidateId: c.anonymizedCandidateId,
          pipelineStage: 'interview',
        });
      }
      for (let i = 1; i <= 1; i++) {
        const c = seedCandidate({ id: `c_ob_${i}` });
        seedRecommendation({
          positionId: position.id,
          anonymizedCandidateId: c.anonymizedCandidateId,
          pipelineStage: 'onboarded',
        });
      }
      for (let i = 1; i <= 1; i++) {
        const c = seedCandidate({ id: `c_rj_${i}` });
        seedRecommendation({
          positionId: position.id,
          anonymizedCandidateId: c.anonymizedCandidateId,
          pipelineStage: 'rejected',
        });
      }

      const handler = createSandboxHandler(getTestDb());
      const result = handler.getSandbox(pm, position.id);

      expect(result.total).toBe(8);
      const stageMap = Object.fromEntries(result.stages.map((s) => [s.stage, s.count]));
      expect(stageMap.submitted).toBe(3);
      expect(stageMap.screen_passed).toBe(2);
      expect(stageMap.interview).toBe(1);
      expect(stageMap.offer).toBe(0);
      expect(stageMap.onboarded).toBe(1);
      expect(stageMap.rejected).toBe(1);
    });

    it('does NOT include recommendations for other positions in the same project', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const posA = makePosition(pm, project.id, 'Pos A');
      const posB = makePosition(pm, project.id, 'Pos B');

      const c1 = seedCandidate({ id: 'c_a_1' });
      seedRecommendation({
        positionId: posA.id,
        anonymizedCandidateId: c1.anonymizedCandidateId,
        pipelineStage: 'submitted',
      });
      const c2 = seedCandidate({ id: 'c_b_1' });
      seedRecommendation({
        positionId: posB.id,
        anonymizedCandidateId: c2.anonymizedCandidateId,
        pipelineStage: 'submitted',
      });

      const handler = createSandboxHandler(getTestDb());
      const resultA = handler.getSandbox(pm, posA.id);
      const resultB = handler.getSandbox(pm, posB.id);

      expect(resultA.total).toBe(1);
      expect(resultB.total).toBe(1);
      expect(resultA.stages.find((s) => s.stage === 'submitted')?.candidates[0]?.recommendation_id)
        .not.toBe(resultB.stages.find((s) => s.stage === 'submitted')?.candidates[0]?.recommendation_id);
    });

    it('does NOT include recommendations with NULL position_id', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);

      const c1 = seedCandidate({ id: 'c_linked' });
      seedRecommendation({
        positionId: position.id,
        anonymizedCandidateId: c1.anonymizedCandidateId,
        pipelineStage: 'submitted',
      });
      // A recommendation with NULL position_id (legacy / hunter-side data).
      // We seed it against the linked position, then NULL out the column
      // directly so the FK check is satisfied (we can't insert with NULL
      // in the seed path because the repo wrapper enforces a value).
      const c2 = seedCandidate({ id: 'c_unlinked' });
      seedRecommendation({
        positionId: position.id,
        anonymizedCandidateId: c2.anonymizedCandidateId,
        pipelineStage: 'submitted',
      });
      getTestDb().prepare(
        'UPDATE recommendations SET position_id = NULL WHERE anonymized_candidate_id = ?'
      ).run(c2.anonymizedCandidateId);

      const handler = createSandboxHandler(getTestDb());
      const result = handler.getSandbox(pm, position.id);
      expect(result.total).toBe(1);
    });

    it('returns the candidate list per stage (anonymized name, stage_entered_at, risk_flags)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);

      const c = seedCandidate({ id: 'c_one', userName: 'Alice' });
      const stageEnteredAt = Date.now() - 35 * 86_400_000; // 35 days ago → stuck_long
      seedRecommendation({
        positionId: position.id,
        anonymizedCandidateId: c.anonymizedCandidateId,
        pipelineStage: 'interview',
        stageEnteredAtMs: stageEnteredAt,
      });

      const handler = createSandboxHandler(getTestDb());
      const result = handler.getSandbox(pm, position.id);

      const stage = result.stages.find((s) => s.stage === 'interview');
      expect(stage).toBeTruthy();
      expect(stage!.candidates).toHaveLength(1);
      const cand = stage!.candidates[0]!;
      expect(cand.candidate_display_name).toContain('*'); // masked
      expect(cand.stage_entered_at).toBe(stageEnteredAt);
      expect(cand.risk_flags).toContain('stuck_long');
    });
  });

  // -------- Risk flags ----------

  describe('risk flags', () => {
    it('adds "stuck_long" when stage_entered_at > 30 days ago', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);
      const c = seedCandidate({ id: 'c_stuck30' });
      seedRecommendation({
        positionId: position.id,
        anonymizedCandidateId: c.anonymizedCandidateId,
        pipelineStage: 'screen_passed',
        stageEnteredAtMs: Date.now() - 31 * 86_400_000,
      });

      const handler = createSandboxHandler(getTestDb());
      const result = handler.getSandbox(pm, position.id);
      const stage = result.stages.find((s) => s.stage === 'screen_passed');
      expect(stage!.candidates[0]!.risk_flags).toEqual(['stuck_long']);
    });

    it('adds "stuck_very_long" when stage_entered_at > 60 days ago', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);
      const c = seedCandidate({ id: 'c_stuck60' });
      seedRecommendation({
        positionId: position.id,
        anonymizedCandidateId: c.anonymizedCandidateId,
        pipelineStage: 'offer',
        stageEnteredAtMs: Date.now() - 61 * 86_400_000,
      });

      const handler = createSandboxHandler(getTestDb());
      const result = handler.getSandbox(pm, position.id);
      const stage = result.stages.find((s) => s.stage === 'offer');
      expect(stage!.candidates[0]!.risk_flags).toEqual(['stuck_very_long']);
    });

    it('does NOT add risk flags for fresh candidates (< 30 days)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);
      const c = seedCandidate({ id: 'c_fresh' });
      seedRecommendation({
        positionId: position.id,
        anonymizedCandidateId: c.anonymizedCandidateId,
        pipelineStage: 'submitted',
        stageEnteredAtMs: Date.now() - 5 * 86_400_000,
      });

      const handler = createSandboxHandler(getTestDb());
      const result = handler.getSandbox(pm, position.id);
      const stage = result.stages.find((s) => s.stage === 'submitted');
      expect(stage!.candidates[0]!.risk_flags).toEqual([]);
    });

    it('does NOT add "stuck" risk flags for terminal stages', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);
      const c1 = seedCandidate({ id: 'c_ob_long' });
      seedRecommendation({
        positionId: position.id,
        anonymizedCandidateId: c1.anonymizedCandidateId,
        pipelineStage: 'onboarded',
        stageEnteredAtMs: Date.now() - 100 * 86_400_000,
      });
      const c2 = seedCandidate({ id: 'c_rj_long' });
      seedRecommendation({
        positionId: position.id,
        anonymizedCandidateId: c2.anonymizedCandidateId,
        pipelineStage: 'rejected',
        stageEnteredAtMs: Date.now() - 100 * 86_400_000,
      });

      const handler = createSandboxHandler(getTestDb());
      const result = handler.getSandbox(pm, position.id);
      const ob = result.stages.find((s) => s.stage === 'onboarded');
      const rj = result.stages.find((s) => s.stage === 'rejected');
      expect(ob!.candidates[0]!.risk_flags).toEqual([]);
      expect(rj!.candidates[0]!.risk_flags).toEqual([]);
    });

    it('aggregates risk_flag counts at the stage level', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);
      // 3 in interview: 1 stuck_long, 1 stuck_very_long, 1 fresh
      const c1 = seedCandidate({ id: 'c_long30' });
      seedRecommendation({
        positionId: position.id, anonymizedCandidateId: c1.anonymizedCandidateId,
        pipelineStage: 'interview', stageEnteredAtMs: Date.now() - 35 * 86_400_000,
      });
      const c2 = seedCandidate({ id: 'c_long60' });
      seedRecommendation({
        positionId: position.id, anonymizedCandidateId: c2.anonymizedCandidateId,
        pipelineStage: 'interview', stageEnteredAtMs: Date.now() - 70 * 86_400_000,
      });
      const c3 = seedCandidate({ id: 'c_fresh2' });
      seedRecommendation({
        positionId: position.id, anonymizedCandidateId: c3.anonymizedCandidateId,
        pipelineStage: 'interview', stageEnteredAtMs: Date.now() - 2 * 86_400_000,
      });

      const handler = createSandboxHandler(getTestDb());
      const result = handler.getSandbox(pm, position.id);
      const stage = result.stages.find((s) => s.stage === 'interview');
      expect(stage!.count).toBe(3);
      // The handler exposes per-stage risk_count summary via `risk_count`.
      // We surface `stuck_long` / `stuck_very_long` totals on the stage.
      expect(stage!.risk_count).toBeDefined();
      expect(stage!.risk_count.stuck_long).toBe(1);
      expect(stage!.risk_count.stuck_very_long).toBe(1);
    });
  });

  // -------- Stage ordering ----------

  describe('stage ordering', () => {
    it('returns stages in pipeline order (submitted → … → onboarded → rejected)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);
      // Seed one recommendation in a random stage to make sure ordering
      // is by the canonical PIPELINE_STAGES list, not by COUNT.
      const c = seedCandidate({ id: 'c_order' });
      seedRecommendation({
        positionId: position.id, anonymizedCandidateId: c.anonymizedCandidateId,
        pipelineStage: 'onboarded',
      });
      const handler = createSandboxHandler(getTestDb());
      const result = handler.getSandbox(pm, position.id);
      expect(result.stages.map((s) => s.stage)).toEqual([
        'submitted', 'screen_passed', 'interview', 'offer', 'onboarded', 'rejected',
      ]);
    });
  });

  // -------- Display name (masked) ----------

  describe('display name masking', () => {
    it('returns a masked candidate_display_name (does not leak raw PII)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);
      const c = seedCandidate({ id: 'c_mask', userName: 'Alice Wonderland' });
      seedRecommendation({
        positionId: position.id, anonymizedCandidateId: c.anonymizedCandidateId,
        pipelineStage: 'submitted',
      });
      const handler = createSandboxHandler(getTestDb());
      const result = handler.getSandbox(pm, position.id);
      const cand = result.stages.find((s) => s.stage === 'submitted')!.candidates[0]!;
      // Mask: at most 2 chars from start + at most 2 chars from end + '***'
      expect(cand.candidate_display_name).not.toBe('Alice Wonderland');
      expect(cand.candidate_display_name).toContain('*');
    });
  });

  // -------- Repo extensions (aggregateByPositionStage + findByPositionAndStage) ----------

  describe('recommendations repo extensions', () => {
    it('aggregateByPositionStage returns counts per stage for a position', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);
      for (let i = 1; i <= 2; i++) {
        const c = seedCandidate({ id: `c_repo_${i}` });
        seedRecommendation({
          positionId: position.id, anonymizedCandidateId: c.anonymizedCandidateId,
          pipelineStage: 'submitted',
        });
      }
      const repo = createRecommendationsRepo(getTestDb());
      const agg = repo.aggregateByPositionStage(position.id);
      expect(agg.submitted).toBe(2);
      expect(agg.interview).toBe(0);
      expect(agg.total).toBe(2);
    });

    it('findByPositionAndStage returns the candidates in a stage (paginated)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);
      for (let i = 1; i <= 3; i++) {
        const c = seedCandidate({ id: `c_page_${i}` });
        seedRecommendation({
          positionId: position.id, anonymizedCandidateId: c.anonymizedCandidateId,
          pipelineStage: 'submitted',
        });
      }
      const repo = createRecommendationsRepo(getTestDb());
      const page = repo.findByPositionAndStage(position.id, 'submitted', { limit: 2, offset: 0 });
      expect(page).toHaveLength(2);
      const page2 = repo.findByPositionAndStage(position.id, 'submitted', { limit: 2, offset: 2 });
      expect(page2).toHaveLength(1);
    });

    it('findByPositionAndStage returns empty array for a stage with no recs', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const position = makePosition(pm, project.id);
      const repo = createRecommendationsRepo(getTestDb());
      const page = repo.findByPositionAndStage(position.id, 'interview', {});
      expect(page).toEqual([]);
    });
  });
});