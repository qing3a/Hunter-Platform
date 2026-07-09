import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  pmMatches,
  pmPositions,
  type MatchListItem,
  type Position,
} from '../../api/pm-portal';
import { MatchCard } from '../../components/pm-portal/MatchCard';
import { PositionPicker } from '../../components/pm-portal/PositionPicker';
import { SortPills, type SortKey } from '../../components/pm-portal/SortPills';
import { useToast } from '../../lib/toast';

// ============================================================================
// CandidateMatchesPage (Task 11 / S6)
// ============================================================================
//
// Lists candidate matches for a single project_position. Sort order is
// driven by the SortPills (匹配度 / 到岗时间 / 薪资匹配) and the page
// re-sorts client-side on pill change so the UI reacts instantly.
//
// Each card shows:
//   - score badge         colour-coded by band (excellent / good / fair / poor)
//   - score tier label    small "高分 / 中分 / 低分" chip next to the score
//   - masked display name + optional headline
//   - reasons (green ✓)   weighted-match positive signals
//   - gaps    (red ✗)     weighted-match negative signals
//   - per-row action stack  → 推荐给猎头 / 📞 解锁 / ✗ 不合适
//   - 查看详情 button      placeholder (Task 13 will wire it)
//
// Controls
// --------
//   - sort pills         匹配度 (score) / 到岗时间 (created_at) / 薪资匹配
//                        (score fallback — salary data not yet on the
//                        match list item)
//   - min_score dropdown  (0 / 60 / 75 / 90) — drives pmMatches.list's
//                        `min_score` query param
//   - 重算匹配 button     calls pmMatches.recompute then invalidates the
//                        list query (the recompute response itself is
//                        shown as a toast)
//
// Sort semantics
// --------------
//   - 'score'  -> score DESC, then match_id ASC for stable ordering
//   - 'time'   -> created_at DESC (most recent first; salary / time-to-join
//                 data is not on MatchListItem yet — Task 13 will surface it)
//   - 'salary' -> falls back to the score-DESC order so the pill is still
//                 useful as a UI affordance even though the data isn't
//                 available. The placeholder keeps the affordance
//                 consistent with the prototype (prototype.html lines
//                 1645-1658).
//
// Action callbacks
// ----------------
//   - recommend / unlock / reject all push a `info` toast for v1. The
//     real mutation calls will land in a later Task that introduces
//     the recommend / unlock backend endpoints.
//
// Routing
// -------
// /admin/pm/positions/:id/matches. Registered by Task 17 (admin-web App.tsx).
// For now the test file mounts the page directly via MemoryRouter.
//
// Network
// -------
//   - pmPositions.get(id)      position title + project_id for back-nav
//   - pmPositions.list(id, ?)  paginated project positions (inline picker)
//   - pmMatches.list(id, ?)    paginated matches (server: score DESC)
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

/**
 * Pure helper — sort the matches array by the current SortKey.
 * Kept top-level so unit tests can import it directly.
 */
export function sortMatches(
  matches: MatchListItem[],
  key: SortKey,
): MatchListItem[] {
  const copy = [...matches];
  if (key === 'time') {
    return copy.sort((a, b) => {
      if (b.created_at !== a.created_at) return b.created_at - a.created_at;
      return a.match_id - b.match_id;
    });
  }
  if (key === 'salary') {
    // No salary data on MatchListItem yet — fall back to score DESC so
    // the pill is still useful as a UI affordance (and stable).
    return copy.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.match_id - b.match_id;
    });
  }
  // 'score' — default
  return copy.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.match_id - b.match_id;
  });
}

export function CandidateMatchesPage() {
  const { id: positionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  // ---- Local UI state ----
  const [minScore, setMinScore] = useState<MinScoreOption>(0);
  const [sortKey, setSortKey] = useState<SortKey>('score');

  // ---- Network: position header ----
  const positionQuery = useQuery({
    queryKey: ['pm', 'positions', 'get', positionId],
    queryFn: () => pmPositions.get(positionId!),
    enabled: Boolean(positionId),
  });

  // ---- Network: project positions (Task 7 inline picker) ----
  // S6 hosts a <PositionPicker> at the top of the page so the PM can
  // jump to another position's match list without leaving the funnel.
  // The query is gated on the position header so the picker is only
  // rendered once we know the project id.
  const matchProjectId = positionQuery.data?.position.project_id;
  const positionsListQuery = useQuery({
    queryKey: ['pm', 'positions', 'list', matchProjectId, 'picker'],
    queryFn: () => pmPositions.list(matchProjectId!, { limit: 100 }),
    enabled: Boolean(matchProjectId),
  });

  // ---- Network: matches list ----
  // Server-side already sorts by score DESC; we additionally client-side
  // sort so reordering after a recompute (where the order might lag by
  // one render frame) is deterministic in the UI.
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
  const rawMatches: MatchListItem[] = matchesQuery.data?.matches ?? [];
  const matches = useMemo(() => sortMatches(rawMatches, sortKey), [rawMatches, sortKey]);
  const total = matchesQuery.data?.total ?? 0;
  const averageScore = useMemo(() => {
    if (matches.length === 0) return null;
    const sum = matches.reduce((acc, m) => acc + m.score, 0);
    return Math.round(sum / matches.length);
  }, [matches]);

  // ---- Handlers ----
  const handleBack = () => {
    const projectId = position?.project_id;
    if (projectId) navigate(`/admin/pm/projects/${projectId}`);
    else navigate('/admin/pm/projects');
  };

  const handleRecompute = () => {
    recomputeMutation.mutate();
  };

  const handleMinScoreChange = (next: MinScoreOption) => {
    setMinScore(next);
  };

  const handleSortChange = (next: SortKey) => {
    setSortKey(next);
  };

  // Per-row action callbacks — v1 emits a toast placeholder; later
  // Tasks will wire the real pmMatches.{recommend,unlock,reject}
  // mutations. We log the match id so the PM can see something is
  // happening even if their toast dismisses before they read it.
  const handleRecommend = useCallback(
    (m: MatchListItem) => {
      toast.push({
        type: 'info',
        message: `已记录推荐 #${m.match_id}（v1 占位,后续接入）`,
      });
    },
    [toast],
  );
  const handleUnlock = useCallback(
    (m: MatchListItem) => {
      toast.push({
        type: 'info',
        message: `已记录解锁 #${m.match_id}（v1 占位,后续接入）`,
      });
    },
    [toast],
  );
  const handleReject = useCallback(
    (m: MatchListItem) => {
      toast.push({
        type: 'info',
        message: `已记录不适合 #${m.match_id}（v1 占位,后续接入）`,
      });
    },
    [toast],
  );

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
          onClick={() => navigate('/admin/pm/projects')}
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
          {/*
            Inline position picker (Task 7). Renders once the position
            header has resolved (so we know the project id); before
            that we skip rendering to avoid an orphan <select>.
          */}
          {matchProjectId && positionId && (
            <PositionPicker
              positions={[
                ...((positionsListQuery.data?.positions ?? []).map((p) => ({
                  id: p.id,
                  title: p.title,
                  title_level: p.title_level ?? undefined,
                }))),
                ...(positionsListQuery.data?.positions?.some(
                  (p) => p.id === positionId,
                )
                  ? []
                  : [
                      {
                        id: positionId,
                        title: position?.title ?? '当前岗位',
                        title_level: position?.title_level ?? undefined,
                      },
                    ]),
              ]}
              value={positionId}
              onChange={(newPositionId) => {
                if (newPositionId === positionId) return;
                navigate(
                  `/admin/pm/projects/${matchProjectId}/positions/${newPositionId}/matches`,
                );
              }}
            />
          )}
          {/*
            Sort pills (Task 11). Sits directly under the picker so the
            PM sees it on the same scan line. Default is 'score' so the
            initial view matches the pre-Task-11 behaviour.
          */}
          <div className="pm-matches-sort" data-testid="pm-matches-sort">
            <span className="pm-matches-sort-label">排序</span>
            <SortPills value={sortKey} onChange={handleSortChange} />
          </div>
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
            <MatchCard
              key={match.match_id}
              match={match}
              index={idx}
              onRecommend={handleRecommend}
              onUnlock={handleUnlock}
              onReject={handleReject}
            />
          ))}
        </section>
      )}
    </div>
  );
}
