import { useEffect, useState } from 'react';

interface AdminUser {
  id: string;
  user_type: string;
  name: string;
  contact: string | null;
  status: string;
  quota_per_day: number;
  quota_used: number;
  reputation: number;
  created_at: string;
}

export default function UserManagement(): JSX.Element {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [filter, setFilter] = useState<{ user_type?: string; status?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const updateFilter = (patch: Record<string, string | undefined>) => {
    setFilter((prev) => {
      const next: { user_type?: string; status?: string } = { ...prev };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete (next as any)[k];
        else (next as any)[k] = v;
      }
      return next;
    });
  };

  const load = async () => {
    setError(null); setInfo(null);
    const res = await window.api.admin.users.list(filter);
    if (res.ok) setUsers(res.data);
    else setError(res.error?.message ?? 'load failed');
  };

  useEffect(() => { void load(); }, [filter.user_type, filter.status]);

  const suspend = async (id: string) => {
    const reason = prompt('Suspend reason:') ?? '';
    if (!reason) return;
    const res = await window.api.admin.users.suspend(id, reason);
    if (res.ok) { setInfo(`Suspended ${id}`); await load(); }
    else setError(res.error?.message ?? 'suspend failed');
  };

  const unsuspend = async (id: string) => {
    const res = await window.api.admin.users.unsuspend(id);
    if (res.ok) { setInfo(`Unsuspended ${id}`); await load(); }
    else setError(res.error?.message ?? 'unsuspend failed');
  };

  const adjustQuota = async (id: string, current: number) => {
    const input = prompt(`New quota_per_day (current: ${current}):`);
    const n = input ? Number(input) : NaN;
    if (!Number.isFinite(n)) return;
    const res = await window.api.admin.users.adjustQuota(id, n);
    if (res.ok) { setInfo(`Quota updated to ${n}`); await load(); }
    else setError(res.error?.message ?? 'adjust failed');
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>用户管理</h1>
      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}
      <div className="card">
        <label>类型: <select value={filter.user_type ?? ''} onChange={(e) => updateFilter({ user_type: e.target.value || undefined })}>
          <option value="">全部</option>
          <option value="candidate">候选人</option>
          <option value="headhunter">猎头</option>
          <option value="employer">雇主</option>
        </select></label>
        <label style={{ marginLeft: 16 }}>状态: <select value={filter.status ?? ''} onChange={(e) => updateFilter({ status: e.target.value || undefined })}>
          <option value="">全部</option>
          <option value="active">active</option>
          <option value="suspended">suspended</option>
        </select></label>
        <button style={{ marginLeft: 16 }} onClick={load}>刷新</button>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>ID</th><th>类型</th><th>名称</th><th>状态</th><th>配额(已用/总额)</th><th>信誉</th><th>操作</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><code>{u.id}</code></td>
                <td>{u.user_type}</td>
                <td>{u.name}</td>
                <td>{u.status}</td>
                <td>{u.quota_used} / {u.quota_per_day}</td>
                <td>{u.reputation}</td>
                <td>
                  {u.status === 'active' ? (
                    <button className="danger" onClick={() => suspend(u.id)}>暂停</button>
                  ) : (
                    <button onClick={() => unsuspend(u.id)}>恢复</button>
                  )}
                  <button style={{ marginLeft: 4 }} onClick={() => adjustQuota(u.id, u.quota_per_day)}>改配额</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}