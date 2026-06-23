import { apiFetchRaw } from './raw';

export type CandidateRow = {
  anonymized_id: string;
  candidate_user_id: string;
  masked_name: string;
  masked_email: string;
  headhunter_id: string;
  industry: string | null;
  title_level: string | null;
  is_public_pool: 0 | 1;
  unlock_status: string;
  created_at: string;
};

export async function listCandidates(opts: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  in_pool?: boolean;
  unlock_status?: string;
} = {}): Promise<{ data: CandidateRow[]; pagination: { total: number; page: number; pageSize: number; has_more: boolean } }> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.keyword) params.set('keyword', opts.keyword);
  if (opts.in_pool !== undefined) params.set('in_pool', String(opts.in_pool));
  if (opts.unlock_status) params.set('unlock_status', opts.unlock_status);
  const query = params.toString() ? `?${params}` : '';
  const env = await apiFetchRaw<CandidateRow[]>('candidates' + query);
  if (!env.ok || !env.data || !env.pagination) {
    throw new Error(env.error?.message ?? 'Failed to fetch candidates');
  }
  return { data: env.data, pagination: env.pagination };
}