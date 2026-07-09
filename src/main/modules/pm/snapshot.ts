// src/main/modules/pm/snapshot.ts
//
// PM Workbench (Phase 3b, Task 12) — Global Snapshot handler module.
//
// Surface (1 endpoint, wired in Task 17):
//   - GET /v1/pm/snapshot
//
// The snapshot aggregates EVERYTHING the PM owns into a single response:
//   1. 4-stage funnel (projects → positions → candidates → matches)
//   2. Activity feed — last 24h of HR-relevant events (applications,
//      headhunter pickups, fresh matches) drawn from the underlying
//      `recommendations` and `matches` tables, ordered DESC by timestamp
//      and capped at 50 rows.
//
// Authorization model:
//   - Caller must be a PM (user_type === 'pm'). Non-PMs get FORBIDDEN.
//   - The aggregation is scoped to the caller's `pm_user_id` via JOIN to
//     the `projects` table. Projects / positions / matches / candidates
//     belonging to a different PM are NEVER included.
//
// Performance note (no N+1):
//   - Projects  → single conditional aggregation (1 query)
//   - Positions → single IN-clause query over the PM's project_ids
//                  (1 query, regardless of project count)
//   - Matches   → single conditional aggregation joined to project_positions
//                  (1 query)
//   - Candidates → single COUNT(DISTINCT) query joined via matches
//                  (1 query)
//   - Activity  → single UNION query across recommendations + matches
//                  (1 query)
//   - Candidate names → batched profile lookup across the activity
//                  event's anonymized_candidate_ids (1 IN-clause query)
//   - Position titles → batched lookup across position_ids (1 IN-clause query)
//
// Total: ~7 queries for the whole snapshot regardless of project count.

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { maskName } from '../../lib/mask.js';
import { Errors } from '../../errors.js';
import type {
  ActivityEvent,
  SnapshotFunnel,
} from '../../schemas/pm.js';

/**
 * Widened user_type for PM-only endpoints. Same pattern as sandbox.ts /
 * positions.ts / projects.ts. Cast-and-narrow at the boundary so the
 * rest of the module stays on the narrow User type.
 */
type UserTypeExtended = User['user_type'] | 'pm';

/** Runtime check that the caller is a PM. */
function userTypeIs(user: User, t: UserTypeExtended): boolean {
  return (user.user_type as UserTypeExtended) === t;
}

/** Maximum number of activity feed rows returned per request. */
const ACTIVITY_LIMIT = 50;

/** Lookback window (ms) for the activity feed. */
const ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Raw row from the activity UNION query. Each source table contributes
 * its own shape (recommendation vs. match) — we normalize them here.
 *
 * - `src` discriminates between the two sources.
 * - `event_type` matches the wire enum (application / pickup / match_created).
 * - `created_at_iso` is the textual ISO timestamp from the source table
 *   (recommendations.created_at is TEXT per the v001 schema; matches.created_at
 *   is INTEGER per v028 — we coerce both to unix ms at hydration).
 * - `position_id` / `project_id` are nullable because matches don't carry a
 *   project_id directly (they carry position_id, which JOINs to project_id).
 */
interface RawActivityRow {
  src: 'rec' | 'match';
  event_type: 'application' | 'pickup' | 'match_created';
  /** ms-since-epoch (always populated; we coerce from ISO if needed) */
  occurred_at: number;
  /** nullable for legacy / hunter-side recs that haven't linked to a PM position */
  position_id: string | null;
  /** nullable on the match path (we derive via position JOIN) */
  project_id: string | null;
  /** anonymized_candidate_id for recommendation rows; null for match rows */
  anonymized_candidate_id: string | null;
  /** candidate_user_id for match rows; null for recommendation rows */
  candidate_user_id: string | null;
  /** Used to classify a rec as 'pickup' vs 'application'. */
  pickup_headhunter_id: string | null;
}

export interface SnapshotModule {
  getSnapshot(user: User): {
    funnel: SnapshotFunnel;
    activity: ActivityEvent[];
    generated_at: number;
  };
}

export function createSnapshotHandler(db: DB): SnapshotModule {
  /** Throw unless the caller is a PM. */
  function assertPm(user: User): void {
    if (!userTypeIs(user, 'pm')) {
      throw Errors.forbidden('Only PMs can view the global snapshot');
    }
  }

  /**
   * Project aggregates — total + by_status across every project the PM
   * owns. One round-trip via conditional aggregation; no per-project
   * subquery.
   */
  function aggregateProjects(pmUserId: string): SnapshotFunnel['projects'] {
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'planning'  THEN 1 ELSE 0 END) AS planning,
        SUM(CASE WHEN status = 'active'    THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'paused'    THEN 1 ELSE 0 END) AS paused,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
      FROM projects
      WHERE pm_user_id = ?
    `).get(pmUserId) as {
      total: number | null;
      planning: number | null;
      active: number | null;
      paused: number | null;
      completed: number | null;
      cancelled: number | null;
    };
    return {
      total: row.total ?? 0,
      by_status: {
        planning: row.planning ?? 0,
        active: row.active ?? 0,
        paused: row.paused ?? 0,
        completed: row.completed ?? 0,
        cancelled: row.cancelled ?? 0,
      },
    };
  }

  /**
   * Position aggregates — total + by_status + headcount totals. One
   * JOIN query against projects so the PM-scope is enforced in SQL.
   */
  function aggregatePositions(pmUserId: string): SnapshotFunnel['positions'] {
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN pp.status = 'open'   THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN pp.status = 'paused' THEN 1 ELSE 0 END) AS paused_count,
        SUM(CASE WHEN pp.status = 'filled' THEN 1 ELSE 0 END) AS filled_count,
        COALESCE(SUM(pp.headcount_planned), 0) AS headcount_planned_total,
        COALESCE(SUM(pp.headcount_filled),  0) AS headcount_filled_total
      FROM project_positions pp
      JOIN projects p ON p.id = pp.project_id
      WHERE p.pm_user_id = ?
    `).get(pmUserId) as {
      total: number | null;
      open_count: number | null;
      paused_count: number | null;
      filled_count: number | null;
      headcount_planned_total: number | null;
      headcount_filled_total: number | null;
    };
    return {
      total: row.total ?? 0,
      by_status: {
        open: row.open_count ?? 0,
        paused: row.paused_count ?? 0,
        filled: row.filled_count ?? 0,
      },
      headcount_planned_total: row.headcount_planned_total ?? 0,
      headcount_filled_total: row.headcount_filled_total ?? 0,
    };
  }

  /**
   * Candidate aggregates — total (matches × candidate) + distinct
   * candidate_user_id count. The PM cares about people, not pairs, so
   * `distinct` is the headline number.
   *
   * `total` is the raw match-count surfaced as "candidate appearances"
   * — useful for understanding the funnel depth even when one candidate
   * has applied to multiple positions.
   */
  function aggregateCandidates(pmUserId: string): SnapshotFunnel['candidates'] {
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT m.candidate_user_id) AS distinct_count
      FROM matches m
      JOIN project_positions pp ON pp.id = m.position_id
      JOIN projects p ON p.id = pp.project_id
      WHERE p.pm_user_id = ?
    `).get(pmUserId) as {
      total: number | null;
      distinct_count: number | null;
    };
    return {
      total: row.total ?? 0,
      distinct: row.distinct_count ?? 0,
    };
  }

  /**
   * Match aggregates — total + average score. Conditional aggregation
   * keeps it to one round-trip.
   *
   * avg_score is rounded to an integer (the wire type is int 0..100).
   * When total = 0 we return 0 (rather than NULL) so the UI never has
   * to special-case the empty state.
   */
  function aggregateMatches(pmUserId: string): SnapshotFunnel['matches'] {
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(ROUND(AVG(m.score)), 0) AS avg_score
      FROM matches m
      JOIN project_positions pp ON pp.id = m.position_id
      JOIN projects p ON p.id = pp.project_id
      WHERE p.pm_user_id = ?
    `).get(pmUserId) as {
      total: number | null;
      avg_score: number | null;
    };
    return {
      total: row.total ?? 0,
      avg_score: row.avg_score ?? 0,
    };
  }

  /**
   * Activity feed — last 24h of HR-relevant events.
   *
   * Two source tables are UNIONed:
   *   - recommendations: contributes 'application' + 'pickup' events
   *   - matches:         contributes 'match_created' events
   *
   * The UNION projects each row into a common shape (RawActivityRow).
   * We filter on the recent window via `created_at >= ?`. Note:
   *   - recommendations.created_at is TEXT (ISO 8601, see v001)
   *   - matches.created_at is INTEGER (unix ms, see v028)
   * We pass the cutoff as both forms and rely on the column's native
   * type for the comparison — SQLite handles both correctly because
   * the cutoff value is the appropriate type for each side.
   *
   * Cap is applied at the SQL level (LIMIT 100 pre-merge) so we don't
   * do unnecessary work; the handler then re-sorts DESC and truncates
   * to ACTIVITY_LIMIT before returning.
   *
   * The query joins project_positions + projects to enforce PM scope
   * AND to surface the project_id for recommendations (which carry
   * position_id but not project_id directly).
   */
  function queryRecentActivity(pmUserId: string, sinceIso: string, sinceMs: number): RawActivityRow[] {
    // We can't quite do a UNION with two different `created_at` column
    // types without explicit casts — SQLite will still work because both
    // sides compare against the right type, but the result-set column
    // type is determined by the first SELECT. We UNION ALL and pass
    // the appropriate cutoff constant in each SELECT.
    //
    // Use LIMIT on each branch so we don't pull in ancient rows that
    // will be filtered out anyway. The outer ORDER BY + LIMIT is the
    // canonical cap, but pre-limiting saves a sort when activity is
    // sparse.
    const sql = `
      SELECT
        'rec' AS src,
        CASE WHEN r.pickup_headhunter_id IS NOT NULL THEN 'pickup' ELSE 'application' END AS event_type,
        -- Convert ISO TEXT timestamp to unix ms using strftime('%s', ...) * 1000.
        -- SQLite's strftime returns seconds-since-epoch in UTC.
        CAST(strftime('%s', r.created_at) AS INTEGER) * 1000 AS occurred_at,
        r.position_id AS position_id,
        p.id AS project_id,
        r.anonymized_candidate_id AS anonymized_candidate_id,
        NULL AS candidate_user_id,
        r.pickup_headhunter_id AS pickup_headhunter_id
      FROM recommendations r
      LEFT JOIN project_positions pp ON pp.id = r.position_id
      LEFT JOIN projects p ON p.id = pp.project_id
      WHERE r.created_at >= ?
        AND (
          r.position_id IS NULL  -- hunter-side legacy; included but project_id NULL
          OR p.pm_user_id = ?    -- PM-scope check
        )

      UNION ALL

      SELECT
        'match' AS src,
        'match_created' AS event_type,
        m.created_at AS occurred_at,
        m.position_id AS position_id,
        p.id AS project_id,
        NULL AS anonymized_candidate_id,
        m.candidate_user_id AS candidate_user_id,
        NULL AS pickup_headhunter_id
      FROM matches m
      JOIN project_positions pp ON pp.id = m.position_id
      JOIN projects p ON p.id = pp.project_id
      WHERE m.created_at >= ?
        AND p.pm_user_id = ?

      ORDER BY occurred_at DESC
      LIMIT ?
    `;
    // Bound: sinceIso, pmUserId, sinceMs, pmUserId, ACTIVITY_LIMIT * 2
    // (×2 because we have two branches, each potentially contributing up to LIMIT)
    return db.prepare(sql).all(
      sinceIso, pmUserId,
      sinceMs, pmUserId,
      ACTIVITY_LIMIT * 2,
    ) as unknown as RawActivityRow[];
  }

  /**
   * Batch-lookup anonymized candidate profiles (candidate_user_id + raw
   * display_name) for a set of `anonymized_candidate_id`s. One IN-clause
   * query — replaces the per-event 3-table JOIN that would otherwise
   * trigger N+1.
   */
  function findCandidateNames(anonymizedIds: string[]): Map<string, { display_name: string | null }> {
    const map = new Map<string, { display_name: string | null }>();
    if (anonymizedIds.length === 0) return map;
    const unique = Array.from(new Set(anonymizedIds.filter((x) => typeof x === 'string' && x.length > 0)));
    if (unique.length === 0) return map;
    const placeholders = unique.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT ca.id AS anonymized_id, u.name AS display_name
      FROM candidates_anonymized ca
      JOIN candidates_private cp ON cp.id = ca.source_private_id
      JOIN users u ON u.id = cp.candidate_user_id
      WHERE ca.id IN (${placeholders})
    `).all(...unique) as Array<{ anonymized_id: string; display_name: string | null }>;
    for (const r of rows) {
      map.set(r.anonymized_id, { display_name: r.display_name });
    }
    return map;
  }

  /**
   * Batch-lookup candidate_user_id → display_name for a set of
   * candidate_user_id values (the match side of the activity feed).
   * One IN-clause query.
   */
  function findUserNames(userIds: string[]): Map<string, { display_name: string | null }> {
    const map = new Map<string, { display_name: string | null }>();
    if (userIds.length === 0) return map;
    const unique = Array.from(new Set(userIds.filter((x) => typeof x === 'string' && x.length > 0)));
    if (unique.length === 0) return map;
    const placeholders = unique.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id, name FROM users WHERE id IN (${placeholders})`
    ).all(...unique) as Array<{ id: string; name: string | null }>;
    for (const r of rows) {
      map.set(r.id, { display_name: r.name });
    }
    return map;
  }

  /**
   * Batch-lookup position_id → title for the activity feed. One query.
   * Position titles are NOT anonymized (the PM owns the position) so
   * we can surface them as-is.
   */
  function findPositionTitles(positionIds: string[]): Map<string, string> {
    const map = new Map<string, string>();
    if (positionIds.length === 0) return map;
    const unique = Array.from(new Set(positionIds.filter((x) => typeof x === 'string' && x.length > 0)));
    if (unique.length === 0) return map;
    const placeholders = unique.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id, title FROM project_positions WHERE id IN (${placeholders})`
    ).all(...unique) as Array<{ id: string; title: string }>;
    for (const r of rows) map.set(r.id, r.title);
    return map;
  }

  /**
   * Build the pre-formatted Chinese summary for a single event.
   *
   * `pickup`   → "猎头 hh_xxx 认领了 张*三"
   * `application` → "张*三 申请了 <岗位>"
   * `match_created` → "系统为 张*三 生成了匹配 (<岗位>)"
   *
   * Candidate names are anonymized via maskName(); position titles are
   * emitted verbatim (PM owns the position). When the underlying name
   * is missing we fall back to "候选人" / "用户" so the summary never
   * surfaces an empty string.
   */
  function formatSummary(
    eventType: 'application' | 'pickup' | 'match_created',
    displayName: string | null,
    positionTitle: string | null,
  ): string {
    const safeName = displayName && displayName.length > 0 ? maskName(displayName) : '候选人';
    const safeTitle = positionTitle && positionTitle.length > 0 ? positionTitle : '岗位';
    switch (eventType) {
      case 'application':
        return `${safeName} 申请了 ${safeTitle}`;
      case 'pickup':
        // We don't expose the hunter's identity on the wire (only the
        // PM's view is scoped); use a generic verb so the summary still
        // reads naturally.
        return `猎头认领了 ${safeName} 的申请 · ${safeTitle}`;
      case 'match_created':
        return `系统为 ${safeName} 生成了匹配 · ${safeTitle}`;
    }
  }

  return {
    /**
     * GET /v1/pm/snapshot
     *
     * Returns the PM's global snapshot:
     *   - funnel: projects / positions / candidates / matches aggregates
     *   - activity: last 24h of HR events, ordered DESC by occurred_at
     *               (max 50 events)
     *   - generated_at: server timestamp (unix ms)
     *
     * The response shape is stable so the frontend can cache by
     * `generated_at` and use it to drive its auto-refresh timer.
     */
    getSnapshot(user: User) {
      assertPm(user);
      const pmUserId = user.id;

      // 1. Funnel aggregates — 4 parallel queries.
      const funnel: SnapshotFunnel = {
        projects: aggregateProjects(pmUserId),
        positions: aggregatePositions(pmUserId),
        candidates: aggregateCandidates(pmUserId),
        matches: aggregateMatches(pmUserId),
      };

      // 2. Activity feed — single UNION query, then post-process.
      const now = Date.now();
      const sinceMs = now - ACTIVITY_WINDOW_MS;
      const sinceIso = new Date(sinceMs).toISOString();
      const rawEvents = queryRecentActivity(pmUserId, sinceIso, sinceMs);

      // 3. Batch hydration — collect ids, do 3 IN-clause lookups.
      const anonymizedIds = rawEvents
        .map((r) => r.anonymized_candidate_id)
        .filter((x): x is string => x !== null);
      const userIds = rawEvents
        .map((r) => r.candidate_user_id)
        .filter((x): x is string => x !== null);
      const positionIds = rawEvents
        .map((r) => r.position_id)
        .filter((x): x is string => x !== null);

      const candidateByAnon = findCandidateNames(anonymizedIds);
      const candidateByUser = findUserNames(userIds);
      const titlesByPosition = findPositionTitles(positionIds);

      // 4. Hydrate + sort + cap + format.
      const events: ActivityEvent[] = rawEvents
        .slice(0, ACTIVITY_LIMIT)
        .map((r) => {
          const displayName = r.anonymized_candidate_id
            ? candidateByAnon.get(r.anonymized_candidate_id)?.display_name ?? null
            : r.candidate_user_id
              ? candidateByUser.get(r.candidate_user_id)?.display_name ?? null
              : null;
          const positionTitle = r.position_id
            ? titlesByPosition.get(r.position_id) ?? null
            : null;
          return {
            event_type: r.event_type,
            occurred_at: r.occurred_at,
            project_id: r.project_id,
            position_id: r.position_id,
            candidate_user_id: r.candidate_user_id ?? (r.anonymized_candidate_id
              ? candidateByAnon.get(r.anonymized_candidate_id)?.display_name ?? null
                ? null  // backfill below if needed
                : null
              : null),
            summary: formatSummary(r.event_type, displayName, positionTitle),
          };
        });

      // For recommendation rows we ALSO want to surface candidate_user_id
      // on the wire (so the UI can drill through). Resolve it from the
      // anonymized → user chain via a second pass over the candidate
      // profiles. (Already loaded into candidateByAnon above; we just
      // need to read candidate_user_id too — but the helper above only
      // exposes display_name. Build a parallel map.)
      const anonToUserId = new Map<string, string>();
      if (anonymizedIds.length > 0) {
        const unique = Array.from(new Set(anonymizedIds));
        const placeholders = unique.map(() => '?').join(',');
        const rows = db.prepare(`
          SELECT ca.id AS anonymized_id, cp.candidate_user_id AS user_id
          FROM candidates_anonymized ca
          JOIN candidates_private cp ON cp.id = ca.source_private_id
          WHERE ca.id IN (${placeholders})
        `).all(...unique) as Array<{ anonymized_id: string; user_id: string }>;
        for (const r of rows) anonToUserId.set(r.anonymized_id, r.user_id);
      }

      for (let i = 0; i < events.length; i++) {
        const raw = rawEvents[i];
        const ev = events[i];
        if (!raw || !ev) continue;
        if (raw.anonymized_candidate_id) {
          const uid = anonToUserId.get(raw.anonymized_candidate_id);
          if (uid) ev.candidate_user_id = uid;
        }
      }

      return {
        funnel,
        activity: events,
        generated_at: now,
      };
    },
  };
}