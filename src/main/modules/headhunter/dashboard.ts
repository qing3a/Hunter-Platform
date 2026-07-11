// src/main/modules/headhunter/dashboard.ts
//
// Hunter Workspace (Phase 3a, Task 6) — aggregate dashboard handler.
//
// This is a pure COMPOSITION module: it does not own new tables or
// repos. It stitches four existing pieces together into a single
// payload that powers `HunterWorkspacePage` (Task 12):
//
//   1. createHunterStats(db).overview(user)  →  KPI rollup
//   2. createHunterTasks(db).list(user, ...)  →  top_tasks (≤5 pending)
//   3. kanban repo's getBoard(user.id)        →  per-stage card counts
//   4. raw SQL over `recommendations`        →  recent_recommendations
//                                              (≤5 most-recent, non-rejected)
//
// Authorization:
//   - All paths require user_type === 'hr'. Non-headhunters
//     receive FORBIDDEN. Centralized via `assertHeadhunter(user)`,
//     identical to stats / tasks / kanban.
//
// Why direct SQL for recent_recommendations (rather than reusing the
// kanban repo)? Two reasons:
//   - The kanban repo joins kanban_cards to columns and groups them by
//     stage; for the dashboard we want a flat, time-ordered list
//     (ORDER BY updated_at DESC LIMIT 5), which is the simpler query.
//   - The recent list includes BOTH active AND rejected recs by default;
//     the dashboard filters rejected out, but a future iteration may
//     surface them as a separate "archive" tab. Keeping the query
//     here (and not in the kanban repo) avoids leaking that filter
//     into a kanban-focused abstraction.
//
// candidate_name masking:
//   We read `users.name` (the plaintext display name) and run it
//   through `maskName()` to produce the desensitized form. This is
//   GDPR-safe: a user who has cleared their name via F6 has
//   `users.name = NULL` (per v008), and the dashboard surfaces that
//   as `candidate_name: null` for the workspace page to render as "—".
//   We deliberately do NOT decrypt `candidates_private.name_enc` here:
//   the dashboard is rendered on every workspace page load and we
//   don't want to pay a decrypt cost on rows the user can already see
//   from a public-safe field. The view endpoint (M5) is the place that
//   unlocks PII.

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import type { PipelineStage } from '../../lib/hunter-pipeline.js';
import { PIPELINE_STAGES } from '../../lib/hunter-pipeline.js';
import { createHunterStats } from './stats.js';
import { createHunterTasks } from './tasks.js';
import { createHunterKanbanRepo } from '../../db/repositories/hunter-kanban.js';
import { maskName } from '../../lib/mask.js';
import { Errors } from '../../errors.js';

/** Top-level KPI rollup surfaced on the workspace hero card. */
export interface DashboardKpi {
  onboards_this_month: number;
  active_recommendations: number;
  placements_count: number;
  pending_pickup_count: number;
  conversion_rate: number;
}

/** One row in the per-stage kanban card-count summary. */
export interface DashboardKanbanSummary {
  stage: PipelineStage;
  count: number;
}

/**
 * One row in the "Recent activity" section of the workspace page.
 * Mirrors the kanban card shape but adds `pipeline_stage` and
 * `updated_at` explicitly (the kanban card `updated_at` is derived
 * from recommendations.updated_at, so the two should agree).
 */
export interface DashboardRecommendation {
  recommendation_id: string;
  candidate_user_id: string;
  candidate_name: string | null;
  job_id: string;
  job_title: string;
  pipeline_stage: PipelineStage;
  /** unix ms */
  updated_at: number;
}

/** Full payload for `HunterWorkspacePage`. */
export interface DashboardPayload {
  kpi: DashboardKpi;
  /** Up to 5 pending tasks, ordered by due_at ASC NULLS LAST. */
  top_tasks: import('../../db/repositories/hunter-tasks.js').HunterTaskRow[];
  /** 5 entries, one per non-terminal stage, in canonical order. */
  kanban_summary: DashboardKanbanSummary[];
  /** Up to 5 most-recent non-rejected recs for the caller. */
  recent_recommendations: DashboardRecommendation[];
}

export interface HunterDashboardModule {
  getDashboard(user: User): DashboardPayload;
}

const TOP_TASKS_LIMIT = 5;
const RECENT_RECS_LIMIT = 5;

export function createHunterDashboard(db: DB): HunterDashboardModule {
  const stats = createHunterStats(db);
  const tasks = createHunterTasks(db);
  const kanbanRepo = createHunterKanbanRepo(db);

  /** Throw unless the caller is a headhunter. Centralizes the check. */
  function assertHeadhunter(user: User): void {
    if (user.user_type !== 'hr') {
      throw Errors.forbidden('Only headhunters can view their dashboard');
    }
  }

  /**
   * Count kanban cards per stage by calling the kanban repo's
   * getBoard(). The repo guarantees that non-terminal stages
   * (submitted..onboarded) appear in the result and rejected is
   * excluded (rejected cards are terminal and never show on the
   * board). The lazy `seedDefaultColumns` step is a no-op when the
   * columns already exist.
   *
   * The cost is a single board query — we don't N+1 over stages.
   * The result is then mapped into the canonical 5-stage array so
   * the client always gets exactly 5 entries in submitted→onboarded
   * order, with `count = 0` for stages that have no cards.
   */
  function computeKanbanSummary(hunterUserId: string): DashboardKanbanSummary[] {
    // Lazy-seed the 5 default columns first (idempotent). The kanban
    // handler does this in getBoard(), but the repo itself does NOT —
    // we mirror the handler's contract here so the dashboard works
    // for a hunter who has never opened the kanban page.
    kanbanRepo.seedDefaultColumns(hunterUserId);
    const board = kanbanRepo.getBoard(hunterUserId);
    const countByStage = new Map<PipelineStage, number>();
    for (const col of board.columns) {
      countByStage.set(col.pipeline_stage, col.cards.length);
    }
    return PIPELINE_STAGES.map((stage) => ({
      stage,
      count: countByStage.get(stage) ?? 0,
    }));
  }

  /**
   * Fetch the 5 most-recent non-rejected recommendations for the
   * caller, joined to jobs (for title) and users (for masked
   * candidate name). Single SELECT with a JOIN — no N+1.
   *
   * Filter rationale:
   *   - `headhunter_id = ?`  — own recs only (other hunters' recs
   *                            never leak here)
   *   - `pipeline_stage != 'rejected'`  — terminal rejections are
   *                            excluded so the recent list reflects
   *                            active or recently-onboarded work
   *   - `ORDER BY updated_at DESC LIMIT 5`  — most recent first
   */
  function fetchRecentRecommendations(hunterUserId: string): DashboardRecommendation[] {
    const rows = db
      .prepare(
        `SELECT
           r.id                AS recommendation_id,
           cp.candidate_user_id AS candidate_user_id,
           u.name              AS candidate_name_raw,
           r.job_id            AS job_id,
           j.title             AS job_title,
           r.pipeline_stage    AS pipeline_stage,
           CAST(strftime('%s', r.updated_at) AS INTEGER) * 1000 AS updated_at
         FROM recommendations r
         JOIN jobs j ON j.id = r.job_id
         JOIN candidates_anonymized ca ON ca.id = r.anonymized_candidate_id
         JOIN candidates_private cp    ON cp.id = ca.source_private_id
         JOIN users u                  ON u.id = cp.candidate_user_id
         WHERE r.headhunter_id = ?
           AND r.pipeline_stage != 'rejected'
         ORDER BY r.updated_at DESC, r.id ASC
         LIMIT ?`,
      )
      .all(hunterUserId, RECENT_RECS_LIMIT) as Array<{
      recommendation_id: string;
      candidate_user_id: string;
      candidate_name_raw: string | null;
      job_id: string;
      job_title: string;
      pipeline_stage: PipelineStage;
      updated_at: number;
    }>;

    return rows.map((r) => ({
      recommendation_id: r.recommendation_id,
      candidate_user_id: r.candidate_user_id,
      // users.name is nullable (v008 GDPR). maskName("") returns "" —
      // collapse that to null so the workspace page renders "—".
      candidate_name: r.candidate_name_raw ? maskName(r.candidate_name_raw) : null,
      job_id: r.job_id,
      job_title: r.job_title,
      pipeline_stage: r.pipeline_stage,
      updated_at: r.updated_at,
    }));
  }

  return {
    /**
     * Return the workspace page payload. Composes 4 sub-queries:
     *   1. stats.overview()       — KPI
     *   2. tasks.list()            — top_tasks (pending, ≤5, ordered)
     *   3. kanban.getBoard()       — per-stage counts
     *   4. fetchRecentRecommendations()  — recent activity
     *
     * Throws FORBIDDEN for non-headhunters (centralized).
     */
    getDashboard(user: User): DashboardPayload {
      assertHeadhunter(user);
      const overview = stats.overview(user);
      const topTasks = tasks.list(user, { status: 'pending', limit: TOP_TASKS_LIMIT });
      const kanbanSummary = computeKanbanSummary(user.id);
      const recent = fetchRecentRecommendations(user.id);

      return {
        kpi: {
          onboards_this_month: overview.onboards_this_month,
          active_recommendations: overview.active_recommendations,
          placements_count: overview.placements_count,
          pending_pickup_count: overview.pending_pickup_count,
          conversion_rate: overview.conversion_rate,
        },
        top_tasks: topTasks,
        kanban_summary: kanbanSummary,
        recent_recommendations: recent,
      };
    },
  };
}
