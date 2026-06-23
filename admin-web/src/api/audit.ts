import { apiFetchRaw } from './raw';

export type AdminLogRow = {
  id: number;
  actor: string;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  created_at: string;
};

export type ActionHistoryRow = {
  id: number;
  user_id: string;
  capability_name: string;
  target_type: string | null;
  target_id: string | null;
  request_summary_json: string | null;
  response_summary_json: string | null;
  status: 'success' | 'error';
  error_code: string | null;
  duration_ms: number | null;
  trace_id: string | null;
  created_at: string;
};

export type LoginEventRow = {
  id: number;
  admin_user_id: string | null;
  email: string;
  success: 0 | 1;
  failure_reason: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

type Paginated<T> = {
  data: T[];
  pagination: { total: number; page: number; pageSize: number; has_more: boolean };
};

function buildQuery(opts: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const q = params.toString();
  return q ? `?${q}` : '';
}

export async function listAdminLog(opts: { page?: number; pageSize?: number; actor?: string; action_type?: string; target_type?: string } = {}): Promise<Paginated<AdminLogRow>> {
  const env = await apiFetchRaw<AdminLogRow[]>('admin-log' + buildQuery(opts as any));
  if (!env.ok || !env.data || !env.pagination) throw new Error('Invalid admin-log response');
  return { data: env.data, pagination: env.pagination };
}

export async function listActionHistory(opts: { page?: number; pageSize?: number; user_id?: string; capability_name?: string; status?: 'success' | 'error' } = {}): Promise<Paginated<ActionHistoryRow>> {
  const env = await apiFetchRaw<ActionHistoryRow[]>('action-history' + buildQuery(opts as any));
  if (!env.ok || !env.data || !env.pagination) throw new Error('Invalid action-history response');
  return { data: env.data, pagination: env.pagination };
}

export async function listLoginEvents(opts: { page?: number; pageSize?: number; admin_id?: string; success?: 0 | 1; email?: string; from?: string; until?: string } = {}): Promise<Paginated<LoginEventRow>> {
  const env = await apiFetchRaw<LoginEventRow[]>('login-events' + buildQuery(opts as any));
  if (!env.ok || !env.data || !env.pagination) throw new Error('Invalid login-events response');
  return { data: env.data, pagination: env.pagination };
}