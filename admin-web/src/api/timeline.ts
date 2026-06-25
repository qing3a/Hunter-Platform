import { apiFetchRaw } from './raw';

export type TimelineType = 'user' | 'candidate' | 'job' | 'recommendation';
export type TimelineSource = 'admin' | 'user' | 'unlock';

export type TimelineItem = {
  id: number;
  source: TimelineSource;
  action: string;
  actor: string | null;
  details: string | null;
  created_at: string;
};

type Paginated<T> = {
  data: T[];
  pagination: { total: number; page: number; pageSize: number; has_more: boolean };
};

export async function getTimeline(
  type: TimelineType,
  id: string,
  opts: {
    page?: number;
    pageSize?: number;
    source?: TimelineSource | 'all';
    from?: string;
    until?: string;
    actor?: string;
  } = {},
): Promise<Paginated<TimelineItem>> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.source && opts.source !== 'all') params.set('source', opts.source);
  if (opts.from) params.set('from', opts.from);
  if (opts.until) params.set('until', opts.until);
  if (opts.actor) params.set('actor', opts.actor);
  const query = params.toString() ? `?${params}` : '';
  const env = await apiFetchRaw<TimelineItem[]>(`timeline/${type}/${id}${query}`);
  if (!env.ok || !env.data || !env.pagination) {
    throw new Error(env.error?.message ?? 'Failed to fetch timeline');
  }
  return { data: env.data, pagination: env.pagination };
}