// tests/integration/hunter-portal/kanban.test.ts
//
// Integration tests for the Hunter Workspace (Phase 3a, Task 4):
//   - hunter-kanban repository (seedDefaultColumns, getBoard, moveCard,
//     addCard, removeCard)
//   - createHunterKanban handler module (headhunter auth, state-machine
//     transitions via canTransition(), ownership scoping, error semantics)
//
// Per the task spec, we call the handler functions DIRECTLY (not via HTTP) —
// the HTTP routes for hunter-portal/kanban are wired in Task 7. The handler
// and repo are exercised against a real in-process SQLite DB that has the
// v027 migration applied.
//
// Architectural notes:
//   - Kanban has NO `kanban_cards` table. Cards are derived from
//     recommendations filtered by `headhunter_id = $hunter AND
//     pipeline_stage IN (kanban stages)`. The kanban_columns table only
//     holds per-hunter column definitions.
//   - getBoard(hunterUserId) seeds the 5 default columns lazily
//     ("onboarding pattern") if no columns exist for that hunter.
//   - State transitions go through canTransition() from hunter-pipeline.ts.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  getTestDb,
} from '../../helpers/test-app.js';
import { createHunterKanban } from '../../../src/main/modules/headhunter/kanban.js';
import { Errors, ApiError } from '../../../src/main/errors.js';
import type { User } from '../../../src/shared/types.js';
import type {
  KanbanColumnRow,
} from '../../../src/main/db/repositories/hunter-kanban.js';

type SeedUser = User;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function seedUser(opts: {
  id: string;
  userType: 'headhunter' | 'candidate' | 'employer';
  name?: string;
}): SeedUser {
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

/** Seed a candidate private + anonymized row (FK chain for rec.candidate_user_id). */
function seedCandidate(opts: {
  userId: string;
  headhunterId: string;
  anonId?: string;
  privateId?: string;
  name?: string;
}): { anonId: string; privateId: string } {
  const db = getTestDb();
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

/**
 * Seed a recommendation directly via SQL so we don't have to drive the
 * normal recommend flow. Defaults to pipeline_stage='submitted' which is
 * the first kanban column.
 */
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
  const db = getTestDb();
  const employerIdRow = db.prepare('SELECT employer_id FROM jobs WHERE id = ?').get(opts.jobId) as { employer_id: string } | undefined;
  if (!employerIdRow) throw new Error(`job not found: ${opts.jobId}`);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO recommendations (id, headhunter_id, employer_id, anonymized_candidate_id,
                                 job_id, status, source_type, commission_split_json,
                                 referrer_headhunter_id, pipeline_stage, kanban_position,
                                 created_at, updated_at)
    VALUES (?, ?, ?, ?, ?,
            ?, 'headhunter', NULL,
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

describe('hunter-portal: kanban (handler + repo integration)', () => {
  beforeEach(() => {
    createTestApp();
    resetDb();
  });
  afterAll(() => closeTestDb());

  // -------- getBoard (lazy onboarding) ----------

  describe('getBoard', () => {
    it('first call seeds the 5 default columns in order, all with empty cards', () => {
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      const board = createHunterKanban(getTestDb()).getBoard(hunter);

      expect(board.columns).toHaveLength(5);
      expect(board.columns.map((c) => c.name)).toEqual([
        '投递', '简历过', '面试', 'Offer', '到岗',
      ]);
      expect(board.columns.map((c) => c.pipeline_stage)).toEqual([
        'submitted', 'screen_passed', 'interview', 'offer', 'onboarded',
      ]);
      expect(board.columns.map((c) => c.position)).toEqual([0, 1, 2, 3, 4]);
      for (const col of board.columns) {
        expect(col.cards).toEqual([]);
      }
    });

    it('idempotent: a second getBoard does not duplicate columns', () => {
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      const kb = createHunterKanban(getTestDb());
      const first = kb.getBoard(hunter);
      const second = kb.getBoard(hunter);
      expect(second.columns).toHaveLength(5);
      expect(second.columns.map((c) => c.id)).toEqual(first.columns.map((c) => c.id));
    });

    it('returns the matching cards after recommendations have been moved to columns', () => {
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      const j1 = seedJob({ id: 'job1' });
      const j2 = seedJob({ id: 'job2' });
      const j3 = seedJob({ id: 'job3' });
      const c1 = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      const c2 = seedCandidate({ userId: 'c2', headhunterId: 'h1' });
      const c3 = seedCandidate({ userId: 'c3', headhunterId: 'h1' });
      seedRecommendation({
        id: 'rec_a', headhunterId: 'h1', jobId: 'job1', anonId: c1.anonId,
        pipelineStage: 'submitted', kanbanPosition: 0,
      });
      seedRecommendation({
        id: 'rec_b', headhunterId: 'h1', jobId: 'job2', anonId: c2.anonId,
        pipelineStage: 'submitted', kanbanPosition: 1,
      });
      seedRecommendation({
        id: 'rec_c', headhunterId: 'h1', jobId: 'job3', anonId: c3.anonId,
        pipelineStage: 'screen_passed', kanbanPosition: 0,
      });

      const board = createHunterKanban(getTestDb()).getBoard(hunter);
      const submittedCol = board.columns.find((c) => c.pipeline_stage === 'submitted')!;
      const screenCol = board.columns.find((c) => c.pipeline_stage === 'screen_passed')!;
      expect(submittedCol.cards.map((c) => c.recommendation_id)).toEqual(['rec_a', 'rec_b']);
      expect(screenCol.cards.map((c) => c.recommendation_id)).toEqual(['rec_c']);
      // Empty columns stay empty.
      expect(board.columns.find((c) => c.pipeline_stage === 'interview')!.cards).toEqual([]);
    });

    it('does not leak another hunter\'s cards', () => {
      const h1 = seedUser({ id: 'h1', userType: 'headhunter' });
      const h2 = seedUser({ id: 'h2', userType: 'headhunter' });
      const j = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h2' });
      seedRecommendation({
        id: 'rec_h2', headhunterId: 'h2', jobId: 'job1', anonId: c.anonId,
        pipelineStage: 'submitted',
      });

      const kb = createHunterKanban(getTestDb());
      const board1 = kb.getBoard(h1);
      const board2 = kb.getBoard(h2);

      expect(board2.columns.find((x) => x.pipeline_stage === 'submitted')!.cards.map((cc) => cc.recommendation_id))
        .toEqual(['rec_h2']);
      // h1's board is empty — no columns shared (per-hunter kanban_columns),
      // and no shared cards.
      expect(board1.columns.flatMap((x) => x.cards)).toEqual([]);
      // Two distinct sets of column ids.
      const ids1 = board1.columns.map((c) => c.id);
      const ids2 = board2.columns.map((c) => c.id);
      expect(ids1.some((x) => ids2.includes(x))).toBe(false);
    });
  });

  // -------- moveCard ----------

  describe('moveCard', () => {
    function setupTwoCols(): {
      hunter: SeedUser;
      colSubmitted: KanbanColumnRow;
      colScreen: KanbanColumnRow;
    } {
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      const kb = createHunterKanban(getTestDb());
      const board = kb.getBoard(hunter);
      return {
        hunter,
        colSubmitted: board.columns.find((c) => c.pipeline_stage === 'submitted')!,
        colScreen: board.columns.find((c) => c.pipeline_stage === 'screen_passed')!,
      };
    }

    it('legal transition submitted → screen_passed updates stage + position', () => {
      const { hunter, colScreen } = setupTwoCols();
      const j = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      seedRecommendation({
        id: 'rec1', headhunterId: 'h1', jobId: 'job1', anonId: c.anonId,
        pipelineStage: 'submitted',
      });

      const moved = createHunterKanban(getTestDb()).moveCard(hunter, 'rec1', {
        to_column_id: colScreen.id, to_position: 0,
      });

      expect(moved.recommendation_id).toBe('rec1');
      expect(moved.pipeline_stage).toBe('screen_passed');
      expect(moved.kanban_position).toBe(0);
    });

    it('illegal transition submitted → offer throws invalidState', () => {
      const { hunter, colSubmitted } = setupTwoCols();
      const j = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      seedRecommendation({
        id: 'rec1', headhunterId: 'h1', jobId: 'job1', anonId: c.anonId,
        pipelineStage: 'submitted',
      });
      // Find the Offer column.
      const kb = createHunterKanban(getTestDb());
      const offerCol = kb.getBoard(hunter).columns.find((cc) => cc.pipeline_stage === 'offer')!;

      expectErrorCode(
        () => kb.moveCard(hunter, 'rec1', { to_column_id: offerCol.id }),
        'INVALID_STATE',
      );
    });

    it('same column + new position reorders with no stage change', async () => {
      const { hunter, colSubmitted } = setupTwoCols();
      const j1 = seedJob({ id: 'job1' });
      const j2 = seedJob({ id: 'job2' });
      const c1 = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      const c2 = seedCandidate({ userId: 'c2', headhunterId: 'h1' });
      seedRecommendation({
        id: 'rec1', headhunterId: 'h1', jobId: 'job1', anonId: c1.anonId,
        pipelineStage: 'submitted', kanbanPosition: 5,
      });
      // Bump the clock 1.1s so the second row's updated_at falls in a
      // distinct epoch second from rec1's. SQLite's strftime('%s', ...)
      // truncates to seconds, so inserts that share a second tie on
      // updated_at and the deterministic tie-break (id ASC) wins.
      await new Promise((r) => setTimeout(r, 1100));
      seedRecommendation({
        id: 'rec2', headhunterId: 'h1', jobId: 'job2', anonId: c2.anonId,
        pipelineStage: 'submitted', kanbanPosition: 9,
      });

      const kb = createHunterKanban(getTestDb());
      const moved = kb.moveCard(hunter, 'rec2', { to_column_id: colSubmitted.id, to_position: 0 });
      expect(moved.pipeline_stage).toBe('submitted');
      expect(moved.kanban_position).toBe(0);

      const board = kb.getBoard(hunter);
      const ids = board.columns.find((c) => c.pipeline_stage === 'submitted')!.cards.map((c) => c.recommendation_id);
      // rec2 was just updated AND is at the lower kanban_position, so it
      // sorts first. rec1 sits at the original position 5.
      expect(ids).toEqual(['rec2', 'rec1']);
    });

    it('throws notFound for a rec not owned by the hunter', () => {
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      const other = seedUser({ id: 'h2', userType: 'headhunter' });
      const j = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h2' });
      seedRecommendation({
        id: 'rec_other', headhunterId: 'h2', jobId: 'job1', anonId: c.anonId,
        pipelineStage: 'submitted',
      });
      const kb = createHunterKanban(getTestDb());
      const board = kb.getBoard(hunter);
      const screenCol = board.columns.find((cc) => cc.pipeline_stage === 'screen_passed')!;
      expectErrorCode(
        () => kb.moveCard(hunter, 'rec_other', { to_column_id: screenCol.id }),
        'NOT_FOUND',
      );
    });

    it('throws notFound for a non-existent column', () => {
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      const j = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      seedRecommendation({
        id: 'rec1', headhunterId: 'h1', jobId: 'job1', anonId: c.anonId,
        pipelineStage: 'submitted',
      });
      const kb = createHunterKanban(getTestDb());
      expectErrorCode(
        () => kb.moveCard(hunter, 'rec1', { to_column_id: 99999 }),
        'NOT_FOUND',
      );
    });
  });

  // -------- addCard (claim) ----------

  describe('addCard', () => {
    it('claims a pending_pickup rec and places it on the first column', () => {
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      const j = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      // pending_pickup with headhunter_id NULL means it's available to claim.
      seedRecommendation({
        id: 'rec_pp', headhunterId: null, jobId: 'job1', anonId: c.anonId,
        status: 'pending_pickup',
      });

      const kb = createHunterKanban(getTestDb());
      const board = kb.getBoard(hunter);
      const firstCol = board.columns.find((cc) => cc.position === 0)!;

      const card = kb.addCard(hunter, 'rec_pp', firstCol.id);
      expect(card.recommendation_id).toBe('rec_pp');
      expect(card.pipeline_stage).toBe('submitted');
      expect(card.kanban_position).toBe(0);

      // Underlying rec was claimed.
      const row = getTestDb().prepare(
        'SELECT headhunter_id, status, pipeline_stage, kanban_position FROM recommendations WHERE id = ?'
      ).get('rec_pp') as { headhunter_id: string; status: string; pipeline_stage: string; kanban_position: number };
      expect(row.headhunter_id).toBe('h1');
      // status is the existing application status — addCard does NOT change it.
      expect(row.pipeline_stage).toBe('submitted');
      expect(row.kanban_position).toBe(0);
    });

    it('throws invalidState for an already-claimed rec (headhunter_id != null)', () => {
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      seedUser({ id: 'h2', userType: 'headhunter' });
      const j = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h2' });
      // Already owned by h2.
      seedRecommendation({
        id: 'rec_claimed', headhunterId: 'h2', jobId: 'job1', anonId: c.anonId,
        status: 'pending_pickup',
      });
      const kb = createHunterKanban(getTestDb());
      const board = kb.getBoard(hunter);
      const firstCol = board.columns.find((cc) => cc.position === 0)!;

      expectErrorCode(
        () => kb.addCard(hunter, 'rec_claimed', firstCol.id),
        'INVALID_STATE',
      );
    });

    it('throws invalidState for a rec not in pending_pickup status', () => {
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      const j = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      seedRecommendation({
        id: 'rec_pending', headhunterId: null, jobId: 'job1', anonId: c.anonId,
        status: 'pending',
      });
      const kb = createHunterKanban(getTestDb());
      const board = kb.getBoard(hunter);
      const firstCol = board.columns.find((cc) => cc.position === 0)!;

      expectErrorCode(
        () => kb.addCard(hunter, 'rec_pending', firstCol.id),
        'INVALID_STATE',
      );
    });
  });

  // -------- removeCard ----------

  describe('removeCard', () => {
    it('moves a submitted card to rejected and returns the card', () => {
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      const j = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      seedRecommendation({
        id: 'rec1', headhunterId: 'h1', jobId: 'job1', anonId: c.anonId,
        pipelineStage: 'submitted',
      });
      const card = createHunterKanban(getTestDb()).removeCard(hunter, 'rec1');
      expect(card.recommendation_id).toBe('rec1');
      expect(card.pipeline_stage).toBe('rejected');

      // After remove, it should NOT show on the kanban (only non-terminal stages show).
      const board = createHunterKanban(getTestDb()).getBoard(hunter);
      const allCards = board.columns.flatMap((cc) => cc.cards);
      expect(allCards.find((cc) => cc.recommendation_id === 'rec1')).toBeUndefined();
    });

    it('throws invalidState for an onboarded (terminal) card', () => {
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      const j = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      seedRecommendation({
        id: 'rec_ob', headhunterId: 'h1', jobId: 'job1', anonId: c.anonId,
        pipelineStage: 'onboarded',
      });
      expectErrorCode(
        () => createHunterKanban(getTestDb()).removeCard(hunter, 'rec_ob'),
        'INVALID_STATE',
      );
    });

    it('throws invalidState for an already-rejected (terminal) card', () => {
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      const j = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h1' });
      seedRecommendation({
        id: 'rec_rj', headhunterId: 'h1', jobId: 'job1', anonId: c.anonId,
        pipelineStage: 'rejected',
      });
      expectErrorCode(
        () => createHunterKanban(getTestDb()).removeCard(hunter, 'rec_rj'),
        'INVALID_STATE',
      );
    });

    it('throws notFound for a rec not owned by the hunter', () => {
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      seedUser({ id: 'h2', userType: 'headhunter' });
      const j = seedJob({ id: 'job1' });
      const c = seedCandidate({ userId: 'c1', headhunterId: 'h2' });
      seedRecommendation({
        id: 'rec_other', headhunterId: 'h2', jobId: 'job1', anonId: c.anonId,
        pipelineStage: 'submitted',
      });
      expectErrorCode(
        () => createHunterKanban(getTestDb()).removeCard(hunter, 'rec_other'),
        'NOT_FOUND',
      );
    });
  });

  // -------- auth ----------

  describe('auth', () => {
    it('rejects non-headhunter callers with FORBIDDEN', () => {
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const employer = seedUser({ id: 'e1', userType: 'employer' });
      const kb = createHunterKanban(getTestDb());
      expectErrorCode(() => kb.getBoard(candidate), 'FORBIDDEN');
      expectErrorCode(() => kb.getBoard(employer), 'FORBIDDEN');
      expectErrorCode(
        () => kb.moveCard(candidate, 'r', { to_column_id: 1 }),
        'FORBIDDEN',
      );
      expectErrorCode(
        () => kb.addCard(candidate, 'r', 1),
        'FORBIDDEN',
      );
      expectErrorCode(
        () => kb.removeCard(candidate, 'r'),
        'FORBIDDEN',
      );
    });
  });
});