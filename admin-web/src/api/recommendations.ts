import { apiFetchRaw } from './raw';

export type RecommendationStatus =
  | 'pending' | 'employer_interested' | 'candidate_approved' | 'unlocked'
  | 'rejected_employer' | 'rejected_candidate' | 'withdrawn' | 'placed';

export type RecommendationRow = {
  id: string;
  job_id: string;
  job_title: string;
  anonymized_candidate_id: string;
  headhunter_id: string;
  headhunter_name: string;
  status: RecommendationStatus;
  created_at: string;
  updated_at: string;
};

type Paginated<T> = {
  data: T[];
  pagination: { total: number; page: number; pageSize: number; has_more: boolean };
};

export async function getRecommendation(id: string): Promise<RecommendationRow> {
  const env = await apiFetchRaw<RecommendationRow>('recommendations/' + id);
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to fetch recommendation');
  return env.data;
}

export async function listRecommendations(opts: {
  page?: number;
  pageSize?: number;
  status?: RecommendationStatus | '';
  keyword?: string;
  from?: string;
  until?: string;
} = {}): Promise<Paginated<RecommendationRow>> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.status) params.set('status', opts.status);
  if (opts.keyword) params.set('keyword', opts.keyword);
  if (opts.from) params.set('from', opts.from);
  if (opts.until) params.set('until', opts.until);
  const query = params.toString() ? `?${params}` : '';
  const env = await apiFetchRaw<RecommendationRow[]>('recommendations' + query);
  if (!env.ok || !env.data || !env.pagination) {
    throw new Error(env.error?.message ?? 'Failed to fetch recommendations');
  }
  return { data: env.data, pagination: env.pagination };
}