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
  if (!stats) return <Layout adminName="..."><p>加载中...</p></Layout>;

  return (
    <Layout adminName={me?.name ?? 'Admin'}>
      <h1>仪表盘</h1>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <MetricCard label="用户总数" value={stats.total_users} />
        <MetricCard label="候选人总数" value={stats.total_candidates} />
        <MetricCard label="今日新增用户" value={stats.today_new_users} hint="下方趋势图显示每日对比" />
        <MetricCard label="进行中的合作" value={stats.active_placements} />
      </div>

      <h2 style={{ marginTop: 32 }}>用户增长 — 最近 30 天</h2>
      <div className="card">
        <Sparkline data={stats.trend_30d} width={600} height={80} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#999', marginTop: 8 }}>
          <span>30 天前</span>
          <span>今天</span>
        </div>
      </div>

      <h2 style={{ marginTop: 32 }}>职位状态分布</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <MetricCard label="开放" value={stats.open_jobs} />
        <MetricCard label="暂停" value={stats.jobs_paused} />
        <MetricCard label="已关闭" value={stats.jobs_closed} />
        <MetricCard label="已招到" value={stats.jobs_filled} />
      </div>

      <h2 style={{ marginTop: 32 }}>推荐数据</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <MetricCard label="推荐总数" value={stats.total_recommendations} />
        <MetricCard label="今日新增推荐" value={stats.today_new_recommendations} />
        <MetricCard label="待处理 / 已解锁" value={`${stats.recommendations_pending} / ${stats.recommendations_unlocked}`} />
      </div>

      <h2 style={{ marginTop: 32 }}>更多统计</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <MetricCard label="职位总数" value={stats.total_jobs} />
        <MetricCard label="今日已用配额" value={stats.daily_quota_used} />
        <MetricCard label="Webhook 死信" value={stats.webhook_dead_letters} />
      </div>
    </Layout>
  );
}