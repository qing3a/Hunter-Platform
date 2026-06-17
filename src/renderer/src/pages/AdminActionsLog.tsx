import { useEffect, useState } from 'react';

interface AdminLogEntry {
  id: number;
  admin_user_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details_json: string | null;
  created_at: string;
}

export default function AdminActionsLog(): JSX.Element {
  const [list, setList] = useState<AdminLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const r = await window.api.admin.adminLog.list({});
    if (r.ok) setList(r.data);
    else setError(r.error?.message);
  };

  useEffect(() => { void load(); }, []);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>管理员操作日志</h1>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <button onClick={load}>刷新</button>
        <p style={{ fontSize: 12, color: '#64748b' }}>记录 admin 执行的 suspend / adjustQuota / markPaid / cancel / remove 等操作</p>
        <table>
          <thead><tr><th>时间</th><th>动作</th><th>目标类型</th><th>目标</th><th>详情</th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td><code>{e.action}</code></td>
                <td>{e.target_type ?? '—'}</td>
                <td><code>{e.target_id?.slice(0, 16) ?? '—'}</code></td>
                <td><code style={{ fontSize: 11 }}>{e.details_json?.slice(0, 60) ?? '—'}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}