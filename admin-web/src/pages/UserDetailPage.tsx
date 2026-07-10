import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import Skeleton from '../components/Skeleton';
import ConfirmModal from '../components/ConfirmModal';
import { getUser, suspendUser, unsuspendUser, type UserRow } from '../api/users';
import { useToast } from '@hunter-platform/shared-web/lib';
import { relativeTime } from '@hunter-platform/shared-web/lib';

type DataState<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string };
type ConfirmState =
  | { open: false }
  | { open: true; type: 'suspend' | 'unsuspend' };

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [user, setUser] = useState<DataState<UserRow> | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false });

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

  const handleConfirm = async (reason?: string) => {
    if (!confirm.open) return;
    if (!user || user.loading || 'error' in user) return;
    const u = user.data;
    try {
      if (confirm.type === 'suspend') {
        await suspendUser(u.id, reason!);
        toast.push({ type: 'success', message: `已暂停 ${u.name}` });
      } else {
        await unsuspendUser(u.id);
        toast.push({ type: 'success', message: `已恢复 ${u.name}` });
      }
      setConfirm({ open: false });
      load();
    } catch (e) {
      throw e;
    }
  };

  if (user === null) return <Layout adminName="Admin"><p>加载中...</p></Layout>;
  if (user.loading) return <Layout adminName="Admin"><Skeleton variant="row" count={5} /></Layout>;
  if ('error' in user) {
    return (
      <Layout adminName="Admin">
        <div data-testid="user-error-state">
          <p style={{ color: '#a8071a' }}>无法加载: {user.error}</p>
          <Link to="/users" className="btn">← 返回用户列表</Link>
        </div>
      </Layout>
    );
  }

  const u = user.data;
  const isActive = u.status === 'active';
  const isSuspended = u.status === 'suspended';
  return (
    <Layout adminName="Admin">
      <div data-testid="user-detail">
      <Link to="/users">← 返回用户列表</Link>
      <h1 style={{ marginTop: 16 }}>{u.name}</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <StatusBadge status={u.status} />
        <span>类型: {u.user_type}</span>
        <span>配额: {u.quota_used}/{u.quota_per_day}</span>
        <span>创建: {relativeTime(u.created_at)}</span>
      </div>
      {(isActive || isSuspended) && (
        <button
          onClick={() => setConfirm({ open: true, type: isActive ? 'suspend' : 'unsuspend' })}
          className={isActive ? 'btn btn-danger' : 'btn btn-primary'}
          data-testid="user-suspend-toggle"
          style={{ marginBottom: 24 }}
        >
          {isActive ? '暂停账号' : '恢复账号'}
        </button>
      )}
      <ConfirmModal
        open={confirm.open}
        title={confirm.open ? (confirm.type === 'suspend' ? '暂停账号' : '恢复账号') : ''}
        message={confirm.open ? (confirm.type === 'suspend' ? '确认暂停此账号？此操作可恢复。' : '确认恢复此账号？') : ''}
        confirmText={confirm.open ? (confirm.type === 'suspend' ? '确认暂停' : '确认恢复') : '确认'}
        variant={confirm.open && confirm.type === 'suspend' ? 'danger' : 'primary'}
        requireReason={confirm.open && confirm.type === 'suspend'}
        onConfirm={handleConfirm}
        onClose={() => setConfirm({ open: false })}
      />
      </div>
    </Layout>
  );
}
