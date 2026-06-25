import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import Skeleton from '../components/Skeleton';
import { getUser, type UserRow } from '../api/users';
import { useToast } from '../lib/toast';
import { relativeTime } from '../lib/format';

type DataState<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string };

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [user, setUser] = useState<DataState<UserRow> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setUser({ loading: true });
    try {
      const u = await getUser(id);
      setUser({ loading: false, data: u });
    } catch (e: any) {
      setUser({ loading: false, error: e.message });
      toast.push({ type: 'error', message: e.message });
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  if (user === null) return <Layout adminName="Admin"><p>加载中...</p></Layout>;
  if (user.loading) return <Layout adminName="Admin"><Skeleton variant="row" count={5} /></Layout>;
  if ('error' in user) {
    return (
      <Layout adminName="Admin">
        <div data-testid="user-error-state">
          <p style={{ color: '#a8071a' }}>无法加载: {user.error}</p>
          <Link to="/admin/users" className="btn">← 返回用户列表</Link>
        </div>
      </Layout>
    );
  }

  const u = user.data;
  return (
    <Layout adminName="Admin">
      <Link to="/admin/users">← 返回用户列表</Link>
      <h1 style={{ marginTop: 16 }}>{u.name}</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <StatusBadge status={u.status} />
        <span>类型: {u.user_type}</span>
        <span>配额: {u.quota_used}/{u.quota_per_day}</span>
        <span>创建: {relativeTime(u.created_at)}</span>
      </div>
      <Link to={`/admin/users/${u.id}/timeline`} className="btn btn-primary" data-testid="user-timeline-link">查看时间轴</Link>
    </Layout>
  );
}