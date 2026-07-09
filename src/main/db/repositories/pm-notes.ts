// src/main/db/repositories/pm-notes.ts
//
// PM Workbench (Phase 3b, Task 16) — repository for the `pm_notes` table
// (v028 migration). Factory pattern matching notifications.ts / matches.ts:
// takes the shared DB handle and returns a closure-bound object with
// prepared statements.
//
// Schema reminder (v028):
//   pm_notes:
//     id                 INTEGER PRIMARY KEY AUTOINCREMENT
//     pm_user_id         TEXT NOT NULL      → users(id)
//     candidate_user_id  TEXT NOT NULL      → users(id)
//     starred            INTEGER NOT NULL   (0|1)
//     note_text          TEXT
//     created_at         INTEGER NOT NULL   (unix ms)
//     updated_at         INTEGER NOT NULL   (unix ms)
//     UNIQUE(pm_user_id, candidate_user_id)
//
// Authorization model:
//   - All row-level queries are scoped to (pm_user_id, candidate_user_id)
//     so the SQL itself enforces the ownership boundary (defense in depth).
//   - The PM can never read or write another PM's note — the WHERE clause
//     always pins pm_user_id.
//
// UPSERT semantics:
//   - `upsert` uses ON CONFLICT(pm_user_id, candidate_user_id) DO UPDATE
//     so re-saving the same note from the editor refreshes the row in
//     place rather than failing on the UNIQUE constraint.
//   - Partial updates (only starred / only note_text) work by leaving the
//     missing column out of the SET clause; SQLite's UPSERT preserves the
//     existing value when no SET clause is emitted for that column. We
//     build the SQL dynamically for the same reason as projects.ts.

import type { DB } from '../connection.js';

export interface PmNoteRow {
  id: number;
  pm_user_id: string;
  candidate_user_id: string;
  /** 0|1 in storage; the handler converts to a boolean on the wire. */
  starred: number;
  /** Free-form UTF-8 text, max 2000 chars (enforced in the handler / schema). */
  note_text: string | null;
  /** unix ms */
  created_at: number;
  /** unix ms */
  updated_at: number;
}

/** Input for `upsert` — at least one of `starred` / `note_text` is expected. */
export interface PmNoteUpsert {
  starred?: boolean;
  note_text?: string | null;
}

/**
 * Hydrate a raw SQLite row into a typed `PmNoteRow`. Stored `starred` is
 * already an integer (0|1) so we pass it through.
 */
function rowFromDb(row: Record<string, unknown>): PmNoteRow {
  return {
    id: row.id as number,
    pm_user_id: row.pm_user_id as string,
    candidate_user_id: row.candidate_user_id as string,
    starred: row.starred as number,
    note_text: (row.note_text as string | null) ?? null,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  };
}

export function createPmNotesRepo(db: DB) {
  const findStmt = db.prepare(
    'SELECT * FROM pm_notes WHERE pm_user_id = ? AND candidate_user_id = ?',
  );
  const listByPmStmt = db.prepare(
    'SELECT * FROM pm_notes WHERE pm_user_id = ? ORDER BY updated_at DESC, id ASC',
  );

  return {
    /**
     * Look up a single note by its (pm_user_id, candidate_user_id) tuple.
     * Returns null when no row exists OR when the row exists but belongs
     * to a different PM (the caller can't distinguish — same pattern as
     * projects.findById / matches.findOne).
     */
    findByPmAndCandidate(pmUserId: string, candidateUserId: string): PmNoteRow | null {
      const row = findStmt.get(pmUserId, candidateUserId) as Record<string, unknown> | undefined;
      if (!row) return null;
      return rowFromDb(row);
    },

    /**
     * UPSERT a (pm_user_id, candidate_user_id) row.
     *
     * The SET clause is built dynamically based on which keys are present:
     *   - absent keys → left unchanged (preserves the previous value)
     *   - present starred → written as 0|1
     *   - present note_text → written verbatim (null clears it)
     *
     * `updated_at` is bumped to `now` unconditionally on every UPSERT so
     * the client can use it as a "last edit" timestamp.
     *
     * Returns the freshly persisted row (re-read so `updated_at` reflects
     * the just-applied value).
     */
    upsert(pmUserId: string, candidateUserId: string, patch: PmNoteUpsert): PmNoteRow {
      const now = Date.now();
      const sets: string[] = [];
      const params: (string | number | null)[] = [];

      if (patch.starred !== undefined) {
        sets.push('starred = ?');
        params.push(patch.starred ? 1 : 0);
      }
      if (patch.note_text !== undefined) {
        sets.push('note_text = ?');
        params.push(patch.note_text);
      }

      // Always bump updated_at.
      sets.push('updated_at = ?');
      params.push(now);

      const sql = `
        INSERT INTO pm_notes (pm_user_id, candidate_user_id, starred, note_text,
                              created_at, updated_at)
        VALUES (?, ?, ${patch.starred !== undefined ? '?' : '0'},
                       ${patch.note_text !== undefined ? '?' : 'NULL'},
                ?, ?)
        ON CONFLICT(pm_user_id, candidate_user_id) DO UPDATE SET
          ${sets.join(', ')}
      `;

      // Build the binding list in the same order as the VALUES placeholders.
      const bindParams: (string | number | null)[] = [pmUserId, candidateUserId];
      if (patch.starred !== undefined) bindParams.push(patch.starred ? 1 : 0);
      if (patch.note_text !== undefined) bindParams.push(patch.note_text);
      bindParams.push(now, now);
      bindParams.push(...params);

      db.prepare(sql).run(...bindParams);

      const row = findStmt.get(pmUserId, candidateUserId) as Record<string, unknown> | undefined;
      if (!row) {
        // INSERT just succeeded — this should be unreachable. Surface as
        // an explicit error rather than crashing with a null deref.
        throw new Error(
          `pm-notes.upsert: failed to read back (pm=${pmUserId}, candidate=${candidateUserId})`,
        );
      }
      return rowFromDb(row);
    },

    /**
     * Bulk list every note owned by the PM, sorted by `updated_at` DESC
     * (most-recently-edited first). Used by the candidate library page's
     * bulk hydration so the UI can render ⭐ / 📝 icons in a single
     * round-trip instead of fanning out N GETs.
     *
     * Empty array when the PM has not saved any notes yet — the handler
     * surfaces this as `{ notes: [] }` so the client always has a defined
     * shape.
     */
    listByPm(pmUserId: string): PmNoteRow[] {
      const rows = listByPmStmt.all(pmUserId) as Array<Record<string, unknown>>;
      return rows.map(rowFromDb);
    },
  };
}