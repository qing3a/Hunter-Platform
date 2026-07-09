import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  pmMatches,
  pmPositions,
  type MatchListItem,
  type Position,
} from '../../api/pm-portal';
import { MatchCard } from '../../components/pm-portal/MatchCard';
import { useToast } from '../../lib/toast';

// ============================================================================
// CandidateMatchesPage (Task 11 / S6)
// ============================================================================
//
// Lists candidate matches for a single project_position, sorted by
// score DESC. Each card shows:
//   - score badge         colour-coded by band (excellent / good / fair / poor)
//   - masked display name + optional headline
//   - reasons (green ✓)   weighted-match positive signals
//   - gaps    (red ✗)     weighted-match negative signals
//   - 查看详情 button      placeholder (Task 13 will wire it)
//
// Controls
// --------
//   - min_score dropdown  (0 / 60 / 75 / 90) — drives pmMatches.list's
//                         `min_score` query param
//   - 重算匹配 button      calls pmMatches.recompute then invalidates the
//                         list query (the recompute response itself is
//                         shown as a toast)
//
// Routing
// -------
// /pm/positions/:id/matches. Registered by Task 17 (admin-web App.tsx).
// For now the test file mounts the page directly via MemoryRouter.
//
// Network
// -------
//   - pmPositions.get(id)      position title + project_id for back-nav
//   - pmMatches.list(id, ?)    paginated matches (score DESC, total count)
//   - pmMatches.recompute(id)  bulk UPSERT + top-N echo

/** Allowed values for the min_score filter — matches the spec. */
const MIN_SCORE_OPTIONS = [0, 60, 75, 90] as const;
type MinScoreOption = typeof MIN_SCORE_OPTIONS[number];

const MIN_SCORE_LABELS: Record<MinScoreOption, string> = {
  0: '全部',
  60: '60+',
  75: '75+',
  90: '90+',
};

export function CandidateMatchesPage() {
  const { id: positionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  // ---- Local UI state ----
  const [minScore, setMinScore] = useState<MinScoreOption>(0);

  // ---- Network: position header ----
  const positionQuery = useQuery({
    queryKey: ['pm', 'positions', 'get', positionId],
    queryFn: () => pmPositions.get(positionId!),
    enabled: Boolean(positionId),
  });

  // ---- Network: matches list ----
  // Server-side already sorts by score DESC; we additionally client-side
  // sort by score DESC so reordering after a recompute (where the order
  // might lag by one render frame) is deterministic in the UI.
  const matchesQuery = useQuery({
    queryKey: ['pm', 'matches', 'list', positionId, minScore],
    queryFn: () => pmMatches.list(positionId!, { min_score: minScore, limit: 100 }),
    enabled: Boolean(positionId),
  });

  // ---- Network: recompute mutation ----
  const recomputeMutation = useMutation({
    mutationFn: () => pmMatches.recompute(positionId!),
    onSuccess: (res) => {
      toast.push({
        type: 'success',
        message: `重算完成 · 共计算 ${res.computed_count} 位候选人`,
      });
      // Invalidate the list so the freshly-upserted rows hydrate the UI.
      queryClient.invalidateQueries({ queryKey: ['pm', 'matches', 'list', positionId] });
    },
    onError: (err: Error) => {
      toast.push({
        type: 'error',
        message: `重算失败:${err.message ?? '未知错误'}`,
      });
    },
  });

  // ---- Derived state ----
  const position = positionQuery.data?.position as Position | undefined;
  const matches: MatchListItem[] = useMemo(() => {
    const raw = matchesQuery.data?.matches ?? [];
    // Defensive client-side sort by score DESC then by match_id ASC for
    // stable ordering. Server already sorts by score DESC, but recompute
    // mutations can leave a stale cache in flight for a tick.
    return [...raw].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.match_id - b.match_id;
    });
  }, [matchesQuery.data]);
  const total = matchesQuery.data?.total ?? 0;
  const averageScore = useMemo(() => {
    if (matches.length === 0) return null;
    const sum = matches.reduce((acc, m) => acc + m.score, 0);
    return Math.round(sum / matches.length);
  }, [matches]);

  // ---- Handlers ----
  const handleBack = () => {
    const projectId = position?.project_id;
    if (projectId) navigate(`/pm/projects/${projectId}`);
    else navigate('/pm/projects');
  };

  const handleRecompute = () => {
    recomputeMutation.mutate();
  };

  const handleMinScoreChange = (next: MinScoreOption) => {
    setMinScore(next);
  };

  // ---- Render guards ----

  if (positionQuery.isError) {
    return (
      <div className="pm-matches" data-testid="pm-matches-position-error">
        <div className="pm-matches-error">
          加载岗位信息失败:{String((positionQuery.error as Error)?.message ?? '未知错误')}
        </div>
        <button
          type="button"
          className="pm-matches-back"
          onClick={() => navigate('/pm/projects')}
          data-testid="pm-matches-back-fallback"
        >
          返回项目列表
        </button>
      </div>
    );
  }

  if (matchesQuery.isError) {
    return (
      <div className="pm-matches" data-testid="pm-matches-error">
        <div className="pm-matches-error">
          加载匹配失败:{String((matchesQuery.error as Error)?.message ?? '未知错误')}
        </div>
        <button
          type="button"
          className="pm-matches-back"
          onClick={handleBack}
          data-testid="pm-matches-back"
        >
          返回项目详情
        </button>
      </div>
    );
  }

  const isLoading = matchesQuery.isLoading || positionQuery.isLoading;

  return (
    <div className="pm-matches" data-testid="pm-matches-root">
      <header className="pm-matches-header">
        <div className="pm-matches-header-left">
          <button
            type="button"
            className="pm-matches-back"
            onClick={handleBack}
            data-testid="pm-matches-back"
          >
            返回项目详情
          </button>
          <h1 className="pm-matches-title" data-testid="pm-matches-title">
            {position ? `${position.title} · 候选人匹配` : '候选人匹配'}
          </h1>
        </div>
        <div className="pm-matches-header-actions">
          <label className="pm-matches-filter">
            <span className="pm-matches-filter-label">最低分</span>
            <select
              className="pm-matches-filter-select"
              data-testid="pm-matches-min-score"
              value={minScore}
              onChange={(e) => handleMinScoreChange(Number(e.target.value) as MinScoreOption)}
              disabled={isLoading || recomputeMutation.isPending}
            >
              {MIN_SCORE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {MIN_SCORE_LABELS[opt]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="pm-matches-recompute"
            data-testid="pm-matches-recompute"
            onClick={handleRecompute}
            disabled={isLoading || recomputeMutation.isPending}
          >
            {recomputeMutation.isPending ? '重算中…' : '重算匹配'}
          </button>
        </div>
      </header>

      {/* Stats strip */}
      <section
        className="pm-matches-stats"
        data-testid="pm-matches-stats"
        aria-label="匹配概览"
      >
        <div className="pm-matches-stat">
          <span className="pm-matches-stat-label">匹配数</span>
          <span
            className="pm-matches-stat-value"
            data-testid="pm-matches-stat-total"
            data-total={total}
          >
            {isLoading ? '—' : total}
          </span>
        </div>
        <div className="pm-matches-stat">
          <span className="pm-matches-stat-label">平均分</span>
          <span
            className="pm-matches-stat-value"
            data-testid="pm-matches-stat-average"
            data-average={averageScore ?? ''}
          >
            {isLoading ? '—' : (averageScore ?? '—')}
          </span>
        </div>
        <div className="pm-matches-stat">
          <span className="pm-matches-stat-label">当前过滤</span>
          <span
            className="pm-matches-stat-value"
            data-testid="pm-matches-stat-filter"
            data-min-score={minScore}
          >
            {MIN_SCORE_LABELS[minScore]}
          </span>
        </div>
      </section>

      {/* Body: loading / empty / grid */}
      {isLoading ? (
        <div className="pm-matches-loading" data-testid="pm-matches-loading">
          加载中…
        </div>
      ) : matches.length === 0 ? (
        <div className="pm-matches-empty" data-testid="pm-matches-empty">
          {recomputeMutation.isSuccess ? '重算后无新匹配' : '暂无匹配,试试重算匹配'}
        </div>
      ) : (
        <section
          className="pm-matches-grid"
          data-testid="pm-matches-grid"
          aria-label="候选人匹配列表"
        >
          {matches.map((match, idx) => (
            <MatchCard key={match.match_id} match={match} index={idx} />
          ))}
        </section>
      )}
    </div>
  );
}