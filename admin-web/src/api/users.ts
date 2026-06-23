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