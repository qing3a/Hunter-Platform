// src/main/modules/pm/sandbox.ts
//
// PM Workbench (Phase 3b, Task 9) — Sandbox handler module.
//
// Surface (1 endpoint, wired in Task 17):
//   - GET /v1/pm/positions/:id/sandbox
//
// The sandbox aggregates hunter-side `recommendations` for a single
// project_position, grouped by the 6 pipeline stages (submitted →
// screen_passed → interview → offer → onboarded + rejected). Each stage
// carries:
//   - count                    number of candidates in that stage
//   - risk_count               per-flag counts (stuck_long / stuck_very_long)
//   - candidates[]             up to 20 candidates, with masked display name,
//                              stage_entered_at timestamp, and per-candidate
//                              risk_flags
//
// The frontend (admin-web PipelineSandboxPage) renders one card per stage
// and lets the PM expand a stage to see the candidate list. The first 5
// stages are the "active funnel" — onboarded + rejected are terminal and
// shown but not styled as clickable.
//
// Authorization model:
//   - Caller must be a PM (user_type === 'pm'). Non-PMs get FORBIDDEN.
//   - Position must exist AND belong to the caller's project.
//     Both "missing" and "not owned" map to NOT_FOUND — we never leak
//     the existence of another PM's positions.
//
// Risk flag computation (pure, deterministic):
//   - stuck_long       — stage_entered_at < now - 30 days AND stage non-terminal
//   - stuck_very_long  — stage_entered_at < now - 60 days AND stage non-terminal
//   (stuck_very_long is a SUPERSET of stuck_long — we only emit the more
//   severe flag to keep the UI chips simple. A candidate stuck 70 days
//   shows "stuck_very_long", not both.)

import type { DB } from '../../db/connection.js';
import type { User, Recommendation } from '../../../shared/types.js';
import { createProjectsRepo } from '../../db/repositories/projects.js';
import { createProjectPositionsRepo, type PositionRow } from '../../db/repositories/project-positions.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { maskName } from '../../lib/mask.js';
import { Errors } from '../../errors.js';
import {
  PIPELINE_STAGES,
  STAGE_LABELS,
  isTerminal,
  type PipelineStage,
} from '../../lib/hunter-pipeline.js';
import type {
  SandboxStage,
  SandboxCandidate,
  SandboxStageRiskCount,
} from '../../schemas/pm.js';

/**
 * Widened user_type for PM-only endpoints. Same pattern as positions.ts /
 * plans.ts. Cast-and-narrow at the boundary so the rest of the module
 * stays on the narrow User type.
 */
type UserTypeExtended = User['user_type'] | 'pm';

/** Runtime check that the user is a PM. */
function userTypeIs(user: User, t: UserTypeExtended): boolean {
  return (user.user_type as UserTypeExtended) === t;
}

/** Threshold (ms) above which a non-terminal candidate is "stuck". */
const STUCK_LONG_MS = 30 * 86_400_000;        // 30 days
const STUCK_VERY_LONG_MS = 60 * 86_400_000;   // 60 days

/** Per-stage candidate cap in the response. */
const STAGE_CANDIDATE_LIMIT = 20;

/** Labels mirror the candidate-portal funnel card but are duplicated here for portability. */
const STAGE_LABEL_MAP: Record<PipelineStage, string> = { ...STAGE_LABELS };

export interface SandboxModule {
  getSandbox(user: User, positionId: string): {
    position: { id: string; title: string; total_headcount_planned: number; total_headcount_filled: number };
    stages: SandboxStage[];
    total: number;
  };
}

export function createSandboxHandler(db: DB): SandboxModule {
  const projectsRepo = createProjectsRepo(db);
  const positionsRepo = createProjectPositionsRepo(db);
  const recsRepo = createRecommendationsRepo(db);

  /** Throw unless the caller is a PM. Centralises the check. */
  function assertPm(user: User): void {
    if (!userTypeIs(user, 'pm')) {
      throw Errors.forbidden('Only PMs can view sandbox');
    }
  }

  /**
   * Look up a position by id, scoped to the calling PM. The hop through
   * `projects.findById` enforces the ownership scope; the row-level
   * `findByIdForPm` is defense in depth. NOT_FOUND is thrown for both
   * "missing" and "not owned" so the response can't be used to probe
   * the existence of another PM's positions.
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

  /**
   * Compute the per-candidate risk_flags for a given stage entry. Pure
   * function — the only inputs are the timestamp and the stage. Terminal
   * stages never receive stuck_* flags (their duration is bounded by the
   * workflow, not by PM responsiveness).
   *
   * Returns [] when the candidate is fresh or in a terminal stage.
   */
  function computeRiskFlags(stage: PipelineStage, stageEnteredAt: number | null): string[] {
    if (isTerminal(stage)) return [];
    if (stageEnteredAt == null) return [];
    const ageMs = Date.now() - stageEnteredAt;
    // stuck_very_long subsumes stuck_long — emit only the more severe flag
    // so the UI doesn't show both chips for the same candidate.
    if (ageMs >= STUCK_VERY_LONG_MS) return ['stuck_very_long'];
    if (ageMs >= STUCK_LONG_MS) return ['stuck_long'];
    return [];
  }

  /**
   * Hydrate a single recommendation row into the wire-shape
   * SandboxCandidate. Looks up the anonymized candidate's display name
   * via a pre-built `profilesByAnonymizedId` map (so the JOIN runs
   * once per request, not once per candidate — see `getSandbox`).
   *
   * `stage_entered_at` is best-effort: v030 added the column and backfilled
   * it from updated_at, so it should never be null in practice. We still
   * coerce null → Date.now() as a defensive fallback (risk_flags will then
   * report a 0-day candidate).
   */
  function hydrateCandidate(
    rec: Recommendation,
    profilesByAnonymizedId: Map<string, { candidate_user_id: string; display_name: string | null }>,
  ): SandboxCandidate {
    // Lookup the candidate_user_id via the anonymized → private chain.
    // The user_id is what the UI uses as the stable identity.
    const profile = profilesByAnonymizedId.get(rec.anonymized_candidate_id);
    const displayName = maskName(profile?.display_name ?? '');

    // Recommendation.pipeline_stage is typed as string (optional). Narrow
    // it to PipelineStage here — the DB CHECK constraint guarantees it's
    // one of the 6 values, and the sandbox aggregation only ever queries
    // rows in the canonical stages list.
    const pipelineStage = (rec.pipeline_stage ?? 'submitted') as PipelineStage;
    const stageEnteredAt = rec.stage_entered_at ?? null;

    return {
      recommendation_id: rec.id,
      candidate_user_id: profile?.candidate_user_id ?? '',
      candidate_display_name: displayName,
      stage_entered_at: stageEnteredAt ?? Date.now(),
      risk_flags: computeRiskFlags(pipelineStage, stageEnteredAt),
    };
  }

  return {
    /**
     * GET /v1/pm/positions/:id/sandbox
     *
     * Aggregates the recommendations attached to `positionId`, grouped by
     * the 6 pipeline stages (5 active + 1 terminal "rejected"). Returns:
     *   - the position summary (id / title / headcount planned vs filled)
     *   - per-stage buckets (count + risk_count + up to 20 candidates)
     *   - the grand total
     *
     * Stage ordering is the canonical PIPELINE_STAGES list (submitted
     * first, onboarded last among active, rejected terminal at the very
     * end). The handler never reads more than 20 candidates per stage so
     * the response stays under a few KB even with deep funnels.
     */
    getSandbox(user: User, positionId: string) {
      assertPm(user);
      const position = findPositionForUser(user, positionId);

      // Per-stage counts in one round-trip.
      const agg = recsRepo.aggregateByPositionStage(position.id);

      // Build the stage list in canonical pipeline order, including the
      // terminal 'rejected' bucket so the UI can show it consistently.
      const allStages: PipelineStage[] = [...PIPELINE_STAGES, 'rejected'];

      // For each stage, fetch up to STAGE_CANDIDATE_LIMIT candidates.
      // We issue 6 small queries (one per stage) — stage count is bounded
      // by the pipeline shape, so this isn't an N+1 problem at the stage
      // level. (The previous per-candidate hydration was the actual N+1
      // and is now eliminated by the batched profile fetch below.)
      const recsByStage: Array<{ stage: PipelineStage; recs: Recommendation[] }> =
        allStages.map((stage) => ({
          stage,
          recs: recsRepo.findByPositionAndStage(position.id, stage, {
            limit: STAGE_CANDIDATE_LIMIT,
            offset: 0,
          }),
        }));

      // Batch the anonymized → user profile lookups across ALL stages in a
      // single IN-clause query. Before this change, `hydrateCandidate` did
      // a per-candidate 3-table JOIN inline — up to 6 × 20 = 120
      // round-trips per sandbox request. Now: 1.
      const allAnonymizedIds = recsByStage.flatMap((rs) => rs.recs.map((r) => r.anonymized_candidate_id));
      const profiles = recsRepo.findCandidatePublicProfiles(allAnonymizedIds);
      const profilesByAnonymizedId = new Map(
        profiles.map((p) => [p.anonymized_candidate_id, { candidate_user_id: p.candidate_user_id, display_name: p.display_name }])
      );

      const stages: SandboxStage[] = recsByStage.map(({ stage, recs }) => {
        const candidates = recs.map((r) => hydrateCandidate(r, profilesByAnonymizedId));
        const riskCount: SandboxStageRiskCount = {
          stuck_long: candidates.filter((c) => c.risk_flags.includes('stuck_long')).length,
          stuck_very_long: candidates.filter((c) => c.risk_flags.includes('stuck_very_long')).length,
        };
        const count = stage === 'submitted' ? agg.submitted
          : stage === 'screen_passed' ? agg.screen_passed
          : stage === 'interview' ? agg.interview
          : stage === 'offer' ? agg.offer
          : stage === 'onboarded' ? agg.onboarded
          : agg.rejected;
        return {
          stage,
          count,
          risk_count: riskCount,
          candidates,
        };
      });

      return {
        position: {
          id: position.id,
          title: position.title,
          total_headcount_planned: position.headcount_planned,
          total_headcount_filled: position.headcount_filled,
        },
        stages,
        total: agg.total,
      };
    },
  };
}

// Re-export the stage label map for the frontend (admin-web) so the funnel
// labels stay in sync with hunter-pipeline.ts without needing a separate
// constants file. The admin-web side is expected to render the same labels.
export { STAGE_LABEL_MAP };