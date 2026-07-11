// tests/integration/pm/matches.test.ts
//
// PM Workbench (Phase 3b, Task 10) — Matches Repository + Handler integration
// tests.
//
// Covers:
//   - createMatchesRepo (UPSERT idempotency, listByPosition filter + paginate,
//     listAllByPosition, deleteByPosition)
//   - createMatchesHandler (PM auth, ownership guard, list empty + filled,
//     recompute populates matches, min_score filter, pagination,
//     cross-PM isolation)

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  getTestDb,
} from '../../helpers/test-app.js';
import { createProjectsHandler } from '../../../src/main/modules/pm/projects.js';
import { createPositionsHandler } from '../../../src/main/modules/pm/positions.js';
import { createMatchesHandler } from '../../../src/main/modules/pm/matches.js';
import { createMatchesRepo } from '../../../src/main/db/repositories/matches.js';
import { Errors, ApiError } from '../../../src/main/errors.js';
import type { User } from '../../../src/shared/types.js';

function seedUser(opts: {
  id: string;
  userType: 'pm' | 'hr' | 'candidate' | 'pm';
  name?: string;
  contact?: string | null;
}): User {
  const db = getTestDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, user_type, name, contact, agent_endpoint,
                       api_key_hash, api_key_prefix, api_key_expires_at,
                       prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
                       quota_per_day, quota_used, quota_reset_at, reputation,
                       status, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL,
            ?, 'hp_prefix_pm', NULL,
            NULL, NULL, NULL,
            300, 0, ?, 50,
            'active', ?, ?)
  `).run(
    opts.id,
    opts.userType,
    opts.name ?? `Test ${opts.userType}`,
    opts.contact ?? null,
    `hash_${opts.id}`,
    now,
    now,
    now,
  );
  return {
    id: opts.id,
    user_type: opts.userType,
    name: opts.name ?? `Test ${opts.userType}`,
    contact: opts.contact ?? null,
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

function seedCandidateUser(id: string, name?: string): User {
  return seedUser({ id, userType: 'candidate', name: name ?? `Candidate ${id}` });
}

/**
 * Seed a candidate with the full chain: users → candidates_private →
 * candidates_anonymized. Returns the candidate_user_id.
 */
function seedCandidate(opts: {
  id: string;
  name: string;
  industry?: string | null;
  title_level?: string | null;
  education?: string | null;
  skills?: string[];
  expected_salary?: number | null;
  location?: string | null;
  remote_ok?: boolean;
}): string {
  const db = getTestDb();
  // candidates_private.headhunter_id has FK to users(id) — seed a real
  // headhunter user the first time we need it.
  if (!db.prepare("SELECT 1 FROM users WHERE id = 'hh_test'").get()) {
    seedUser({ id: 'hh_test', userType: 'hr', name: 'Test Headhunter' });
  }
  seedUser({ id: opts.id, userType: 'candidate', name: opts.name });
  const now = new Date().toISOString();
  const privateId = `priv_${opts.id}`;
  const rawPayload: Record<string, unknown> = {};
  if (opts.location !== undefined) rawPayload.location = opts.location;
  if (opts.remote_ok !== undefined) rawPayload.remote_ok = opts.remote_ok;
  db.prepare(`
    INSERT INTO candidates_private (
      id, headhunter_id, candidate_user_id, name_enc, phone_enc, email_enc,
      current_company_raw, current_title_raw, expected_salary, years_experience,
      education_school, resume_url, skills_json, raw_payload_json,
      created_at, updated_at
    ) VALUES (?, 'hh_test', ?, '', '', '', NULL, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?)
  `).run(
    privateId,
    opts.id,
    opts.expected_salary ?? null,
    opts.skills ? JSON.stringify(opts.skills) : null,
    Object.keys(rawPayload).length > 0 ? JSON.stringify(rawPayload) : null,
    now,
    now,
  );
  const anonId = `anon_${opts.id}`;
  db.prepare(`
    INSERT INTO candidates_anonymized (
      id, source_private_id, source_headhunter_id, industry, title_level,
      years_experience, salary_range, education_tier, skills_json,
      is_public_pool, unlock_status, created_at, updated_at
    ) VALUES (?, ?, 'hh_test', ?, ?, NULL, NULL, ?, ?, 1, 'unlocked', ?, ?)
  `).run(
    anonId,
    privateId,
    opts.industry ?? null,
    opts.title_level ?? null,
    opts.education ?? null,
    opts.skills ? JSON.stringify(opts.skills) : null,
    now,
    now,
  );
  return opts.id;
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

function makeProject(pm: User, name = 'Test project'): { id: string; pm_user_id: string } {
  return createProjectsHandler(getTestDb()).createProject(pm, { name });
}

describe('pm: matches (handler + repo integration)', () => {
  beforeEach(() => {
    createTestApp();
    resetDb();
  });
  afterAll(() => closeTestDb());

  describe('repo (direct)', () => {
    it('upsert inserts a row', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      seedCandidateUser('cand_1', 'Alice');
      const repo = createMatchesRepo(getTestDb());

      repo.upsert({
        position_id: pos.id,
        candidate_user_id: 'cand_1',
        score: 80,
        reasons: ['技能匹配'],
        gaps: [],
      });

      const row = repo.findOne(pos.id, 'cand_1');
      expect(row).not.toBeNull();
      expect(row!.score).toBe(80);
      expect(row!.reasons).toEqual(['技能匹配']);
      expect(row!.gaps).toEqual([]);
    });

    it('upsert is idempotent on (position_id, candidate_user_id) and updates score', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      seedCandidateUser('c1');
      const repo = createMatchesRepo(getTestDb());

      repo.upsert({ position_id: pos.id, candidate_user_id: 'c1', score: 50, reasons: [], gaps: [] });
      repo.upsert({ position_id: pos.id, candidate_user_id: 'c1', score: 90, reasons: ['x'], gaps: ['y'] });

      const { matches, total } = repo.listByPosition(pos.id, {});
      expect(total).toBe(1);
      expect(matches[0].score).toBe(90);
      expect(matches[0].reasons).toEqual(['x']);
    });

    it('listByPosition orders by score DESC', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      seedCandidateUser('a');
      seedCandidateUser('b');
      seedCandidateUser('c');
      const repo = createMatchesRepo(getTestDb());

      repo.upsert({ position_id: pos.id, candidate_user_id: 'a', score: 30, reasons: [], gaps: [] });
      repo.upsert({ position_id: pos.id, candidate_user_id: 'b', score: 90, reasons: [], gaps: [] });
      repo.upsert({ position_id: pos.id, candidate_user_id: 'c', score: 60, reasons: [], gaps: [] });

      const { matches } = repo.listByPosition(pos.id, {});
      expect(matches.map((m) => m.candidate_user_id)).toEqual(['b', 'c', 'a']);
    });

    it('listByPosition filters by min_score', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      seedCandidateUser('a');
      seedCandidateUser('b');
      seedCandidateUser('c');
      const repo = createMatchesRepo(getTestDb());

      repo.upsert({ position_id: pos.id, candidate_user_id: 'a', score: 30, reasons: [], gaps: [] });
      repo.upsert({ position_id: pos.id, candidate_user_id: 'b', score: 90, reasons: [], gaps: [] });
      repo.upsert({ position_id: pos.id, candidate_user_id: 'c', score: 70, reasons: [], gaps: [] });

      const { matches, total } = repo.listByPosition(pos.id, { min_score: 60 });
      expect(total).toBe(2);
      expect(matches.map((m) => m.candidate_user_id).sort()).toEqual(['b', 'c']);
    });

    it('listByPosition respects limit and offset', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      const repo = createMatchesRepo(getTestDb());
      for (let i = 0; i < 5; i++) {
        seedCandidateUser(`c${i}`);
        repo.upsert({ position_id: pos.id, candidate_user_id: `c${i}`, score: 10 * i, reasons: [], gaps: [] });
      }

      const p1 = repo.listByPosition(pos.id, { limit: 2, offset: 0 });
      const p2 = repo.listByPosition(pos.id, { limit: 2, offset: 2 });
      expect(p1.matches).toHaveLength(2);
      expect(p2.matches).toHaveLength(2);
      expect(p1.total).toBe(5);
      expect(p2.total).toBe(5);
      expect(p1.matches[0].score).toBeGreaterThanOrEqual(p1.matches[1].score);
    });

    it('deleteByPosition removes all matches for a position', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      seedCandidateUser('a');
      seedCandidateUser('b');
      const repo = createMatchesRepo(getTestDb());

      repo.upsert({ position_id: pos.id, candidate_user_id: 'a', score: 50, reasons: [], gaps: [] });
      repo.upsert({ position_id: pos.id, candidate_user_id: 'b', score: 60, reasons: [], gaps: [] });
      const removed = repo.deleteByPosition(pos.id);
      expect(removed).toBe(2);
      const { total } = repo.listByPosition(pos.id, {});
      expect(total).toBe(0);
    });

    it('upsertMany wraps in BEGIN/COMMIT (all-or-nothing)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      seedCandidateUser('a');
      seedCandidateUser('b');
      seedCandidateUser('c');
      const repo = createMatchesRepo(getTestDb());

      const inserted = repo.upsertMany([
        { position_id: pos.id, candidate_user_id: 'a', score: 10, reasons: [], gaps: [] },
        { position_id: pos.id, candidate_user_id: 'b', score: 20, reasons: [], gaps: [] },
        { position_id: pos.id, candidate_user_id: 'c', score: 30, reasons: [], gaps: [] },
      ]);
      expect(inserted).toBe(3);
      const { total } = repo.listByPosition(pos.id, {});
      expect(total).toBe(3);
    });

    it('malformed JSON in reasons_json degrades to []', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      seedCandidateUser('cand_x');
      const repo = createMatchesRepo(getTestDb());
      getTestDb().prepare(`
        INSERT INTO matches (position_id, candidate_user_id, score, reasons_json, gaps_json, created_at)
        VALUES (?, 'cand_x', 50, 'not-json{', '[]', ?)
      `).run(pos.id, Date.now());
      const row = repo.findOne(pos.id, 'cand_x');
      expect(row).not.toBeNull();
      expect(row!.reasons).toEqual([]);
      expect(row!.gaps).toEqual([]);
    });
  });

  describe('list', () => {
    it('returns empty list and total=0 for a position with no matches', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      const handler = createMatchesHandler(getTestDb());

      const { matches, total } = handler.listMatches(pm, pos.id, {});
      expect(matches).toEqual([]);
      expect(total).toBe(0);
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const handler = createMatchesHandler(getTestDb());

      expectErrorCode(() => handler.listMatches(candidate, pos.id, {}), 'FORBIDDEN');
    });

    it('throws NOT_FOUND for a non-existent position', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createMatchesHandler(getTestDb());

      expectErrorCode(() => handler.listMatches(pm, 'pos_doesnotexist', {}), 'NOT_FOUND');
    });

    it('throws NOT_FOUND for a position owned by another PM (no leak)', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const pos = createPositionsHandler(getTestDb()).createPosition(pm1, project.id, { title: 'pos' });
      const handler = createMatchesHandler(getTestDb());

      expectErrorCode(() => handler.listMatches(pm2, pos.id, {}), 'NOT_FOUND');
    });

    it('rejects invalid min_score with INVALID_PARAMS', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      const handler = createMatchesHandler(getTestDb());

      expectErrorCode(
        () => handler.listMatches(pm, pos.id, { min_score: 150 }),
        'INVALID_PARAMS',
      );
    });

    it('hydrates candidate_display_name from users.name', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      seedCandidate({ id: 'cand_a', name: 'Alice' });
      const repo = createMatchesRepo(getTestDb());

      repo.upsert({ position_id: pos.id, candidate_user_id: 'cand_a', score: 75, reasons: ['技能匹配'], gaps: [] });

      const handler = createMatchesHandler(getTestDb());
      const { matches } = handler.listMatches(pm, pos.id, {});
      expect(matches).toHaveLength(1);
      expect(matches[0].candidate_user_id).toBe('cand_a');
      expect(matches[0].candidate_display_name).toBe('Alice');
      expect(matches[0].score).toBe(75);
    });

    it('filters by min_score and returns the un-paginated total', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      seedCandidateUser('a');
      seedCandidateUser('b');
      seedCandidateUser('c');
      const repo = createMatchesRepo(getTestDb());
      repo.upsert({ position_id: pos.id, candidate_user_id: 'a', score: 30, reasons: [], gaps: [] });
      repo.upsert({ position_id: pos.id, candidate_user_id: 'b', score: 90, reasons: [], gaps: [] });
      repo.upsert({ position_id: pos.id, candidate_user_id: 'c', score: 70, reasons: [], gaps: [] });

      const handler = createMatchesHandler(getTestDb());
      const r1 = handler.listMatches(pm, pos.id, { min_score: 60 });
      expect(r1.total).toBe(2);
      expect(r1.matches.every((m) => m.score >= 60)).toBe(true);

      const r2 = handler.listMatches(pm, pos.id, {});
      expect(r2.total).toBe(3);
    });

    it('respects limit + offset for pagination', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      const repo = createMatchesRepo(getTestDb());
      for (let i = 0; i < 5; i++) {
        seedCandidateUser(`c${i}`);
        repo.upsert({ position_id: pos.id, candidate_user_id: `c${i}`, score: 10 * (i + 1), reasons: [], gaps: [] });
      }

      const handler = createMatchesHandler(getTestDb());
      const page1 = handler.listMatches(pm, pos.id, { limit: 2, offset: 0 });
      const page2 = handler.listMatches(pm, pos.id, { limit: 2, offset: 2 });
      expect(page1.matches).toHaveLength(2);
      expect(page2.matches).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page2.total).toBe(5);
      const ids1 = new Set(page1.matches.map((m) => m.candidate_user_id));
      const ids2 = new Set(page2.matches.map((m) => m.candidate_user_id));
      for (const id of ids2) expect(ids1.has(id)).toBe(false);
    });
  });

  describe('recompute', () => {
    it('populates matches for all candidates with computed_count = N', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const positionsHandler = createPositionsHandler(getTestDb());
      const matchesHandler = createMatchesHandler(getTestDb());

      const pos = positionsHandler.createPosition(pm, project.id, {
        title: 'Senior Frontend',
        required_skills: ['vue', 'typescript'],
        title_level: 'senior',
        industry: 'fintech',
        salary_min: 30000,
        salary_max: 60000,
      });

      seedCandidate({
        id: 'cand_a',
        name: 'Alice',
        title_level: 'senior',
        industry: 'fintech',
        skills: ['vue', 'typescript', 'react'],
        education: 'bachelor',
        expected_salary: 45000,
        remote_ok: true,
        location: '上海',
      });
      seedCandidate({
        id: 'cand_b',
        name: 'Bob',
        title_level: 'junior',
        industry: 'gaming',
        skills: ['cobol'],
        education: 'highschool',
        expected_salary: 100000,
      });

      const result = matchesHandler.recomputeMatches(pm, pos.id);
      expect(result.computed_count).toBe(2);
      expect(result.top_matches).toHaveLength(2);
      expect(result.top_matches[0].candidate_user_id).toBe('cand_a');
      expect(result.top_matches[0].score).toBeGreaterThan(result.top_matches[1].score);
    });

    it('returns computed_count=0 and empty top_matches when there are no candidates', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      const handler = createMatchesHandler(getTestDb());

      const result = handler.recomputeMatches(pm, pos.id);
      expect(result.computed_count).toBe(0);
      expect(result.top_matches).toEqual([]);
    });

    it('is idempotent — re-running refreshes scores in place', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, {
        title: 'pos',
        required_skills: ['rust'],
      });
      seedCandidate({ id: 'cand_a', name: 'Alice', skills: ['rust'] });

      const handler = createMatchesHandler(getTestDb());
      const r1 = handler.recomputeMatches(pm, pos.id);
      const r2 = handler.recomputeMatches(pm, pos.id);

      expect(r1.computed_count).toBe(1);
      expect(r2.computed_count).toBe(1);
      const list = handler.listMatches(pm, pos.id, {});
      expect(list.total).toBe(1);
      expect(r2.top_matches[0].candidate_user_id).toBe('cand_a');
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const handler = createMatchesHandler(getTestDb());

      expectErrorCode(() => handler.recomputeMatches(candidate, pos.id), 'FORBIDDEN');
    });

    it('throws NOT_FOUND for a non-existent position', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createMatchesHandler(getTestDb());

      expectErrorCode(() => handler.recomputeMatches(pm, 'pos_doesnotexist'), 'NOT_FOUND');
    });

    it('throws NOT_FOUND for a position owned by another PM (no leak)', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const pos = createPositionsHandler(getTestDb()).createPosition(pm1, project.id, { title: 'pos' });
      const handler = createMatchesHandler(getTestDb());

      expectErrorCode(() => handler.recomputeMatches(pm2, pos.id), 'NOT_FOUND');
    });

    it('top_matches is capped at 5', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, { title: 'pos' });
      const handler = createMatchesHandler(getTestDb());

      for (let i = 0; i < 7; i++) {
        seedCandidate({ id: `cand_${i}`, name: `Cand ${i}`, skills: ['rust', 'go'] });
      }

      const result = handler.recomputeMatches(pm, pos.id);
      expect(result.computed_count).toBe(7);
      expect(result.top_matches.length).toBeLessThanOrEqual(5);
    });

    it('reasons / gaps are populated when skills overlap', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, {
        title: 'pos',
        required_skills: ['rust', 'k8s'],
      });
      seedCandidate({ id: 'cand_a', name: 'Alice', skills: ['rust', 'k8s', 'go'] });

      const handler = createMatchesHandler(getTestDb());
      const result = handler.recomputeMatches(pm, pos.id);
      expect(result.top_matches[0].reasons.some((r) => r.includes('技能'))).toBe(true);
      expect(result.top_matches[0].gaps).toEqual([]);
    });

    it('populates a 缺 x 经验 gap when candidate lacks required skills', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const pos = createPositionsHandler(getTestDb()).createPosition(pm, project.id, {
        title: 'pos',
        required_skills: ['rust', 'k8s', 'wasm'],
      });
      seedCandidate({ id: 'cand_a', name: 'Alice', skills: ['python'] });

      const handler = createMatchesHandler(getTestDb());
      const result = handler.recomputeMatches(pm, pos.id);
      const top = result.top_matches[0];
      expect(top.gaps.some((g) => g.includes('缺'))).toBe(true);
      expect(top.gaps.some((g) => g.includes('rust') || g.includes('k8s') || g.includes('wasm'))).toBe(true);
    });
  });
});