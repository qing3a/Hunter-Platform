import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import Skeleton from '../components/Skeleton';
import { getCandidate, type CandidateRow } from '../api/candidates';
import { useToast } from '@hunter-platform/shared-web/lib';
import { relativeTime } from '@hunter-platform/shared-web/lib';

type DataState<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string };

export default function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [candidate, setCandidate] = useState<DataState<CandidateRow> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setCandidate({ loading: true });
    try {
      const c = await getCandidate(id);
      setCandidate({ loading: false, data: c });
    } catch (e: any) {
      setCandidate({ loading: false, error: e.message });
      toast.push({ type: 'error', message: e.message });
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  if (candidate === null) return <Layout adminName="Admin"><p>加载中...</p></Layout>;
  if (candidate.loading) return <Layout adminName="Admin"><Skeleton variant="row" count={5} /></Layout>;
  if ('error' in candidate) {
    return (
      <Layout adminName="Admin">
        <div data-testid="candidate-error-state">
          <p style={{ color: '#a8071a' }}>无法加载: {candidate.error}</p>
          <Link to="/candidates" className="btn">← 返回候选人列表</Link>
        </div>
      </Layout>
    );
  }

  const c = candidate.data;
  return (
    <Layout adminName="Admin">
      <Link to="/candidates">← 返回候选人列表</Link>
      <h1 style={{ marginTop: 16 }}>{c.masked_name}</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <StatusBadge status={c.unlock_status} />
        <span>邮箱: {c.masked_email}</span>
        <span>猎头: {c.headhunter_id}</span>
        {c.industry && <span>行业: {c.industry}</span>}
        {c.title_level && <span>职级: {c.title_level}</span>}
        <span>公开池: {c.is_public_pool ? '是' : '否'}</span>
        <span>创建: {relativeTime(c.created_at)}</span>
      </div>
    </Layout>
  );
}