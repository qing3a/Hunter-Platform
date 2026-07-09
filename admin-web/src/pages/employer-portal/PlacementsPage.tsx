import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  employerPlacements,
  employerJobs,
  type Placement,
  type PlacementStatus,
  type Job,
} from '../../api/employer';
import { PlacementTimeline } from '../../components/employer-portal/PlacementTimeline';

// ============================================================================
// PlacementsPage (Employer Portal — Task 7)
//
// Read-only timeline of completed placements for the caller's jobs.
// Backed by GET /v1/employer/placements (see src/main/routes/employer.ts
// → commissionHandler.listPlacements, scoped via placements.listByEmployer).
//
// Layout
// ------
//   ┌────────────────────────────────────────────────────────────┐
//   │ 成交记录           [全部] [待付款] [已付款] [已取消]   N  │
//   ├────────────────────────────────────────────────────────────┤
//   │ [候选人] [工作]   [成交金额]  [状态]   [日期]            │
//   │ [card]  cand-A1   Engineer   ¥360,000  待付款  2026-06-15│
//   │ [card]  cand-B2   Designer   ¥500,000  已付款  2026-06-10│
//   │ ...                                                       │
//   └────────────────────────────────────────────────────────────┘
//
// Why a client-side status filter (not a re-query):
//   - The placements endpoint supports ?status= server-side, but the
//     list is already small (≤50 rows in v1; one round-trip covers
//     all of a typical employer's placements). Re-querying on every
//     chip click produces a loading flash for no upside; filtering
//     in-memory is instantaneous and the wire-format stays simpler.
//
// Job-title enrichment
// --------------------
//   The backend's `Placement` shape only carries `job_id` (no joined
//   title). To keep the timeline readable we resolve job titles in the
//   SPA by fetching the caller's jobs once and indexing them into a
//   `Map<job_id, Job>`. If a placement references a job_id not in the
//   map (race / pagination / future jobs added after the fetch) the
//   row falls back to the raw job_id (handled inside PlacementTimeline).
// ============================================================================

// ---- Filter --------------------------------------------------------------

type StatusFilter = 'all' | PlacementStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'pending_payment', label: '待付款' },
  { value: 'paid', label: '已付款' },
  { value: 'cancelled', label: '已取消' },
];

// ---- Helpers --------------------------------------------------------------

function filterByStatus(items: Placement[], filter: StatusFilter): Placement[] {
  if (filter === 'all') return items;
  return items.filter((p) => p.status === filter);
}

// ---- Component ------------------------------------------------------------

export function PlacementsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // ---- Network: placements list ----
  // Single GET on mount; status filter is applied client-side so the UI
  // flips immediately on click. Same pattern as JobsManagementPage.
  const placementsQuery = useQuery<Placement[]>({
    queryKey: ['employer', 'placements', 'list'],
    queryFn: () => employerPlacements.list(),
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  // ---- Network: jobs list (for title enrichment) ----
  // Fetched in parallel with the placements query. Errors here are
  // non-fatal — the timeline falls back to the raw job_id when a
  // placement's job isn't in the resolved map.
  const jobsQuery = useQuery<Job[]>({
    queryKey: ['employer', 'jobs', 'list'],
    queryFn: () => employerJobs.list(),
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  const placements = placementsQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];

  // job_id → Job (for title resolution in the timeline).
  const jobMap = useMemo(() => {
    const m = new Map<string, Job>();
    for (const j of jobs) m.set(j.id, j);
    return m;
  }, [jobs]);

  const visible = useMemo(
    () => filterByStatus(placements, statusFilter),
    [placements, statusFilter],
  );

  // ---- Render: loading ----
  if (placementsQuery.isLoading) {
    return (
      <div className="employer-placements" data-testid="employer-placements-loading">
        加载中…
      </div>
    );
  }

  // ---- Render: error ----
  if (placementsQuery.isError) {
    return (
      <div className="employer-placements" data-testid="employer-placements-root">
        <header className="employer-placements-header">
          <h1 className="employer-placements-title" data-testid="employer-placements-title">
            成交记录
          </h1>
        </header>
        <div className="employer-placements-error" data-testid="employer-placements-error">
          加载失败:{String((placementsQuery.error as Error)?.message ?? '未知错误')}
        </div>
      </div>
    );
  }

  return (
    <div className="employer-placements" data-testid="employer-placements-root">
      <header className="employer-placements-header">
        <h1 className="employer-placements-title" data-testid="employer-placements-title">
          成交记录
        </h1>
        <span className="employer-placements-count" data-testid="employer-placements-count">
          {placements.length} 条
        </span>
      </header>

      <section className="employer-placements-filters" data-testid="employer-placements-filters">
        {STATUS_FILTERS.map((sf) => (
          <button
            key={sf.value}
            type="button"
            className={`employer-placements-filter${statusFilter === sf.value ? ' active' : ''}`}
            data-testid={`employer-placements-filter-${sf.value}`}
            onClick={() => setStatusFilter(sf.value)}
          >
            {sf.label}
          </button>
        ))}
      </section>

      {visible.length === 0 ? (
        <div className="employer-placements-empty" data-testid="employer-placements-empty">
          {placements.length === 0
            ? '还没有成交记录。候选人入职并完成确认后会出现在这里。'
            : '当前筛选下没有成交记录。'}
        </div>
      ) : (
        <div className="employer-placements-timeline" data-testid="employer-placements-timeline">
          {visible.map((p) => (
            <PlacementTimeline
              key={p.id}
              placement={p}
              jobTitle={jobMap.get(p.job_id) ?? p.job_id}
            />
          ))}
        </div>
      )}
    </div>
  );
}