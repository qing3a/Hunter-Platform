// tests/integration/pm/positions.test.ts
//
// PM Workbench (Phase 3b, Task 5) — Positions Repository + Handler integration tests.
//
// Covers:
//   - createProjectPositionsRepo (CRUD + ownership via project_id)
//   - createPositionsHandler (PM auth, validation, ownership guard via project,
//     error semantics)
//   - status filter (open / paused / filled)
//   - bulk insert (used by Task 6 AI decompose)
//   - stats aggregation (total / open / paused / filled / headcount totals)
//
// Pattern matches tests/integration/pm/projects.test.ts: seed users + projects
// directly via SQL on the shared getTestDb(), then call the handler methods
// directly (HTTP routing is wired later in Task 17).

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  getTestDb,
} from '../../helpers/test-app.js';
import { createProjectsHandler } from '../../../src/main/modules/pm/projects.js';
import { createPositionsHandler } from '../../../src/main/modules/pm/positions.js';
import { createProjectPositionsRepo } from '../../../src/main/db/repositories/project-positions.js';
import { Errors, ApiError } from '../../../src/main/errors.js';
import type { User } from '../../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function seedUser(opts: {
  id: string;
  userType: 'pm' | 'headhunter' | 'candidate' | 'employer';
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pm: positions (handler + repo integration)', () => {
  beforeEach(() => {
    createTestApp();
    resetDb();
  });
  afterAll(() => closeTestDb());

  // -------- create ----------

  describe('create', () => {
    it('inserts a row with auto-generated id and default status=open', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      const position = handler.createPosition(pm, project.id, {
        title: 'Senior Frontend Engineer',
      });

      expect(position.id).toMatch(/^pos_[A-Za-z0-9_-]{12}$/);
      expect(position.project_id).toBe(project.id);
      expect(position.title).toBe('Senior Frontend Engineer');
      expect(position.status).toBe('open');
      expect(position.headcount_planned).toBe(1);
      expect(position.headcount_filled).toBe(0);
      expect(position.required_skills).toEqual([]);
      expect(position.created_at).toBeGreaterThan(0);
    });

    it('accepts all optional fields', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      const position = handler.createPosition(pm, project.id, {
        title: 'Backend Engineer',
        description: 'Build the API',
        required_skills: ['Node.js', 'PostgreSQL'],
        title_level: 'senior',
        industry: 'FinTech',
        salary_min: 20000,
        salary_max: 40000,
        headcount_planned: 3,
      });

      expect(position.title).toBe('Backend Engineer');
      expect(position.description).toBe('Build the API');
      expect(position.required_skills).toEqual(['Node.js', 'PostgreSQL']);
      expect(position.title_level).toBe('senior');
      expect(position.industry).toBe('FinTech');
      expect(position.salary_min).toBe(20000);
      expect(position.salary_max).toBe(40000);
      expect(position.headcount_planned).toBe(3);
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const handler = createPositionsHandler(getTestDb());

      expectErrorCode(
        () => handler.createPosition(candidate, project.id, { title: 'x' }),
        'FORBIDDEN',
      );
    });

    it('rejects empty title with INVALID_PARAMS', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      expectErrorCode(
        () => handler.createPosition(pm, project.id, { title: '' }),
        'INVALID_PARAMS',
      );
    });

    it('rejects title over 200 chars with INVALID_PARAMS', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());
      const long = 'x'.repeat(201);

      expectErrorCode(
        () => handler.createPosition(pm, project.id, { title: long }),
        'INVALID_PARAMS',
      );
    });

    it('rejects invalid status (create uses default, but extra fields go via strict zod)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      // Status is not part of CreatePositionSchema, so passing one should fail
      // because of .strict() — the schema rejects unknown keys.
      expectErrorCode(
        () => handler.createPosition(pm, project.id, { title: 'x', status: 'open' as never }),
        'INVALID_PARAMS',
      );
    });

    it('throws NOT_FOUND when project does not exist', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createPositionsHandler(getTestDb());

      expectErrorCode(
        () => handler.createPosition(pm, 'proj_doesnotexist', { title: 'x' }),
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND when project is owned by another PM', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const handler = createPositionsHandler(getTestDb());

      expectErrorCode(
        () => handler.createPosition(pm2, project.id, { title: 'hijack' }),
        'NOT_FOUND',
      );
    });
  });

  // -------- list ----------

  describe('list', () => {
    it('returns only positions of the project (scoped)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const p1 = makeProject(pm, 'p1');
      const p2 = makeProject(pm, 'p2');
      const handler = createPositionsHandler(getTestDb());

      handler.createPosition(pm, p1.id, { title: 'p1-pos-1' });
      handler.createPosition(pm, p1.id, { title: 'p1-pos-2' });
      handler.createPosition(pm, p2.id, { title: 'p2-pos-1' });

      const r1 = handler.listPositions(pm, p1.id, {});
      const r2 = handler.listPositions(pm, p2.id, {});

      expect(r1.positions.map((p) => p.title).sort()).toEqual(['p1-pos-1', 'p1-pos-2']);
      expect(r2.positions.map((p) => p.title)).toEqual(['p2-pos-1']);
      expect(r1.total).toBe(2);
      expect(r2.total).toBe(1);
    });

    it('returns empty list and total=0 for project with no positions', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      const { positions, total } = handler.listPositions(pm, project.id, {});
      expect(positions).toEqual([]);
      expect(total).toBe(0);
    });

    it('filters by status (exact match)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      const a = handler.createPosition(pm, project.id, { title: 'a' });
      handler.createPosition(pm, project.id, { title: 'b' });
      handler.updatePosition(pm, a.id, { status: 'paused' });

      const open = handler.listPositions(pm, project.id, { status: 'open' });
      const paused = handler.listPositions(pm, project.id, { status: 'paused' });

      expect(open.positions.every((p) => p.status === 'open')).toBe(true);
      expect(open.positions).toHaveLength(1);
      expect(paused.positions.every((p) => p.status === 'paused')).toBe(true);
      expect(paused.positions).toHaveLength(1);
    });

    it('rejects invalid status filter with INVALID_PARAMS', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      expectErrorCode(
        () => handler.listPositions(pm, project.id, { status: 'bogus' as never }),
        'INVALID_PARAMS',
      );
    });

    it('respects limit and offset for pagination', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      for (let i = 0; i < 5; i++) {
        handler.createPosition(pm, project.id, { title: `pos-${i}` });
      }

      const first = handler.listPositions(pm, project.id, { limit: 2, offset: 0 });
      const next = handler.listPositions(pm, project.id, { limit: 2, offset: 2 });
      expect(first.positions).toHaveLength(2);
      expect(next.positions).toHaveLength(2);
      expect(first.total).toBe(5);
      expect(next.total).toBe(5);
    });

    it('throws NOT_FOUND for project owned by another PM (no leak)', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const handler = createPositionsHandler(getTestDb());

      expectErrorCode(
        () => handler.listPositions(pm2, project.id, {}),
        'NOT_FOUND',
      );
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const handler = createPositionsHandler(getTestDb());

      expectErrorCode(
        () => handler.listPositions(candidate, project.id, {}),
        'FORBIDDEN',
      );
    });
  });

  // -------- detail (get) ----------

  describe('get', () => {
    it('returns the position with computed stats', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      const created = handler.createPosition(pm, project.id, {
        title: 'Engineer',
        required_skills: ['Go'],
        headcount_planned: 3,
      });

      const detail = handler.getPosition(pm, created.id);
      expect(detail.position.id).toBe(created.id);
      expect(detail.position.title).toBe('Engineer');
      expect(detail.stats.headcount_planned).toBe(3);
      expect(detail.stats.headcount_filled).toBe(0);
      expect(detail.stats.is_complete).toBe(false);
    });

    it('marks is_complete=true when headcount_filled >= headcount_planned', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      const created = handler.createPosition(pm, project.id, {
        title: 'Engineer',
        headcount_planned: 2,
      });
      handler.updatePosition(pm, created.id, { headcount_filled: 2 });

      const detail = handler.getPosition(pm, created.id);
      expect(detail.stats.is_complete).toBe(true);
    });

    it('throws NOT_FOUND for a non-existent id', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createPositionsHandler(getTestDb());

      expectErrorCode(() => handler.getPosition(pm, 'pos_doesnotexist'), 'NOT_FOUND');
    });

    it('throws NOT_FOUND for a position owned by another PM (via project)', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const handler = createPositionsHandler(getTestDb());

      const pos = handler.createPosition(pm1, project.id, { title: 'x' });
      expectErrorCode(() => handler.getPosition(pm2, pos.id), 'NOT_FOUND');
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const handler = createPositionsHandler(getTestDb());

      const pos = handler.createPosition(pm, project.id, { title: 'x' });
      expectErrorCode(() => handler.getPosition(candidate, pos.id), 'FORBIDDEN');
    });
  });

  // -------- update ----------

  describe('update', () => {
    it('patches mutable fields', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      const created = handler.createPosition(pm, project.id, { title: 'orig' });
      const updated = handler.updatePosition(pm, created.id, {
        title: 'revised',
        description: 'new desc',
        required_skills: ['Rust', 'WASM'],
        title_level: 'staff',
        salary_min: 30000,
        salary_max: 60000,
        headcount_planned: 5,
        status: 'paused',
        headcount_filled: 1,
      });

      expect(updated.title).toBe('revised');
      expect(updated.description).toBe('new desc');
      expect(updated.required_skills).toEqual(['Rust', 'WASM']);
      expect(updated.title_level).toBe('staff');
      expect(updated.salary_min).toBe(30000);
      expect(updated.salary_max).toBe(60000);
      expect(updated.headcount_planned).toBe(5);
      expect(updated.status).toBe('paused');
      expect(updated.headcount_filled).toBe(1);
    });

    it('allows partial patch', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      const created = handler.createPosition(pm, project.id, {
        title: 'orig',
        headcount_planned: 2,
      });
      const updated = handler.updatePosition(pm, created.id, { title: 'renamed' });

      expect(updated.title).toBe('renamed');
      expect(updated.headcount_planned).toBe(2);
    });

    it('rejects invalid status with INVALID_PARAMS', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      const created = handler.createPosition(pm, project.id, { title: 'x' });
      expectErrorCode(
        () => handler.updatePosition(pm, created.id, { status: 'bogus' as never }),
        'INVALID_PARAMS',
      );
    });

    it('throws NOT_FOUND for non-existent id', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createPositionsHandler(getTestDb());

      expectErrorCode(
        () => handler.updatePosition(pm, 'pos_doesnotexist', { title: 'x' }),
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND for a position owned by another PM (no leak)', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const handler = createPositionsHandler(getTestDb());

      const pos = handler.createPosition(pm1, project.id, { title: 'x' });
      expectErrorCode(
        () => handler.updatePosition(pm2, pos.id, { title: 'hijack' }),
        'NOT_FOUND',
      );
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const handler = createPositionsHandler(getTestDb());

      const pos = handler.createPosition(pm, project.id, { title: 'x' });
      expectErrorCode(
        () => handler.updatePosition(candidate, pos.id, { title: 'y' }),
        'FORBIDDEN',
      );
    });
  });

  // -------- delete ----------

  describe('delete', () => {
    it('removes the row and returns {deleted: true}', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      const pos = handler.createPosition(pm, project.id, { title: 'x' });
      const result = handler.deletePosition(pm, pos.id);
      expect(result.deleted).toBe(true);
      expectErrorCode(() => handler.getPosition(pm, pos.id), 'NOT_FOUND');
    });

    it('throws NOT_FOUND for non-existent id', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createPositionsHandler(getTestDb());

      expectErrorCode(
        () => handler.deletePosition(pm, 'pos_doesnotexist'),
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND for a position owned by another PM (no leak)', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const handler = createPositionsHandler(getTestDb());

      const pos = handler.createPosition(pm1, project.id, { title: 'x' });
      expectErrorCode(() => handler.deletePosition(pm2, pos.id), 'NOT_FOUND');

      // The row should still exist for the owner.
      const detail = handler.getPosition(pm1, pos.id);
      expect(detail.position.id).toBe(pos.id);
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const handler = createPositionsHandler(getTestDb());

      const pos = handler.createPosition(pm, project.id, { title: 'x' });
      expectErrorCode(() => handler.deletePosition(candidate, pos.id), 'FORBIDDEN');
    });
  });

  // -------- bulk insert (used by Task 6 AI decompose) ----------

  describe('bulk', () => {
    it('inserts multiple positions atomically and returns them in input order', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      const items = [
        { title: 'PM Lead', headcount_planned: 1, required_skills: ['Agile'] },
        { title: 'Tech Lead', headcount_planned: 1, required_skills: ['Go', 'K8s'] },
        { title: 'Engineer', headcount_planned: 3, required_skills: ['Go'] },
      ];
      const result = handler.bulkCreate(pm, project.id, { items });

      expect(result.positions).toHaveLength(3);
      expect(result.positions.map((p) => p.title)).toEqual(['PM Lead', 'Tech Lead', 'Engineer']);
      expect(result.positions.every((p) => p.project_id === project.id)).toBe(true);

      // Verify all three are visible via list.
      const list = handler.listPositions(pm, project.id, {});
      expect(list.total).toBe(3);
    });

    it('rejects empty items array', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      expectErrorCode(
        () => handler.bulkCreate(pm, project.id, { items: [] }),
        'INVALID_PARAMS',
      );
    });

    it('throws NOT_FOUND when project is owned by another PM', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const handler = createPositionsHandler(getTestDb());

      expectErrorCode(
        () => handler.bulkCreate(pm2, project.id, { items: [{ title: 'x' }] }),
        'NOT_FOUND',
      );
    });
  });

  // -------- stats (used by project detail Overview tab) ----------

  describe('stats', () => {
    it('aggregates counts and headcount sums across a project', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      const a = handler.createPosition(pm, project.id, {
        title: 'a',
        headcount_planned: 2,
      });
      handler.createPosition(pm, project.id, {
        title: 'b',
        headcount_planned: 3,
      });
      handler.createPosition(pm, project.id, {
        title: 'c',
        headcount_planned: 1,
      });
      handler.updatePosition(pm, a.id, {
        status: 'paused',
        headcount_filled: 0,
      });

      const stats = handler.stats(pm, project.id);
      expect(stats.total).toBe(3);
      expect(stats.open).toBe(2);
      expect(stats.paused).toBe(1);
      expect(stats.filled).toBe(0);
      expect(stats.headcount_planned_total).toBe(6);
      expect(stats.headcount_filled_total).toBe(0);
    });

    it('returns zeros for project with no positions', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPositionsHandler(getTestDb());

      const stats = handler.stats(pm, project.id);
      expect(stats.total).toBe(0);
      expect(stats.open).toBe(0);
      expect(stats.paused).toBe(0);
      expect(stats.filled).toBe(0);
      expect(stats.headcount_planned_total).toBe(0);
      expect(stats.headcount_filled_total).toBe(0);
    });

    it('throws NOT_FOUND for project owned by another PM', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const handler = createPositionsHandler(getTestDb());

      expectErrorCode(() => handler.stats(pm2, project.id), 'NOT_FOUND');
    });
  });

  // -------- repo-level checks (defense in depth) ----------

  describe('repo (direct)', () => {
    it('insert then findById returns the row with required_skills parsed', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const repo = createProjectPositionsRepo(getTestDb());

      const pos = repo.insert(project.id, {
        title: 'repo test',
        required_skills: ['Python', 'AWS'],
      });
      expect(pos.required_skills).toEqual(['Python', 'AWS']);

      const fetched = repo.findById(pos.id, project.id);
      expect(fetched?.title).toBe('repo test');
      expect(fetched?.required_skills).toEqual(['Python', 'AWS']);
    });

    it('findById returns null for unknown id', () => {
      seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject({ id: 'pm1', user_type: 'pm' } as unknown as User);
      const repo = createProjectPositionsRepo(getTestDb());
      expect(repo.findById('pos_unknown', project.id)).toBeNull();
    });

    it('update returns false for unknown id and true after update', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const repo = createProjectPositionsRepo(getTestDb());

      const pos = repo.insert(project.id, { title: 'a' });
      expect(repo.update('pos_unknown', project.id, { title: 'x' })).toBe(false);
      expect(repo.update(pos.id, project.id, { title: 'b' })).toBe(true);
    });

    it('delete returns false for unknown id and true after delete', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const repo = createProjectPositionsRepo(getTestDb());

      const pos = repo.insert(project.id, { title: 'a' });
      expect(repo.delete('pos_unknown', project.id)).toBe(false);
      expect(repo.delete(pos.id, project.id)).toBe(true);
    });

    it('bulkInsert creates multiple positions and returns them in input order', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const repo = createProjectPositionsRepo(getTestDb());

      const created = repo.bulkInsert(project.id, [
        { title: 'a' },
        { title: 'b' },
        { title: 'c' },
      ]);
      expect(created).toHaveLength(3);
      expect(created.map((p) => p.title)).toEqual(['a', 'b', 'c']);
    });

    it('stats returns correct aggregates', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const repo = createProjectPositionsRepo(getTestDb());

      const a = repo.insert(project.id, { title: 'a', headcount_planned: 2 });
      repo.insert(project.id, { title: 'b', headcount_planned: 1 });
      repo.update(a.id, project.id, { status: 'filled', headcount_filled: 2 });

      const stats = repo.stats(project.id);
      expect(stats.total).toBe(2);
      expect(stats.filled).toBe(1);
      expect(stats.open).toBe(1);
      expect(stats.headcount_planned_total).toBe(3);
      expect(stats.headcount_filled_total).toBe(2);
    });
  });
});
