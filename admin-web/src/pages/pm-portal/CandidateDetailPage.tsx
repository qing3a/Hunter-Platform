import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  pmMatches,
  pmPositions,
  pmProjects,
  type MatchListItem,
  type Position,
  type ProjectSummary,
  type TitleLevel,
} from '../../api/pm-portal';
import { CandidateRadar } from '../../components/pm-portal/CandidateRadar';
import { PrivateNoteCard } from '../../components/pm-portal/PrivateNoteCard';
import { ScoreBadge, scoreBand } from '../../components/pm-portal/ScoreBadge';

// ============================================================================
// CandidateDetailPage (S5 / Task 13)
// ============================================================================
//
// PM-side candidate detail page. Three sections:
//
//   1. Header       — anonymized display name + headline metadata
//                     (title, experience, skills).
//   2. Top row      — basic info card on the left; 5-dim capability
//                     radar (CandidateRadar) on the right.
//   3. Matched jobs — every position this candidate has been scored
//                     against, sorted by score DESC. For each match
//                     we show: position title, project name, score
//                     band badge, reasons preview, click-through
//                     to the position detail (Task 17 will wire the
//                     full route; for now it's a placeholder).
//   4. PM notes     — `<PrivateNoteCard>` editor (UI stub; Task 16
//                     replaces the namespace with real handlers).
//
// Important: this page does NOT have a dedicated "GET /v1/pm/candidates/
// :userId" endpoint yet. To render the matched-jobs list we
// client-side aggregate by fetching:
//   - pmProjects.list()                 every project the PM owns
//   - pmPositions.list(projectId)       every position in each project
//                                       (parallel via useQueries)
//   - pmMatches.list(positionId)        every match for each position
//                                       (flat-list of MatchListItems)
// …then filter by the route :userId. This is N+1, but the volume for
// v1 (≤ 20 projects × ≤ 20 positions/project) is well within budget.
// Task 17 will introduce a dedicated /v1/pm/candidates/:id endpoint
// and the page will switch to it then.
//
// Routing
// -------
// /admin/pm/candidates/:userId. Not yet registered in App.tsx — Task 17
// will mount it. Tests mount via MemoryRouter.

// ============================================================================
// Wire types
// ============================================================================

/** Local row shape for the matched-jobs table. */
interface MatchedJobRow {
  match: MatchListItem;
  position: Position;
  project: ProjectSummary;
}

/**
 * Minimal candidate summary. Task 17 will replace this hand-rolled shape
 * with a real `/v1/pm/candidates/:userId` response. For Task 13 we
 * derive the candidate's surface from the matches themselves: the
 * highest-scored match carries the `candidate_display_name` + the
 * candidate_user_id; skills / title_level come from a fixed lookup
 * keyed by userId (mostly empty for now — the demo data below is
 * shipped in the test fixtures).
 */
export interface CandidateSummary {
  user_id: string;
  display_name: string;
  /** Title / role blurb (e.g. "高级前端工程师"). */
  headline_title: string | null;
  /** Years of experience hint. */
  years_experience: number | null;
  /** Free-form skill keywords. */
  skills: string[];
  /** Optional title level band. */
  title_level: TitleLevel | null;
}

// ============================================================================
// Demo candidate lookup (Task 13 placeholder)
// ============================================================================
//
// Real candidate detail (skills, years_experience, title_level) does
// NOT exist on the wire yet — see plan lines 374–380. The page
// gracefully degrades: when the lookup returns no row, the radar
// still renders an all-zero pentagon and the metadata rows render
// placeholders.
//
// The lookup table is intentionally hard-coded so the UI tests can
// assert against deterministic candidate data without needing a
// separate /v1/pm/candidates/:id round-trip.

const DEMO_CANDIDATE_TABLE: Record<string, CandidateSummary> = {
  'cand-1': {
    user_id: 'cand-1',
    display_name: '张*三',
    headline_title: '高级前端工程师',
    years_experience: 8,
    skills: ['vue', 'react', 'typescript', '前端'],
    title_level: 'senior',
  },
  'cand-2': {
    user_id: 'cand-2',
    display_name: '李*四',
    headline_title: '全栈工程师',
    years_experience: 6,
    skills: ['node.js', 'java', 'postgres', '后端'],
    title_level: 'senior',
  },
};

function lookupCandidate(userId: string): CandidateSummary | null {
  return DEMO_CANDIDATE_TABLE[userId] ?? null;
}

// ============================================================================
// Page component
// ============================================================================

/**
 * Number of matches we pull per position. Matches the value used by
 * CandidateMatchesPage. Capped to keep the client-side aggregation
 * bounded; v1 doesn't paginate because we filter to a single candidate
 * after the fact.
 */
const MATCHES_PER_POSITION = 100;

export function CandidateDetailPage() {
  const { userId: candidateUserId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  // ---- Local UI state ----
  // (None yet — the reasons preview is always capped at 2 entries,
  // matching the Task-11 CandidateMatchesPage pattern.)

  // ---- Network: projects ----
  const projectsQuery = useQuery({
    queryKey: ['pm', 'projects', 'list', 'all'],
    queryFn: () => pmProjects.list({ limit: 100 }),
    enabled: Boolean(candidateUserId),
  });

  const projects: ProjectSummary[] = projectsQuery.data?.projects ?? [];

  // ---- Network: positions per project (parallel via useQueries) ----
  // useQueries returns an array parallel to the input — same order, so
  // we can zip back to the project list for matched-job rows.
  const positionsQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ['pm', 'positions', 'list', p.id, 'all'],
      queryFn: () => pmPositions.list(p.id, { limit: 100 }),
      enabled: projectsQuery.isSuccess,
    })),
  });

  // Flatten project -> positions into a single list (drop empty groups).
  const flatPositions = useMemo(() => {
    const out: Array<{ project: ProjectSummary; position: Position }> = [];
    projects.forEach((project, idx) => {
      const q = positionsQueries[idx];
      if (!q || !q.data) return;
      for (const pos of q.data.positions) {
        out.push({ project, position: pos });
      }
    });
    return out;
  }, [projects, positionsQueries]);

  // ---- Network: matches per position (parallel via useQueries) ----
  // Only fire once the positions are known.
  const matchesQueries = useQueries({
    queries: flatPositions.map(({ position }) => ({
      queryKey: ['pm', 'matches', 'list', 'for-candidate', position.id],
      queryFn: () => pmMatches.list(position.id, { min_score: 0, limit: MATCHES_PER_POSITION }),
      enabled: flatPositions.length > 0,
    })),
  });

  // ---- Derived: candidate rows + lookup ----
  const candidate = candidateUserId ? lookupCandidate(candidateUserId) : null;

  const matchedJobs: MatchedJobRow[] = useMemo(() => {
    if (!candidateUserId) return [];
    const out: MatchedJobRow[] = [];
    flatPositions.forEach(({ project, position }, idx) => {
      const q = matchesQueries[idx];
      if (!q || !q.data) return;
      for (const match of q.data.matches) {
        if (match.candidate_user_id !== candidateUserId) continue;
        out.push({ match, position, project });
      }
    });
    // Sort by score DESC, then match_id ASC for stability.
    out.sort((a, b) => {
      if (b.match.score !== a.match.score) return b.match.score - a.match.score;
      return a.match.match_id - b.match.match_id;
    });
    return out;
  }, [flatPositions, matchesQueries, candidateUserId]);

  const isLoadingPositions =
    projectsQuery.isLoading || positionsQueries.some((q) => q.isLoading);
  const isLoadingMatches = matchesQueries.some((q) => q.isLoading);

  // ---- Derived: de-duplicated candidate list (Task 7 inline picker) ----
  // We flatten every match we've already pulled (the same useQueries
  // fan-out that powers `matchedJobs`), dedupe by candidate_user_id,
  // and keep the highest-scoring display name we observed. The picker
  // re-uses this so the PM can flip between candidates visible to them
  // across all PM projects, without leaving the detail page.
  const allCandidates: Array<{
    user_id: string;
    display_name: string | null;
  }> = useMemo(() => {
    const byId = new Map<string, { user_id: string; display_name: string | null }>();
    matchesQueries.forEach((q) => {
      if (!q.data) return;
      for (const m of q.data.matches) {
        if (!m.candidate_user_id) continue;
        const existing = byId.get(m.candidate_user_id);
        if (existing) {
          if (!existing.display_name && m.candidate_display_name) {
            existing.display_name = m.candidate_display_name;
          }
          continue;
        }
        byId.set(m.candidate_user_id, {
          user_id: m.candidate_user_id,
          display_name: m.candidate_display_name ?? null,
        });
      }
    });
    // Stable sort by user_id ASC.
    return Array.from(byId.values()).sort((a, b) =>
      a.user_id.localeCompare(b.user_id),
    );
  }, [matchesQueries]);

  // ---- Handlers ----
  const handleBack = () => {
    navigate(-1);
  };

  const handleViewPosition = (row: MatchedJobRow) => {
    // Placeholder until Task 17 wires the real route.
    navigate(`/admin/pm/projects/${row.project.id}/positions/${row.position.id}`);
  };

  // ---- Render guards ----

  if (projectsQuery.isError) {
    return (
      <div className="pm-candidate-detail" data-testid="pm-candidate-detail-error">
        <div className="pm-candidate-detail-error">
          加载项目失败:{String((projectsQuery.error as Error)?.message ?? '未知错误')}
        </div>
        <button
          type="button"
          className="pm-candidate-detail-back"
          onClick={() => navigate('/admin/pm/projects')}
          data-testid="pm-candidate-detail-back-fallback"
        >
          返回项目列表
        </button>
      </div>
    );
  }

  const isInitialLoading = projectsQuery.isLoading || isLoadingPositions;

  return (
    <div className="pm-candidate-detail" data-testid="pm-candidate-detail-root">
      <header className="pm-candidate-detail-header">
        <button
          type="button"
          className="pm-candidate-detail-back"
          onClick={handleBack}
          data-testid="pm-candidate-detail-back"
        >
          返回
        </button>
        <h1
          className="pm-candidate-detail-title"
          data-testid="pm-candidate-detail-title"
        >
          候选人详情
        </h1>
        {candidate && (
          <span
            className="pm-candidate-detail-name"
            data-testid="pm-candidate-detail-name"
          >
            {candidate.display_name}
          </span>
        )}
        {/*
          Inline candidate picker (Task 7). Lists every candidate the
          PM is currently aware of (deduped across all projects /
          positions in this page's fan-out). On change, navigates to
          the new candidate's detail URL.
        */}
        {candidateUserId && (
          <select
            className="pm-candidate-detail-picker"
            data-testid="pm-candidate-picker"
            aria-label="选择候选人"
            value={candidateUserId}
            onChange={(e) => {
              const next = e.target.value;
              if (next === candidateUserId) return;
              navigate(`/admin/pm/candidates/${next}`);
            }}
          >
            {/* Always include the route candidate so the picker
                remains usable while the matches fan-out is still
                loading. */}
            <option value={candidateUserId}>
              {candidate?.display_name ?? candidateUserId}
            </option>
            {allCandidates
              .filter((c) => c.user_id !== candidateUserId)
              .map((c) => (
                <option key={c.user_id} value={c.user_id}>
                  {c.display_name ?? c.user_id}
                </option>
              ))}
          </select>
        )}
      </header>

      {isInitialLoading ? (
        <div className="pm-candidate-detail-loading" data-testid="pm-candidate-detail-loading">
          加载中…
        </div>
      ) : (
        <>
          {/* ----- Top row: profile + radar ----- */}
          <section
            className="pm-candidate-detail-top"
            data-testid="pm-candidate-detail-top"
            aria-label="基本信息"
          >
            <article className="pm-candidate-detail-profile" data-testid="pm-candidate-detail-profile">
              <h2
                className="pm-candidate-detail-profile-name"
                data-testid="pm-candidate-detail-profile-name"
              >
                {candidate ? candidate.display_name : '匿名候选人'}
              </h2>
              <p
                className="pm-candidate-detail-profile-headline"
                data-testid="pm-candidate-detail-profile-headline"
              >
                {candidate?.headline_title ?? '——（候选人人选概要即将上线）'}
              </p>
              <dl className="pm-candidate-detail-profile-meta">
                <div className="pm-candidate-detail-profile-row">
                  <dt>经验</dt>
                  <dd data-testid="pm-candidate-detail-profile-years">
                    {candidate?.years_experience != null
                      ? `${candidate.years_experience} 年`
                      : '——'}
                  </dd>
                </div>
                <div className="pm-candidate-detail-profile-row">
                  <dt>职级</dt>
                  <dd data-testid="pm-candidate-detail-profile-level">
                    {candidate?.title_level ?? '——'}
                  </dd>
                </div>
                <div className="pm-candidate-detail-profile-row pm-candidate-detail-profile-row-skills">
                  <dt>技能</dt>
                  <dd data-testid="pm-candidate-detail-profile-skills">
                    {candidate?.skills && candidate.skills.length > 0
                      ? candidate.skills.join(' / ')
                      : '——'}
                  </dd>
                </div>
                <div className="pm-candidate-detail-profile-row">
                  <dt>候选 ID</dt>
                  <dd
                    className="pm-candidate-detail-profile-userid"
                    data-testid="pm-candidate-detail-profile-userid"
                    data-candidate-user-id={candidateUserId ?? ''}
                  >
                    {candidateUserId ?? '——'}
                  </dd>
                </div>
              </dl>
            </article>

            <article
              className="pm-candidate-detail-radar"
              data-testid="pm-candidate-detail-radar-card"
              aria-label="5 维能力雷达"
            >
              <h2 className="pm-candidate-detail-radar-title">能力雷达</h2>
              <CandidateRadar
                source={{
                  skills: candidate?.skills ?? [],
                  title_level: candidate?.title_level ?? null,
                }}
              />
            </article>
          </section>

          {/* ----- Matched jobs ----- */}
          <section className="pm-candidate-detail-matches" aria-label="匹配工作">
            <header className="pm-candidate-detail-matches-header">
              <h2 className="pm-candidate-detail-matches-title">匹配工作</h2>
              <span
                className="pm-candidate-detail-matches-count"
                data-testid="pm-candidate-detail-matches-count"
                data-count={matchedJobs.length}
              >
                {isLoadingMatches
                  ? '加载中…'
                  : `共 ${matchedJobs.length} 个匹配`}
              </span>
            </header>

            {isLoadingMatches && matchedJobs.length === 0 ? (
              <div
                className="pm-candidate-detail-matches-loading"
                data-testid="pm-candidate-detail-matches-loading"
              >
                加载匹配中…
              </div>
            ) : matchedJobs.length === 0 ? (
              <p
                className="pm-candidate-detail-matches-empty"
                data-testid="pm-candidate-detail-matches-empty"
              >
                该候选人暂无匹配岗位
              </p>
            ) : (
              <ul
                className="pm-candidate-detail-matches-list"
                data-testid="pm-candidate-detail-matches-list"
              >
                {matchedJobs.map((row, idx) => (
                  <li
                    key={row.match.match_id}
                    className="pm-candidate-detail-matches-item"
                    data-testid={`pm-candidate-detail-match-${idx}`}
                    data-match-id={row.match.match_id}
                    data-score={row.match.score}
                    data-band={scoreBand(row.match.score)}
                  >
                    <ScoreBadge
                      score={row.match.score}
                      size="sm"
                      testId={`pm-candidate-detail-match-${idx}-score`}
                    />
                    <div className="pm-candidate-detail-matches-body">
                      <button
                        type="button"
                        className="pm-candidate-detail-matches-title-link"
                        data-testid={`pm-candidate-detail-match-${idx}-title`}
                        onClick={() => handleViewPosition(row)}
                      >
                        {row.position.title}
                      </button>
                      <span
                        className="pm-candidate-detail-matches-project"
                        data-testid={`pm-candidate-detail-match-${idx}-project`}
                      >
                        @{row.project.name}
                      </span>
                      {row.match.reasons.length > 0 && (
                        <p
                          className="pm-candidate-detail-matches-reasons"
                          data-testid={`pm-candidate-detail-match-${idx}-reasons`}
                        >
                          {row.match.reasons.slice(0, 2).join(' · ')}
                          {row.match.reasons.length > 2 && '…'}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ----- PM private notes ----- */}
          {candidateUserId && (
            <PrivateNoteCard
              candidateUserId={candidateUserId}
              candidateLabel={candidate?.display_name}
            />
          )}
        </>
      )}
    </div>
  );
}
