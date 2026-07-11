// tests/integration/pm/snapshot.test.ts
//
// PM Workbench (Phase 3b, Task 12) — Global Snapshot handler integration tests.
//
// Covers:
//   - Auth (FORBIDDEN for non-PM)
//   - Empty PM (no projects → zeroed funnel + empty activity)
//   - Project / position / candidate / match aggregation across various
//     states (planning / active / paused / completed / cancelled;
//     open / paused / filled)
//   - Cross-PM isolation: B's projects / positions / candidates / matches
//     MUST NOT bleed into A's snapshot.
//   - Activity feed ordering + cap (max 50, DESC by occurred_at)
//   - Activity feed recency window (only events from last 24h are surfaced)
//   - Activity feed event_type classification (application vs pickup vs match_created)
//   - Activity feed summary format (masked names + position title)
//   - Activity feed links (project_id / position_id / candidate_user_id populated)
//   - Performance — verify no per-row 3-table JOIN N+1 (we issue a fixed
//     small number of queries regardless of N)
//   - Funnel `candidates.distinct` de-duplicates across positions
//   - Funnel `matches.avg_score` rounds to integer and returns 0 when empty
//
// Pattern mirrors tests/integration/pm/sandbox.test.ts: seed users + projects
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
import { createSnapshotHandler } from '../../../src/main/modules/pm/snapshot.js';
import { createRecommendationsRepo } from '../../../src/main/db/repositories/recommendations.js';
import { createMatchesRepo } from '../../../src/main/db/repositories/matches.js';
import { Errors, ApiError } from '../../../src/main/errors.js';
import type { User } from '../../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Test fixtures (mirror sandbox.test.ts)
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

function makeProject(pm: User, name = 'Test project'): {
  id: string;
  pm_user_id: string;
} {
  const handler = createProjectsHandler(getTestDb());
  return handler.createProject(pm, { name });
}

function makePosition(
  pm: User,
  projectId: string,
  title = 'Senior Engineer',
  opts: { status?: 'open' | 'paused' | 'filled'; headcount_planned?: number; headcount_filled?: number } = {},
): {
  id: string;
} {
  const handler = createPositionsHandler(getTestDb());
  return handler.createPosition(pm, projectId, {
    title,
    headcount_planned: opts.headcount_planned ?? 1,
  });
}

/** Set a project's status via direct UPDATE — bypasses PATCH validation. */
function setProjectStatus(projectId: string, status: 'planning' | 'active' | 'paused' | 'completed' | 'cancelled'): void {
  getTestDb().prepare('UPDATE projects SET status = ? WHERE id = ?').run(status, projectId);
}

/** Set a position's status + headcount_filled directly. */
function setPositionState(
  positionId: string,
  status: 'open' | 'paused' | 'filled',
  headcountFilled: number,
): void {
  getTestDb().prepare(
    'UPDATE project_positions SET status = ?, headcount_filled = ? WHERE id = ?'
  ).run(status, headcountFilled, positionId);
}

function seedCandidate(opts: { id: string; userName?: string }): {
  candidateUserId: string;
  anonymizedCandidateId: string;
} {
  const db = getTestDb();
  const now = new Date().toISOString();
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
 * Seed a recommendation linked to a (position, anonymized_candidate) pair.
 *
 * `createdAtMs` lets us push the row into / out of the 24h window.
 * `pickupHeadhunterId` controls whether the event is classified as 'pickup'.
 */
function seedRecommendation(opts: {
  positionId: string;
  anonymizedCandidateId: string;
  createdAtMs?: number;
  pickupHeadhunterId?: string | null;
}): string {
  const db = getTestDb();
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
    job_id: 'job_default',
    status: 'pending',
    source_type: 'hr',
    pickup_headhunter_id: opts.pickupHeadhunterId ?? null,
    candidate_note: null,
    commission_split_json: null,
    referrer_headhunter_id: null,
    created_at: now,
    updated_at: now,
  });
  // Patch position_id + (optionally) created_at so we can push the row
  // out of the 24h window when needed.
  const createdAtMs = opts.createdAtMs ?? Date.now();
  const createdAtIso = new Date(createdAtMs).toISOString();
  db.prepare(
    'UPDATE recommendations SET position_id = ?, created_at = ?, updated_at = ? WHERE id = ?'
  ).run(opts.positionId, createdAtIso, createdAtIso, id);
  return id;
}

/** Seed a match row. `createdAtMs` lets us push the row into / out of the window. */
function seedMatch(opts: {
  positionId: string;
  candidateUserId: string;
  score: number;
  createdAtMs?: number;
}): number {
  const db = getTestDb();
  const repo = createMatchesRepo(db);
  // The matches repo doesn't expose `created_at` as a setter; we INSERT
  // directly via the same UPSERT path then patch the column so we can
  // push rows into the past.
  repo.upsert({
    position_id: opts.positionId,
    candidate_user_id: opts.candidateUserId,
    score: opts.score,
    reasons: [],
    gaps: [],
  });
  const createdAtMs = opts.createdAtMs ?? Date.now();
  // Get the freshly-inserted match_id.
  const row = db.prepare(
    'SELECT id FROM matches WHERE position_id = ? AND candidate_user_id = ? ORDER BY id DESC LIMIT 1'
  ).get(opts.positionId, opts.candidateUserId) as { id: number };
  db.prepare('UPDATE matches SET created_at = ? WHERE id = ?').run(createdAtMs, row.id);
  return row.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pm: snapshot (handler + aggregation)', () => {
  beforeEach(() => {
    createTestApp();
    resetDb();
  });
  afterAll(() => closeTestDb());

  // -------- Auth ----------

  describe('auth', () => {
    it('rejects non-PM callers with FORBIDDEN', () => {
      const hh = seedUser({ id: 'hh1', userType: 'hr' });
      const handler = createSnapshotHandler(getTestDb());
      expectErrorCode(() => handler.getSnapshot(hh), 'FORBIDDEN');
    });

    it('returns an empty snapshot for a PM with no projects', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createSnapshotHandler(getTestDb());
      const snap = handler.getSnapshot(pm);
      expect(snap.funnel.projects.total).toBe(0);
      expect(snap.funnel.projects.by_status.planning).toBe(0);
      expect(snap.funnel.positions.total).toBe(0);
      expect(snap.funnel.candidates.total).toBe(0);
      expect(snap.funnel.candidates.distinct).toBe(0);
      expect(snap.funnel.matches.total).toBe(0);
      expect(snap.funnel.matches.avg_score).toBe(0);
      expect(snap.activity).toEqual([]);
      expect(typeof snap.generated_at).toBe('number');
    });
  });

  // -------- Funnel: projects ----------

  describe('funnel: projects', () => {
    it('counts projects by status (planning / active / paused / completed / cancelled)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const p1 = makeProject(pm, 'P1');
      const p2 = makeProject(pm, 'P2');
      const p3 = makeProject(pm, 'P3');
      const p4 = makeProject(pm, 'P4');
      const p5 = makeProject(pm, 'P5');
      // Default status is 'planning' — move 4 to other states.
      setProjectStatus(p2.id, 'active');
      setProjectStatus(p3.id, 'paused');
      setProjectStatus(p4.id, 'completed');
      setProjectStatus(p5.id, 'cancelled');

      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      expect(snap.funnel.projects.total).toBe(5);
      expect(snap.funnel.projects.by_status.planning).toBe(1);
      expect(snap.funnel.projects.by_status.active).toBe(1);
      expect(snap.funnel.projects.by_status.paused).toBe(1);
      expect(snap.funnel.projects.by_status.completed).toBe(1);
      expect(snap.funnel.projects.by_status.cancelled).toBe(1);
      // touch p1 to silence unused warning
      expect(p1.id).toBeTruthy();
    });
  });

  // -------- Funnel: positions ----------

  describe('funnel: positions', () => {
    it('counts positions by status + headcount totals across all PM projects', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos1 = makePosition(pm, project.id, 'Eng A', { headcount_planned: 3 });
      const pos2 = makePosition(pm, project.id, 'Eng B', { headcount_planned: 5 });
      const pos3 = makePosition(pm, project.id, 'Eng C', { headcount_planned: 2 });
      setPositionState(pos2.id, 'paused', 1);
      setPositionState(pos3.id, 'filled', 2);

      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      expect(snap.funnel.positions.total).toBe(3);
      expect(snap.funnel.positions.by_status.open).toBe(1);
      expect(snap.funnel.positions.by_status.paused).toBe(1);
      expect(snap.funnel.positions.by_status.filled).toBe(1);
      expect(snap.funnel.positions.headcount_planned_total).toBe(10);
      expect(snap.funnel.positions.headcount_filled_total).toBe(3); // 0 + 1 + 2
      // touch pos1
      expect(pos1.id).toBeTruthy();
    });
  });

  // -------- Funnel: candidates + matches ----------

  describe('funnel: candidates + matches', () => {
    it('reports total + distinct candidates and average match score', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos1 = makePosition(pm, project.id, 'Eng A');
      const pos2 = makePosition(pm, project.id, 'Eng B');

      // 3 distinct candidates: c1 appears in pos1+pos2 (1 distinct, 2 raw).
      const c1 = seedCandidate({ id: 'c1', userName: 'Alice Wonderland' });
      const c2 = seedCandidate({ id: 'c2', userName: 'Bob Builder' });
      const c3 = seedCandidate({ id: 'c3', userName: 'Carol Singer' });
      seedMatch({ positionId: pos1.id, candidateUserId: c1.candidateUserId, score: 70 });
      seedMatch({ positionId: pos2.id, candidateUserId: c1.candidateUserId, score: 80 });
      seedMatch({ positionId: pos1.id, candidateUserId: c2.candidateUserId, score: 90 });
      seedMatch({ positionId: pos2.id, candidateUserId: c3.candidateUserId, score: 100 });

      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      // 4 raw matches, 3 distinct candidates.
      expect(snap.funnel.candidates.total).toBe(4);
      expect(snap.funnel.candidates.distinct).toBe(3);
      expect(snap.funnel.matches.total).toBe(4);
      // avg_score = (70+80+90+100)/4 = 85
      expect(snap.funnel.matches.avg_score).toBe(85);
    });

    it('reports avg_score = 0 when there are no matches', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      makePosition(pm, project.id);
      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      expect(snap.funnel.matches.total).toBe(0);
      expect(snap.funnel.matches.avg_score).toBe(0);
    });

    it('rounds avg_score to the nearest integer', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = makePosition(pm, project.id);
      const c1 = seedCandidate({ id: 'c1' });
      const c2 = seedCandidate({ id: 'c2' });
      const c3 = seedCandidate({ id: 'c3' });
      // avg = (77+78+82)/3 = 79
      seedMatch({ positionId: pos.id, candidateUserId: c1.candidateUserId, score: 77 });
      seedMatch({ positionId: pos.id, candidateUserId: c2.candidateUserId, score: 78 });
      seedMatch({ positionId: pos.id, candidateUserId: c3.candidateUserId, score: 82 });
      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      expect(snap.funnel.matches.avg_score).toBe(79);
    });
  });

  // -------- Cross-PM isolation ----------

  describe('cross-PM isolation', () => {
    it('does NOT include another PM\'s projects / positions / candidates / matches', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });

      const p1 = makeProject(pm1, 'P1');
      const p2 = makeProject(pm2, 'P2');
      const pos1 = makePosition(pm1, p1.id);
      const pos2 = makePosition(pm2, p2.id);
      const c1 = seedCandidate({ id: 'c1' });
      const c2 = seedCandidate({ id: 'c2' });
      seedMatch({ positionId: pos1.id, candidateUserId: c1.candidateUserId, score: 60 });
      seedMatch({ positionId: pos2.id, candidateUserId: c2.candidateUserId, score: 90 });
      seedRecommendation({
        positionId: pos1.id,
        anonymizedCandidateId: c1.anonymizedCandidateId,
      });
      seedRecommendation({
        positionId: pos2.id,
        anonymizedCandidateId: c2.anonymizedCandidateId,
      });

      const snap1 = createSnapshotHandler(getTestDb()).getSnapshot(pm1);
      const snap2 = createSnapshotHandler(getTestDb()).getSnapshot(pm2);
      expect(snap1.funnel.projects.total).toBe(1);
      expect(snap1.funnel.positions.total).toBe(1);
      expect(snap1.funnel.matches.total).toBe(1);
      expect(snap1.funnel.matches.avg_score).toBe(60);
      // pm1 has 1 recommendation + 1 match = 2 activity events.
      expect(snap1.activity.length).toBe(2);
      // Every event in snap1 must be tied to pos1 (never pos2).
      for (const ev of snap1.activity) {
        expect(ev.position_id).toBe(pos1.id);
      }

      expect(snap2.funnel.projects.total).toBe(1);
      expect(snap2.funnel.positions.total).toBe(1);
      expect(snap2.funnel.matches.total).toBe(1);
      expect(snap2.funnel.matches.avg_score).toBe(90);
      expect(snap2.activity.length).toBe(2);
      for (const ev of snap2.activity) {
        expect(ev.position_id).toBe(pos2.id);
      }
    });
  });

  // -------- Activity feed ----------

  describe('activity feed', () => {
    it('returns events from the last 24h only', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = makePosition(pm, project.id);
      // Use a name that retains visible chars after masking so we can
      // assert on the summary string (maskName keeps first+last chars).
      const c = seedCandidate({ id: 'c_recent', userName: 'Recent One' });

      // Recent (1h ago) — should appear.
      seedRecommendation({
        positionId: pos.id,
        anonymizedCandidateId: c.anonymizedCandidateId,
        createdAtMs: Date.now() - 1 * 60 * 60 * 1000,
      });

      // Old (48h ago) — should NOT appear (outside 24h window).
      const cOld = seedCandidate({ id: 'c_old', userName: 'Old Person' });
      seedRecommendation({
        positionId: pos.id,
        anonymizedCandidateId: cOld.anonymizedCandidateId,
        createdAtMs: Date.now() - 48 * 60 * 60 * 1000,
      });

      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      expect(snap.activity.length).toBe(1);
      // The recent row should appear; the old one filtered out.
      // Masked name "Recent One" → "R***ne".
      expect(snap.activity[0]?.summary).toContain('R***ne');
    });

    it('classifies recs with pickup_headhunter_id set as "pickup" events', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = makePosition(pm, project.id);
      const c = seedCandidate({ id: 'c_pickup', userName: 'Alice Person' });
      seedRecommendation({
        positionId: pos.id,
        anonymizedCandidateId: c.anonymizedCandidateId,
        pickupHeadhunterId: 'hh_default',
      });

      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      expect(snap.activity.length).toBe(1);
      expect(snap.activity[0]?.event_type).toBe('pickup');
      expect(snap.activity[0]?.summary).toContain('猎头认领');
    });

    it('classifies recs WITHOUT pickup_headhunter_id as "application" events', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = makePosition(pm, project.id);
      const c = seedCandidate({ id: 'c_apply', userName: 'Bob Person' });
      seedRecommendation({
        positionId: pos.id,
        anonymizedCandidateId: c.anonymizedCandidateId,
      });

      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      expect(snap.activity.length).toBe(1);
      expect(snap.activity[0]?.event_type).toBe('application');
      expect(snap.activity[0]?.summary).toContain('申请了');
    });

    it('classifies new matches as "match_created" events', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = makePosition(pm, project.id);
      const c = seedCandidate({ id: 'c_match', userName: 'Carol Singer' });
      seedMatch({
        positionId: pos.id,
        candidateUserId: c.candidateUserId,
        score: 80,
        createdAtMs: Date.now() - 5 * 60 * 1000,
      });

      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      expect(snap.activity.length).toBe(1);
      expect(snap.activity[0]?.event_type).toBe('match_created');
      expect(snap.activity[0]?.summary).toContain('匹配');
    });

    it('orders events by occurred_at DESC', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = makePosition(pm, project.id);
      // Use names that retain distinguishable chars after masking:
      // "Older Person" → "O***on", "Newer Person" → "N***on".
      const c1 = seedCandidate({ id: 'c_o1', userName: 'Older Person' });
      const c2 = seedCandidate({ id: 'c_o2', userName: 'Newer Person' });
      const now = Date.now();
      seedRecommendation({
        positionId: pos.id,
        anonymizedCandidateId: c1.anonymizedCandidateId,
        createdAtMs: now - 60 * 60 * 1000, // 1h ago
      });
      seedRecommendation({
        positionId: pos.id,
        anonymizedCandidateId: c2.anonymizedCandidateId,
        createdAtMs: now - 5 * 60 * 1000, // 5min ago
      });

      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      expect(snap.activity.length).toBe(2);
      // Newer first (sorted DESC by occurred_at).
      expect(snap.activity[0]?.summary).toContain('N***on');
      expect(snap.activity[1]?.summary).toContain('O***on');
      expect(snap.activity[0]?.occurred_at).toBeGreaterThan(snap.activity[1]?.occurred_at ?? 0);
    });

    it('caps the activity feed at 50 events', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = makePosition(pm, project.id);
      // 60 recommendations spread across the last hour — all within window.
      for (let i = 0; i < 60; i++) {
        const c = seedCandidate({ id: `c_cap_${i}`, userName: `Candidate ${i}` });
        seedRecommendation({
          positionId: pos.id,
          anonymizedCandidateId: c.anonymizedCandidateId,
          createdAtMs: Date.now() - i * 60 * 1000, // staggered 0..59 min ago
        });
      }
      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      expect(snap.activity.length).toBe(50);
    });

    it('populates project_id / position_id / candidate_user_id for each event', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm, 'Specific Project');
      const pos = makePosition(pm, project.id, 'Specific Position');
      const c = seedCandidate({ id: 'c_links', userName: 'Alice Wonderland' });
      seedRecommendation({
        positionId: pos.id,
        anonymizedCandidateId: c.anonymizedCandidateId,
      });

      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      expect(snap.activity.length).toBe(1);
      const ev = snap.activity[0]!;
      expect(ev.project_id).toBe(project.id);
      expect(ev.position_id).toBe(pos.id);
      // candidate_user_id is resolved from the anonymized → user chain.
      expect(ev.candidate_user_id).toBe(c.candidateUserId);
    });

    it('masks the candidate name in the summary', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = makePosition(pm, project.id);
      const c = seedCandidate({ id: 'c_mask2', userName: 'Alice Wonderland' });
      seedRecommendation({
        positionId: pos.id,
        anonymizedCandidateId: c.anonymizedCandidateId,
      });

      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      const summary = snap.activity[0]?.summary ?? '';
      expect(summary).not.toContain('Alice Wonderland');
      expect(summary).toContain('*');
    });

    it('includes the position title in the summary', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = makePosition(pm, project.id, 'Frontend Architect');
      const c = seedCandidate({ id: 'c_pos', userName: 'Alice Person' });
      seedRecommendation({
        positionId: pos.id,
        anonymizedCandidateId: c.anonymizedCandidateId,
      });

      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      const summary = snap.activity[0]?.summary ?? '';
      expect(summary).toContain('Frontend Architect');
    });
  });

  // -------- Performance ----------

  describe('performance (no N+1)', () => {
    it('issues a fixed number of queries regardless of project count', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });

      // Seed 10 projects × 5 positions × 3 candidates × 2 matches + a
      // handful of recs. If the handler were N+1 the query count would
      // balloon (10 × 5 × 3 × 2 ≈ 300 queries just for funnel data).
      const positions: string[] = [];
      const candidates: Array<{ candidateUserId: string; anonymizedCandidateId: string }> = [];
      for (let p = 0; p < 10; p++) {
        const project = makeProject(pm, `P${p}`);
        for (let pos = 0; pos < 5; pos++) {
          positions.push(makePosition(pm, project.id, `Eng ${p}-${pos}`).id);
        }
      }
      for (let i = 0; i < 30; i++) {
        candidates.push(seedCandidate({ id: `c_perf_${i}`, userName: `Perf${i}` }));
      }
      // Each position gets 6 matches (cycling through the 30 candidates).
      for (let i = 0; i < positions.length; i++) {
        const posId = positions[i]!;
        for (let k = 0; k < 6; k++) {
          const cand = candidates[(i * 6 + k) % candidates.length]!;
          seedMatch({ positionId: posId, candidateUserId: cand.candidateUserId, score: 60 + (k * 5) });
        }
      }
      // A few recent recs for the activity feed (one per project).
      for (let p = 0; p < 10; p++) {
        const project = makeProject(pm, `P${p}-recs`);
        const pos = makePosition(pm, project.id, `Eng ${p}-recs`);
        const c = candidates[p % candidates.length]!;
        seedRecommendation({
          positionId: pos.id,
          anonymizedCandidateId: c.anonymizedCandidateId,
        });
      }

      // Patch the underlying db.prepare to count query executions.
      const db = getTestDb();
      const originalPrepare = db.prepare.bind(db);
      let queryCount = 0;
      db.prepare = ((sql: string) => {
        // The handler should NOT issue per-row prepare() calls. We count
        // every prepare() (including the INSERTs the handler didn't
        // issue — only the SELECTs/aggregations).
        // To focus on read queries we filter to SELECT only.
        if (typeof sql === 'string' && /^\s*SELECT/i.test(sql)) {
          queryCount += 1;
        }
        return originalPrepare(sql);
      }) as typeof db.prepare;

      const snap = createSnapshotHandler(db).getSnapshot(pm);
      // Restore.
      db.prepare = originalPrepare;

      // Sanity-check the response shape.
      expect(snap.funnel.projects.total).toBe(20); // 10 + 10 (recs loop)
      expect(snap.funnel.positions.total).toBe(60);
      expect(snap.funnel.matches.total).toBe(300);

      // Hard cap on SELECT queries for a fully populated snapshot.
      // We allow up to 15 to account for the hydration helper queries
      // (candidates/users/positions lookups). A naive N+1 would issue
      // hundreds. The aggregate queries themselves are 4.
      expect(queryCount).toBeLessThan(15);
    });
  });

  // -------- Edge cases ----------

  describe('edge cases', () => {
    it('returns funnel with all-zero counts but valid shape for an empty PM', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      expect(snap.funnel).toEqual({
        projects: {
          total: 0,
          by_status: { planning: 0, active: 0, paused: 0, completed: 0, cancelled: 0 },
        },
        positions: {
          total: 0,
          by_status: { open: 0, paused: 0, filled: 0 },
          headcount_planned_total: 0,
          headcount_filled_total: 0,
        },
        candidates: { total: 0, distinct: 0 },
        matches: { total: 0, avg_score: 0 },
      });
      expect(snap.activity).toEqual([]);
    });

    it('handles recommendations linked to NULL position_id (legacy hunter-side rows)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = makePosition(pm, project.id, 'Some Position');
      const c1 = seedCandidate({ id: 'c_linked', userName: 'Linked User' });
      const c2 = seedCandidate({ id: 'c_legacy', userName: 'Legacy User' });
      seedRecommendation({
        positionId: pos.id,
        anonymizedCandidateId: c1.anonymizedCandidateId,
      });
      // Legacy rec with no position link.
      const recId = seedRecommendation({
        positionId: pos.id,
        anonymizedCandidateId: c2.anonymizedCandidateId,
      });
      getTestDb().prepare('UPDATE recommendations SET position_id = NULL WHERE id = ?').run(recId);

      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      // Both events appear; the legacy one has project_id = NULL.
      expect(snap.activity.length).toBe(2);
      // The legacy event summary uses the fallback position title "岗位"
      // because the position_id lookup misses.
      const legacyEv = snap.activity.find((e) => e.summary.includes('岗位'));
      expect(legacyEv).toBeTruthy();
      expect(legacyEv?.project_id).toBeNull();
      expect(legacyEv?.position_id).toBeNull();
    });

    it('handles missing candidate profile gracefully (no PII, fallback summary)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = makePosition(pm, project.id);
      // Insert a recommendation pointing at an anonymized_candidate_id
      // that does NOT exist in candidates_anonymized — the snapshot
      // should NOT crash, the summary should fall back to "候选人".
      //
      // Note: recommendations.anonymized_candidate_id has a FK to
      // candidates_anonymized(id). We disable FK temporarily so we
      // can stage a "dangling" reference that simulates a deleted
      // candidate profile. The handler is expected to swallow the
      // miss gracefully — that's what this test verifies.
      const db = getTestDb();
      // Seed hh_default + emp_default (FK targets for recommendations) — idempotent.
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get('hh_default')) {
        db.prepare(`
          INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
                             quota_per_day, quota_used, quota_reset_at, reputation, status,
                             created_at, updated_at)
          VALUES ('hh_default', 'hr', 'Default Hunter', NULL, 'hash_hh_default', 'hp',
                  200, 0, ?, 50, 'active',
                  ?, ?)
        `).run(new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
      }
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get('emp_default')) {
        db.prepare(`
          INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
                             quota_per_day, quota_used, quota_reset_at, reputation, status,
                             created_at, updated_at)
          VALUES ('emp_default', 'pm', 'Default Employer', NULL, 'hash_emp_default', 'hp',
                  100, 0, ?, 50, 'active',
                  ?, ?)
        `).run(new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
      }
      if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get('job_default')) {
        db.prepare(`
          INSERT INTO jobs (id, employer_id, title, status, priority, created_at, updated_at)
          VALUES ('job_default', 'emp_default', 'Default Job', 'open', 'normal', ?, ?)
        `).run(new Date().toISOString(), new Date().toISOString());
      }
      // Temporarily disable FK so we can insert a recommendation with a
      // dangling anonymized_candidate_id. Restore FK in a finally block.
      db.exec('PRAGMA foreign_keys = OFF');
      try {
        const repo = createRecommendationsRepo(db);
        const id = `rec_missing_${Math.random().toString(36).slice(2, 14)}`;
        const now = new Date().toISOString();
        repo.insert({
          id,
          headhunter_id: 'hh_default',
          employer_id: 'emp_default',
          anonymized_candidate_id: 'cand_ghost', // missing — simulates a deleted profile
          job_id: 'job_default',
          status: 'pending',
          source_type: 'hr',
          pickup_headhunter_id: null,
          candidate_note: null,
          commission_split_json: null,
          referrer_headhunter_id: null,
          created_at: now,
          updated_at: now,
        });
        db.prepare(
          'UPDATE recommendations SET position_id = ?, created_at = ?, updated_at = ? WHERE id = ?'
        ).run(pos.id, now, now, id);
      } finally {
        db.exec('PRAGMA foreign_keys = ON');
      }

      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      expect(snap.activity.length).toBe(1);
      expect(snap.activity[0]?.summary).toContain('候选人');
      expect(snap.activity[0]?.candidate_user_id).toBeNull();
    });

    it('uses `generated_at` to expose a stable server timestamp', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const before = Date.now();
      const snap = createSnapshotHandler(getTestDb()).getSnapshot(pm);
      const after = Date.now();
      expect(snap.generated_at).toBeGreaterThanOrEqual(before);
      expect(snap.generated_at).toBeLessThanOrEqual(after);
    });
  });
});