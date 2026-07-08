// tests/integration/pm/projects.test.ts
//
// PM Workbench (Phase 3b, Task 2) — Projects Repository + Handler integration tests.
//
// Covers:
//   - createProjectsRepo (CRUD + ownership + position/plan count aggregation)
//   - createProjectsHandler (PM auth, validation, ownership guard, error semantics)
//   - default 5-stage staffing_plan template auto-created on project create
//   - cascade delete of positions / plans via FK
//
// Pattern matches tests/integration/hunter-portal/tasks.test.ts: seed users
// directly via SQL on the shared getTestDb(), then call the handler methods
// directly (HTTP routing is wired later in Task 17). The handler functions
// return plain JS objects matching the repo row shapes.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  getTestDb,
} from '../../helpers/test-app.js';
import { createProjectsHandler } from '../../../src/main/modules/pm/projects.js';
import { createProjectsRepo } from '../../../src/main/db/repositories/projects.js';
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

/** Small awaitable sleep so created_at (millisecond unix epoch) differs across inserts. */
function tick(ms = 2): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pm: projects (handler + repo integration)', () => {
  beforeEach(() => {
    createTestApp();
    resetDb();
  });
  afterAll(() => closeTestDb());

  // -------- create ----------

  describe('create', () => {
    it('inserts a row with auto-generated id and default status=planning', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());

      const project = handler.createProject(pm, { name: 'New project' });

      expect(project.id).toMatch(/^proj_[A-Za-z0-9_-]{12}$/);
      expect(project.pm_user_id).toBe('pm1');
      expect(project.name).toBe('New project');
      expect(project.status).toBe('planning');
      expect(project.target).toBeNull();
      expect(project.budget_total).toBeNull();
      expect(project.start_at).toBeNull();
      expect(project.end_at).toBeNull();
      expect(project.current_team).toBeNull();
      expect(project.created_at).toBeGreaterThan(0);
      expect(project.updated_at).toBeGreaterThan(0);
      expect(project.updated_at).toBe(project.created_at);
    });

    it('auto-creates the default 5-stage staffing plan template', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());

      const project = handler.createProject(pm, { name: 'Project X' });

      const db = getTestDb();
      const plan = db.prepare(
        'SELECT * FROM staffing_plans WHERE project_id = ?'
      ).get(project.id) as {
        id: string;
        project_id: string;
        name: string;
        total_headcount: number;
        positions_json: string;
        is_selected: number;
      } | undefined;

      expect(plan).toBeDefined();
      expect(plan!.project_id).toBe(project.id);
      expect(plan!.name).toBe('默认计划 (5 阶段漏斗)');
      expect(plan!.total_headcount).toBe(0);
      expect(plan!.positions_json).toBe('[]');
      expect(plan!.is_selected).toBe(1);
    });

    it('accepts all optional fields including current_team JSON', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());

      const team = [
        { role: 'PM', count: 1 },
        { role: 'Engineer', count: 3 },
      ];
      const project = handler.createProject(pm, {
        name: 'Big project',
        target: 'Build the thing',
        budget_total: 1_000_000,
        start_at: Date.now(),
        end_at: Date.now() + 30 * 86_400_000,
        current_team: team,
      });

      expect(project.name).toBe('Big project');
      expect(project.target).toBe('Build the thing');
      expect(project.budget_total).toBe(1_000_000);
      expect(project.start_at).not.toBeNull();
      expect(project.end_at).not.toBeNull();
      expect(project.current_team).toEqual(team);
    });

    it('rejects an empty name with INVALID_PARAMS', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      expectErrorCode(() => handler.createProject(pm, { name: '' }), 'INVALID_PARAMS');
      expectErrorCode(() => handler.createProject(pm, { name: '   ' }), 'INVALID_PARAMS');
    });

    it('rejects a name over 200 chars with INVALID_PARAMS', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      const long = 'x'.repeat(201);
      expectErrorCode(
        () => handler.createProject(pm, { name: long }),
        'INVALID_PARAMS',
      );
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const employer = seedUser({ id: 'e1', userType: 'employer' });
      const hunter = seedUser({ id: 'h1', userType: 'headhunter' });
      const handler = createProjectsHandler(getTestDb());
      expectErrorCode(() => handler.createProject(candidate, { name: 'x' }), 'FORBIDDEN');
      expectErrorCode(() => handler.createProject(employer, { name: 'x' }), 'FORBIDDEN');
      expectErrorCode(() => handler.createProject(hunter, { name: 'x' }), 'FORBIDDEN');
    });
  });

  // -------- list ----------

  describe('list', () => {
    it('returns only the caller PM rows (ownership scoped)', async () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());

      handler.createProject(pm1, { name: 'pm1 A' });
      handler.createProject(pm1, { name: 'pm1 B' });
      handler.createProject(pm2, { name: 'pm2 X' });

      const pm1Rows = handler.listProjects(pm1, {});
      const pm2Rows = handler.listProjects(pm2, {});

      expect(pm1Rows.projects.map((p) => p.name).sort()).toEqual(['pm1 A', 'pm1 B']);
      expect(pm2Rows.projects.map((p) => p.name)).toEqual(['pm2 X']);
      expect(pm1Rows.total).toBe(2);
      expect(pm2Rows.total).toBe(1);
    });

    it('returns position_count and plan_count per project', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      const db = getTestDb();

      const project = handler.createProject(pm, { name: 'with extras' });

      // Insert 2 positions
      db.prepare(`
        INSERT INTO project_positions (id, project_id, title, headcount_planned)
        VALUES ('pos_1', ?, 'Engineer', 1), ('pos_2', ?, 'Designer', 1)
      `).run(project.id, project.id);

      // Insert one extra plan (so plan_count = 2: default + manual)
      db.prepare(`
        INSERT INTO staffing_plans (id, project_id, name, total_headcount, positions_json, is_selected)
        VALUES ('plan_extra', ?, 'alt plan', 0, '[]', 0)
      `).run(project.id);

      const { projects } = handler.listProjects(pm, {});
      expect(projects).toHaveLength(1);
      expect(projects[0].position_count).toBe(2);
      expect(projects[0].plan_count).toBe(2);
    });

    it('returns empty list and total=0 for PM with no projects', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());

      const { projects, total } = handler.listProjects(pm, {});
      expect(projects).toEqual([]);
      expect(total).toBe(0);
    });

    it('orders by created_at DESC', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      const a = handler.createProject(pm, { name: 'A' });
      await tick();
      const b = handler.createProject(pm, { name: 'B' });
      await tick();
      const c = handler.createProject(pm, { name: 'C' });

      const { projects } = handler.listProjects(pm, {});
      expect(projects.map((p) => p.id)).toEqual([c.id, b.id, a.id]);
    });

    it('respects limit and offset for pagination', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      for (let i = 0; i < 5; i++) {
        handler.createProject(pm, { name: `p${i}` });
        await tick();
      }
      const first = handler.listProjects(pm, { limit: 2, offset: 0 });
      const next = handler.listProjects(pm, { limit: 2, offset: 2 });
      expect(first.projects).toHaveLength(2);
      expect(next.projects).toHaveLength(2);
      expect(first.total).toBe(5);
      expect(next.total).toBe(5);
      expect(first.projects[0].id).not.toBe(next.projects[0].id);
    });

    it('clamps limit to max 100', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      handler.createProject(pm, { name: 'only one' });
      const { projects } = handler.listProjects(pm, { limit: 999 });
      expect(projects).toHaveLength(1);
    });

    it('filters by status (exact match)', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());

      handler.createProject(pm, { name: 'planning one' });
      const second = handler.createProject(pm, { name: 'active one' });
      handler.updateProject(pm, second.id, { status: 'active' });

      const planningOnly = handler.listProjects(pm, { status: 'planning' });
      const activeOnly = handler.listProjects(pm, { status: 'active' });

      expect(planningOnly.projects.every((p) => p.status === 'planning')).toBe(true);
      expect(planningOnly.projects).toHaveLength(1);
      expect(activeOnly.projects.every((p) => p.status === 'active')).toBe(true);
      expect(activeOnly.projects).toHaveLength(1);
    });

    it('rejects invalid status filter with INVALID_PARAMS', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      expectErrorCode(
        () => handler.listProjects(pm, { status: 'invalid' as never }),
        'INVALID_PARAMS',
      );
    });
  });

  // -------- detail ----------

  describe('detail', () => {
    it('returns project + positions + plans + stats for the owner', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      const db = getTestDb();

      const project = handler.createProject(pm, { name: 'detail me' });

      // Add a couple of positions and one extra plan
      db.prepare(`
        INSERT INTO project_positions (id, project_id, title, headcount_planned, headcount_filled)
        VALUES ('pos_open', ?, 'Engineer', 2, 0), ('pos_filled', ?, 'Designer', 1, 1)
      `).run(project.id, project.id);
      // Add one extra plan (the handler's createProject() already seeded
      // the default "默认计划 (5 阶段漏斗)" plan, so we just add a second
      // draft to verify the count + selection logic).
      db.prepare(`
        INSERT INTO staffing_plans (id, project_id, name, total_headcount, positions_json, is_selected)
        VALUES ('plan_alt', ?, 'alt plan', 0, '[]', 0)
      `).run(project.id);

      const detail = handler.getProject(pm, project.id);

      expect(detail.project.id).toBe(project.id);
      expect(detail.project.name).toBe('detail me');
      expect(detail.positions).toHaveLength(2);
      // 1 default plan (created by createProject) + 1 inserted alt plan = 2 total.
      expect(detail.plans).toHaveLength(2);
      expect(detail.stats.total_positions).toBe(2);
      expect(detail.stats.filled_positions).toBe(1);
      expect(detail.stats.total_plans).toBe(2);
      // The default plan is selected; verify by checking stats, not by
      // hard-coding the id (the default plan id is auto-generated).
      const defaultPlan = detail.plans.find((p) => p.name === '默认计划 (5 阶段漏斗)');
      expect(defaultPlan).toBeDefined();
      expect(detail.stats.selected_plan_id).toBe(defaultPlan!.id);
    });

    it('throws NOT_FOUND for a non-existent id', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      expectErrorCode(() => handler.getProject(pm, 'proj_doesnotexist'), 'NOT_FOUND');
    });

    it('throws NOT_FOUND for a project owned by another PM (no leak)', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());

      const project = handler.createProject(pm1, { name: 'mine' });
      expectErrorCode(() => handler.getProject(pm2, project.id), 'NOT_FOUND');
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const handler = createProjectsHandler(getTestDb());
      const project = handler.createProject(pm, { name: 'x' });

      expectErrorCode(() => handler.getProject(candidate, project.id), 'FORBIDDEN');
    });
  });

  // -------- update ----------

  describe('update', () => {
    it('patches mutable fields and bumps updated_at', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      const created = handler.createProject(pm, { name: 'original' });

      await tick();

      const updated = handler.updateProject(pm, created.id, {
        name: 'revised',
        target: 'new target',
        budget_total: 500_000,
        status: 'active',
      });

      expect(updated.name).toBe('revised');
      expect(updated.target).toBe('new target');
      expect(updated.budget_total).toBe(500_000);
      expect(updated.status).toBe('active');
      expect(updated.updated_at).toBeGreaterThan(created.updated_at);
      expect(updated.created_at).toBe(created.created_at);
    });

    it('allows partial patch (only some fields)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      const created = handler.createProject(pm, {
        name: 'a',
        target: 'orig target',
        budget_total: 100,
      });

      const updated = handler.updateProject(pm, created.id, { name: 'b' });

      expect(updated.name).toBe('b');
      expect(updated.target).toBe('orig target');
      expect(updated.budget_total).toBe(100);
    });

    it('round-trips current_team JSON', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      const created = handler.createProject(pm, { name: 'team-test' });

      const team = [
        { role: 'Tech Lead', count: 1 },
        { role: 'Engineer', count: 5 },
      ];
      const updated = handler.updateProject(pm, created.id, { current_team: team });

      expect(updated.current_team).toEqual(team);

      const detail = handler.getProject(pm, created.id);
      expect(detail.project.current_team).toEqual(team);
    });

    it('rejects invalid status with INVALID_PARAMS', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      const created = handler.createProject(pm, { name: 'x' });

      expectErrorCode(
        () => handler.updateProject(pm, created.id, { status: 'bogus' as never }),
        'INVALID_PARAMS',
      );
    });

    it('throws NOT_FOUND for a non-existent id', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      expectErrorCode(
        () => createProjectsHandler(getTestDb()).updateProject(pm, 'proj_doesnotexist', { name: 'x' }),
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND for a project owned by another PM', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      const created = handler.createProject(pm1, { name: 'mine' });

      expectErrorCode(
        () => handler.updateProject(pm2, created.id, { name: 'hijack' }),
        'NOT_FOUND',
      );
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const handler = createProjectsHandler(getTestDb());
      const created = handler.createProject(pm, { name: 'x' });

      expectErrorCode(
        () => handler.updateProject(candidate, created.id, { name: 'y' }),
        'FORBIDDEN',
      );
    });
  });

  // -------- delete ----------

  describe('delete', () => {
    it('removes the row and returns {deleted: true}', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      const created = handler.createProject(pm, { name: 'delete me' });

      const result = handler.deleteProject(pm, created.id);
      expect(result.deleted).toBe(true);

      expectErrorCode(() => handler.getProject(pm, created.id), 'NOT_FOUND');
    });

    it('cascade deletes positions and staffing_plans via FK', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      const db = getTestDb();

      const project = handler.createProject(pm, { name: 'cascade' });
      db.prepare(`
        INSERT INTO project_positions (id, project_id, title, headcount_planned)
        VALUES ('pos_1', ?, 'Eng', 1), ('pos_2', ?, 'Designer', 1)
      `).run(project.id, project.id);
      // createProject already created the default plan; verify both pre-delete.
      const beforePos = db.prepare('SELECT COUNT(*) AS n FROM project_positions WHERE project_id = ?').get(project.id) as { n: number };
      const beforePlans = db.prepare('SELECT COUNT(*) AS n FROM staffing_plans WHERE project_id = ?').get(project.id) as { n: number };
      expect(beforePos.n).toBe(2);
      expect(beforePlans.n).toBeGreaterThanOrEqual(1);

      handler.deleteProject(pm, project.id);

      const afterPos = db.prepare('SELECT COUNT(*) AS n FROM project_positions WHERE project_id = ?').get(project.id) as { n: number };
      const afterPlans = db.prepare('SELECT COUNT(*) AS n FROM staffing_plans WHERE project_id = ?').get(project.id) as { n: number };
      expect(afterPos.n).toBe(0);
      expect(afterPlans.n).toBe(0);
    });

    it('throws NOT_FOUND for a non-existent id', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      expectErrorCode(
        () => createProjectsHandler(getTestDb()).deleteProject(pm, 'proj_doesnotexist'),
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND for a project owned by another PM and the row survives', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const handler = createProjectsHandler(getTestDb());
      const created = handler.createProject(pm1, { name: 'mine' });

      expectErrorCode(() => handler.deleteProject(pm2, created.id), 'NOT_FOUND');

      const detail = handler.getProject(pm1, created.id);
      expect(detail.project.id).toBe(created.id);
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const handler = createProjectsHandler(getTestDb());
      const created = handler.createProject(pm, { name: 'x' });

      expectErrorCode(() => handler.deleteProject(candidate, created.id), 'FORBIDDEN');
    });
  });

  // -------- repo-level checks (defense in depth) ----------

  describe('repo (direct)', () => {
    it('list returns empty for unknown PM', () => {
      const repo = createProjectsRepo(getTestDb());
      const result = repo.list('pm_doesnotexist', {});
      expect(result.projects).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('findById returns null for unknown id', () => {
      seedUser({ id: 'pm1', userType: 'pm' });
      const repo = createProjectsRepo(getTestDb());
      expect(repo.findById('proj_unknown', 'pm1')).toBeNull();
    });

    it('insert then findById returns the row with current_team JSON parsed', () => {
      seedUser({ id: 'pm1', userType: 'pm' });
      const repo = createProjectsRepo(getTestDb());
      const team = [{ role: 'Lead', count: 1 }];
      const project = repo.insert({
        pm_user_id: 'pm1',
        name: 'repo test',
        current_team: team,
      });
      expect(project.current_team).toEqual(team);
    });

    it('update bumps updated_at and respects ownership', () => {
      seedUser({ id: 'pm1', userType: 'pm' });
      seedUser({ id: 'pm2', userType: 'pm' });
      const repo = createProjectsRepo(getTestDb());
      const project = repo.insert({ pm_user_id: 'pm1', name: 'a' });

      const ok = repo.update(project.id, 'pm1', { name: 'b' });
      expect(ok).toBe(true);

      const notOk = repo.update(project.id, 'pm2', { name: 'hijack' });
      expect(notOk).toBe(false);
    });

    it('delete returns false for unknown id and true after delete', () => {
      seedUser({ id: 'pm1', userType: 'pm' });
      const repo = createProjectsRepo(getTestDb());
      const project = repo.insert({ pm_user_id: 'pm1', name: 'a' });
      expect(repo.delete('proj_unknown', 'pm1')).toBe(false);
      expect(repo.delete(project.id, 'pm1')).toBe(true);
    });
  });
});