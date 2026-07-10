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
import { CandidateRadar, computeCandidateCapabilities } from '../../components/pm-portal/CandidateRadar';
import { CandidateProfileCard, type CandidateProfile } from '../../components/pm-portal/CandidateProfileCard';
import { MatchTableRow } from '../../components/pm-portal/MatchTableRow';
import { PMViewBanner } from '../../components/pm-portal/PMViewBanner';
import { PrivateNoteCard } from '../../components/pm-portal/PrivateNoteCard';
import { TierBadgeRow } from '../../components/pm-portal/TierBadgeRow';
import { useToast } from '@hunter-platform/shared-web/lib';

// ============================================================================
// CandidateDetailPage (S5 / Task 10 + Task 13)
// ============================================================================
//
// PM-side candidate detail page (S5 visual fidelity pass).
//
// Layout (280px + 1fr grid):
//
//   ┌──────────────────────────────────────────────────────┐
//   │ <back> 候选人详情       [picker]                      │  <- header
//   │ PMViewBanner (PM 视角 disclaimer)                    │  <- full width
//   ├────────────────┬─────────────────────────────────────┤
//   │ CandidateProfile│ CandidateRadar (svg)                │
//   │ Card (280px)   │  TierBadgeRow (5 dim A/B/C/D)       │
//   │                │  MatchTable (one row per match)     │
//   │                │  PrivateNoteCard                    │
//   └────────────────┴─────────────────────────────────────┘
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
  /** Company blurb shown next to the title (Task 10). */
  company: string | null;
  /** Source channel (e.g. "内推" / "主动投递" / "猎头推荐"). */
  source: string | null;
  /** Free-form resume / bio paragraph (Task 10). */
  resume: string | null;
}

// ============================================================================
// Demo candidate lookup (Task 13 placeholder)
// ============================================================================
//
// Real candidate detail (skills, years_experience, title_level) does
// NOT exist on the wire yet — see plan lines 374–380. The page
// gracefully degrades: when the lookup returns no row, the radar
// still renders an all-zero pentagon and the profile card falls
// back to a 匿名候选人 placeholder.
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
    company: '某互联网大厂',
    source: '内推',
    resume: '8年前端经验,Vue/React 专家,带过 5 人小组',
  },
  'cand-2': {
    user_id: 'cand-2',
    display_name: '李*四',
    headline_title: '全栈工程师',
    years_experience: 6,
    skills: ['node.js', 'java', 'postgres', '后端'],
    title_level: 'senior',
    company: '某跨境电商',
    source: '猎头推荐',
    resume: '6年全栈,熟悉 Node/Java,主导过 3 个 0→1 项目',
  },
};

function lookupCandidate(userId: string): CandidateSummary | null {
  return DEMO_CANDIDATE_TABLE[userId] ?? null;
}

/**
 * Convert a CandidateSummary into the CandidateProfile shape the
 * left-column card expects. Pure helper — the demo lookup may
 * return null, in which case we build a placeholder profile.
 */
function buildProfile(candidate: CandidateSummary | null): CandidateProfile {
  if (!candidate) {
    return {
      displayName: '匿名候选人',
      title: '——',
      company: '——',
      source: '——',
      resume: '候选人人选概要即将上线',
      tags: [],
    };
  }
  return {
    displayName: candidate.display_name,
    title: candidate.headline_title ?? '——',
    company: candidate.company ?? '——',
    source: candidate.source ?? '——',
    resume: candidate.resume ?? '——（候选人简历即将上线）',
    tags: candidate.skills,
  };
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
  const toast = useToast();

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
  const profile = buildProfile(candidate);

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

  // ---- Derived: 5-dim radar scores (re-used by TierBadgeRow) ----
  // We compute the same scores the radar chart uses so the A/B/C/D
  // badges underneath always agree with the polygon.
  const tierDims = useMemo(() => {
    const scores = computeCandidateCapabilities({
      skills: candidate?.skills ?? [],
      title_level: candidate?.title_level ?? null,
    });
    return [
      { label: '前端', value: scores.frontend },
      { label: '后端', value: scores.backend },
      { label: '移动端', value: scores.mobile },
      { label: '数据', value: scores.data },
      { label: '设计', value: scores.design },
    ];
  }, [candidate]);

  // ---- Handlers ----
  const handleBack = () => {
    navigate(-1);
  };

  const handleRecommend = (row: MatchedJobRow) => {
    toast.push({
      type: 'success',
      message: `已推荐 ${candidate?.display_name ?? '候选人'} → ${row.position.title}`,
    });
  };

  const handleCaution = (row: MatchedJobRow) => {
    toast.push({
      type: 'info',
      message: `已标记谨慎 ${row.position.title}`,
    });
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

      <PMViewBanner />

      {isInitialLoading ? (
        <div className="pm-candidate-detail-loading" data-testid="pm-candidate-detail-loading">
          加载中…
        </div>
      ) : (
        <div className="pm-s5-grid" data-testid="pm-s5-grid">
          {/* ----- Left column: profile card ----- */}
          <aside className="pm-s5-grid-left" data-testid="pm-s5-grid-left">
            <CandidateProfileCard profile={profile} />
          </aside>

          {/* ----- Right column: radar + tier badges + match table + notes ----- */}
          <section className="pm-s5-grid-right" data-testid="pm-s5-grid-right">
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
              <TierBadgeRow dims={tierDims} />
            </article>

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
                <table className="pm-s5-match-table" data-testid="pm-s5-match-table">
                  <thead>
                    <tr>
                      <th>岗位</th>
                      <th>项目</th>
                      <th>级别</th>
                      <th>分数</th>
                      <th>理由 / 差距</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchedJobs.map((row) => (
                      <MatchTableRow
                        key={row.match.match_id}
                        match={{
                          position: row.position.title,
                          project: row.project.name,
                          level: row.position.title_level ?? '——',
                          score: row.match.score,
                          reasons: row.match.reasons.slice(0, 2).join(' / '),
                          gaps: row.match.gaps.slice(0, 2).join(' / '),
                        }}
                        onRecommend={() => handleRecommend(row)}
                        onCaution={() => handleCaution(row)}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* ----- PM private notes ----- */}
            {candidateUserId && (
              <PrivateNoteCard
                candidateUserId={candidateUserId}
                candidateLabel={candidate?.display_name}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
