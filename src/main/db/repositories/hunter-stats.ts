// src/main/db/repositories/hunter-stats.ts
//
// Repository for the hunter-stats personal metrics (Phase 3a, Task 5).
//
// Two read-only methods, both aggregate over the existing
// `recommendations` table — no new tables needed for stats.
//
// Method contracts:
//   - getOverview(hunterUserId): 5-KPI dashboard rollup. No date filter;
//     these are lifetime numbers (the dashboard surfaces them without
//     a date widget, per the task spec).
//   - getFunnel(hunterUserId, range?): 5-stage pipeline breakdown with
//     conversion_from_prev ratios. When `range` is provided, counts are
//     restricted to recs whose created_at falls within [from, to].
//     When range is omitted, counts are over the hunter's lifetime.
//
// Notes on the "placed" semantics:
//   The `recommendations.status` enum (see v002 / v026) DOES include
//   'placed', so `placements_count` is defined as the count of rows with
//   `headhunter_id = ? AND status = 'placed'`. This is a more precise
//   signal than `pipeline_stage = 'onboarded'` because the status column
//   is only set to 'placed' after the commercial placement step (the
//   candidate actually starting the role and the platform billing
//   pipeline is initiated), whereas pipeline_stage can move to
//   'onboarded' earlier as a planning signal. For stats purposes we
//   want the *commercial* definition.

import type { DB } from '../connection.js';

export interface HunterOverview {
  /** # of recs in non-terminal stages (submitted | screen_passed | interview | offer). */
  active_recommendations: number;
  /** # of recs where status='placed' for this hunter (lifetime). */
  placements_count: number;
  /** # of recs with pipeline_stage='onboarded' AND updated_at >= start of current month. */
  onboards_this_month: number;
  /** # of recs with status='pending_pickup' AND pickup_headhunter_id IS NULL (global queue). */
  pending_pickup_count: number;
  /** placements_count / total_recs, 0..1, rounded to 2 dp. 0 when total=0. */
  conversion_rate: number;
}

export type FunnelStage =
  | 'submitted'
  | 'screen_passed'
  | 'interview'
  | 'offer'
  | 'onboarded';

export interface FunnelStageCount {
  stage: FunnelStage;
  count: number;
  /** 0..1; 1.0 for the first stage. */
  conversion_from_prev: number;
}

export interface DateRange {
  from?: number | null; // unix ms
  to?: number | null;   // unix ms
}

/** Canonical funnel order, head→tail. */
const FUNNEL_STAGES: FunnelStage[] = [
  'submitted',
  'screen_passed',
  'interview',
  'offer',
  'onboarded',
];

/** Compute unix-ms for the start of the current calendar month (local time). */
function startOfThisMonthMs(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
}

export function createHunterStatsRepo(db: DB) {
  return {
    /**
     * Overview KPIs for a hunter. Date range is intentionally NOT applied —
     * the dashboard surfaces these as lifetime numbers.
     */
    getOverview(hunterUserId: string): HunterOverview {
      // -- active_recommendations: non-terminal pipeline stages.
      const activeRow = db
        .prepare(
          `SELECT COUNT(*) AS c
             FROM recommendations
            WHERE headhunter_id = ?
              AND pipeline_stage IN ('submitted','screen_passed','interview','offer')`,
        )
        .get(hunterUserId) as { c: number };

      // -- placements_count: status='placed' (commercial definition).
      const placedRow = db
        .prepare(
          `SELECT COUNT(*) AS c
             FROM recommendations
            WHERE headhunter_id = ?
              AND status = 'placed'`,
        )
        .get(hunterUserId) as { c: number };

      // -- onboards_this_month: pipeline_stage='onboarded' AND updated_at >= start-of-month.
      const monthStart = startOfThisMonthMs();
      const monthStartIso = new Date(monthStart).toISOString();
      const onboardedThisMonthRow = db
        .prepare(
          `SELECT COUNT(*) AS c
             FROM recommendations
            WHERE headhunter_id = ?
              AND pipeline_stage = 'onboarded'
              AND updated_at >= ?`,
        )
        .get(hunterUserId, monthStartIso) as { c: number };

      // -- pending_pickup_count: global queue (hunter-agnostic).
      //    Only unclaimed pending_pickup recs are visible to the queue.
      //    TODO: when this gets hot, add a partial index:
      //        CREATE INDEX idx_rec_pending_pickup_unclaimed
      //          ON recommendations(id) WHERE status = 'pending_pickup' AND pickup_headhunter_id IS NULL;
      //    For now the natural scan is fine — this is an O(1) count over
      //    a small set (a queue that should never be huge).
      const pendingRow = db
        .prepare(
          `SELECT COUNT(*) AS c
             FROM recommendations
            WHERE status = 'pending_pickup'
              AND pickup_headhunter_id IS NULL`,
        )
        .get() as { c: number };

      // -- conversion_rate: placed / total. 0 when total=0. 2-dp rounded.
      const totalRow = db
        .prepare(`SELECT COUNT(*) AS c FROM recommendations WHERE headhunter_id = ?`)
        .get(hunterUserId) as { c: number };
      const placements = placedRow.c;
      const total = totalRow.c;
      const conversion_rate = total === 0 ? 0 : Math.round((placements / total) * 100) / 100;

      return {
        active_recommendations: activeRow.c,
        placements_count: placements,
        onboards_this_month: onboardedThisMonthRow.c,
        pending_pickup_count: pendingRow.c,
        conversion_rate,
      };
    },

    /**
     * Funnel breakdown: count of recs at each of the 5 active stages,
     * scoped to this hunter, optionally bounded by [from, to] on
     * `recommendations.created_at`. The returned array is always
     * 5 rows in canonical order submitted → onboarded, with
     * `conversion_from_prev` set per the file-header contract.
     */
    getFunnel(hunterUserId: string, range?: DateRange): FunnelStageCount[] {
      const fromMs = range?.from ?? null;
      const toMs = range?.to ?? null;
      const fromIso = fromMs !== null ? new Date(fromMs).toISOString() : null;
      const toIso = toMs !== null ? new Date(toMs).toISOString() : null;

      // Build a single SELECT that emits all 5 stage counts at once so
      // the round-trip is one query. FILTER (WHERE ...) is supported by
      // SQLite ≥ 3.30 (Node 22 ships a recent enough SQLite).
      const sql = `
        SELECT
          SUM(CASE WHEN pipeline_stage = 'submitted'     THEN 1 ELSE 0 END) AS submitted,
          SUM(CASE WHEN pipeline_stage = 'screen_passed' THEN 1 ELSE 0 END) AS screen_passed,
          SUM(CASE WHEN pipeline_stage = 'interview'     THEN 1 ELSE 0 END) AS interview,
          SUM(CASE WHEN pipeline_stage = 'offer'         THEN 1 ELSE 0 END) AS offer,
          SUM(CASE WHEN pipeline_stage = 'onboarded'     THEN 1 ELSE 0 END) AS onboarded
        FROM recommendations
        WHERE headhunter_id = ?
          ${fromIso !== null ? 'AND created_at >= ?' : ''}
          ${toIso !== null ? 'AND created_at <= ?' : ''}
      `;
      const params: (string | number)[] = [hunterUserId];
      if (fromIso !== null) params.push(fromIso);
      if (toIso !== null) params.push(toIso);

      const row = db.prepare(sql).get(...params) as
        | { submitted: number | null; screen_passed: number | null; interview: number | null;
            offer: number | null; onboarded: number | null }
        | undefined;

      const counts: Record<FunnelStage, number> = {
        submitted: row?.submitted ?? 0,
        screen_passed: row?.screen_passed ?? 0,
        interview: row?.interview ?? 0,
        offer: row?.offer ?? 0,
        onboarded: row?.onboarded ?? 0,
      };

      // Build the result with conversions. Edge case: when ALL counts are
      // zero we chose 1.0 for every row (see stats.test.ts header comment).
      const allZero = FUNNEL_STAGES.every((s) => counts[s] === 0);

      let prev = 0;
      return FUNNEL_STAGES.map((stage) => {
        const count = counts[stage];
        let conversion: number;
        if (allZero) {
          conversion = 1;
        } else if (stage === FUNNEL_STAGES[0]) {
          conversion = 1;
        } else if (prev === 0) {
          // The previous stage is zero but a later stage is non-zero (e.g.
          // 0 submitted, 3 screen_passed). We define this as 0 — there
          // was no flow through the prior stage. Clients can render
          // "—" for 0 in a funnel chart.
          conversion = 0;
        } else {
          conversion = Math.round((count / prev) * 100) / 100;
        }
        prev = count;
        return { stage, count, conversion_from_prev: conversion };
      });
    },
  };
}
