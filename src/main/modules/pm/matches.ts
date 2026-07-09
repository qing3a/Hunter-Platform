// src/main/modules/pm/matches.ts
//
// PM Workbench (Phase 3b, Task 10) — Matches handler module.
//
// Surface (2 endpoints, wired in Task 17):
//   - GET    /v1/pm/positions/:id/matches              list with min_score filter
//   - POST   /v1/pm/positions/:id/matches/recompute    bulk UPSERT matches
//
// Authorization model:
//   - Caller must be a PM (user_type === 'pm'). Non-PMs get FORBIDDEN.
//   - Position must exist AND belong to a project owned by the calling PM.
//     Both "missing" and "not owned" map to NOT_FOUND so we never leak
//     the existence of another PM's positions.
//
// Recompute semantics:
//   - For each (candidate_user_id) reachable via users JOIN
//     candidates_anonymized JOIN candidates_private, compute the match
//     score via src/main/lib/weighted-match.ts.calculateMatch and UPSERT
//     into the matches table.
//   - The recompute loop is wrapped in BEGIN/COMMIT inside the repo's
//     `upsertMany` so a partial failure rolls back the entire batch.
//   - Re-running recompute is idempotent — the UNIQUE(position_id,
//     candidate_user_id) constraint + ON CONFLICT clause refresh rows
//     in place rather than duplicating them.
//
// List semantics:
//   - Returns matches sorted by score DESC (best fit first).
//   - min_score filter is applied in SQL.
//   - candidate_display_name is hydrated via JOIN to users (one extra
//     query, batched across all matches in the page).
//
// Scoring input sources (read-side):
//   - candidate.skills / title_level / industry / education come from
//     candidates_anonymized (skills_json parsed).
//   - candidate.expected_salary_min / max come from candidates_private.
//   - candidate.remote_ok + location come from candidates_private
//     (raw_payload_json or dedicated columns, depending on schema).

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createProjectsRepo } from '../../db/repositories/projects.js';
import { createProjectPositionsRepo, type PositionRow } from '../../db/repositories/project-positions.js';
import { createMatchesRepo, type MatchRow, type MatchUpsert } from '../../db/repositories/matches.js';
import { calculateMatch, type CandidateMatchInput, type PositionMatchInput } from '../../lib/weighted-match.js';
import { Errors } from '../../errors.js';
import {
  ListMatchesQuerySchema,
  type ListMatchesQuery,
  type MatchListItem,
  type TopMatch,
} from '../../schemas/pm.js';

/** Widened user_type for PM-only endpoints. Same pattern as positions.ts. */
type UserTypeExtended = User['user_type'] | 'pm';

/** Runtime check that the user is a PM. */
function userTypeIs(user: User, t: UserTypeExtended): boolean {
  return (user.user_type as UserTypeExtended) === t;
}

/** Cap for the top_matches returned alongside recompute's response. */
const TOP_MATCHES_LIMIT = 5;

interface CandidatePublicProfileRow {
  candidate_user_id: string;
  /** Pre-mask display name (raw users.name). */
  display_name: string | null;
  /** JSON-encoded skill array, or null. */
  skills_json: string | null;
  title_level: string | null;
  industry: string | null;
  education_tier: string | null;
  /** expected_salary_min / max live on candidates_private in v001. */
  expected_salary_min: number | null;
  expected_salary_max: number | null;
  /** remote_ok + location live in raw_payload_json. We accept null. */
  raw_payload_json: string | null;
}

export interface MatchesModule {
  listMatches(
    user: User,
    positionId: string,
    filter: unknown,
  ): { matches: MatchListItem[]; total: number };
  recomputeMatches(
    user: User,
    positionId: string,
  ): { computed_count: number; top_matches: TopMatch[] };
}

export function createMatchesHandler(db: DB): MatchesModule {
  const projectsRepo = createProjectsRepo(db);
  const positionsRepo = createProjectPositionsRepo(db);
  const matchesRepo = createMatchesRepo(db);

  /** Throw unless the caller is a PM. Centralises the check. */
  function assertPm(user: User): void {
    if (!userTypeIs(user, 'pm')) {
      throw Errors.forbidden('Only PMs can manage matches');
    }
  }

  /**
   * Look up a position by id, scoped to the calling PM. NOT_FOUND is
   * thrown for both "missing" and "not owned" so the response can't be
   * used to probe the existence of another PM's positions.
   */
  function findPositionForUser(user: User, positionId: string): PositionRow {
    if (!positionId || typeof positionId !== 'string') {
      throw Errors.invalidParams('position_id is required');
    }
    const projectIdRow = db.prepare(
      'SELECT project_id FROM project_positions WHERE id = ?'
    ).get(positionId) as { project_id: string } | undefined;
    if (!projectIdRow) throw Errors.notFound('Position not found');
    const project = projectsRepo.findById(projectIdRow.project_id, user.id);
    if (!project) throw Errors.notFound('Position not found');
    const row = positionsRepo.findByIdForPm(positionId, user.id, projectIdRow.project_id);
    if (!row) throw Errors.notFound('Position not found');
    return row;
  }

  /** Strict-parse the list query; throws INVALID_PARAMS on failure. */
  function parseListFilter(filter: unknown): ListMatchesQuery {
    const parsed = ListMatchesQuerySchema.safeParse(filter ?? {});
    if (!parsed.success) {
      throw Errors.invalidParams('Invalid query parameters', { issues: parsed.error.issues });
    }
    return parsed.data;
  }

  /**
   * Convert a PositionRow into the PositionMatchInput shape consumed by
   * `calculateMatch`. required_skills is already a parsed string[] on
   * PositionRow (parsed in the repo).
   */
  function positionToMatchInput(position: PositionRow): PositionMatchInput {
    return {
      required_skills: position.required_skills,
      title_level: (position.title_level as PositionMatchInput['title_level']) ?? null,
      industry: position.industry,
      salary_min: position.salary_min,
      salary_max: position.salary_max,
    };
  }

  /**
   * Convert a candidate public-profile row into the CandidateMatchInput
   * shape. JSON columns are parsed here so the failure mode (malformed
   * JSON → empty array) is contained.
   */
  function profileToCandidateInput(p: CandidatePublicProfileRow): CandidateMatchInput {
    let skills: string[] = [];
    if (typeof p.skills_json === 'string' && p.skills_json.length > 0) {
      try {
        const parsed = JSON.parse(p.skills_json);
        if (Array.isArray(parsed)) skills = parsed.map(String);
      } catch {
        skills = [];
      }
    }
    // remote_ok + location are pulled from raw_payload_json when present;
    // we degrade to false / null otherwise.
    let remoteOk = false;
    let location: string | null = null;
    if (typeof p.raw_payload_json === 'string' && p.raw_payload_json.length > 0) {
      try {
        const raw = JSON.parse(p.raw_payload_json) as Record<string, unknown>;
        if (typeof raw.remote_ok === 'boolean') remoteOk = raw.remote_ok;
        if (typeof raw.location === 'string') location = raw.location;
      } catch {
        // ignore malformed payload
      }
    }
    return {
      skills,
      title_level: (p.title_level as CandidateMatchInput['title_level']) ?? null,
      industry: p.industry,
      expected_salary_min: p.expected_salary_min,
      expected_salary_max: p.expected_salary_max,
      education: (p.education_tier as CandidateMatchInput['education']) ?? null,
      location,
      remote_ok: remoteOk,
    };
  }

  /**
   * Enumerate every candidate with at least a users row + anonymized row.
   * The JOIN chain is users → candidates_private → candidates_anonymized.
   * We DON'T filter by is_public_pool / unlock_status — the PM recompute
   * runs against the entire candidate population so the PM can see how
   * their open pool compares. (Future: gate by unlock for paid tiers.)
   */
  function listAllCandidateProfiles(): CandidatePublicProfileRow[] {
    return db.prepare(`
      SELECT cp.candidate_user_id AS candidate_user_id,
             u.name AS display_name,
             ca.skills_json AS skills_json,
             ca.title_level AS title_level,
             ca.industry AS industry,
             ca.education_tier AS education_tier,
             cp.expected_salary AS expected_salary_min,
             cp.expected_salary AS expected_salary_max,
             cp.raw_payload_json AS raw_payload_json
      FROM users u
      JOIN candidates_private cp ON cp.candidate_user_id = u.id
      JOIN candidates_anonymized ca ON ca.source_private_id = cp.id
      WHERE u.user_type = 'candidate'
        AND u.status = 'active'
    `).all() as unknown as CandidatePublicProfileRow[];
  }

  /**
   * Batch lookup of candidate display names for an array of user ids.
   * Returns a Map keyed by candidate_user_id. Used by listMatches to
   * hydrate the matches page in a single round-trip.
   */
  function batchDisplayNames(userIds: string[]): Map<string, string | null> {
    const map = new Map<string, string | null>();
    if (userIds.length === 0) return map;
    const unique = Array.from(new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0)));
    if (unique.length === 0) return map;
    const placeholders = unique.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id, name FROM users WHERE id IN (${placeholders})`
    ).all(...unique) as Array<{ id: string; name: string | null }>;
    for (const r of rows) map.set(r.id, r.name ?? null);
    return map;
  }

  return {
    /**
     * GET /v1/pm/positions/:id/matches
     *
     * Returns the paginated match list (score DESC) optionally filtered
     * by min_score. Each match row carries the hydrated
     * candidate_display_name from users.name (NULL until a recompute has
     * been run).
     */
    listMatches(user: User, positionId: string, filter: unknown): { matches: MatchListItem[]; total: number } {
      assertPm(user);
      const position = findPositionForUser(user, positionId);
      const parsed = parseListFilter(filter);

      const repoFilter: { min_score?: number; limit?: number; offset?: number } = {};
      if (parsed.min_score !== undefined) repoFilter.min_score = parsed.min_score;
      if (parsed.limit !== undefined) repoFilter.limit = parsed.limit;
      if (parsed.offset !== undefined) repoFilter.offset = parsed.offset;

      const { matches, total } = matchesRepo.listByPosition(position.id, repoFilter);

      // One batched lookup for all the display names on this page.
      const namesByCandidateId = batchDisplayNames(matches.map((m) => m.candidate_user_id));

      const items: MatchListItem[] = matches.map((m) => ({
        match_id: m.id,
        position_id: m.position_id,
        candidate_user_id: m.candidate_user_id,
        score: m.score,
        reasons: m.reasons,
        gaps: m.gaps,
        created_at: m.created_at,
        candidate_display_name: namesByCandidateId.get(m.candidate_user_id) ?? null,
      }));
      return { matches: items, total };
    },

    /**
     * POST /v1/pm/positions/:id/matches/recompute
     *
     * Enumerate all candidates, score them against the position via
     * calculateMatch, and UPSERT the results. Wraps the whole batch in a
     * BEGIN/COMMIT transaction (inside the repo's `upsertMany`) so a
     * partial failure rolls back the entire batch.
     *
     * Returns:
     *   - computed_count  = number of candidate rows processed
     *   - top_matches     = top-N (by score DESC) hydrated with
     *                       candidate_display_name, ready for the UI to
     *                       render immediately
     */
    recomputeMatches(user: User, positionId: string): { computed_count: number; top_matches: TopMatch[] } {
      assertPm(user);
      const position = findPositionForUser(user, positionId);
      const positionInput = positionToMatchInput(position);

      const profiles = listAllCandidateProfiles();
      const upserts: MatchUpsert[] = profiles.map((p) => {
        const candidateInput = profileToCandidateInput(p);
        const result = calculateMatch({ position: positionInput, candidate: candidateInput });
        return {
          position_id: position.id,
          candidate_user_id: p.candidate_user_id,
          score: result.score,
          reasons: result.reasons,
          gaps: result.gaps,
        };
      });

      matchesRepo.upsertMany(upserts);

      // top_matches = top-N by score DESC. Pull from the freshly-upserted
      // rows via listAllByPosition so we don't have to re-sort in memory.
      const allRows = matchesRepo.listAllByPosition(position.id);
      const topRows: MatchRow[] = allRows.slice(0, TOP_MATCHES_LIMIT);
      const namesByCandidateId = batchDisplayNames(topRows.map((r) => r.candidate_user_id));
      const top_matches: TopMatch[] = topRows.map((r) => ({
        candidate_user_id: r.candidate_user_id,
        score: r.score,
        reasons: r.reasons,
        gaps: r.gaps,
        candidate_display_name: namesByCandidateId.get(r.candidate_user_id) ?? null,
      }));

      return { computed_count: upserts.length, top_matches };
    },
  };
}