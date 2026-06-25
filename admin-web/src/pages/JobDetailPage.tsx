import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import Skeleton from '../components/Skeleton';
import { getJob, type JobRow } from '../api/jobs';
import { useToast } from '../lib/toast';
import { relativeTime } from '../lib/format';

type DataState<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string };

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [job, setJob] = useState<DataState<JobRow> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setJob({ loading: true });
    try {
      const j = await getJob(id);
      setJob({ loading: false, data: j });
    } catch (e: any) {
      setJob({ loading: false, error: e.message });
      toast.push({ type: 'error', message: e.message });
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  if (job === null) return <Layout adminName="Admin"><p>加载中...</p></Layout>;
  if (job.loading) return <Layout adminName="Admin"><Skeleton variant="row" count={5} /></Layout>;
  if ('error' in job) {
    return (
      <Layout adminName="Admin">
        <div data-testid="job-error-state">
          <p style={{ color: '#a8071a' }}>无法加载: {job.error}</p>
          <Link to="/admin/jobs" className="btn">← 返回职位列表</Link>
        </div>
      </Layout>
    );
  }

  const j = job.data;
  return (
    <Layout adminName="Admin">
      <div data-testid="job-detail">
      <Link to="/admin/jobs">← 返回职位列表</Link>
      <h1 style={{ marginTop: 16 }}>{j.title}</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <StatusBadge status={j.status} />
        <span>雇主: {j.employer_name}</span>
        <span>创建: {relativeTime(j.created_at)}</span>
      </div>
      <Link to={`/admin/jobs/${j.id}/timeline`} className="btn btn-primary" data-testid="job-timeline-link">查看时间轴</Link>
      </div>
    </Layout>
  );
}