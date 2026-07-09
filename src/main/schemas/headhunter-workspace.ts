// src/main/schemas/headhunter-workspace.ts
//
// Hunter Workspace (Phase 3a, Task 7) — consolidated Zod request/response
// schemas for the 12 endpoints on `/v1/headhunter-workspace/*`.
//
// This file is the single source of truth for the wire shape of every
// hunter-workspace endpoint. The router layer (`routes/headhunter-workspace.ts`)
// imports these and calls `respond()` with them; the handler modules
// (`modules/headhunter/*.ts`) return plain JS objects matching these shapes.
//
// Conventions (mirrored from candidate-portal.ts):
//   - Request bodies use `.strict()` so unknown keys cause a 400 (loud rejection).
//   - Response envelopes are bare `z.object({ ok: z.literal(true), data: ... })`
//     — `respond()` does its own validation; we don't wrap with `EnvelopeSchema()`
//     so the helper can pass a single schema to `safeParse`.
//   - All enums use `z.enum([...])` — strings from clients must match exactly.
//   - `exactOptionalPropertyTypes` is on, so the router has to spread keys whose
//     values are defined (helpers in the router re-shape parsed data to match
//     handler inputs).

import { z } from 'zod';

// ===== Shared primitives =====

/**
 * The 6 valid pipeline stages. The kanban board surfaces the first 5
 * (rejected is terminal and hidden from the board); the dashboard summary
 * shows the first 5 too. 'rejected' is included here because the kanban
 * removeCard() validates transitions against all 6.
 */
export const PipelineStageSchema = z.enum([
  'submitted', 'screen_passed', 'interview', 'offer', 'onboarded', 'rejected',
]);

export const TaskPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);

/** status filter for GET /tasks */
export const TaskStatusFilterSchema = z.enum(['pending', 'completed', 'all']);

/**
 * Hunter task row — mirrors `HunterTaskRow` in db/repositories/hunter-tasks.ts.
 * `created_at` and `updated_at` are unix milliseconds; `due_at` and
 * `completed_at` are nullable.
 */
const HunterTaskRowSchema = z.object({
  id: z.string(),
  hunter_user_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  related_recommendation_id: z.string().nullable(),
  related_candidate_user_id: z.string().nullable(),
  due_at: z.number().nullable(),
  completed_at: z.number().nullable(),
  priority: TaskPrioritySchema,
  created_at: z.number(),
  updated_at: z.number(),
}).strict();

// ===== Tasks =====

/** GET /v1/headhunter-workspace/tasks?status=&limit=&offset= */
export const TaskListQuerySchema = z.object({
  status: TaskStatusFilterSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}).strict();

/** POST /v1/headhunter-workspace/tasks */
export const TaskCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  /** unix ms */
  due_at: z.number().int().nullable().optional(),
  priority: TaskPrioritySchema.optional(),
  related_recommendation_id: z.string().optional(),
  related_candidate_user_id: z.string().optional(),
}).strict();

/** PUT /v1/headhunter-workspace/tasks/:id */
export const TaskUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  /** unix ms */
  due_at: z.number().int().nullable().optional(),
  priority: TaskPrioritySchema.optional(),
}).strict();

export const TaskResponseSchema = z.object({
  ok: z.literal(true),
  data: HunterTaskRowSchema,
}).strict();

export const TaskListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(HunterTaskRowSchema),
}).strict();

export const TaskDeleteResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({ deleted: z.literal(true) }),
}).strict();

// ===== Kanban =====

/**
 * Mirrors `KanbanColumnRow` in db/repositories/hunter-kanban.ts.
 * `created_at` is unix ms (the repo converts from SQLite's INTEGER ms).
 */
const KanbanColumnRowSchema = z.object({
  id: z.number().int(),
  hunter_user_id: z.string(),
  name: z.string(),
  position: z.number().int(),
  pipeline_stage: PipelineStageSchema,
  created_at: z.number(),
}).strict();

/**
 * Mirrors `KanbanCard` in db/repositories/hunter-kanban.ts.
 * `candidate_name` is always null in the current kanban data path
 * (the repo hard-codes NULL for the column) — the dashboard reads
 * the masked name from `users.name` separately.
 */
const KanbanCardSchema = z.object({
  recommendation_id: z.string(),
  candidate_user_id: z.string(),
  candidate_name: z.string().nullable(),
  job_id: z.string(),
  job_title: z.string(),
  match_score: z.number().nullable(),
  pipeline_stage: PipelineStageSchema,
  kanban_position: z.number().nullable(),
  /** unix ms */
  updated_at: z.number(),
}).strict();

const KanbanBoardSchema = z.object({
  columns: z.array(KanbanColumnRowSchema.extend({
    cards: z.array(KanbanCardSchema),
  })),
}).strict();

export const KanbanBoardResponseSchema = z.object({
  ok: z.literal(true),
  data: KanbanBoardSchema,
}).strict();

export const KanbanCardResponseSchema = z.object({
  ok: z.literal(true),
  data: KanbanCardSchema,
}).strict();

/** POST /v1/headhunter-workspace/kanban/move */
export const KanbanMoveSchema = z.object({
  recommendation_id: z.string(),
  to_column_id: z.number().int().positive(),
  /** null/undefined = append (NULL kanban_position) */
  to_position: z.number().int().nullable().optional(),
}).strict();

/** POST /v1/headhunter-workspace/kanban/add */
export const KanbanAddSchema = z.object({
  recommendation_id: z.string(),
  to_column_id: z.number().int().positive(),
}).strict();

/** POST /v1/headhunter-workspace/kanban/remove */
export const KanbanRemoveSchema = z.object({
  recommendation_id: z.string(),
}).strict();

// ===== Stats =====

export const StatsOverviewResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    active_recommendations: z.number().int(),
    placements_count: z.number().int(),
    onboards_this_month: z.number().int(),
    pending_pickup_count: z.number().int(),
    conversion_rate: z.number(),
  }),
}).strict();

export const StatsFunnelResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    funnel: z.array(z.object({
      stage: z.enum(['submitted', 'screen_passed', 'interview', 'offer', 'onboarded']),
      count: z.number().int(),
      conversion_from_prev: z.number(),
    })),
    range: z.object({
      from: z.number().nullable(),
      to: z.number().nullable(),
    }),
  }),
}).strict();

/** GET /v1/headhunter-workspace/stats?from=&to= */
export const StatsFunnelQuerySchema = z.object({
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
}).strict();

/**
 * Combined GET /stats envelope — returns overview + funnel in a single
 * call so the workspace page can render both without two round trips.
 * `range.from` / `range.to` are echoed back as null when missing.
 */
export const StatsCombinedResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    overview: z.object({
      active_recommendations: z.number().int(),
      placements_count: z.number().int(),
      onboards_this_month: z.number().int(),
      pending_pickup_count: z.number().int(),
      conversion_rate: z.number(),
    }),
    funnel: z.array(z.object({
      stage: z.enum(['submitted', 'screen_passed', 'interview', 'offer', 'onboarded']),
      count: z.number().int(),
      conversion_from_prev: z.number(),
    })),
    range: z.object({
      from: z.number().nullable(),
      to: z.number().nullable(),
    }),
  }),
}).strict();

// ===== Dashboard =====

export const DashboardResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    kpi: z.object({
      onboards_this_month: z.number().int(),
      active_recommendations: z.number().int(),
      placements_count: z.number().int(),
      pending_pickup_count: z.number().int(),
      conversion_rate: z.number(),
    }),
    top_tasks: z.array(HunterTaskRowSchema),
    kanban_summary: z.array(z.object({
      stage: z.enum(['submitted', 'screen_passed', 'interview', 'offer', 'onboarded']),
      count: z.number().int(),
    })),
    recent_recommendations: z.array(z.object({
      recommendation_id: z.string(),
      candidate_user_id: z.string(),
      candidate_name: z.string().nullable(),
      job_id: z.string(),
      job_title: z.string(),
      pipeline_stage: PipelineStageSchema,
      /** unix ms */
      updated_at: z.number(),
    })),
  }),
}).strict();