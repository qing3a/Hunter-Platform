import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import Skeleton from '../components/Skeleton';
import { getRecommendation, type RecommendationRow } from '../api/recommendations';
import { useToast } from '../lib/toast';
import { relativeTime } from '../lib/format';

type DataState<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string };

export default function RecommendationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [rec, setRec] = useState<DataState<RecommendationRow> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setRec({ loading: true });
    try {
      const r = await getRecommendation(id);
      setRec({ loading: false, data: r });
    } catch (e: any) {
      setRec({ loading: false, error: e.message });
      toast.push({ type: 'error', message: e.message });
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  if (rec === null) return <Layout adminName="Admin"><p>加载中...</p></Layout>;
  if (rec.loading) return <Layout adminName="Admin"><Skeleton variant="row" count={5} /></Layout>;
  if ('error' in rec) {
    return (
      <Layout adminName="Admin">
        <div data-testid="recommendation-error-state">
          <p style={{ color: '#a8071a' }}>无法加载: {rec.error}</p>
          <Link to="/recommendations" className="btn">← 返回推荐列表</Link>
        </div>
      </Layout>
    );
  }

  const r = rec.data;
  return (
    <Layout adminName="Admin">
      <div data-testid="recommendation-detail">
      <Link to="/recommendations">← 返回推荐列表</Link>
      <h1 style={{ marginTop: 16 }}>推荐 {r.id}</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <StatusBadge status={r.status} />
        <span>职位: {r.job_title}</span>
        <span>猎头: {r.headhunter_name}</span>
        <span>候选: <code>{r.anonymized_candidate_id}</code></span>
        <span>创建: {relativeTime(r.created_at)}</span>
      </div>
      <Link to={`/admin/recommendations/${r.id}/timeline`} className="btn btn-primary" data-testid="recommendation-timeline-link">查看时间轴</Link>
      </div>
    </Layout>
  );
}