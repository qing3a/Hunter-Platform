import { useEffect, useState } from 'react';

interface Bucket {
  id: number;
  user_id: string;
  window_start: string;
  window_seconds: number;
  request_count: number;
  expires_at: string;
}

export default function RateLimitManagement(): JSX.Element {
  const [filter, setFilter] = useState('');
  const [list, setList] = useState<Bucket[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const res = await window.api.admin.rateLimit.listBuckets(filter || undefined);
    if (res.ok) setList(res.data);
    else setError(res.error?.message ?? 'load failed');
  };

  useEffect(() => { void load(); }, [filter]);

  const clear = async (user_id: string) => {
    if (!confirm(`Clear all buckets for ${user_id}?`)) return;
    const res = await window.api.admin.rateLimit.clearForUser(user_id);
    if (res.ok) await load();
    else setError(res.error?.message ?? 'clear failed');
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>限流桶</h1>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <input placeholder="按 user_id 过滤" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button style={{ marginLeft: 8 }} onClick={load}>刷新</button>
        <table>
          <thead><tr><th>User</th><th>窗口</th><th>计数</th><th>过期时间</th><th>操作</th></tr></thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td><code>{b.user_id}</code></td>
                <td>{b.window_seconds}s</td>
                <td>{b.request_count}</td>
                <td>{new Date(b.expires_at).toLocaleString()}</td>
                <td><button className="danger" onClick={() => clear(b.user_id)}>清空</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}