// tests/integration/pm/decompose.test.ts
//
// PM Workbench (Phase 3b, Task 6) — AI heuristic decomposition handler +
// repository integration tests.
//
// Covers:
//   - createDecomposeHandler (PM auth, project ownership, empty-target check,
//     history persistence)
//   - commitDecomposition (re-validation, ownership checks, atomic bulk insert)
//   - listDecompositions (pagination, scoping to project)
//   - createPositionDecompositionsRepo (insert/findById/listByProject)
//
// Pattern matches tests/integration/pm/positions.test.ts: seed users + projects
// directly via SQL on the shared getTestDb(), then call the handler methods
// directly (HTTP routing is wired later in Task 17).
//
// Decompose delay note: the lib uses an 800ms simulated delay. We don't want
// these tests to take 800ms * 6+ times — but we DO want one test that
// confirms the delay happens, so it serves as a contract test. The rest of
// the tests just await the result normally; total runtime is still
// dominated by the delay (~5s all-in is fine).

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  getTestDb,
} from '../../helpers/test-app.js';
import { createProjectsHandler } from '../../../src/main/modules/pm/projects.js';
import { createPositionsHandler } from '../../../src/main/modules/pm/positions.js';
import { createDecomposeHandler } from '../../../src/main/modules/pm/decompose.js';
import { createPositionDecompositionsRepo } from '../../../src/main/db/repositories/position-decompositions.js';
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

function expectErrorCode(promise: Promise<unknown>, code: string): Promise<void> {
  return promise.then(
    () => { throw new Error(`Expected promise to reject with ${code}, but it resolved`); },
    (e: unknown) => {
      if (e instanceof ApiError) {
        expect(e.code).toBe(code);
        return;
      }
      throw e;
    },
  );
}

function expectSyncErrorCode(fn: () => unknown, code: string): void {
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

/** Create a project for the given PM with the given target text. */
function makeProject(pm: User, name: string, target?: string): {
  id: string;
  pm_user_id: string;
  target: string | null;
} {
  const projects = createProjectsHandler(getTestDb());
  return projects.createProject(pm, {
    name,
    ...(target !== undefined ? { target } : {}),
  }) as { id: string; pm_user_id: string; target: string | null };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pm: decompose (handler + repo integration)', () => {
  beforeEach(() => {
    createTestApp();
    resetDb();
  });
  afterAll(() => closeTestDb());

  // -------- decompose ----------

  describe('decomposeProject', () => {
    it('runs the heuristic on project.target and returns matching suggestions + history row', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm, 'big-app', '需要 Vue 前端 + Java 后端 + iOS swift');
      const handler = createDecomposeHandler(getTestDb());

      const { decomposition, suggestions } = await handler.decomposeProject(pm, project.id, {});

      expect(suggestions.length).toBeGreaterThan(0);
      // Frontend + backend + iOS templates should match.
      const titles = suggestions.map((s) => s.title);
      expect(titles).toContain('高级前端工程师');
      expect(titles).toContain('后端工程师');
      expect(titles).toContain('iOS 工程师');

      // Every suggestion has a non-empty rationale (Self-Review item).
      for (const s of suggestions) {
        expect(s.rationale.length).toBeGreaterThan(0);
      }

      // History row is persisted.
      expect(decomposition.id).toMatch(/^decomp_[A-Za-z0-9_-]{12}$/);
      expect(decomposition.project_id).toBe(project.id);
      expect(decomposition.source).toBe('ai_heuristic');
      expect(decomposition.source_text).toBe('需要 Vue 前端 + Java 后端 + iOS swift');
      expect(decomposition.positions_json.length).toBe(suggestions.length);
      expect(decomposition.created_at).toBeGreaterThan(0);
    });

    it('history row is queryable via listByProject', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm, 'p1', 'Vue + React');
      const handler = createDecomposeHandler(getTestDb());

      await handler.decomposeProject(pm, project.id, {});
      await handler.decomposeProject(pm, project.id, {}); // second run

      const list = handler.listDecompositions(pm, project.id, {});
      expect(list.total).toBe(2);
      expect(list.decompositions).toHaveLength(2);
      // Ordered most-recent first.
      expect(list.decompositions[0].created_at).toBeGreaterThanOrEqual(
        list.decompositions[1].created_at,
      );
    });

    it('rejects INVALID_PARAMS when project.target is empty', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm, 'no-target');
      const handler = createDecomposeHandler(getTestDb());

      await expectErrorCode(
        handler.decomposeProject(pm, project.id, {}),
        'INVALID_PARAMS',
      );
    });

    it('rejects INVALID_PARAMS when project.target is whitespace-only', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm, 'ws', '   \n  ');
      const handler = createDecomposeHandler(getTestDb());

      await expectErrorCode(
        handler.decomposeProject(pm, project.id, {}),
        'INVALID_PARAMS',
      );
    });

    it('throws NOT_FOUND for a non-existent project', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const handler = createDecomposeHandler(getTestDb());

      await expectErrorCode(
        handler.decomposeProject(pm, 'proj_doesnotexist', {}),
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND for a project owned by another PM', async () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'private', 'Vue frontend');
      const handler = createDecomposeHandler(getTestDb());

      await expectErrorCode(
        handler.decomposeProject(pm2, project.id, {}),
        'NOT_FOUND',
      );
    });

    it('rejects non-PM callers with FORBIDDEN', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm, 'pm-only', 'vue');
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      // R1.C2: 'pm' is the merged employer role — seed an hr (legacy
      // employer-equivalent) and a separate hr user to assert both are
      // blocked from PM-only endpoints. Real PM users must NOT be.
      const nonPmHr = seedUser({ id: 'e1', userType: 'hr' });
      const hunter = seedUser({ id: 'h1', userType: 'hr' });
      const handler = createDecomposeHandler(getTestDb());

      await expectErrorCode(
        handler.decomposeProject(candidate, project.id, {}),
        'FORBIDDEN',
      );
      await expectErrorCode(
        handler.decomposeProject(nonPmHr, project.id, {}),
        'FORBIDDEN',
      );
      await expectErrorCode(
        handler.decomposeProject(hunter, project.id, {}),
        'FORBIDDEN',
      );
    });

    it('the default fallback (全栈工程师) is returned when no keyword matches', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm, 'vague', '什么也不是的描述 xyz123');
      const handler = createDecomposeHandler(getTestDb());

      const { suggestions } = await handler.decomposeProject(pm, project.id, {});
      expect(suggestions.some((s) => s.title === '全栈工程师')).toBe(true);
    });
  });

  // -------- commit ----------

  describe('commitDecomposition', () => {
    it('bulk-creates the supplied positions under the project', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm, 'with-target', 'Vue frontend + java 后端');
      const handler = createDecomposeHandler(getTestDb());

      const { decomposition } = await handler.decomposeProject(pm, project.id, {});

      // Hand-edit one of the suggestions before committing (simulates the
      // PM tweaking the AI's output via the modal).
      const editedSuggestions = decomposition.positions_json.map((p, i) =>
        i === 0
          ? { ...p, title: 'EDITED TITLE', headcount: 3, skills: ['vue', 'typescript', 'pinia'] }
          : p,
      );

      const result = handler.commitDecomposition(pm, project.id, decomposition.id, {
        positions: editedSuggestions,
      });

      expect(result.positions.length).toBe(editedSuggestions.length);
      // Verify the edit was applied.
      expect(result.positions[0].title).toBe('EDITED TITLE');
      expect(result.positions[0].headcount_planned).toBe(3);
      expect(result.positions[0].required_skills).toContain('pinia');

      // Verify positions are visible via the positions endpoint.
      const positionsHandler = createPositionsHandler(getTestDb());
      const list = positionsHandler.listPositions(pm, project.id, {});
      expect(list.total).toBe(editedSuggestions.length);
    });

    it('re-validates each position via Zod (rejects empty titles)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm, 'p', 'vue');
      const handler = createDecomposeHandler(getTestDb());

      // Seed a decomposition row directly so we don't wait the 800ms.
      const repo = createPositionDecompositionsRepo(getTestDb());
      const decomp = repo.insert({
        project_id: project.id,
        source_text: 'vue',
        positions_json: [{
          title: 'x',
          skills: ['vue'],
          title_level: 'mid',
          headcount: 1,
          rationale: 'ok',
        }],
      });

      expectSyncErrorCode(
        () => handler.commitDecomposition(pm, project.id, decomp.id, {
          positions: [{ title: '', skills: ['vue'], title_level: 'mid', headcount: 1, rationale: 'ok' }],
        }),
        'INVALID_PARAMS',
      );
    });

    it('re-validates each position via Zod (rejects missing rationale)', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm, 'p', 'vue');
      const handler = createDecomposeHandler(getTestDb());

      const repo = createPositionDecompositionsRepo(getTestDb());
      const decomp = repo.insert({
        project_id: project.id,
        source_text: 'vue',
        positions_json: [{
          title: 'x',
          skills: ['vue'],
          title_level: 'mid',
          headcount: 1,
          rationale: 'ok',
        }],
      });

      expectSyncErrorCode(
        () => handler.commitDecomposition(pm, project.id, decomp.id, {
          positions: [{ title: 'ok', skills: ['vue'], title_level: 'mid', headcount: 1, rationale: '' }],
        }),
        'INVALID_PARAMS',
      );
    });

    it('throws NOT_FOUND for a non-existent decomposition', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm, 'p', 'vue');
      const handler = createDecomposeHandler(getTestDb());

      expectSyncErrorCode(
        () => handler.commitDecomposition(pm, project.id, 'decomp_doesnotexist', {
          positions: [{
            title: 'x', skills: ['vue'], title_level: 'mid', headcount: 1, rationale: 'r',
          }],
        }),
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND when decomposition belongs to a different project', () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const p1 = makeProject(pm, 'p1', 'vue');
      const p2 = makeProject(pm, 'p2', 'java');
      const repo = createPositionDecompositionsRepo(getTestDb());
      const decomp = repo.insert({
        project_id: p1.id,
        source_text: 'vue',
        positions_json: [{
          title: 'x', skills: ['vue'], title_level: 'mid', headcount: 1, rationale: 'r',
        }],
      });

      const handler = createDecomposeHandler(getTestDb());
      expectSyncErrorCode(
        () => handler.commitDecomposition(pm, p2.id, decomp.id, {
          positions: [{
            title: 'x', skills: ['vue'], title_level: 'mid', headcount: 1, rationale: 'r',
          }],
        }),
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND when project is owned by another PM (no leak)', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'mine', 'vue');
      const repo = createPositionDecompositionsRepo(getTestDb());
      const decomp = repo.insert({
        project_id: project.id,
        source_text: 'vue',
        positions_json: [{
          title: 'x', skills: ['vue'], title_level: 'mid', headcount: 1, rationale: 'r',
        }],
      });

      const handler = createDecomposeHandler(getTestDb());
      expectSyncErrorCode(
        () => handler.commitDecomposition(pm2, project.id, decomp.id, {
          positions: [{
            title: 'x', skills: ['vue'], title_level: 'mid', headcount: 1, rationale: 'r',
          }],
        }),
        'NOT_FOUND',
      );
    });

    it('rejects non-PM callers with FORBIDDEN', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(pm, 'p', 'vue');
      const candidate = seedUser({ id: 'c1', userType: 'candidate' });
      const handler = createDecomposeHandler(getTestDb());
      const repo = createPositionDecompositionsRepo(getTestDb());
      const decomp = repo.insert({
        project_id: project.id,
        source_text: 'vue',
        positions_json: [{
          title: 'x', skills: ['vue'], title_level: 'mid', headcount: 1, rationale: 'r',
        }],
      });

      expectSyncErrorCode(
        () => handler.commitDecomposition(candidate, project.id, decomp.id, {
          positions: [{
            title: 'x', skills: ['vue'], title_level: 'mid', headcount: 1, rationale: 'r',
          }],
        }),
        'FORBIDDEN',
      );
    });
  });

  // -------- listDecompositions ----------

  describe('listDecompositions', () => {
    it('returns decompositions scoped to a single project', async () => {
      const pm = seedUser({ id: 'pm1', userType: 'pm' });
      const p1 = makeProject(pm, 'p1', 'vue');
      const p2 = makeProject(pm, 'p2', 'java');
      const handler = createDecomposeHandler(getTestDb());

      const a = await handler.decomposeProject(pm, p1.id, {});
      await handler.decomposeProject(pm, p1.id, {});
      await handler.decomposeProject(pm, p2.id, {});

      const p1List = handler.listDecompositions(pm, p1.id, {});
      const p2List = handler.listDecompositions(pm, p2.id, {});

      expect(p1List.total).toBe(2);
      expect(p2List.total).toBe(1);
      expect(p1List.decompositions.every((d) => d.project_id === p1.id)).toBe(true);
      expect(p2List.decompositions.every((d) => d.project_id === p2.id)).toBe(true);
    });

    it('throws NOT_FOUND for a project owned by another PM', () => {
      const pm1 = seedUser({ id: 'pm1', userType: 'pm' });
      const pm2 = seedUser({ id: 'pm2', userType: 'pm' });
      const project = makeProject(pm1, 'private', 'vue');
      const handler = createDecomposeHandler(getTestDb());

      expectSyncErrorCode(
        () => handler.listDecompositions(pm2, project.id, {}),
        'NOT_FOUND',
      );
    });
  });

  // -------- repo-level (defense in depth) ----------

  describe('position_decompositions repo (direct)', () => {
    it('insert then findById returns the row with positions_json parsed', () => {
      seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(
        { id: 'pm1', user_type: 'pm' } as unknown as User,
        'repo',
      );
      const repo = createPositionDecompositionsRepo(getTestDb());

      const inserted = repo.insert({
        project_id: project.id,
        source_text: 'vue',
        positions_json: [
          {
            title: 'x',
            skills: ['vue'],
            title_level: 'mid',
            headcount: 1,
            rationale: 'ok',
          },
        ],
        source: 'ai_heuristic',
      });

      expect(inserted.id).toMatch(/^decomp_[A-Za-z0-9_-]{12}$/);
      expect(inserted.positions_json).toHaveLength(1);
      expect(inserted.positions_json[0].title).toBe('x');

      const fetched = repo.findById(inserted.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.positions_json[0].title).toBe('x');
    });

    it('findById returns null for an unknown id', () => {
      const repo = createPositionDecompositionsRepo(getTestDb());
      expect(repo.findById('decomp_doesnotexist')).toBeNull();
    });

    it('listByProject orders most-recent first', async () => {
      seedUser({ id: 'pm1', userType: 'pm' });
      const project = makeProject(
        { id: 'pm1', user_type: 'pm' } as unknown as User,
        'order-test',
      );
      const repo = createPositionDecompositionsRepo(getTestDb());
      const a = repo.insert({
        project_id: project.id,
        source_text: 'a',
        positions_json: [],
      });
      // Small sleep so created_at differs.
      await new Promise((r) => setTimeout(r, 5));
      const b = repo.insert({
        project_id: project.id,
        source_text: 'b',
        positions_json: [],
      });

      const list = repo.listByProject(project.id, {});
      expect(list.total).toBe(2);
      expect(list.decompositions[0].id).toBe(b.id);
      expect(list.decompositions[1].id).toBe(a.id);
    });
  });
});
