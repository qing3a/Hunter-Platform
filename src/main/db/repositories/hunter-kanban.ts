// src/main/db/repositories/hunter-kanban.ts
//
// Repository for the hunter kanban board (Phase 3a, Task 4).
//
// Design notes (see also v027_hunter_workspace.sql):
//   - There is NO separate `kanban_cards` table. Cards are derived from
//     `recommendations` filtered by
//       headhunter_id = $hunter AND pipeline_stage IN (the 5 active stages)
//     (rejected cards are terminal and never appear on the board).
//   - `kanban_columns` only holds per-hunter column definitions (5 default
//     columns seeded lazily on first getBoard()).
//   - The state machine lives in src/main/lib/hunter-pipeline.ts
//     (canTransition). This repo does NOT validate transitions — the
//     handler does, so the repo can be reused for admin overrides later
//     that might bypass the state machine (e.g. support tools).
//
// All methods that touch a specific row scope by hunter_user_id so the SQL
// itself enforces ownership (defense in depth).

import type { DB } from '../connection.js';
import type { PipelineStage } from '../../lib/hunter-pipeline.js';

export interface KanbanColumnRow {
  id: number;
  hunter_user_id: string;
  name: string;
  position: number;
  pipeline_stage: PipelineStage;
  /** unix ms */
  created_at: number;
}

export interface KanbanCard {
  recommendation_id: string;
  candidate_user_id: string;
  candidate_name: string | null;
  job_id: string;
  job_title: string;
  /**
   * Match score for this card. Currently always null — the matching scorer
   * runs on-the-fly in the dashboard view, not at kanban time. See
   * src/main/lib/matching.ts for the Jaccard scorer that would be the
   * source. TODO: compute on the fly (or cache in a match table) when
   * the dashboard wires this up.
   */
  match_score: number | null;
  pipeline_stage: PipelineStage;
  kanban_position: number | null;
  /** unix ms — derived from recommendations.updated_at */
  updated_at: number;
}

export interface KanbanBoard {
  columns: Array<KanbanColumnRow & { cards: KanbanCard[] }>;
}

export interface MoveCardInput {
  to_column_id: number;
  /** null/undefined = append (NULL kanban_position) */
  to_position?: number | null;
}

/** The five active pipeline stages that show up as cards on the board. */
const ACTIVE_STAGES: PipelineStage[] = [
  'submitted',
  'screen_passed',
  'interview',
  'offer',
  'onboarded',
];

/** Default 5-column board (matches STAGE_LABELS in hunter-pipeline.ts). */
const DEFAULT_COLUMNS: Array<{
  position: number;
  name: string;
  pipeline_stage: PipelineStage;
}> = [
  { position: 0, name: '投递', pipeline_stage: 'submitted' },
  { position: 1, name: '简历过', pipeline_stage: 'screen_passed' },
  { position: 2, name: '面试', pipeline_stage: 'interview' },
  { position: 3, name: 'Offer', pipeline_stage: 'offer' },
  { position: 4, name: '到岗', pipeline_stage: 'onboarded' },
];

export function createHunterKanbanRepo(db: DB) {
  const seedDefaultColumnsStmt = db.prepare(`
    INSERT INTO kanban_columns (hunter_user_id, name, position, pipeline_stage, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const listColumnsStmt = db.prepare(`
    SELECT * FROM kanban_columns
    WHERE hunter_user_id = ?
    ORDER BY position ASC
  `);

  const findColumnByIdStmt = db.prepare(`
    SELECT * FROM kanban_columns
    WHERE id = ? AND hunter_user_id = ?
  `);

  // Card join — picks up everything the handler needs to render a column.
  // The 5 active stages filter the "rejected" terminal stage out so removed
  // cards disappear from the board automatically.
  const cardsForHunterStmt = db.prepare(`
    SELECT
      r.id                       AS recommendation_id,
      cp.candidate_user_id       AS candidate_user_id,
      NULL                       AS candidate_name,
      r.job_id                   AS job_id,
      j.title                    AS job_title,
      NULL                       AS match_score,
      r.pipeline_stage           AS pipeline_stage,
      r.kanban_position          AS kanban_position,
      CAST(strftime('%s', r.updated_at) AS INTEGER) * 1000 AS updated_at
    FROM recommendations r
    JOIN jobs j ON j.id = r.job_id
    JOIN candidates_anonymized ca ON ca.id = r.anonymized_candidate_id
    JOIN candidates_private cp ON cp.id = ca.source_private_id
    WHERE r.headhunter_id = ?
      AND r.pipeline_stage IN ('submitted','screen_passed','interview','offer','onboarded')
    ORDER BY
      CASE WHEN r.kanban_position IS NULL THEN 1 ELSE 0 END ASC,
      r.kanban_position ASC,
      CAST(strftime('%s', r.updated_at) AS INTEGER) DESC,
      r.id ASC
  `);

  const updateCardStmt = db.prepare(`
    UPDATE recommendations
    SET pipeline_stage = ?, kanban_position = ?, updated_at = ?
    WHERE id = ? AND headhunter_id = ?
  `);

  const claimRecStmt = db.prepare(`
    UPDATE recommendations
    SET headhunter_id = ?,
        pipeline_stage = ?,
        kanban_position = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'pending_pickup'
      AND headhunter_id IS NULL
  `);

  const rejectRecStmt = db.prepare(`
    UPDATE recommendations
    SET pipeline_stage = 'rejected',
        updated_at = ?
    WHERE id = ? AND headhunter_id = ?
  `);

  const findFirstColumnStmt = db.prepare(`
    SELECT * FROM kanban_columns
    WHERE hunter_user_id = ?
    ORDER BY position ASC
    LIMIT 1
  `);

  const findRecByIdForHunterStmt = db.prepare(`
    SELECT * FROM recommendations
    WHERE id = ? AND headhunter_id = ?
  `);

  const findAnyRecByIdStmt = db.prepare(`
    SELECT * FROM recommendations WHERE id = ?
  `);

  return {
    /**
     * Seed the 5 default columns for a hunter. Idempotent: if any columns
     * already exist for this hunter, the call is a no-op. Called lazily
     * from the handler's getBoard() ("lazy onboarding" pattern) so the
     * schema stays out of the migrations and per-hunters can have custom
     * columns later.
     */
    seedDefaultColumns(hunterUserId: string): void {
      const existing = listColumnsStmt.all(hunterUserId) as unknown as KanbanColumnRow[];
      if (existing.length > 0) return;
      const now = Date.now();
      // Wrap the multi-row insert in a transaction so a partial failure
      // doesn't leave a hunter with 2-of-5 columns.
      db.exec('BEGIN');
      try {
        for (const c of DEFAULT_COLUMNS) {
          seedDefaultColumnsStmt.run(hunterUserId, c.name, c.position, c.pipeline_stage, now);
        }
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      }
    },

    /** Returns columns ordered by position. Does NOT include cards. */
    listColumns(hunterUserId: string): KanbanColumnRow[] {
      return listColumnsStmt.all(hunterUserId) as unknown as KanbanColumnRow[];
    },

    /** Returns one column by id (scoped to hunter) or null. */
    findColumnById(id: number, hunterUserId: string): KanbanColumnRow | null {
      const row = findColumnByIdStmt.get(id, hunterUserId);
      return (row as unknown as KanbanColumnRow | undefined) ?? null;
    },

    /**
     * Returns the full board: columns (5) + cards joined from recommendations
     * + jobs + candidates_private + candidates_anonymized. Cards are ordered
     * by kanban_position ASC NULLS LAST, then updated_at DESC.
     *
     * Seeding is the handler's job — this repo doesn't auto-seed so callers
     * who want a "no side effects" snapshot can use listColumns() instead.
     */
    getBoard(hunterUserId: string): KanbanBoard {
      const columns = listColumnsStmt.all(hunterUserId) as unknown as KanbanColumnRow[];
      const cards = cardsForHunterStmt.all(hunterUserId) as unknown as KanbanCard[];
      const byCol = new Map<PipelineStage, KanbanCard[]>();
      for (const stage of ACTIVE_STAGES) byCol.set(stage, []);
      for (const c of cards) {
        const list = byCol.get(c.pipeline_stage);
        if (list) list.push(c);
      }
      return {
        columns: columns.map((c) => ({ ...c, cards: byCol.get(c.pipeline_stage) ?? [] })),
      };
    },

    /**
     * Move a card to a column. Sets recommendations.pipeline_stage +
     * kanban_position. Returns the updated card row, or null if not found
     * or not owned by the hunter. Does NOT validate the state machine —
     * that's the handler's responsibility (so the repo can be reused for
     * admin overrides later).
     */
    moveCard(
      hunterUserId: string,
      recId: string,
      input: MoveCardInput,
    ): KanbanCard | null {
      const column = this.findColumnById(input.to_column_id, hunterUserId);
      if (!column) return null;
      const now = Date.now();
      const result = updateCardStmt.run(
        column.pipeline_stage,
        input.to_position ?? null,
        new Date(now).toISOString(),
        recId,
        hunterUserId,
      );
      if (result.changes === 0) {
        // Either the rec doesn't exist or isn't owned by this hunter.
        return null;
      }
      // Re-read the joined card row so the caller sees a consistent shape.
      const row = db.prepare(`
        SELECT
          r.id                       AS recommendation_id,
          cp.candidate_user_id       AS candidate_user_id,
          NULL                       AS candidate_name,
          r.job_id                   AS job_id,
          j.title                    AS job_title,
          NULL                       AS match_score,
          r.pipeline_stage           AS pipeline_stage,
          r.kanban_position          AS kanban_position,
          CAST(strftime('%s', r.updated_at) AS INTEGER) * 1000 AS updated_at
        FROM recommendations r
        JOIN jobs j ON j.id = r.job_id
        JOIN candidates_anonymized ca ON ca.id = r.anonymized_candidate_id
        JOIN candidates_private cp ON cp.id = ca.source_private_id
        WHERE r.id = ? AND r.headhunter_id = ?
      `).get(recId, hunterUserId) as KanbanCard | undefined;
      return row ?? null;
    },

    /**
     * Claim a pending_pickup rec and place it on the hunter's kanban.
     * Sets headhunter_id, pipeline_stage = first-column stage,
     * kanban_position = 0. Returns the updated card row, or null if the
     * rec doesn't exist, is already claimed, or has a non-pending_pickup
     * status (the SQL WHERE guards the latter two atomically).
     */
    addCard(hunterUserId: string, recId: string, toColumnId: number): KanbanCard | null {
      const column = this.findColumnById(toColumnId, hunterUserId);
      if (!column) return null;
      // Only the first column (position=0) makes semantic sense for a
      // pickup — new claims start at 'submitted'. But we honor whatever
      // column the caller passed in (its pipeline_stage is what gets
      // applied). Most callers will pass column.position === 0.
      // Reject if toColumnId refers to the first column ONLY for safety:
      // if the column's pipeline_stage isn't 'submitted' we still apply
      // it. The state-machine legality check lives in the handler.

      const now = new Date().toISOString();
      const result = claimRecStmt.run(
        hunterUserId,
        column.pipeline_stage,
        0,
        now,
        recId,
      );
      if (result.changes === 0) {
        // Either: rec doesn't exist, already claimed, or not pending_pickup.
        // Differentiating those is the handler's job (it returns
        // NOT_FOUND vs INVALID_STATE based on a follow-up read).
        return null;
      }
      const row = db.prepare(`
        SELECT
          r.id                       AS recommendation_id,
          cp.candidate_user_id       AS candidate_user_id,
          NULL                       AS candidate_name,
          r.job_id                   AS job_id,
          j.title                    AS job_title,
          NULL                       AS match_score,
          r.pipeline_stage           AS pipeline_stage,
          r.kanban_position          AS kanban_position,
          CAST(strftime('%s', r.updated_at) AS INTEGER) * 1000 AS updated_at
        FROM recommendations r
        JOIN jobs j ON j.id = r.job_id
        JOIN candidates_anonymized ca ON ca.id = r.anonymized_candidate_id
        JOIN candidates_private cp ON cp.id = ca.source_private_id
        WHERE r.id = ? AND r.headhunter_id = ?
      `).get(recId, hunterUserId) as KanbanCard | undefined;
      return row ?? null;
    },

    /**
     * Move the rec to pipeline_stage = 'rejected' (terminal). Returns the
     * updated card row, or null if not found / not owned / already terminal.
     * The handler is expected to verify the source state isn't terminal
     * before calling — the repo just performs the UPDATE.
     */
    removeCard(hunterUserId: string, recId: string): KanbanCard | null {
      const now = new Date().toISOString();
      const result = rejectRecStmt.run(now, recId, hunterUserId);
      if (result.changes === 0) return null;
      const row = db.prepare(`
        SELECT
          r.id                       AS recommendation_id,
          cp.candidate_user_id       AS candidate_user_id,
          NULL                       AS candidate_name,
          r.job_id                   AS job_id,
          j.title                    AS job_title,
          NULL                       AS match_score,
          r.pipeline_stage           AS pipeline_stage,
          r.kanban_position          AS kanban_position,
          CAST(strftime('%s', r.updated_at) AS INTEGER) * 1000 AS updated_at
        FROM recommendations r
        JOIN jobs j ON j.id = r.job_id
        JOIN candidates_anonymized ca ON ca.id = r.anonymized_candidate_id
        JOIN candidates_private cp ON cp.id = ca.source_private_id
        WHERE r.id = ? AND r.headhunter_id = ?
      `).get(recId, hunterUserId) as KanbanCard | undefined;
      return row ?? null;
    },
  };
}