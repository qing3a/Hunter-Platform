import { apiFetchRaw } from './raw';

export type DeadLetterRow = {
  id: number;
  target_user_id: string;
  event_type: string;
  attempt_count: number;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
};

type Paginated<T> = {
  data: T[];
  pagination: { total: number; page: number; pageSize: number; has_more: boolean };
};

export async function listDeadLetter(opts: {
  page?: number;
  pageSize?: number;
  event_type?: string;
  min_attempt_count?: number;
  from?: string;
  until?: string;
} = {}): Promise<Paginated<DeadLetterRow>> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.event_type) params.set('event_type', opts.event_type);
  if (opts.min_attempt_count !== undefined) params.set('min_attempt_count', String(opts.min_attempt_count));
  if (opts.from) params.set('from', opts.from);
  if (opts.until) params.set('until', opts.until);
  const query = params.toString() ? `?${params}` : '';
  const env = await apiFetchRaw<DeadLetterRow[]>('webhooks/dead-letter' + query);
  if (!env.ok || !env.data || !env.pagination) {
    throw new Error(env.error?.message ?? 'Failed to fetch dead-letter list');
  }
  return { data: env.data, pagination: env.pagination };
}

export async function retryDeadLetter(id: number): Promise<{ id: number; status: string }> {
  const env = await apiFetchRaw<{ id: number; status: string }>(`webhooks/${id}/retry`, { method: 'POST' });
  if (!env.ok || !env.data) {
    throw new Error(env.error?.message ?? 'Failed to retry dead-letter');
  }
  return env.data;
}