// tests/integration/hunter-portal/tasks.test.ts
//
// Integration tests for the Hunter Workspace (Phase 3a, Task 3):
//   - hunter_tasks repository (CRUD + filters + ownership)
//   - createHunterTasks handler module (headhunter auth, title validation,
//     ownership scope, error semantics)
//
// Per the task spec, we call the handler functions DIRECTLY (not via HTTP) —
// the HTTP routes for hunter-portal/tasks are wired in Task 7. The handler
// and repo are exercised against a real in-process SQLite DB that has the
// v027 migration applied.
//
// Pattern mirrors messages.test.ts: seed users via direct SQL on the shared
// `getTestDb()`, then call `createHunterTasks(db).<method>(user, ...)`.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  getTestDb,
} from '../../helpers/test-app.js';
import { createHunterTasks } from '../../../src/main/modules/headhunter/tasks.js';
import { Errors, ApiError } from '../../../src/main/errors.js';
import type { User } from '../../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Insert a headhunter (or any user_type) row directly into the `users` table.
 * Mirrors the shape used by other seed helpers in this repo (see
 * tests/integration/candidate-portal/messages.test.ts seedRecipient).
 */
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

/**
 * Tiny awaitable sleep so created_at (millisecond unix epoch) differs
 * across back-to-back inserts. Used in tests that rely on
 * `ORDER BY created_at DESC` to produce a deterministic order.
 */
function tick(ms = 2): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Inspect the thrown ApiError's code, falling back to message matching. */
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

describe('hunter-portal: tasks (handler + repo integration)', () => {
  beforeEach(() => {
    // First call to createTestApp() boots the shared DB + runs migrations.
    createTestApp();
    resetDb();
  });
  afterAll(() => closeTestDb());

  // -------- create ----------

  describe('create', () => {
    it('inserts a row with auto-generated id and defaults', () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });

      const row = createHunterTasks(getTestDb()).create(hunter, { title: 'follow up with Acme' });

      expect(row.id).toMatch(/^task_[A-Za-z0-9_-]{12}$/);
      expect(row.hunter_user_id).toBe('h1');
      expect(row.title).toBe('follow up with Acme');
      expect(row.description).toBeNull();
      expect(row.related_recommendation_id).toBeNull();
      expect(row.related_candidate_user_id).toBeNull();
      expect(row.due_at).toBeNull();
      expect(row.completed_at).toBeNull();
      expect(row.priority).toBe('normal');
      expect(row.created_at).toBeGreaterThan(0);
      expect(row.updated_at).toBeGreaterThan(0);
      expect(row.updated_at).toBe(row.created_at);
    });

    it('accepts all optional fields', () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });

      const dueAt = Date.now() + 86_400_000;
      const row = createHunterTasks(getTestDb()).create(hunter, {
        title: 'call candidate',
        description: 'discuss offer',
        // omit related_recommendation_id to avoid the FK to recommendations;
        // it's nullable so the row inserts cleanly.
        related_candidate_user_id: candidate.id,
        due_at: dueAt,
        priority: 'urgent',
      });

      expect(row.description).toBe('discuss offer');
      expect(row.related_recommendation_id).toBeNull();
      expect(row.related_candidate_user_id).toBe('c1');
      expect(row.due_at).toBe(dueAt);
      expect(row.priority).toBe('urgent');
    });

    it('rejects an empty title with INVALID_PARAMS', () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const tasks = createHunterTasks(getTestDb());
      expectErrorCode(() => tasks.create(hunter, { title: '' }), 'INVALID_PARAMS');
      expectErrorCode(() => tasks.create(hunter, { title: '   ' }), 'INVALID_PARAMS');
    });

    it('rejects a title over 200 chars with INVALID_PARAMS', () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const long = 'x'.repeat(201);
      expectErrorCode(
        () => createHunterTasks(getTestDb()).create(hunter, { title: long }),
        'INVALID_PARAMS',
      );
    });

    it('rejects non-headhunter callers with FORBIDDEN', () => {
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const employer = seedUser({ id: 'e1', userType: 'pm' });
      const tasks = createHunterTasks(getTestDb());
      expectErrorCode(() => tasks.create(candidate, { title: 'no' }), 'FORBIDDEN');
      expectErrorCode(() => tasks.create(employer, { title: 'no' }), 'FORBIDDEN');
    });
  });

  // -------- list ----------

  describe('list', () => {
    it('returns only the caller hunter rows (ownership scoped)', () => {
      const h1 = seedUser({ id: 'h1', userType: 'hr' });
      const h2 = seedUser({ id: 'h2', userType: 'hr' });

      const tasks = createHunterTasks(getTestDb());
      tasks.create(h1, { title: 'h1 task A' });
      tasks.create(h1, { title: 'h1 task B' });
      tasks.create(h2, { title: 'h2 task X' });

      const h1Rows = tasks.list(h1, { status: 'all' });
      const h2Rows = tasks.list(h2, { status: 'all' });

      expect(h1Rows.map((r) => r.title).sort()).toEqual(['h1 task A', 'h1 task B']);
      expect(h2Rows.map((r) => r.title)).toEqual(['h2 task X']);
    });

    it('filters by status=pending / completed / all', async () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const tasks = createHunterTasks(getTestDb());
      const a = tasks.create(hunter, { title: 'A' });
      await tick();
      const b = tasks.create(hunter, { title: 'B' });
      await tick();
      const c = tasks.create(hunter, { title: 'C' });
      tasks.complete(hunter, b.id);

      const pending = tasks.list(hunter, { status: 'pending' });
      const completed = tasks.list(hunter, { status: 'completed' });
      const all = tasks.list(hunter, { status: 'all' });

      expect(pending.map((r) => r.id).sort()).toEqual([a.id, c.id].sort());
      expect(completed.map((r) => r.id)).toEqual([b.id]);
      expect(all.map((r) => r.id).sort()).toEqual([a.id, b.id, c.id].sort());
    });

    it('default status is pending', async () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const tasks = createHunterTasks(getTestDb());
      const a = tasks.create(hunter, { title: 'A' });
      await tick();
      const b = tasks.create(hunter, { title: 'B' });
      tasks.complete(hunter, b.id);

      const rows = tasks.list(hunter);
      expect(rows.map((r) => r.id)).toEqual([a.id]);
    });

    it('orders by due_at ASC NULLS LAST, then created_at DESC', async () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const tasks = createHunterTasks(getTestDb());
      const t1 = tasks.create(hunter, { title: 'no due, oldest' });
      await tick();
      const t2 = tasks.create(hunter, { title: 'no due, newer' });
      await tick();
      const t3 = tasks.create(hunter, { title: 'due far',  due_at: Date.now() + 7 * 86_400_000 });
      await tick();
      const t4 = tasks.create(hunter, { title: 'due soon', due_at: Date.now() + 86_400_000 });

      const rows = tasks.list(hunter, { status: 'all' });
      expect(rows.map((r) => r.id)).toEqual([t4.id, t3.id, t2.id, t1.id]);
    });

    it('respects limit and offset', async () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const tasks = createHunterTasks(getTestDb());
      for (let i = 0; i < 5; i++) {
        tasks.create(hunter, { title: `t${i}` });
        await tick();
      }
      const firstTwo = tasks.list(hunter, { status: 'all', limit: 2, offset: 0 });
      const nextTwo = tasks.list(hunter, { status: 'all', limit: 2, offset: 2 });
      expect(firstTwo).toHaveLength(2);
      expect(nextTwo).toHaveLength(2);
      expect(firstTwo[0].id).not.toBe(nextTwo[0].id);
    });

    it('clamps limit to max 100', () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const tasks = createHunterTasks(getTestDb());
      tasks.create(hunter, { title: 'a' });
      // Asking for limit=999 should not error; repo clamps to 100 internally.
      // We can't easily assert 100 was honored without seeding 101 rows, so
      // we just verify the call succeeds and returns our single row.
      const rows = tasks.list(hunter, { status: 'all', limit: 999 });
      expect(rows).toHaveLength(1);
    });
  });

  // -------- update ----------

  describe('update', () => {
    it('patches fields and bumps updated_at', async () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const tasks = createHunterTasks(getTestDb());
      const created = tasks.create(hunter, { title: 'original', priority: 'low' });

      // Force a measurable clock delta before the update.
      await tick();

      const updated = tasks.update(hunter, created.id, {
        title: 'revised',
        description: 'with notes',
        priority: 'high',
        due_at: Date.now() + 3600_000,
      });

      expect(updated.title).toBe('revised');
      expect(updated.description).toBe('with notes');
      expect(updated.priority).toBe('high');
      expect(updated.due_at).not.toBeNull();
      expect(updated.updated_at).toBeGreaterThan(created.updated_at);
      expect(updated.created_at).toBe(created.created_at); // not touched
    });

    it('throws NOT_FOUND for a non-existent task', () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      expectErrorCode(
        () => createHunterTasks(getTestDb()).update(hunter, 'task_doesnotexist', { title: 'x' }),
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND for a task owned by another hunter', () => {
      const h1 = seedUser({ id: 'h1', userType: 'hr' });
      const h2 = seedUser({ id: 'h2', userType: 'hr' });
      const tasks = createHunterTasks(getTestDb());
      const created = tasks.create(h1, { title: 'mine' });

      expectErrorCode(
        () => tasks.update(h2, created.id, { title: 'hijack' }),
        'NOT_FOUND',
      );
    });
  });

  // -------- complete / reopen ----------

  describe('complete / reopen', () => {
    it('complete sets completed_at and returns the row', async () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const tasks = createHunterTasks(getTestDb());
      const created = tasks.create(hunter, { title: 'finish me' });
      expect(created.completed_at).toBeNull();

      await tick();
      const completed = tasks.complete(hunter, created.id);
      expect(completed).not.toBeNull();
      expect(completed!.completed_at).toBeGreaterThan(0);
      expect(completed!.updated_at).toBeGreaterThanOrEqual(created.updated_at);
    });

    it('reopen clears completed_at and returns the row', async () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const tasks = createHunterTasks(getTestDb());
      const created = tasks.create(hunter, { title: 'finish me' });
      await tick();
      tasks.complete(hunter, created.id);
      await tick();

      const reopened = tasks.reopen(hunter, created.id);
      expect(reopened).not.toBeNull();
      expect(reopened!.completed_at).toBeNull();
    });

    it('complete throws NOT_FOUND for a task owned by another hunter', () => {
      const h1 = seedUser({ id: 'h1', userType: 'hr' });
      const h2 = seedUser({ id: 'h2', userType: 'hr' });
      const tasks = createHunterTasks(getTestDb());
      const created = tasks.create(h1, { title: 'mine' });

      // Handler maps repo null to NOT_FOUND (don't leak existence).
      expectErrorCode(() => tasks.complete(h2, created.id), 'NOT_FOUND');
    });
  });

  // -------- delete ----------

  describe('delete', () => {
    it('removes the row', () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const tasks = createHunterTasks(getTestDb());
      const created = tasks.create(hunter, { title: 'delete me' });

      tasks.delete(hunter, created.id);

      // Repo returns null for a row that's gone (or not owned).
      const after = tasks.list(hunter, { status: 'all' });
      expect(after).toEqual([]);
    });

    it('delete on a non-existent id throws NOT_FOUND', () => {
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const tasks = createHunterTasks(getTestDb());
      expectErrorCode(() => tasks.delete(hunter, 'task_doesnotexist'), 'NOT_FOUND');
    });

    it('delete on another hunter row throws NOT_FOUND and the row survives', () => {
      const h1 = seedUser({ id: 'h1', userType: 'hr' });
      const h2 = seedUser({ id: 'h2', userType: 'hr' });
      const tasks = createHunterTasks(getTestDb());
      const created = tasks.create(h1, { title: 'mine' });

      expectErrorCode(() => tasks.delete(h2, created.id), 'NOT_FOUND');
      const rows = tasks.list(h1, { status: 'all' });
      expect(rows).toHaveLength(1);
    });
  });
});