import { useEffect, useState } from 'react';

interface AuditEntry {
  id: number;
  recommendation_id: string;
  actor_user_id: string;
  action: string;
  ip_address: string | null;
  created_at: string;
}

export default function AuditLog(): JSX.Element {
  const [list, setList] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const res = await window.api.admin.audit.list({ limit: 200 });
    if (res.ok) setList(res.data);
    else setError(res.error?.message ?? 'load failed');
  };

  useEffect(() => { void load(); }, []);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>审计日志（解锁相关）</h1>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <button onClick={load}>刷新</button>
        <p style={{ fontSize: 12, color: '#64748b' }}>记录 express_interest / approve_unlock / unlock_delivery 等 PII 访问</p>
        <table>
          <thead><tr><th>时间</th><th>动作</th><th>Recommendation</th><th>操作者</th><th>IP</th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td><code>{e.action}</code></td>
                <td><code>{e.recommendation_id.slice(0, 12)}…</code></td>
                <td><code>{e.actor_user_id.slice(0, 12)}…</code></td>
                <td>{e.ip_address ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}