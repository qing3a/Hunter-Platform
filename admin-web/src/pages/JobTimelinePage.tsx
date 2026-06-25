import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import TimelineFilterBar from '../components/TimelineFilterBar';
import TimelineList from '../components/TimelineList';
import Pagination from '../components/Pagination';
import Skeleton from '../components/Skeleton';
import { getTimeline, type TimelineItem } from '../api/timeline';

export default function JobTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const [source, setSource] = useState<'all' | 'admin' | 'user' | 'unlock'>('all');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<TimelineItem[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);

  const load = useCallback((p: number, src: string, f: string, u: string, a: string) => {
    if (!id) return;
    setLoading(true);
    getTimeline('job', id, {
      page: p, pageSize: 20,
      source: src as any,
      from: f || undefined, until: u || undefined, actor: a || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .catch(err => console.error('Timeline load failed:', err))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(page, source, from, until, actor); }, [load, page, source, from, until, actor]);

  return (
    <Layout adminName="Admin">
      <h1>职位时间轴 — {id}</h1>
      <TimelineFilterBar
        source={source} onSourceChange={setSource}
        from={from} onFromChange={setFrom}
        until={until} onUntilChange={setUntil}
        actor={actor} onActorChange={setActor}
        onClear={() => { setSource('all'); setFrom(''); setUntil(''); setActor(''); setPage(1); }}
      />
      {loading ? <Skeleton variant="row" count={5} /> : <TimelineList items={rows} loading={false} empty="暂无事件" />}
      <Pagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} onPageChange={setPage} />
    </Layout>
  );
}