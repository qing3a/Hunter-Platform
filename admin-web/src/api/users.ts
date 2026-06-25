import { apiFetchRaw } from './raw';

export type UserRow = {
  id: string;
  user_type: 'candidate' | 'headhunter' | 'employer';
  name: string;
  status: 'active' | 'suspended' | 'deleted';
  quota_per_day: number;
  quota_used: number;
  quota_reset_at: string;
  reputation: number;
  created_at: string;
};

export async function getUser(id: string): Promise<UserRow> {
  const env = await apiFetchRaw<UserRow>('users/' + id);
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to fetch user');
  return env.data;
}

export async function listUsers(opts: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  user_type?: string;
  status?: string;
} = {}): Promise<{ data: UserRow[]; pagination: { total: number; page: number; pageSize: number; has_more: boolean } }> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.keyword) params.set('keyword', opts.keyword);
  if (opts.user_type) params.set('user_type', opts.user_type);
  if (opts.status) params.set('status', opts.status);
  const query = params.toString() ? `?${params}` : '';
  const env = await apiFetchRaw<UserRow[]>('users' + query);
  if (!env.ok || !env.data || !env.pagination) {
    throw new Error(env.error?.message ?? 'Failed to fetch users');
  }
  return { data: env.data, pagination: env.pagination };
}

export type AdjustQuotaResponse = {
  user_id: string;
  previous_quota: number;
  new_quota: number;
  reason: string;
};

export async function adjustQuota(userId: string, new_quota: number, reason: string): Promise<AdjustQuotaResponse> {
  const env = await apiFetchRaw<AdjustQuotaResponse>(`users/${userId}/adjust-quota`, {
    method: 'POST',
    body: JSON.stringify({ new_quota, reason }),
  });
  if (!env.ok || !env.data) {
    throw new Error(env.error?.message ?? 'Failed to adjust quota');
  }
  return env.data;
}
export async function suspendUser(id: string, reason: string): Promise<{ user_id: string; status: string; reason: string }> {
  const env = await apiFetchRaw<{ user_id: string; status: string; reason: string }>(`users/${id}/suspend`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  if (!env.ok || !env.data) {
    throw new Error(env.error?.message ?? 'Failed to suspend user');
  }
  return env.data;
}

export async function unsuspendUser(id: string): Promise<{ user_id: string; status: string }> {
  const env = await apiFetchRaw<{ user_id: string; status: string }>(`users/${id}/unsuspend`, { method: 'POST' });
  if (!env.ok || !env.data) {
    throw new Error(env.error?.message ?? 'Failed to unsuspend user');
  }
  return env.data;
}
