// src/main/db/repositories/matches.ts
//
// PM Workbench (Phase 3b, Task 10) — repository for the `matches` table
// (v028 migration). Factory pattern matching the other PM repos.
//
// Surface used by src/main/modules/pm/matches.ts:
//   - upsert:           insert or replace a (position, candidate) pair
//   - listByPosition:   paginated + min_score-filterable list of matches
//   - countByPosition:  un-paginated total for a position (after min_score)
//   - deleteByPosition: clear matches (used for full recompute if needed)
//   - listAllByPosition:raw list used by the handler to build the top-N
//                       response on recompute (un-filtered, no pagination)
//
// Concurrency / write path:
//   - `upsert` uses ON CONFLICT(position_id, candidate_user_id) DO UPDATE
//     so recompute can be re-run idempotently. The handler wraps the
//     recompute loop in BEGIN/COMMIT (mirroring bulkInsert pattern).
//   - JSON columns (reasons_json, gaps_json) are stored as TEXT and
//     parsed on read. Malformed JSON degrades to [] — same policy as
//     required_skills_json in project-positions.ts.

import type { DB } from '../connection.js';

export interface MatchRow {
  id: number;
  position_id: string;
  candidate_user_id: string;
  /** Integer 0-100. */
  score: number;
  reasons: string[];
  gaps: string[];
  /** unix ms */
  created_at: number;
}

export interface MatchUpsert {
  position_id: string;
  candidate_user_id: string;
  score: number;
  reasons: string[];
  gaps: string[];
}

export interface MatchListFilter {
  min_score?: number;
  limit?: number;
  offset?: number;
}

const LIST_LIMIT_DEFAULT = 20;
const LIST_LIMIT_MAX = 100;

function rowFromDb(row: Record<string, unknown>): MatchRow {
  const reasonsRaw = row.reasons_json;
  const gapsRaw = row.gaps_json;
  const reasons = parseJsonArray(reasonsRaw);
  const gaps = parseJsonArray(gapsRaw);
  return {
    id: row.id as number,
    position_id: row.position_id as string,
    candidate_user_id: row.candidate_user_id as string,
    score: row.score as number,
    reasons,
    gaps,
    created_at: row.created_at as number,
  };
}

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
    return [];
  } catch {
    return [];
  }
}

export function createMatchesRepo(db: DB) {
  const upsertStmt = db.prepare(`
    INSERT INTO matches (position_id, candidate_user_id, score, reasons_json, gaps_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(position_id, candidate_user_id) DO UPDATE SET
      score = excluded.score,
      reasons_json = excluded.reasons_json,
      gaps_json = excluded.gaps_json,
      created_at = excluded.created_at
  `);

  const findOneStmt = db.prepare(
    'SELECT * FROM matches WHERE position_id = ? AND candidate_user_id = ?'
  );

  const deleteByPositionStmt = db.prepare(
    'DELETE FROM matches WHERE position_id = ?'
  );

  return {
    /**
     * UPSERT a single (position_id, candidate_user_id) row. Used by the
     * recompute handler loop. ON CONFLICT ensures re-running recompute
     * is idempotent — score / reasons / gaps are refreshed in place
     * rather than duplicating rows.
     */
    upsert(input: MatchUpsert): void {
      upsertStmt.run(
        input.position_id,
        input.candidate_user_id,
        input.score,
        JSON.stringify(input.reasons),
        JSON.stringify(input.gaps),
        Date.now(),
      );
    },

    /**
     * Find a single match row (no ownership scope — caller has already
     * verified the position is owned by the PM).
     */
    findOne(positionId: string, candidateUserId: string): MatchRow | null {
      const row = findOneStmt.get(positionId, candidateUserId) as Record<string, unknown> | undefined;
      if (!row) return null;
      return rowFromDb(row);
    },

    /**
     * Paginated list of matches for a position, ordered by score DESC
     * (best match first). Optional `min_score` filter is applied in SQL.
     * Returns `{ matches, total }` where total is the un-paginated count
     * for the same filter.
     */
    listByPosition(positionId: string, filter: MatchListFilter = {}): { matches: MatchRow[]; total: number } {
      const limit = Math.min(Math.max(filter.limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
      const offset = Math.max(filter.offset ?? 0, 0);
      const minScore = filter.min_score ?? 0;

      const where = 'position_id = ? AND score >= ?';
      const params: (string | number)[] = [positionId, minScore];

      const totalRow = db.prepare(
        `SELECT COUNT(*) AS n FROM matches WHERE ${where}`
      ).get(...params) as { n: number } | undefined;
      const total = totalRow?.n ?? 0;

      const sql = `
        SELECT * FROM matches
        WHERE ${where}
        ORDER BY score DESC, candidate_user_id ASC
        LIMIT ? OFFSET ?
      `;
      params.push(limit, offset);
      const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      return { matches: rows.map(rowFromDb), total };
    },

    /**
     * Un-paginated list (no limit, no offset) used by the recompute
     * handler to compute `top_matches` for the response. Mirrors the
     * paginated ordering (score DESC, candidate_user_id ASC).
     */
    listAllByPosition(positionId: string): MatchRow[] {
      const rows = db.prepare(
        `SELECT * FROM matches WHERE position_id = ? ORDER BY score DESC, candidate_user_id ASC`
      ).all(positionId) as Array<Record<string, unknown>>;
      return rows.map(rowFromDb);
    },

    /**
     * Bulk delete all matches for a position. Used by tests and admin
     * tools; the recompute handler does NOT call this — it relies on
     * UPSERT to refresh rows in place.
     */
    deleteByPosition(positionId: string): number {
      const result = deleteByPositionStmt.run(positionId);
      return Number(result.changes);
    },

    /**
     * Bulk UPSERT inside a single transaction. Used by recomputeMatches
     * so a partial failure rolls back the whole batch. Returns the
     * number of rows UPSERTed (= input length on success).
     */
    upsertMany(items: MatchUpsert[]): number {
      if (items.length === 0) return 0;
      db.exec('BEGIN');
      try {
        for (const item of items) {
          upsertStmt.run(
            item.position_id,
            item.candidate_user_id,
            item.score,
            JSON.stringify(item.reasons),
            JSON.stringify(item.gaps),
            Date.now(),
          );
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return items.length;
    },
  };
}