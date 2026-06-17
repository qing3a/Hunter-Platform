import { useEffect, useState } from 'react';

interface Stats {
  users: { total: number; candidate: number; headhunter: number; employer: number };
  jobs: { total: number; open: number; paused: number; closed: number; filled: number };
  recommendations: { total: number; pending: number; unlocked: number };
  candidates: { in_pool: number };
  webhooks: { pending: number; dead_letter: number };
  activity: { placements_today: number };
  timestamp: string;
}

export default function Dashboard(): JSX.Element {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const res = await window.api.admin.dashboard.getStats();
    if (res.ok) setStats(res.data);
    else setError(res.error?.message ?? 'load failed');
  };

  useEffect(() => { void load(); }, []);

  if (error) return <div className="error">Error: {error}</div>;
  if (!stats) return <div className="card">Loading...</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>仪表盘</h1>
      <div className="stat-grid">
        <div className="stat"><div className="label">总用户</div><div className="value">{stats.users.total}</div><div style={{ fontSize: 11, color: '#64748b' }}>猎头 {stats.users.headhunter} · 雇主 {stats.users.employer} · 候选人 {stats.users.candidate}</div></div>
        <div className="stat"><div className="label">开放职位</div><div className="value">{stats.jobs.open ?? 0}</div></div>
        <div className="stat"><div className="label">解锁中</div><div className="value">{stats.recommendations.unlocked ?? 0}</div></div>
        <div className="stat"><div className="label">公开池候选人</div><div className="value">{stats.candidates.in_pool}</div></div>
        <div className="stat"><div className="label">Webhook 死信</div><div className="value" style={{ color: stats.webhooks.dead_letter > 0 ? '#dc2626' : 'inherit' }}>{stats.webhooks.dead_letter}</div></div>
        <div className="stat"><div className="label">Webhook 队列</div><div className="value">{stats.webhooks.pending}</div></div>
        <div className="stat"><div className="label">今日入职</div><div className="value">{stats.activity.placements_today}</div></div>
      </div>
      <div className="card">
        <h2>详情</h2>
        <pre style={{ fontSize: 12, background: '#f1f5f9', padding: 12, borderRadius: 4, overflow: 'auto' }}>{JSON.stringify(stats, null, 2)}</pre>
        <button onClick={load}>刷新</button>
      </div>
    </div>
  );
}