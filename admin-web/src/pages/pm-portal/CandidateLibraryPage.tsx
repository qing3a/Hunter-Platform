import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  pmLibrary,
  pmNotes,
  type LibraryCandidate,
  type PmPrivateNote,
} from '../../api/pm-portal';
import { EmptyState } from '../../components/candidate-portal/EmptyState';
import { ProjectKPICard } from '../../components/pm-portal/ProjectKPICard';
import {
  LibraryFilterBar,
  type LibraryViewMode,
} from '../../components/pm-portal/LibraryFilterBar';
import {
  LibraryCandidateRow,
} from '../../components/pm-portal/LibraryCandidateRow';
import { useToast } from '../../lib/toast';

// ============================================================================
// CandidateLibraryPage (Task 14 / S9)
// ============================================================================
//
// Read-only PM view of every candidate that has been recommended by
// a headhunter across the PM's projects + positions. Built on top of
// `pmLibrary.list()` which orchestrates the N+1 client-side
// aggregation (see pm-portal.ts for the call graph).
//
// Features
// --------
//   - Search (case-insensitive substring on display_name; falls back
//     to candidate_user_id when the name is null)
//   - View toggle (table / card) persisted in localStorage under
//     `pm.library.candidates.viewMode`
//   - PM-private ⭐ annotation — bulk-hydrated via `pmNotes.listAll()`,
//     toggled inline via `pmNotes.update()`
//   - 📝 note preview chip on each row when the PM has saved a note
//
// Routing
// -------
// /admin/pm/library. Not yet registered in App.tsx — Task 17 will mount
// it behind RequirePMAuth. Tests mount via MemoryRouter.

// ----- local constants ----------------------------------------------------

type ViewMode = LibraryViewMode;
const VIEW_MODE_KEY = 'pm.library.candidates.viewMode';

function loadViewMode(): ViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY);
    return raw === 'card' ? 'card' : 'table';
  } catch {
    return 'table';
  }
}

/**
 * Search the visible candidates. Case-insensitive substring on
 * display_name; falls back to user_id so a PM who only knows the
 * masked id ("cand-42") can still find a row. Empty query matches
 * everything.
 */
function filterCandidates(
  candidates: LibraryCandidate[],
  query: string,
): LibraryCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;
  return candidates.filter((c) => {
    if (c.display_name && c.display_name.toLowerCase().includes(q)) return true;
    if (c.candidate_user_id.toLowerCase().includes(q)) return true;
    return false;
  });
}

// ----- component ----------------------------------------------------------

export function CandidateLibraryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  // ---- Local UI state ----
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode());
  const [search, setSearch] = useState('');

  // Persist view mode across reloads.
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      // localStorage may be disabled — tolerate silently.
    }
  }, [viewMode]);

  // ---- Network: aggregated candidates ----
  const libraryQuery = useQuery({
    queryKey: ['pm', 'library', 'list'],
    queryFn: () => pmLibrary.list(),
  });

  const candidates = libraryQuery.data?.candidates ?? [];
  const totalFromServer = libraryQuery.data?.total ?? 0;

  // ---- Network: bulk-fetch PM notes for the visible candidates ----
  // useQueries runs once per queryKey — the array length changes when
  // `candidates` updates (e.g. after a refetch), so the hook returns
  // a fresh array but React-Query reconciles by queryKey.
  const notesQueries = useQueries({
    queries: candidates.map((c) => ({
      queryKey: ['pm', 'notes', c.candidate_user_id] as const,
      queryFn: () => pmNotes.get(c.candidate_user_id),
      enabled: Boolean(c.candidate_user_id),
      retry: false,
    })),
  });

  /**
   * Resolve the starred / note text for each candidate from the
   * matching useQueries slot. `undefined` means "still loading".
   *
   * `note_text` is `string | null` because the backend synthesises
   * `null` when no note has been saved yet (see PmPrivateNote in
   * src/api/pm-portal.ts). Downstream consumers either coalesce with
   * `?? ''` (the row chip in card view) or use a truthy guard
   * (`stats.noteCount`).
   */
  const notesByCandidate = useMemo(() => {
    const map = new Map<string, PmPrivateNote>();
    candidates.forEach((c, idx) => {
      const q = notesQueries[idx];
      if (q?.data) {
        map.set(c.candidate_user_id, q.data);
      }
    });
    return map;
  }, [candidates, notesQueries]);

  const isNotesLoading = notesQueries.some((q) => q.isLoading);

  // ---- Network: star mutation ----
  const starMutation = useMutation({
    mutationFn: ({ userId, starred }: { userId: string; starred: boolean }) =>
      pmNotes.update(userId, { starred }),
    onSuccess: (saved, vars) => {
      queryClient.setQueryData(['pm', 'notes', vars.userId], saved);
      toast.push({
        type: 'success',
        message: saved.starred ? '已加入关注' : '已取消关注',
      });
    },
    onError: (err: Error) => {
      toast.push({
        type: 'error',
        message: `操作失败:${err.message ?? '未知错误'}`,
      });
    },
  });

  // ---- Derived ----
  const stats = useMemo(() => {
    let totalRecommendations = 0;
    let starredCount = 0;
    let noteCount = 0;
    for (const c of candidates) {
      totalRecommendations += c.position_count;
      const note = notesByCandidate.get(c.candidate_user_id);
      if (note?.starred) starredCount += 1;
      if (note?.note_text && note.note_text.trim().length > 0) noteCount += 1;
    }
    return {
      total: totalFromServer,
      totalRecommendations,
      starredCount,
      noteCount,
    };
  }, [candidates, notesByCandidate, totalFromServer]);

  const visible = useMemo(
    () => filterCandidates(candidates, search),
    [candidates, search],
  );

  // ---- Handlers ----

  const handleViewDetail = (row: LibraryCandidate) => {
    // Task 17 will register the route; we already pre-navigate to
    // keep the click-through responsive. If the route isn't mounted
    // yet the destination shows a router-404 — acceptable for v1.
    navigate(`/admin/pm/candidates/${row.candidate_user_id}`);
  };

  const handleToggleStar = (row: LibraryCandidate, next: boolean) => {
    // Optimistic update — flip the cache before the request resolves.
    const prev = queryClient.getQueryData<{ starred: boolean; note_text: string }>(
      ['pm', 'notes', row.candidate_user_id],
    );
    queryClient.setQueryData(
      ['pm', 'notes', row.candidate_user_id],
      { starred: next, note_text: prev?.note_text ?? '' },
    );
    starMutation.mutate(
      { userId: row.candidate_user_id, starred: next },
      {
        onError: () => {
          // Roll back to the server's authoritative value.
          queryClient.setQueryData(
            ['pm', 'notes', row.candidate_user_id],
            prev ?? { starred: !next, note_text: '' },
          );
        },
      },
    );
  };

  // ---- Render guards ----

  if (libraryQuery.isError) {
    return (
      <div className="pm-library pm-library-candidates" data-testid="pm-library-error">
        <header className="pm-library-header">
          <h1 className="pm-library-title">候选人库</h1>
        </header>
        <div className="pm-error">
          加载候选人库失败:{String((libraryQuery.error as Error)?.message ?? '未知错误')}
        </div>
      </div>
    );
  }

  const isLoading = libraryQuery.isLoading;
  const showEmpty = !isLoading && candidates.length === 0;
  const showNoMatch = !isLoading && candidates.length > 0 && visible.length === 0;

  return (
    <div className="pm-library pm-library-candidates" data-testid="pm-library-root">
      <header className="pm-library-header">
        <h1 className="pm-library-title" data-testid="pm-library-title">候选人库</h1>
      </header>

      <section
        className="pm-kpi-grid"
        data-testid="pm-library-stats"
        aria-label="候选人概览"
      >
        <ProjectKPICard
          label="候选人数"
          value={stats.total}
          accent="blue"
          testId="pm-library-kpi-total"
        />
        <ProjectKPICard
          label="推荐数"
          value={stats.totalRecommendations}
          accent="purple"
          testId="pm-library-kpi-recommendations"
        />
        <ProjectKPICard
          label="已关注"
          value={stats.starredCount}
          accent="amber"
          testId="pm-library-kpi-starred"
        />
        <ProjectKPICard
          label="已记录"
          value={stats.noteCount}
          accent="green"
          testId="pm-library-kpi-notes"
        />
      </section>

      <LibraryFilterBar
        search={search}
        onSearch={setSearch}
        viewMode={viewMode}
        onViewMode={setViewMode}
      />

      {isLoading && (
        <div className="pm-loading" data-testid="pm-library-loading">
          加载中…
        </div>
      )}

      {showEmpty && (
        <EmptyState
          icon="👥"
          title="暂无候选人"
          description="当 headhunter 推荐候选人后,这里会显示他们的概览"
        />
      )}

      {showNoMatch && (
        <EmptyState
          icon="🔍"
          title="没有匹配的候选人"
          description="试试调整搜索关键词"
        />
      )}

      {!isLoading && !showEmpty && !showNoMatch && viewMode === 'table' && (
        <table
          className="pm-table pm-library-table"
          data-testid="pm-library-table"
        >
          <thead>
            <tr>
              <th>姓名</th>
              <th>当前最佳匹配</th>
              <th>项目</th>
              <th>岗位</th>
              <th aria-label="关注">⭐</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, idx) => {
              const note = notesByCandidate.get(row.candidate_user_id);
              return (
                <LibraryCandidateRow
                  key={row.candidate_user_id}
                  candidate={row}
                  index={idx}
                  variant="table"
                  onViewDetail={handleViewDetail}
                  starred={note ? note.starred : isNotesLoading ? null : false}
                  onToggleStar={handleToggleStar}
                />
              );
            })}
          </tbody>
        </table>
      )}

      {!isLoading && !showEmpty && !showNoMatch && viewMode === 'card' && (
        <div className="pm-card-grid pm-library-cards" data-testid="pm-library-cards">
          {visible.map((row, idx) => {
            const note = notesByCandidate.get(row.candidate_user_id);
            return (
              <LibraryCandidateRow
                key={row.candidate_user_id}
                candidate={row}
                index={idx}
                variant="card"
                onViewDetail={handleViewDetail}
                starred={note ? note.starred : isNotesLoading ? null : false}
                onToggleStar={handleToggleStar}
                noteText={note?.note_text ?? ''}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}