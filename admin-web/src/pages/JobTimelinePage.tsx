import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import TimelineFilterBar from '../components/TimelineFilterBar';
import TimelineList from '../components/TimelineList';
import Pagination from '../components/Pagination';
import Skeleton from '../components/Skeleton';
import { getTimeline, type TimelineItem } from '../api/timeline';
import { useTimelineFilters } from '../hooks/useTimelineFilters';

export default function JobTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const filters = useTimelineFilters();
  const [rows, setRows] = useState<TimelineItem[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);

  const load = useCallback((p: number) => {
    if (!id) return;
    setLoading(true);
    getTimeline('job', id, {
      page: p, pageSize: 20,
      source: filters.source as any,  // 'all' means no filter; api wrapper skips it
      from: filters.from || undefined,
      until: filters.until || undefined,
      actor: filters.actor || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .catch(err => console.error('Timeline load failed:', err))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, filters.source, filters.from, filters.until, filters.actor]);

  useEffect(() => { load(filters.page); }, [load, filters.page]);

  return (
    <Layout adminName="Admin">
      <h1>职位时间轴 — {id}</h1>
      <TimelineFilterBar
        source={filters.source}
        onSourceChange={filters.setSource}
        from={filters.from}
        onFromChange={filters.setFrom}
        until={filters.until}
        onUntilChange={filters.setUntil}
        actor={filters.actor}
        onActorChange={filters.setActor}
        onClear={filters.resetAll}
      />
      {loading ? <Skeleton variant="row" count={5} /> : <TimelineList items={rows} loading={false} empty="暂无事件" />}
      <Pagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} onPageChange={filters.setPage} />
    </Layout>
  );
}