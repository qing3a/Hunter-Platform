// tests/integration/pm/plans.test.ts
//
// PM Workbench (Phase 3b, Task 7) — Staffing Plans Repository + Handler
// integration tests.
//
// Covers:
//   - createStaffingPlansRepo (CRUD + setSelected transactional + JSON round-trip)
//   - createPlansHandler (PM auth, validation, ownership guard, error semantics)
//   - uniqueness invariant for is_selected (only one selected plan per project)
//   - positions_json round-trip (parse on read, stringify on write)
//   - default plan auto-created by projects.create is already selected
//   - setSelected cross-project isolation (selecting plan X in project A
//     does NOT unselect plans in project B)
//
// Pattern matches tests/integration/pm/positions.test.ts.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  getTestDb,
} from '../../helpers/test-app.js';
import { createProjectsHandler } from '../../../src/main/modules/pm/projects.js';
import { createPlansHandler } from '../../../src/main/modules/pm/plans.js';
import { createStaffingPlansRepo } from '../../../src/main/db/repositories/staffing-plans.js';
import { ApiError } from '../../../src/main/errors.js';
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

function makeProject(pm: User, name = "Test project"): { id: string; pm_user_id: string } {
  const handler = createProjectsHandler(getTestDb());
  return handler.createProject(pm, { name });
}

/** Small awaitable sleep so created_at (millisecond unix epoch) differs across inserts. */
function tick(ms = 2): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('pm: plans (handler + repo integration)', () => {
  beforeEach(() => {
    createTestApp();
    resetDb();
  });
  afterAll(() => closeTestDb());

  // -------- list ----------

  describe('list', () => {
    it('returns the auto-created default plan for a fresh project', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const { plans, total } = handler.listPlans(pm, project.id, {});

      expect(total).toBe(1);
      expect(plans).toHaveLength(1);
      expect(plans[0]?.name).toMatch(/默认计划/);
      expect(plans[0]?.is_selected).toBe(1);
      expect(plans[0]?.project_id).toBe(project.id);
    });

    it('returns all plans ordered most-recent first', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      handler.createPlan(pm, project.id, { name: 'A' });
      await tick();
      handler.createPlan(pm, project.id, { name: 'B' });
      await tick();
      handler.createPlan(pm, project.id, { name: 'C' });

      const { plans, total } = handler.listPlans(pm, project.id, {});
      expect(total).toBe(4);
      expect(plans).toHaveLength(4);
      expect(plans[0]?.name).toBe('C');
      expect(plans[1]?.name).toBe('B');
      expect(plans[2]?.name).toBe('A');
    });

    it('respects limit and offset', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      handler.createPlan(pm, project.id, { name: 'B' });
      handler.createPlan(pm, project.id, { name: 'C' });
      handler.createPlan(pm, project.id, { name: 'D' });

      const first = handler.listPlans(pm, project.id, { limit: 2, offset: 0 });
      const next = handler.listPlans(pm, project.id, { limit: 2, offset: 2 });
      expect(first.plans).toHaveLength(2);
      expect(next.plans).toHaveLength(2);
      expect(first.total).toBe(4);
      expect(next.total).toBe(4);
    });

    it('returns empty (total=0) when the default plan is deleted', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      // Wipe the default plan to test the empty case.
      getTestDb().prepare('DELETE FROM staffing_plans WHERE project_id = ?').run(project.id);

      const { plans, total } = handler.listPlans(pm, project.id, {});
      expect(plans).toEqual([]);
      expect(total).toBe(0);
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const handler = createPlansHandler(getTestDb());

      expectErrorCode(
        () => handler.listPlans(candidate, project.id, {}),
        'FORBIDDEN',
      );
    });

    it('throws NOT_FOUND for a project owned by another PM (no leak)', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const handler = createPlansHandler(getTestDb());

      expectErrorCode(() => handler.listPlans(pm2, project.id, {}), 'NOT_FOUND');
    });
  });

  // -------- create ----------

  describe('create', () => {
    it('inserts a draft plan with positions_json round-trip', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const plan = handler.createPlan(pm, project.id, {
        name: 'Aggressive hiring',
        description: 'Q4 plan',
        total_headcount: 12,
        estimated_cost: 240000,
        positions_json: [
          { position_id: 'pos_aaa', count: 3 },
          { position_id: 'pos_bbb', count: 2 },
        ],
      });

      expect(plan.id).toMatch(/^plan_[A-Za-z0-9_-]{12}$/);
      expect(plan.project_id).toBe(project.id);
      expect(plan.name).toBe('Aggressive hiring');
      expect(plan.description).toBe('Q4 plan');
      expect(plan.total_headcount).toBe(12);
      expect(plan.estimated_cost).toBe(240000);
      expect(plan.positions_json).toEqual([
        { position_id: 'pos_aaa', count: 3 },
        { position_id: 'pos_bbb', count: 2 },
      ]);
      expect(plan.is_selected).toBe(0);  // new plans are drafts
      expect(plan.created_at).toBeGreaterThan(0);
    });

    it('uses empty positions_json by default', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const plan = handler.createPlan(pm, project.id, { name: 'Bare plan' });
      expect(plan.positions_json).toEqual([]);
    });

    it('rejects empty name with INVALID_PARAMS', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      expectErrorCode(
        () => handler.createPlan(pm, project.id, { name: '' }),
        'INVALID_PARAMS',
      );
    });

    it('rejects name over 200 chars', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const long = 'x'.repeat(201);
      expectErrorCode(
        () => handler.createPlan(pm, project.id, { name: long }),
        'INVALID_PARAMS',
      );
    });

    it('rejects negative total_headcount', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      expectErrorCode(
        () => handler.createPlan(pm, project.id, { name: 'x', total_headcount: -1 }),
        'INVALID_PARAMS',
      );
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const handler = createPlansHandler(getTestDb());

      expectErrorCode(
        () => handler.createPlan(candidate, project.id, { name: 'x' }),
        'FORBIDDEN',
      );
    });

    it('throws NOT_FOUND for a project owned by another PM', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const handler = createPlansHandler(getTestDb());

      expectErrorCode(
        () => handler.createPlan(pm2, project.id, { name: 'hijack' }),
        'NOT_FOUND',
      );
    });
  });

  // -------- get (detail) ----------

  describe('get', () => {
    it('returns the plan row with parsed positions_json', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const created = handler.createPlan(pm, project.id, {
        name: 'plan-A',
        positions_json: [{ position_id: 'pos_xyz', count: 4 }],
      });

      const fetched = handler.getPlan(pm, created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.positions_json).toEqual([{ position_id: 'pos_xyz', count: 4 }]);
    });

    it('throws NOT_FOUND for a non-existent id', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createPlansHandler(getTestDb());

      expectErrorCode(() => handler.getPlan(pm, 'plan_doesnotexist'), 'NOT_FOUND');
    });

    it('throws NOT_FOUND for a plan owned by another PM (no leak)', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const handler = createPlansHandler(getTestDb());

      const plan = handler.createPlan(pm1, project.id, { name: 'x' });
      expectErrorCode(() => handler.getPlan(pm2, plan.id), 'NOT_FOUND');
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const plan = handler.createPlan(pm, project.id, { name: 'x' });
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      expectErrorCode(() => handler.getPlan(candidate, plan.id), 'FORBIDDEN');
    });
  });

  // -------- update ----------

  describe('update', () => {
    it('patches name and positions_json', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const created = handler.createPlan(pm, project.id, {
        name: 'orig',
        positions_json: [{ position_id: 'pos_old', count: 1 }],
      });
      const updated = handler.updatePlan(pm, created.id, {
        name: 'revised',
        positions_json: [{ position_id: 'pos_new', count: 5 }],
      });

      expect(updated.name).toBe('revised');
      expect(updated.positions_json).toEqual([{ position_id: 'pos_new', count: 5 }]);
    });

    it('allows partial patch', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const created = handler.createPlan(pm, project.id, {
        name: 'orig',
        total_headcount: 10,
        estimated_cost: 1000,
      });
      const updated = handler.updatePlan(pm, created.id, { name: 'renamed' });

      expect(updated.name).toBe('renamed');
      expect(updated.total_headcount).toBe(10);
      expect(updated.estimated_cost).toBe(1000);
    });

    it('can clear nullable fields with explicit null', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const created = handler.createPlan(pm, project.id, {
        name: 'with desc',
        description: 'has desc',
        estimated_cost: 5000,
      });
      const updated = handler.updatePlan(pm, created.id, {
        description: null,
        estimated_cost: null,
      });

      expect(updated.description).toBeNull();
      expect(updated.estimated_cost).toBeNull();
    });

    it('throws NOT_FOUND for non-existent id', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createPlansHandler(getTestDb());

      expectErrorCode(
        () => handler.updatePlan(pm, 'plan_doesnotexist', { name: 'x' }),
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND for a plan owned by another PM (no leak)', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const handler = createPlansHandler(getTestDb());

      const plan = handler.createPlan(pm1, project.id, { name: 'x' });
      expectErrorCode(
        () => handler.updatePlan(pm2, plan.id, { name: 'hijack' }),
        'NOT_FOUND',
      );
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const plan = handler.createPlan(pm, project.id, { name: 'x' });
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      expectErrorCode(
        () => handler.updatePlan(candidate, plan.id, { name: 'y' }),
        'FORBIDDEN',
      );
    });
  });

  // -------- delete ----------

  describe('delete', () => {
    it('removes the row and returns {deleted: true}', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const plan = handler.createPlan(pm, project.id, { name: 'x' });
      const result = handler.deletePlan(pm, plan.id);
      expect(result.deleted).toBe(true);
      expectErrorCode(() => handler.getPlan(pm, plan.id), 'NOT_FOUND');
    });

    it('throws NOT_FOUND for non-existent id', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createPlansHandler(getTestDb());

      expectErrorCode(
        () => handler.deletePlan(pm, 'plan_doesnotexist'),
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND for a plan owned by another PM (no leak)', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const handler = createPlansHandler(getTestDb());

      const plan = handler.createPlan(pm1, project.id, { name: 'x' });
      expectErrorCode(() => handler.deletePlan(pm2, plan.id), 'NOT_FOUND');

      // The row should still exist for the owner.
      const fetched = handler.getPlan(pm1, plan.id);
      expect(fetched.id).toBe(plan.id);
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const plan = handler.createPlan(pm, project.id, { name: 'x' });
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      expectErrorCode(() => handler.deletePlan(candidate, plan.id), 'FORBIDDEN');
    });
  });

  // -------- setSelected (uniqueness invariant) ----------

  describe('setSelected', () => {
    it('marks a plan as selected (1) and clears others (0)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const defaultPlan = handler.listPlans(pm, project.id, {}).plans[0]!;
      const draft = handler.createPlan(pm, project.id, { name: 'draft-1' });
      const other  = handler.createPlan(pm, project.id, { name: 'draft-2' });

      const selected = handler.setSelectedPlan(pm, draft.id);
      expect(selected.id).toBe(draft.id);
      expect(selected.is_selected).toBe(1);

      const after = handler.listPlans(pm, project.id, {});
      const byId = new Map(after.plans.map((p) => [p.id, p]));
      expect(byId.get(draft.id)?.is_selected).toBe(1);
      expect(byId.get(defaultPlan.id)?.is_selected).toBe(0);
      expect(byId.get(other.id)?.is_selected).toBe(0);
    });

    it('switches selection: only the most-recent selection is_selected=1', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const a = handler.createPlan(pm, project.id, { name: 'A' });
      const b = handler.createPlan(pm, project.id, { name: 'B' });
      const c = handler.createPlan(pm, project.id, { name: 'C' });

      handler.setSelectedPlan(pm, a.id);
      handler.setSelectedPlan(pm, b.id);
      handler.setSelectedPlan(pm, c.id);

      const sel = handler.listPlans(pm, project.id, {}).plans.find((p) => p.is_selected === 1);
      expect(sel?.id).toBe(c.id);
    });

    it('does not unselect plans in OTHER projects (cross-project isolation)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const projectA = makeProject(pm, 'A');
      const projectB = makeProject(pm, 'B');
      const handler = createPlansHandler(getTestDb());

      // projectA default plan is selected by default
      const projectADefault = handler.listPlans(pm, projectA.id, {}).plans[0]!;
      expect(projectADefault.is_selected).toBe(1);

      // projectB default plan is selected by default
      const projectBDefault = handler.listPlans(pm, projectB.id, {}).plans[0]!;
      expect(projectBDefault.is_selected).toBe(1);

      // Select a new draft in projectA
      const draft = handler.createPlan(pm, projectA.id, { name: 'A-draft' });
      handler.setSelectedPlan(pm, draft.id);

      // projectA: only the draft is selected
      const aPlans = handler.listPlans(pm, projectA.id, {}).plans;
      const aSelected = aPlans.filter((p) => p.is_selected === 1);
      expect(aSelected).toHaveLength(1);
      expect(aSelected[0]?.id).toBe(draft.id);

      // projectB: still has its default selected
      const bPlans = handler.listPlans(pm, projectB.id, {}).plans;
      const bSelected = bPlans.filter((p) => p.is_selected === 1);
      expect(bSelected).toHaveLength(1);
      expect(bSelected[0]?.id).toBe(projectBDefault.id);
    });

    it('throws NOT_FOUND for a non-existent plan', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createPlansHandler(getTestDb());

      expectErrorCode(() => handler.setSelectedPlan(pm, 'plan_doesnotexist'), 'NOT_FOUND');
    });

    it('throws NOT_FOUND for a plan owned by another PM (no leak)', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const handler = createPlansHandler(getTestDb());

      const plan = handler.createPlan(pm1, project.id, { name: 'x' });
      expectErrorCode(() => handler.setSelectedPlan(pm2, plan.id), 'NOT_FOUND');
    });

    it('rejects non-PM callers with FORBIDDEN', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const handler = createPlansHandler(getTestDb());

      const plan = handler.createPlan(pm, project.id, { name: 'x' });
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      expectErrorCode(() => handler.setSelectedPlan(candidate, plan.id), 'FORBIDDEN');
    });
  });

  // -------- repo-level checks (defense in depth) ----------

  describe('repo (direct)', () => {
    it('insert then findById returns the row with positions_json parsed', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const repo = createStaffingPlansRepo(getTestDb());

      const plan = repo.insert(project.id, {
        name: 'repo test',
        positions_json: [{ position_id: 'pos_x', count: 2 }],
      });
      expect(plan.positions_json).toEqual([{ position_id: 'pos_x', count: 2 }]);

      const fetched = repo.findById(plan.id);
      expect(fetched?.name).toBe('repo test');
      expect(fetched?.positions_json).toEqual([{ position_id: 'pos_x', count: 2 }]);
    });

    it('findById returns null for unknown id', () => {
      const repo = createStaffingPlansRepo(getTestDb());
      expect(repo.findById('plan_unknown')).toBeNull();
    });

    it('findByIdForPm returns null for plan owned by another PM', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine');
      const repo = createStaffingPlansRepo(getTestDb());

      const plan = repo.insert(project.id, { name: 'secret' });
      expect(repo.findByIdForPm(plan.id, pm2.id)).toBeNull();
      expect(repo.findByIdForPm(plan.id, pm1.id)?.id).toBe(plan.id);
    });

    it('update returns false for unknown id and true after update', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const repo = createStaffingPlansRepo(getTestDb());

      const plan = repo.insert(project.id, { name: 'a' });
      expect(repo.update('plan_unknown', project.id, { name: 'x' })).toBe(false);
      expect(repo.update(plan.id, project.id, { name: 'b' })).toBe(true);
      expect(repo.findById(plan.id)?.name).toBe('b');
    });

    it('update persists positions_json round-trip', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const repo = createStaffingPlansRepo(getTestDb());

      const plan = repo.insert(project.id, { name: 'a', positions_json: [{ position_id: 'p1', count: 1 }] });
      expect(repo.update(plan.id, project.id, { positions_json: [{ position_id: 'p2', count: 9 }] })).toBe(true);
      expect(repo.findById(plan.id)?.positions_json).toEqual([{ position_id: 'p2', count: 9 }]);
    });

    it('delete returns false for unknown id and true after delete', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const repo = createStaffingPlansRepo(getTestDb());

      const plan = repo.insert(project.id, { name: 'a' });
      expect(repo.delete('plan_unknown', project.id)).toBe(false);
      expect(repo.delete(plan.id, project.id)).toBe(true);
    });

    it('setSelected returns null when no row matches the (id, project_id) pair', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const repo = createStaffingPlansRepo(getTestDb());

      expect(repo.setSelected('plan_unknown', project.id)).toBeNull();
    });

    it('setSelected is atomic: failure rolls back the unselect-all', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const repo = createStaffingPlansRepo(getTestDb());

      // Project's default plan is already selected.
      const defaultPlan = repo.getSelected(project.id);
      expect(defaultPlan).not.toBeNull();

      // Try to select a non-existent plan — should fail and leave the
      // default plan still selected.
      const result = repo.setSelected('plan_doesnotexist', project.id);
      expect(result).toBeNull();

      // Verify the previously-selected plan is still selected (unselect-all
      // was rolled back).
      const after = repo.getSelected(project.id);
      expect(after?.id).toBe(defaultPlan?.id);
    });

    it('getSelected returns null when no plan is selected', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const repo = createStaffingPlansRepo(getTestDb());

      // Wipe the auto-selected default and create a draft.
      getTestDb().prepare('DELETE FROM staffing_plans WHERE project_id = ?').run(project.id);
      expect(repo.getSelected(project.id)).toBeNull();
    });

    it('bulkUnselect clears all selected plans and returns the change count', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm);
      const repo = createStaffingPlansRepo(getTestDb());

      // 1 selected (default) + 2 drafts
      const a = repo.insert(project.id, { name: 'A' });
      const b = repo.insert(project.id, { name: 'B' });
      expect(repo.getSelected(project.id)).not.toBeNull();

      // Manually mark A and B selected too (so we can verify the count).
      getTestDb().prepare('UPDATE staffing_plans SET is_selected = 1 WHERE id IN (?, ?)').run(a.id, b.id);

      const cleared = repo.bulkUnselect(project.id);
      expect(cleared).toBe(3);  // 3 plans were selected before the call
      expect(repo.getSelected(project.id)).toBeNull();
    });
  });
});

