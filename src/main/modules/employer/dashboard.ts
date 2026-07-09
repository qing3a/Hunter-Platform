// src/main/modules/employer/dashboard.ts
//
// Employer Panel (Phase 3c, Task 3) — single-call dashboard handler.
//
// Returns seven aggregates for the calling employer:
//
//   1. active_jobs                 — COUNT(jobs WHERE status='open' AND employer_id=me)
//   2. open_positions              — MVP: equals active_jobs (jobs has no
//                                    headcount_planned column; see audit §5).
//   3. candidates_viewed_this_month — COUNT(unlock_audit_log) joined to recs/jobs
//                                    where created_at >= now - 30d
//   4. interested_count            — COUNT(recs WHERE status='employer_interested' for my jobs)
//   5. unlocked_count              — COUNT(recs WHERE status='candidate_approved' for my jobs)
//   6. placements_count            — COUNT(placements joined to my jobs)
//   7. spend_this_month            — SUM(platform_fee+primary_share+referrer_share) over
//                                    placements joined to my jobs where created_at >= now - 30d
//
// Sync vs async: every underlying query is a sync `db.prepare(...).get()` on a
// node:sqlite handle (no IO outside the local file), so the handler signature
// stays sync — same shape as createHunterStats.overview() and
// createHunterDashboard.getDashboard().
//
// Authorization:
//   - assertEmployer(user) — non-employer callers throw FORBIDDEN (403).
//   - All seven counters are scoped to `jobs.employer_id = user.id`, which
//     gives us cross-employer isolation for free. We deliberately do NOT
//     consult `recommendations.employer_id` for the audit-log count
//     (rec.employer_id is normally equal to jobs.employer_id, but joining via
//     jobs makes the query robust to v009-style "headhunter-posted-for-employer"
//     rows where the two may diverge).

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { Errors } from '../../errors.js';

export interface DashboardData {
  active_jobs: number;
  open_positions: number;
  candidates_viewed_this_month: number;
  interested_count: number;
  unlocked_count: number;
  placements_count: number;
  spend_this_month: number;
}

export interface EmployerDashboardHandler {
  getDashboard(user: User): DashboardData;
}

/** 30 days, expressed in milliseconds. */
const THIRTY_DAYS_MS = 30 * 86400 * 1000;

export function createEmployerDashboardHandler(db: DB): EmployerDashboardHandler {
  /**
   * Throw unless the caller is an employer. Centralizes the check so the
   * HTTP router (and any future internal callers) get the same FORBIDDEN
   * semantics with one rule.
   */
  function assertEmployer(user: User): void {
    if (user.user_type !== 'employer') {
      throw Errors.forbidden('Only employers can view their dashboard');
    }
  }

  return {
    /**
     * Return the dashboard aggregate for the calling employer. Synchronous
     * (node:sqlite is in-process; no IO outside the local file).
     */
    getDashboard(user: User): DashboardData {
      assertEmployer(user);

      // ISO 8601 — matches the TEXT format used by `created_at` columns.
      // SQLite string-compares ISO timestamps correctly (lexicographic order
      // matches chronological order), so we compare TEXT-vs-TEXT here.
      const thirtyDaysAgoIso = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

      // 1. active_jobs — jobs that are open AND owned by the caller.
      const activeJobsRow = db.prepare(`
        SELECT COUNT(*) AS c
        FROM jobs
        WHERE employer_id = ? AND status = 'open'
      `).get(user.id) as { c: number };
      const activeJobs = activeJobsRow.c;

      // 2. open_positions — MVP: identical to active_jobs (no headcount column).
      const openPositions = activeJobs;

      // 3. candidates_viewed_this_month — unlock_audit_log rows in the last
      //    30 days where the calling employer is the actor AND the underlying
      //    recommendation targets one of the caller's jobs. We deliberately
      //    join to jobs (rather than trusting rec.employer_id alone) so the
      //    counter survives any future v009-style "headhunter-posted-for-
      //    employer" rows where the two may diverge. The actor_user_id
      //    filter enforces the dashboard's semantic intent ("I viewed a
      //    candidate") — system-level events on my recs by other actors
      //    do not count toward MY "viewed" tally.
      const candidatesViewedRow = db.prepare(`
        SELECT COUNT(*) AS c
        FROM unlock_audit_log ual
        JOIN recommendations r ON r.id = ual.recommendation_id
        JOIN jobs j            ON j.id = r.job_id
        WHERE j.employer_id = ?
          AND ual.actor_user_id = ?
          AND ual.created_at > ?
      `).get(user.id, user.id, thirtyDaysAgoIso) as { c: number };

      // 4 + 5. interested_count + unlocked_count — single grouped query so
      //    we don't N+1 across recommendation statuses. SUM(CASE WHEN...)
      //    returns NULL when there are no rows; coalesce to 0.
      const recCountsRow = db.prepare(`
        SELECT
          SUM(CASE WHEN r.status = 'employer_interested'  THEN 1 ELSE 0 END) AS interested,
          SUM(CASE WHEN r.status = 'candidate_approved'  THEN 1 ELSE 0 END) AS unlocked
        FROM recommendations r
        JOIN jobs j ON j.id = r.job_id
        WHERE j.employer_id = ?
      `).get(user.id) as { interested: number | null; unlocked: number | null };

      // 6. placements_count — all-time placements on the caller's jobs.
      const placementsRow = db.prepare(`
        SELECT COUNT(*) AS c
        FROM placements p
        JOIN jobs j ON j.id = p.job_id
        WHERE j.employer_id = ?
      `).get(user.id) as { c: number };

      // 7. spend_this_month — SUM of the three components the platform
      //    actually charges to the employer for a placement (platform_fee +
      //    primary_share + referrer_share). Excludes candidate_bonus (paid
      //    to the candidate, not the platform) and excludes the cancelled
      //    status by virtue of being a SUM over only the rows that exist.
      //    30d-rolling window via `created_at > now - 30d`.
      const spendRow = db.prepare(`
        SELECT COALESCE(SUM(p.platform_fee + p.primary_share + p.referrer_share), 0) AS s
        FROM placements p
        JOIN jobs j ON j.id = p.job_id
        WHERE j.employer_id = ?
          AND p.created_at > ?
      `).get(user.id, thirtyDaysAgoIso) as { s: number };

      return {
        active_jobs: activeJobs,
        open_positions: openPositions,
        candidates_viewed_this_month: candidatesViewedRow.c,
        interested_count: recCountsRow.interested ?? 0,
        unlocked_count: recCountsRow.unlocked ?? 0,
        placements_count: placementsRow.c,
        spend_this_month: spendRow.s,
      };
    },
  };
}