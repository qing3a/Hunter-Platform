import { useEffect, useState } from 'react';

interface DeadLetter {
  id: number;
  target_user_id: string;
  event_type: string;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export default function WebhookManagement(): JSX.Element {
  const [list, setList] = useState<DeadLetter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = async () => {
    setError(null); setInfo(null);
    const res = await window.api.admin.webhooks.listDeadLetter(100);
    if (res.ok) setList(res.data);
    else setError(res.error?.message ?? 'load failed');
  };

  useEffect(() => { void load(); }, []);

  const retry = async (id: number) => {
    const res = await window.api.admin.webhooks.retry(id);
    if (res.ok) { setInfo(`Re-queued #${id}`); await load(); }
    else setError(res.error?.message ?? 'retry failed');
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Webhook 死信队列</h1>
      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}
      <div className="card">
        <button onClick={load}>刷新</button>
        <p style={{ fontSize: 12, color: '#64748b' }}>已重试 3 次后仍失败的投递。可手动重投。</p>
        <table>
          <thead><tr><th>ID</th><th>事件</th><th>目标用户</th><th>尝试次数</th><th>最后错误</th><th>最后更新</th><th>操作</th></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td>{d.id}</td>
                <td><code>{d.event_type}</code></td>
                <td><code>{d.target_user_id}</code></td>
                <td>{d.attempt_count}</td>
                <td style={{ color: '#dc2626' }}>{d.last_error ?? '—'}</td>
                <td>{new Date(d.updated_at).toLocaleString()}</td>
                <td><button onClick={() => retry(d.id)}>重投</button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#64748b' }}>无死信 🎉</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}