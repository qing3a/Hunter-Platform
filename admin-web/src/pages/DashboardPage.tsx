import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import MetricCard from '../components/MetricCard';
import Sparkline from '../components/Sparkline';
import { getDashboardStats, type DashboardStats } from '../api/dashboard';
import { apiFetch } from '../api/client';

type Me = { id: string; name: string; email: string; role: string; status: string; last_login_at: string | null; created_at: string };

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Me>('me').then(setMe).catch(() => {});
    getDashboardStats().then(setStats).catch(err => setError(err.message));
  }, []);

  if (error) return <Layout adminName="..."><div className="error">{error}</div></Layout>;
  if (!stats) return <Layout adminName="..."><p>Loading...</p></Layout>;

  return (
    <Layout adminName={me?.name ?? 'Admin'}>
      <h1>Dashboard</h1>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <MetricCard label="Total Users" value={stats.total_users} />
        <MetricCard label="Total Candidates" value={stats.total_candidates} />
        <MetricCard label="Today New Users" value={stats.today_new_users} hint="vs prior days in trend below" />
        <MetricCard label="Open Placements" value={stats.active_placements} />
      </div>

      <h2 style={{ marginTop: 32 }}>User Growth — Last 30 Days</h2>
      <div className="card">
        <Sparkline data={stats.trend_30d} width={600} height={80} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#999', marginTop: 8 }}>
          <span>30 days ago</span>
          <span>today</span>
        </div>
      </div>

      <h2 style={{ marginTop: 32 }}>More Stats</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <MetricCard label="Total Jobs" value={stats.total_jobs} />
        <MetricCard label="Open Jobs" value={stats.open_jobs} />
        <MetricCard label="Daily Quota Used" value={stats.daily_quota_used} />
        <MetricCard label="Webhook Dead Letters" value={stats.webhook_dead_letters} />
      </div>
    </Layout>
  );
}