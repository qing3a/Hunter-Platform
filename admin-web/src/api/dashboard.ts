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
};

export async function getDashboardStats(): Promise<DashboardStats> {
  const env = await apiFetchRaw<DashboardStats>('dashboard/stats');
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to fetch dashboard stats');
  return env.data;
}