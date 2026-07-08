import { getAuthHeader, clearSession } from '../lib/candidate-session';

const BASE = '/v1/headhunter-workspace';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  const auth = getAuthHeader();
  if (auth) headers['Authorization'] = auth;

  const res = await fetch(BASE + path, { ...init, headers });
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) clearSession();
    throw new ApiError(
      json.error?.code ?? 'UNKNOWN_ERROR',
      json.error?.message ?? `HTTP ${res.status}`,
      res.status
    );
  }
  return json.data;
}

// ===== Type definitions matching backend Zod schemas =====

export type PipelineStage =
  | 'submitted' | 'screen_passed' | 'interview' | 'offer' | 'onboarded' | 'rejected';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskStatusFilter = 'pending' | 'completed' | 'all';

export interface HunterTask {
  id: string;
  hunter_user_id: string;
  title: string;
  description: string | null;
  related_recommendation_id: string | null;
  related_candidate_user_id: string | null;
  due_at: number | null;
  completed_at: number | null;
  priority: TaskPriority;
  created_at: number;
  updated_at: number;
}

export interface KanbanColumn {
  id: number;
  hunter_user_id: string;
  name: string;
  position: number;
  pipeline_stage: PipelineStage;
  created_at: number;
  cards: KanbanCard[];
}

export interface KanbanCard {
  recommendation_id: string;
  candidate_user_id: string;
  candidate_name: string | null;
  job_id: string;
  job_title: string;
  match_score: number | null;
  pipeline_stage: PipelineStage;
  kanban_position: number | null;
  updated_at: number;
}

export interface DashboardKpi {
  onboards_this_month: number;
  active_recommendations: number;
  placements_count: number;
  pending_pickup_count: number;
  conversion_rate: number;
}

export interface DashboardPayload {
  kpi: DashboardKpi;
  top_tasks: HunterTask[];
  kanban_summary: Array<{ stage: PipelineStage; count: number }>;
  recent_recommendations: Array<{
    recommendation_id: string;
    candidate_user_id: string;
    candidate_name: string | null;
    job_id: string;
    job_title: string;
    pipeline_stage: PipelineStage;
    updated_at: number;
  }>;
}

export interface StatsOverview {
  active_recommendations: number;
  placements_count: number;
  onboards_this_month: number;
  pending_pickup_count: number;
  conversion_rate: number;
}

export interface FunnelStageCount {
  stage: 'submitted' | 'screen_passed' | 'interview' | 'offer' | 'onboarded';
  count: number;
  conversion_from_prev: number;
}

export interface StatsPayload {
  overview: StatsOverview;
  funnel: FunnelStageCount[];
  range: { from: number | null; to: number | null };
}

// ===== API surfaces =====

export const dashboard = {
  get: () => request<DashboardPayload>('/dashboard'),
};

export const tasks = {
  list: (opts: { status?: TaskStatusFilter; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(opts).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<HunterTask[]>(`/tasks?${q}`);
  },
  create: (input: {
    title: string;
    description?: string;
    due_at?: number | null;
    priority?: TaskPriority;
    related_recommendation_id?: string;
    related_candidate_user_id?: string;
  }) => request<HunterTask>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, patch: Partial<{
    title: string;
    description: string | null;
    due_at: number | null;
    priority: TaskPriority;
  }>) => request<HunterTask>(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  delete: (id: string) => request<{ deleted: true }>(`/tasks/${id}`, { method: 'DELETE' }),
  complete: (id: string) => request<HunterTask>(`/tasks/${id}/complete`, { method: 'POST' }),
  reopen: (id: string) => request<HunterTask>(`/tasks/${id}/reopen`, { method: 'POST' }),
};

export const kanban = {
  get: () => request<{ columns: KanbanColumn[] }>('/kanban'),
  move: (input: { recommendation_id: string; to_column_id: number; to_position?: number | null }) =>
    request<KanbanCard>('/kanban/move', { method: 'POST', body: JSON.stringify(input) }),
  add: (input: { recommendation_id: string; to_column_id: number }) =>
    request<KanbanCard>('/kanban/add', { method: 'POST', body: JSON.stringify(input) }),
  remove: (recommendation_id: string) =>
    request<KanbanCard>('/kanban/remove', { method: 'POST', body: JSON.stringify({ recommendation_id }) }),
};

export const stats = {
  get: (opts: { from?: number; to?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(opts).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<StatsPayload>(`/stats?${q}`);
  },
};

// =========================================================================
// Pickup queue (Candidate Portal Phase 1 — Task 13)
//
// These endpoints live under the legacy `/v1/headhunter/*` router (not
// `/v1/headhunter-workspace/*`), so they go through a dedicated request
// helper with its own base path. Auth is the same candidate-session bearer
// token as the workspace endpoints.
// =========================================================================

const PICKUP_BASE = '/v1/headhunter';

async function pickupRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  const auth = getAuthHeader();
  if (auth) headers['Authorization'] = auth;

  const res = await fetch(PICKUP_BASE + path, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) clearSession();
    throw new ApiError(
      json.error?.code ?? 'UNKNOWN_ERROR',
      json.error?.message ?? `HTTP ${res.status}`,
      res.status,
    );
  }
  return json.data;
}

export interface PendingPickupItem {
  id: number;
  recommendation_id: string;
  candidate_user_id: string;
  job_id: string;
  pickup_headhunter_id: string | null;
  candidate_note: string | null;
  withdrawn_at: number | null;
  created_at: number;
  job_title: string | null;
  candidate_display_name: string | null;
  recommendation_status: string;
}

export interface PendingPickupPayload {
  items: PendingPickupItem[];
  next_cursor: null;
}

export interface PickupResult {
  recommendation_id: string;
  status: 'pending';
}

export const pickup = {
  /** List self-applied recommendations awaiting pickup (open queue). */
  listPending: (opts: { limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(opts).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return pickupRequest<PendingPickupPayload>(`/recommendations/pending-pickup?${q}`);
  },
  /** Claim a pending_pickup recommendation (atomic state transition). */
  claim: (recommendationId: string) =>
    pickupRequest<PickupResult>(`/recommendations/${recommendationId}/pickup`, { method: 'POST' }),
};
