// src/main/modules/pm/notes.ts
//
// PM Workbench (Phase 3b, Task 16) — PM Private Notes handler module.
//
// Surface (3 endpoints, wired in this same task):
//   - GET  /v1/pm/notes/:candidate_user_id   single note (or empty defaults)
//   - PUT  /v1/pm/notes/:candidate_user_id   UPSERT note
//   - GET  /v1/pm/notes                      list every note the PM owns
//
// Authorization model:
//   - Caller must be a PM (user_type === 'pm'). Non-PMs get FORBIDDEN.
//   - Notes are scoped per PM via SQL (findByPmAndCandidate pins both
//     pm_user_id and candidate_user_id; UPSERT carries the caller's id
//     in the VALUES clause). A PM can never read or overwrite another
//     PM's note — the schema makes "same candidate, two PMs" a no-op
//     rather than a leak.
//   - The `candidate_user_id` foreign key references users(id); we do
//     NOT validate existence here because:
//       (a) the editor on the candidate detail page only reaches the
//           GET/PUT endpoints after the candidate has been loaded (so
//           an unknown id means "deleted under us", which we still
//           surface as empty defaults so the UI degrades gracefully);
//       (b) putting a hard FK check here would force a second round-trip
//           on every PUT, which is wasted work for the common path.
//
// Cross-PM semantics (GET single):
//   - If pm A asks for a note on candidate C and pm B has saved one,
//     pm A's GET returns the empty defaults (`{ starred: false,
//     note_text: null }`). The candidate row itself is visible to both
//     PMs via the (future) candidate library page — only the private
//     note is scoped.

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import {
  createPmNotesRepo,
  type PmNoteRow,
} from '../../db/repositories/pm-notes.js';
import { Errors } from '../../errors.js';
import {
  NoteUpdateSchema,
  type NoteUpdateInput,
  type NoteResponse,
  type NoteListItem,
} from '../../schemas/pm.js';

/** Widened user_type for PM-only endpoints. Same pattern as matches.ts / sandbox.ts. */
type UserTypeExtended = User['user_type'] | 'pm';

/** Runtime check that the caller is a PM. */
function userTypeIs(user: User, t: UserTypeExtended): boolean {
  return (user.user_type as UserTypeExtended) === t;
}

/**
 * Convert a stored `PmNoteRow` into the wire `NoteResponse` shape.
 * `starred` is INTEGER 0|1 in the DB → boolean on the wire; `updated_at`
 * is already a unix-ms number so we pass it through.
 */
function rowToResponse(row: PmNoteRow): NoteResponse {
  return {
    starred: row.starred === 1,
    note_text: row.note_text,
    updated_at: row.updated_at,
  };
}

export interface NotesModule {
  getNote(user: User, candidateUserId: string): NoteResponse;
  upsertNote(user: User, candidateUserId: string, input: unknown): NoteResponse;
  listMyNotes(user: User): { notes: NoteListItem[] };
}

export function createNotesHandler(db: DB): NotesModule {
  const repo = createPmNotesRepo(db);

  /** Throw unless the caller is a PM. */
  function assertPm(user: User): void {
    if (!userTypeIs(user, 'pm')) {
      throw Errors.forbidden('Only PMs can manage private notes');
    }
  }

  /**
   * Validate the `candidate_user_id` URL segment. Empty / non-string
   * raises INVALID_PARAMS — we never let an empty id reach the SQL
   * layer because the UNIQUE(pm_user_id, candidate_user_id) constraint
   * would let a buggy client store a row keyed on ''.
   */
  function validateCandidateId(candidateUserId: string): string {
    if (typeof candidateUserId !== 'string' || candidateUserId.length === 0) {
      throw Errors.invalidParams('candidate_user_id is required', { field: 'candidate_user_id' });
    }
    return candidateUserId;
  }

  /** Strict-parse the PUT body. Throws INVALID_PARAMS on Zod failure. */
  function parseUpdateInput(input: unknown): NoteUpdateInput {
    const parsed = NoteUpdateSchema.safeParse(input ?? {});
    if (!parsed.success) {
      throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
    }
    return parsed.data;
  }

  return {
    /**
     * GET /v1/pm/notes/:candidate_user_id
     *
     * Returns the PM's note for the given candidate, OR empty defaults
     * (`{ starred: false, note_text: null, updated_at: 0 }`) when no
     * note exists yet. The empty defaults let the editor render an
     * "untitled" state without a second round-trip.
     *
     * Cross-PM note: if pm A asks for a candidate that pm B has saved
     * a note on, pm A still gets the empty defaults — the repo's
     * `findByPmAndCandidate` SQL filters by pm_user_id, so cross-PM
     * data never leaks.
     */
    getNote(user: User, candidateUserId: string): NoteResponse {
      assertPm(user);
      const cid = validateCandidateId(candidateUserId);
      const row = repo.findByPmAndCandidate(user.id, cid);
      if (!row) {
        return { starred: false, note_text: null, updated_at: 0 };
      }
      return rowToResponse(row);
    },

    /**
     * PUT /v1/pm/notes/:candidate_user_id
     *
     * UPSERT a (pm_user_id, candidate_user_id) note. Body is a partial
     * patch — at least one of `starred` / `note_text` is expected (the
     * Zod schema marks both optional, but the handler accepts either
     * or both since the editor may flip just the star or just the text
     * independently).
     *
     * Returns the freshly persisted note so the UI can reconcile its
     * optimistic state without a follow-up GET.
     */
    upsertNote(user: User, candidateUserId: string, input: unknown): NoteResponse {
      assertPm(user);
      const cid = validateCandidateId(candidateUserId);
      const parsed = parseUpdateInput(input);
      // Map `NoteUpdateInput` → `PmNoteUpsert` (same shape, but explicit
      // cast keeps the boundary obvious for future schema drift).
      const patch: { starred?: boolean; note_text?: string | null } = {};
      if (parsed.starred !== undefined) patch.starred = parsed.starred;
      if (parsed.note_text !== undefined) patch.note_text = parsed.note_text;
      const row = repo.upsert(user.id, cid, patch);
      return rowToResponse(row);
    },

    /**
     * GET /v1/pm/notes
     *
     * List every PM-private note the caller owns, ordered by
     * `updated_at` DESC (most-recently-edited first). Used by the
     * candidate library page (Task 14 / S9) to bulk-hydrate the
     * ⭐ / 📝 icons for every visible row in a single round-trip —
     * replaces the Task-13 stub's per-candidate fan-out.
     *
     * Returns `{ notes: [] }` when the PM has no notes yet (NOT a 404;
     * the UI needs a defined shape for the empty state).
     */
    listMyNotes(user: User): { notes: NoteListItem[] } {
      assertPm(user);
      const rows = repo.listByPm(user.id);
      const notes: NoteListItem[] = rows.map((r) => ({
        candidate_user_id: r.candidate_user_id,
        starred: r.starred === 1,
        note_text: r.note_text,
        updated_at: r.updated_at,
      }));
      return { notes };
    },
  };
}