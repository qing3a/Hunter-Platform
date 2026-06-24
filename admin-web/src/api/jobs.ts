import { apiFetchRaw } from './raw';

export type JobStatus = 'open' | 'claimed' | 'paused' | 'closed' | 'filled';

export type JobRow = {
  id: string;
  employer_id: string;
  employer_name: string;
  title: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
};

type Paginated<T> = {
  data: T[];
  pagination: { total: number; page: number; pageSize: number; has_more: boolean };
};

export async function listJobs(opts: {
  page?: number;
  pageSize?: number;
  status?: JobStatus | '';
  keyword?: string;
} = {}): Promise<Paginated<JobRow>> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.status) params.set('status', opts.status);
  if (opts.keyword) params.set('keyword', opts.keyword);
  const query = params.toString() ? `?${params}` : '';
  const env = await apiFetchRaw<JobRow[]>('jobs' + query);
  if (!env.ok || !env.data || !env.pagination) {
    throw new Error(env.error?.message ?? 'Failed to fetch jobs');
  }
  return { data: env.data, pagination: env.pagination };
}