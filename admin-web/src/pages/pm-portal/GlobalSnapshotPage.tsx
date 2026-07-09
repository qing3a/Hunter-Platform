import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { pmSnapshot } from '../../api/pm-portal';
import { SnapshotFunnel } from '../../components/pm-portal/SnapshotFunnel';
import { ActivityFeed } from '../../components/pm-portal/ActivityFeed';

// ============================================================================
// GlobalSnapshotPage (Task 12 / S1)
// ============================================================================
//
// The PM Workbench home page. Renders the 4-stage funnel (projects →
// positions → candidates → matches) and the 24h HR activity feed.
//
// Layout
// ------
//   1. Header
//        - "全局快照" title
//        - last-updated timestamp ("生成于 N 分钟前")
//        - refresh button (manual refetch)
//   2. Funnel  — 4 SnapshotFunnelCards in canonical funnel order
//   3. Activity feed — up to 50 events from the last 24h
//
// Network
// -------
//   - pmSnapshot.get()   single-shot aggregation
//   - The page does NOT auto-poll in v1 — the user clicks "刷新" to
//     pull fresh data. A `pollIntervalMs` knob is reserved for a
//     later task (the spec calls for 30s auto-refresh as a stretch
//     goal).
//
// Routing
// -------
// /admin/pm/snapshot. NOT registered in App.tsx yet — Task 17 wires the
// route. For now the test file mounts the page directly via
// MemoryRouter.

export function GlobalSnapshotPage() {
  // ---- Network: snapshot ----
  // We rely on `refetch` to drive the manual refresh button. The query
  // is NOT polled (refetchInterval: false) — the page emits a "刷新"
  // button that calls refetch() on click.
  const snapshotQuery = useQuery({
    queryKey: ['pm', 'snapshot'],
    queryFn: () => pmSnapshot.get(),
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  // ---- Local state ----
  // The refresh button shows a spinner-style "刷新中…" while the
  // refetch is in flight.
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  // ---- Handlers ----
  const handleRefresh = async () => {
    setIsManualRefreshing(true);
    try {
      await snapshotQuery.refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  };

  // ---- Derived state ----
  const data = snapshotQuery.data;

  // ---- Render: error ----
  if (snapshotQuery.isError) {
    return (
      <div className="pm-snapshot" data-testid="pm-snapshot-error-root">
        <header className="pm-snapshot-header">
          <h1 className="pm-snapshot-title">全局快照</h1>
        </header>
        <div className="pm-snapshot-error" data-testid="pm-snapshot-error">
          加载失败:{String((snapshotQuery.error as Error)?.message ?? '未知错误')}
        </div>
      </div>
    );
  }

  // ---- Render: success ----
  return (
    <div className="pm-snapshot" data-testid="pm-snapshot-root">
      <header className="pm-snapshot-header">
        <div className="pm-snapshot-header-left">
          <h1 className="pm-snapshot-title" data-testid="pm-snapshot-title">全局快照</h1>
          {data && (
            <span
              className="pm-snapshot-generated-at"
              data-testid="pm-snapshot-generated-at"
              data-generated-at={data.generated_at}
            >
              生成于 {formatGeneratedAt(data.generated_at)}
            </span>
          )}
        </div>
        <button
          type="button"
          className="pm-snapshot-refresh"
          onClick={handleRefresh}
          disabled={snapshotQuery.isFetching}
          data-testid="pm-snapshot-refresh"
          aria-label="刷新快照"
        >
          {snapshotQuery.isFetching ? '刷新中…' : '刷新'}
        </button>
      </header>

      {snapshotQuery.isLoading || !data ? (
        <div className="pm-snapshot-loading" data-testid="pm-snapshot-loading">
          加载中…
        </div>
      ) : (
        <>
          <section
            className="pm-snapshot-section"
            data-testid="pm-snapshot-funnel-section"
            aria-label="全局漏斗"
          >
            <h2 className="pm-snapshot-section-title">数据概览</h2>
            <SnapshotFunnel funnel={data.funnel} />
          </section>

          <section
            className="pm-snapshot-section"
            data-testid="pm-snapshot-activity-section"
            aria-label="近 24 小时活动"
          >
            <h2 className="pm-snapshot-section-title">近 24 小时活动</h2>
            <ActivityFeed events={data.activity} />
          </section>
        </>
      )}

      {isManualRefreshing && (
        <span className="pm-snapshot-sr-only" aria-live="polite">
          正在刷新…
        </span>
      )}
    </div>
  );
}

// ---- Helpers ----

/**
 * "生成于 N 分钟前" formatter — caps at "刚刚" / "X 分钟前" / "X 小时前".
 * The page header uses this so the user can see how stale the snapshot
 * is at a glance.
 */
function formatGeneratedAt(unixMs: number): string {
  const delta = Date.now() - unixMs;
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return '昨天';
}