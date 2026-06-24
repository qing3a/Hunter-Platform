import { apiFetchRaw } from './raw';

export type DashboardStats = {
  total_users: number;
  total_candidates: number;
  total_jobs: number;
  open_jobs: number;
  active_placements: number;
  daily_quota_used: number;
  webhook_dead_letters: number;
  today_new_users: number;
  trend_30d: number[];
  // Sub-C additions
  total_recommendations: number;
  today_new_recommendations: number;
  recommendations_pending: number;
  recommendations_unlocked: number;
  jobs_paused: number;
  jobs_closed: number;
  jobs_filled: number;
};

export async function getDashboardStats(): Promise<DashboardStats> {
  const env = await apiFetchRaw<DashboardStats>('dashboard/stats');
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to fetch dashboard stats');
  return env.data;
}