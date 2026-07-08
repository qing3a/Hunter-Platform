// src/main/modules/headhunter/kanban.ts
//
// Hunter Workspace (Phase 3a, Task 4) — per-headhunter kanban board.
//
// Authorization model:
//   - All methods require user_type === 'headhunter'. Non-headhunters get
//     FORBIDDEN. Centralized via `assertHeadhunter(user)`.
//   - Card mutations scope by `caller.id` via the repo (SQL guards
//     ownership). "Not owned" maps to NOT_FOUND so we don't leak the
//     existence of another hunter's card.
//
// State machine:
//   - moveCard and removeCard route through `canTransition()` from
//     src/main/lib/hunter-pipeline.ts. Illegal transitions (or moves
//     from a terminal stage) throw Errors.invalidState(...) with a
//     structured payload describing what was attempted.
//
// Lazy onboarding:
//   - getBoard() seeds the 5 default columns the first time a hunter
//     hits the endpoint. After that, listColumns returns the existing
//     rows (idempotent).

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import {
  createHunterKanbanRepo,
  type KanbanBoard,
  type KanbanCard,
  type KanbanColumnRow,
  type MoveCardInput,
} from '../../db/repositories/hunter-kanban.js';
import { canTransition, nextStages } from '../../lib/hunter-pipeline.js';
import { Errors } from '../../errors.js';

export interface HunterKanbanModule {
  getBoard(user: User): KanbanBoard;
  moveCard(user: User, recId: string, input: MoveCardInput): KanbanCard;
  addCard(user: User, recId: string, toColumnId: number): KanbanCard;
  removeCard(user: User, recId: string): KanbanCard;
}

export function createHunterKanban(db: DB): HunterKanbanModule {
  const repo = createHunterKanbanRepo(db);

  /** Throw unless the caller is a headhunter. */
  function assertHeadhunter(user: User): void {
    if (user.user_type !== 'headhunter') {
      throw Errors.forbidden('Only headhunters can use the kanban');
    }
  }

  /**
   * Look up the current pipeline_stage on a recommendation for the calling
   * hunter. Returns null if the rec doesn't exist or isn't owned by the
   * caller — the caller then maps that to NOT_FOUND.
   */
  function readOwnedRec(recId: string, hunterUserId: string): {
    id: string;
    pipeline_stage: import('../../lib/hunter-pipeline.js').PipelineStage;
    status: string;
    headhunter_id: string | null;
  } | null {
    const row = db.prepare(`
      SELECT id, pipeline_stage, status, headhunter_id
      FROM recommendations
      WHERE id = ? AND headhunter_id = ?
    `).get(recId, hunterUserId) as
      | { id: string; pipeline_stage: import('../../lib/hunter-pipeline.js').PipelineStage;
          status: string; headhunter_id: string | null }
      | undefined;
    return row ?? null;
  }

  /**
   * Look up the current pipeline_stage + status for a recommendation row,
   * regardless of ownership. Used by addCard() so we can distinguish
   * "not found" from "already claimed" from "wrong status".
   */
  function readAnyRec(recId: string): {
    id: string;
    pipeline_stage: import('../../lib/hunter-pipeline.js').PipelineStage;
    status: string;
    headhunter_id: string | null;
  } | null {
    const row = db.prepare(
      'SELECT id, pipeline_stage, status, headhunter_id FROM recommendations WHERE id = ?'
    ).get(recId) as
      | { id: string; pipeline_stage: import('../../lib/hunter-pipeline.js').PipelineStage;
          status: string; headhunter_id: string | null }
      | undefined;
    return row ?? null;
  }

  return {
    /**
     * Return the caller's full board (columns + cards). Lazy-onboards
     * the 5 default columns if the caller has no columns yet.
     */
    getBoard(user: User): KanbanBoard {
      assertHeadhunter(user);
      repo.seedDefaultColumns(user.id);
      return repo.getBoard(user.id);
    },

    /**
     * Move a card to another column. Validates the state transition
     * through canTransition() and throws INVALID_STATE on illegal moves
     * (or moves from a terminal stage). NOT_FOUND for missing rec or
     * missing column.
     */
    moveCard(user: User, recId: string, input: MoveCardInput): KanbanCard {
      assertHeadhunter(user);
      if (!recId || typeof recId !== 'string') {
        throw Errors.invalidParams('recommendation_id is required');
      }
      if (!input || typeof input.to_column_id !== 'number') {
        throw Errors.invalidParams('to_column_id is required');
      }
      const column = repo.findColumnById(input.to_column_id, user.id);
      if (!column) throw Errors.notFound('Column not found');
      const rec = readOwnedRec(recId, user.id);
      if (!rec) throw Errors.notFound('Recommendation not found');

      const fromStage = rec.pipeline_stage;
      const toStage = column.pipeline_stage;
      if (fromStage !== toStage && !canTransition(fromStage, toStage)) {
        throw Errors.invalidState(
          `INVALID_STAGE_TRANSITION: cannot move from '${fromStage}' to '${toStage}'`,
        );
      }

      const card = repo.moveCard(user.id, recId, input);
      if (!card) throw Errors.notFound('Recommendation not found');
      return card;
    },

    /**
     * Claim a pending_pickup rec (headhunter_id IS NULL, status =
     * 'pending_pickup') and place it on the caller's kanban at the
     * given column. The picked-up rec's pipeline_stage becomes whatever
     * the target column's stage is (typically the first column = 'submitted').
     *
     * This is a convenience over the existing
     * /v1/headhunter/recommendations/:id/pickup route — claim + add-to-
     * column in a single call. The state-machine semantics are enforced
     * here (rec must be pending_pickup AND unclaimed).
     */
    addCard(user: User, recId: string, toColumnId: number): KanbanCard {
      assertHeadhunter(user);
      if (!recId || typeof recId !== 'string') {
        throw Errors.invalidParams('recommendation_id is required');
      }
      if (typeof toColumnId !== 'number') {
        throw Errors.invalidParams('to_column_id is required');
      }
      const column = repo.findColumnById(toColumnId, user.id);
      if (!column) throw Errors.notFound('Column not found');

      const rec = readAnyRec(recId);
      if (!rec) throw Errors.notFound('Recommendation not found');
      // Enforce pickup semantics: must be pending_pickup + unclaimed.
      if (rec.status !== 'pending_pickup') {
        throw Errors.invalidState(
          `INVALID_PICKUP_STATE: recommendation status is '${rec.status}', expected 'pending_pickup'`,
        );
      }
      if (rec.headhunter_id !== null) {
        throw Errors.invalidState(
          'ALREADY_CLAIMED: recommendation has already been claimed by another headhunter',
        );
      }

      const card = repo.addCard(user.id, recId, toColumnId);
      if (!card) {
        // The atomic claim UPDATE returned no rows — something raced us
        // between the readAnyRec check above and the UPDATE (another
        // hunter claimed it, or status changed). Surface as
        // INVALID_STATE for consistency with the pre-check.
        throw Errors.invalidState(
          'CARD_CLAIM_RACE: recommendation was claimed or changed state before pickup completed',
        );
      }
      return card;
    },

    /**
     * Move a card to the terminal 'rejected' stage. Calls
     * canTransition(from, 'rejected') — illegal if the rec is already
     * onboarded or rejected (both terminal).
     */
    removeCard(user: User, recId: string): KanbanCard {
      assertHeadhunter(user);
      if (!recId || typeof recId !== 'string') {
        throw Errors.invalidParams('recommendation_id is required');
      }
      const rec = readOwnedRec(recId, user.id);
      if (!rec) throw Errors.notFound('Recommendation not found');

      const fromStage = rec.pipeline_stage;
      if (!canTransition(fromStage, 'rejected')) {
        throw Errors.invalidState(
          `INVALID_STAGE_TRANSITION: cannot remove a card in terminal stage '${fromStage}'`,
          // Helpful payload for clients: list of allowed next stages from
          // the current stage (often empty for terminal stages).
          // (Note: Errors.invalidState takes only `msg` per its current
          // signature, so we encode this in the message text. If the
          // signature grows a `details` param, move this there.)
        );
      }

      const card = repo.removeCard(user.id, recId);
      if (!card) throw Errors.notFound('Recommendation not found');
      return card;
    },
  };
}