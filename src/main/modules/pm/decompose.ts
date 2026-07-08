// src/main/modules/pm/decompose.ts
//
// PM Workbench (Phase 3b, Task 6) — AI heuristic position-decomposition handler.
//
// Surface (3 endpoints, wired in Task 17):
//   - POST /v1/pm/projects/:projectId/decompose
//       run heuristic on project.target → store history → return suggestions
//   - POST /v1/pm/projects/:projectId/decompose/:decompositionId/commit
//       bulk-create project_positions from the stored (possibly edited) list
//   - GET  /v1/pm/projects/:projectId/decompositions
//       list historical runs (for a future "history" tab in the page)
//
// Authorization model (mirrors projects / positions handlers):
//   - Caller must be a PM (user_type === 'pm'). Non-PMs get FORBIDDEN.
//   - The project is verified to exist AND be owned by the calling PM
//     (NOT_FOUND if either fails — we don't leak existence to other PMs).
//   - The decomposition is verified to belong to the project (NOT_FOUND
//     if it doesn't exist, belongs to another project, or another PM's
//     project).
//
// Why we don't trust the client on commit:
//   The UI MAY let the PM edit suggestions before committing (rename a
//   title, add/remove a skill, bump headcount). We re-validate everything
//   server-side against the Zod schema. We ALSO stamp the final positions
//   with the canonical decomposition_id (positions_json is unchanged;
//   it just stays the source of truth on the audit row).
//
// Atomicity:
//   commit runs the bulkInsert inside a single transaction (the
//   project-positions repo already wraps bulkInsert in BEGIN/COMMIT).
//   We DON'T write a new "committed" flag to the decomposition row —
//   the audit row stays immutable; you can read the history + the
//   positions table to derive which positions came from which run.

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import {
  decomposePositions,
  type DecomposedPosition,
} from '../../lib/ai-decompose.js';
import {
  createProjectsRepo,
} from '../../db/repositories/projects.js';
import {
  createProjectPositionsRepo,
  type PositionRow,
} from '../../db/repositories/project-positions.js';
import {
  createPositionDecompositionsRepo,
  type DecompositionRow,
} from '../../db/repositories/position-decompositions.js';
import { Errors } from '../../errors.js';
import {
  CommitDecompositionRequestSchema,
  DecomposeRequestSchema,
  type CommitDecompositionInput,
} from '../../schemas/pm.js';

/**
 * Widened user_type for PM-only endpoints. Same pattern as positions.ts.
 */
type UserTypeExtended = User['user_type'] | 'pm';

/** Runtime check that the user is a PM (cast-and-narrow). */
function userTypeIs(user: User, t: UserTypeExtended): boolean {
  return (user.user_type as UserTypeExtended) === t;
}

export interface DecomposeModule {
  /**
   * Run the keyword heuristic on project.target, persist a history row,
   * and return the new decomposition id + the suggestions for preview.
   * Throws NOT_FOUND if the project doesn't exist or isn't owned by the
   * caller; INVALID_PARAMS if project.target is empty/whitespace.
   */
  decomposeProject(
    user: User,
    projectId: string,
    input: unknown,
  ): Promise<{ decomposition: DecompositionRow; suggestions: DecomposedPosition[] }>;
  /**
   * Bulk-create project_positions from a (possibly edited) suggestion
   * list. Server re-validates each item via the Zod schema. Returns the
   * freshly-inserted position rows.
   * Throws NOT_FOUND if the decomposition doesn't exist, isn't owned by
   * the caller via its project, or the project doesn't exist.
   */
  commitDecomposition(
    user: User,
    projectId: string,
    decompositionId: string,
    input: unknown,
  ): { positions: PositionRow[]; decomposition: DecompositionRow };
  /**
   * List historical decompose runs for a project. Pagination = limit/offset.
   */
  listDecompositions(
    user: User,
    projectId: string,
    filter: unknown,
  ): { decompositions: DecompositionRow[]; total: number };
}

export function createDecomposeHandler(db: DB): DecomposeModule {
  const projectsRepo = createProjectsRepo(db);
  const positionsRepo = createProjectPositionsRepo(db);
  const decompRepo = createPositionDecompositionsRepo(db);

  /** Throw unless the caller is a PM. Centralizes the check. */
  function assertPm(user: User): void {
    if (!userTypeIs(user, 'pm')) {
      throw Errors.forbidden('Only PMs can run AI decompose');
    }
  }

  /**
   * Verify the project exists AND is owned by the calling PM. Returns
   * the project row on success; throws NOT_FOUND on any failure.
   */
  function assertProjectOwned(user: User, projectId: string): {
    id: string;
    target: string | null;
  } {
    if (!projectId || typeof projectId !== 'string') {
      throw Errors.invalidParams('project_id is required');
    }
    const project = projectsRepo.findById(projectId, user.id);
    if (!project) throw Errors.notFound('Project not found');
    return { id: project.id, target: project.target };
  }

  return {
    /**
     * Run the heuristic on the project's target text and persist a
     * history row. Body is empty (validated via DecomposeRequestSchema);
     * the target lives on the project row.
     */
    async decomposeProject(
      user: User,
      projectId: string,
      input: unknown,
    ): Promise<{ decomposition: DecompositionRow; suggestions: DecomposedPosition[] }> {
      assertPm(user);
      const parsed = DecomposeRequestSchema.safeParse(input ?? {});
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const project = assertProjectOwned(user, projectId);
      // Per plan's "Reject empty target" constraint — refuse to run the
      // heuristic on an empty target rather than returning the fallback
      // silently. The UI can edit the project and retry.
      const target = (project.target ?? '').trim();
      if (!target) {
        throw Errors.invalidParams(
          'project target is empty — set a target before running AI decompose',
          { field: 'target' },
        );
      }

      // Run the heuristic. Per plan "Don't fabricate" — return whatever
      // the lib returned (the lib's default fallback ensures length > 0).
      const suggestions = await decomposePositions(target);

      // Persist a history row so the PM can later see "what AI suggested
      // for this project" and so commit can replay the exact positions.
      const decomposition = decompRepo.insert({
        project_id: project.id,
        source_text: target,
        positions_json: suggestions,
        source: 'ai_heuristic',
      });

      return { decomposition, suggestions };
    },

    /**
     * Commit the (possibly edited) suggestion list as project_positions.
     * The decomposition row is the single source of truth for which
     * suggestions were committed — we keep its positions_json untouched.
     */
    commitDecomposition(
      user: User,
      projectId: string,
      decompositionId: string,
      input: unknown,
    ): { positions: PositionRow[]; decomposition: DecompositionRow } {
      assertPm(user);
      // Re-verify project ownership — handler throws NOT_FOUND for both
      // missing and not-owned, never leaking existence.
      const project = assertProjectOwned(user, projectId);
      if (!decompositionId || typeof decompositionId !== 'string') {
        throw Errors.invalidParams('decomposition_id is required');
      }
      const decomp = decompRepo.findById(decompositionId);
      // Defensive ownership check — decomposition must belong to this
      // project (defense in depth: handler + repo agree).
      if (!decomp || decomp.project_id !== project.id) {
        throw Errors.notFound('Decomposition not found');
      }
      // Validate the (possibly edited) positions payload.
      const parsed = CommitDecompositionRequestSchema.safeParse(input ?? {});
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const payload: CommitDecompositionInput = parsed.data;
      // Map suggestions → PositionInsert shape. PositionInsert only
      // consumes the fields the repo cares about (title, description,
      // required_skills, title_level, industry, salary_*, headcount_*).
      const items = payload.positions.map((p) => ({
        title: p.title,
        required_skills: p.skills,
        title_level: p.title_level,
        headcount_planned: p.headcount,
      }));
      // bulkInsert wraps the inserts in a transaction (BEGIN/COMMIT) so
      // partial failures don't leave the project with half a batch. Same
      // pattern as PositionsHandler.bulkCreate.
      const positions = positionsRepo.bulkInsert(project.id, items);
      return { positions, decomposition: decomp };
    },

    /**
     * List historical decompose runs for a project, most-recent first.
     * Pagination via limit/offset (defaults mirror the repo's).
     */
    listDecompositions(
      user: User,
      projectId: string,
      filter: unknown,
    ): { decompositions: DecompositionRow[]; total: number } {
      assertPm(user);
      const project = assertProjectOwned(user, projectId);
      const f = (filter ?? {}) as { limit?: number; offset?: number };
      const repoFilter: { limit?: number; offset?: number } = {};
      if (typeof f.limit === 'number') repoFilter.limit = f.limit;
      if (typeof f.offset === 'number') repoFilter.offset = f.offset;
      return decompRepo.listByProject(project.id, repoFilter);
    },
  };
}
