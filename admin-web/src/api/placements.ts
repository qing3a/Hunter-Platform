import { apiFetchRaw } from './raw';

export type PlacementStatus = 'pending_payment' | 'paid' | 'cancelled';

export type PlacementRow = {
  id: string;
  job_id: string;
  employer_id: string;
  anonymized_candidate_id: string;
  primary_headhunter_id: string | null;
  referrer_headhunter_id: string | null;
  annual_salary: number;
  platform_fee: number;
  primary_share: number;
  referrer_share: number;
  status: PlacementStatus;
  created_at: string;
  updated_at: string;
};

type Paginated<T> = {
  data: T[];
  pagination: { total: number; page: number; pageSize: number; has_more: boolean };
};

export async function listPlacements(opts: {
  page?: number;
  pageSize?: number;
  status?: PlacementStatus | '';
  from?: string;
  until?: string;
} = {}): Promise<Paginated<PlacementRow>> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.status) params.set('status', opts.status);
  if (opts.from) params.set('from', opts.from);
  if (opts.until) params.set('until', opts.until);
  const query = params.toString() ? `?${params}` : '';
  const env = await apiFetchRaw<PlacementRow[]>('placements' + query);
  if (!env.ok || !env.data || !env.pagination) {
    throw new Error(env.error?.message ?? 'Failed to fetch placements');
  }
  return { data: env.data, pagination: env.pagination };
}

export async function markPaid(id: string): Promise<{ id: string; status: 'paid' }> {
  const env = await apiFetchRaw<{ id: string; status: 'paid' }>(`placements/${id}/mark-paid`, { method: 'POST' });
  if (!env.ok || !env.data) {
    throw new Error(env.error?.message ?? 'Failed to mark paid');
  }
  return env.data;
}

export async function cancelPlacement(id: string): Promise<{ id: string; status: 'cancelled' }> {
  const env = await apiFetchRaw<{ id: string; status: 'cancelled' }>(`placements/${id}/cancel`, { method: 'POST' });
  if (!env.ok || !env.data) {
    throw new Error(env.error?.message ?? 'Failed to cancel placement');
  }
  return env.data;
}