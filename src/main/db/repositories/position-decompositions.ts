// src/main/db/repositories/position-decompositions.ts
//
// PM Workbench (Phase 3b, Task 6) — Repository for the
// `position_decompositions` table (v028 migration).
//
// Stores the history of AI/heuristic text→position decomposition runs.
// Each row records:
//   - which project requested the run (FK → projects.id)
//   - the source text the PM provided
//   - the positions_json the heuristic returned (so we can replay or audit)
//   - which strategy produced them ('ai_heuristic' | 'manual')
//
// Decompositions are an append-only audit log: rows are never updated
// or deleted by the handler (delete cascades with the project FK so a
// DELETE on projects cleans up its history). `commitDecomposition`
// re-reads the stored positions_json and bulk-inserts project_positions;
// the decomposition row itself stays unchanged — it carries the
// provenance for every position it produced.
//
// Design choices:
//   - `positions_json` is stored as JSON-stringified text (matches the
//     other tables' convention; parsed on read into DecomposedPosition[]).
//   - `findById` is used by the commit endpoint to load the stored
//     suggestions back into positions (we DON'T trust the client to
//     re-send them — server is the single source of truth).
//   - `listByProject` powers a future history view on the page (not in
//     v1 wire, but the repo supports it for tests + later tasks).

import { randomUUID } from 'node:crypto';
import type { DB } from '../connection.js';
import type { DecomposedPosition } from '../../lib/ai-decompose.js';

export type DecompositionSource = 'ai_heuristic' | 'manual';

export interface DecompositionRow {
  id: string;
  project_id: string;
  source_text: string;
  positions_json: DecomposedPosition[];
  source: DecompositionSource;
  /** unix ms */
  created_at: number;
}

export interface DecompositionInsert {
  project_id: string;
  source_text: string;
  positions_json: DecomposedPosition[];
  source?: DecompositionSource;
}

export interface DecompositionListFilter {
  limit?: number;
  offset?: number;
}

export interface DecompositionListResult {
  decompositions: DecompositionRow[];
  total: number;
}

const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 200;

/**
 * Hydrate a raw SQLite row into a typed `DecompositionRow`. Handles
 * JSON parse for `positions_json` (defensive — malformed JSON is
 * degraded to []).
 */
function rowFromDb(row: Record<string, unknown>): DecompositionRow {
  let positions: DecomposedPosition[] = [];
  const raw = row.positions_json;
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        positions = parsed as DecomposedPosition[];
      }
    } catch {
      positions = [];
    }
  }
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    source_text: row.source_text as string,
    positions_json: positions,
    source: (row.source as DecompositionSource) ?? 'ai_heuristic',
    created_at: row.created_at as number,
  };
}

export function createPositionDecompositionsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO position_decompositions (
      id, project_id, source_text, positions_json, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const findByIdStmt = db.prepare(
    'SELECT * FROM position_decompositions WHERE id = ?'
  );

  const countByProjectStmt = db.prepare(
    'SELECT COUNT(*) AS n FROM position_decompositions WHERE project_id = ?'
  );

  return {
    /**
     * Persist a new decomposition row. Auto-generates id (decomp_<uuid12>)
     * and created_at. `positions_json` is JSON-stringified for storage.
     */
    insert(input: DecompositionInsert): DecompositionRow {
      const id = `decomp_${randomUUID().slice(0, 12)}`;
      const now = Date.now();
      insertStmt.run(
        id,
        input.project_id,
        input.source_text,
        JSON.stringify(input.positions_json),
        input.source ?? 'ai_heuristic',
        now,
      );
      const row = findByIdStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        // Should never happen — INSERT just succeeded.
        throw new Error(`position_decompositions.insert: failed to read back ${id}`);
      }
      return rowFromDb(row);
    },

    /**
     * Look up a single decomposition by id. Returns null if the row
     * doesn't exist. Caller is expected to ALSO verify the project
     * ownership before exposing the decomposition.
     */
    findById(id: string): DecompositionRow | null {
      const row = findByIdStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) return null;
      return rowFromDb(row);
    },

    /**
     * List decompositions for a project, most-recent first. Pagination:
     * default 50, max 200, offset floored at 0. Returns the page plus
     * the un-paginated total.
     */
    listByProject(
      projectId: string,
      filter: DecompositionListFilter = {},
    ): DecompositionListResult {
      const limit = Math.min(Math.max(filter.limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
      const offset = Math.max(filter.offset ?? 0, 0);

      const totalRow = countByProjectStmt.get(projectId) as { n: number } | undefined;
      const total = totalRow?.n ?? 0;

      const rows = db.prepare(
        `SELECT * FROM position_decompositions
         WHERE project_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`
      ).all(projectId, limit, offset) as Array<Record<string, unknown>>;

      return { decompositions: rows.map(rowFromDb), total };
    },
  };
}
