// src/main/routes/headhunter-workspace.ts
//
// Hunter Workspace (Phase 3a, Task 7) — HTTP router that wires the four
// workspace handler modules (tasks, kanban, stats, dashboard) onto
// real Express endpoints.
//
// Mounted by server.ts at `/v1/headhunter-workspace`:
//   - All endpoints require a hunter session (`router.use(authMiddleware(db))`)
//   - Non-headhunter callers receive 403 FORBIDDEN from the underlying handler
//     modules' `assertHeadhunter(user)` checks
//
// Auth boundary is enforced at the router level (auth middleware attaches
// `req.user`); the handler modules themselves re-check `user_type` so the
// underlying functions stay safe to call from other contexts (admin
// overrides, background workers, etc.).
//
// Pattern mirrors candidate-portal router: per-router express.json +
// utf8-only body parsers are attached by the mounting caller (server.ts
// and tests/helpers/test-app.ts). The router itself only registers
// route handlers and a 404 fallback.
//
// Parsed body re-shaping: `exactOptionalPropertyTypes` is on, so the
// handler inputs (which declare `field?: T` not `field?: T | undefined`)
// can't accept `{ field: undefined }`. After Zod `.optional()` parsing,
// `parsed.data.field` is either `T` or `undefined`. We re-shape by
// only spreading keys whose values are not undefined (same pattern as
// candidate-portal router).

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DB } from '../db/connection.js';
import { authMiddleware } from '../modules/auth/middleware.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import type { User } from '../../shared/types.js';
import { createHunterTasks } from '../modules/headhunter/tasks.js';
import { createHunterKanban } from '../modules/headhunter/kanban.js';
import { createHunterStats } from '../modules/headhunter/stats.js';
import { createHunterDashboard } from '../modules/headhunter/dashboard.js';
import {
  TaskListQuerySchema, TaskCreateSchema, TaskUpdateSchema,
  TaskResponseSchema, TaskListResponseSchema, TaskDeleteResponseSchema,
  KanbanBoardResponseSchema, KanbanCardResponseSchema,
  KanbanMoveSchema, KanbanAddSchema, KanbanRemoveSchema,
  StatsCombinedResponseSchema, StatsFunnelQuerySchema,
  DashboardResponseSchema,
} from '../schemas/headhunter-workspace.js';

export function createHeadhunterWorkspaceRouter(db: DB): Router {
  const router = Router();
  router.use(authMiddleware(db));

  const tasks = createHunterTasks(db);
  const kanban = createHunterKanban(db);
  const stats = createHunterStats(db);
  const dashboard = createHunterDashboard(db);

  // ===== Dashboard =====

  // GET /v1/headhunter-workspace/dashboard
  router.get('/dashboard', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const result = dashboard.getDashboard(user);
      respond(res, DashboardResponseSchema, { ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // ===== Tasks =====

  // GET /v1/headhunter-workspace/tasks?status=&limit=&offset=
  router.get('/tasks', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = TaskListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid query', { issues: parsed.error.issues });
      }
      // Re-shape to satisfy exactOptionalPropertyTypes on HunterTaskListFilter.
      const filter: { status?: 'pending' | 'completed' | 'all'; limit?: number; offset?: number } = {};
      if (parsed.data.status !== undefined) filter.status = parsed.data.status;
      if (parsed.data.limit !== undefined) filter.limit = parsed.data.limit;
      if (parsed.data.offset !== undefined) filter.offset = parsed.data.offset;
      const items = tasks.list(user, filter);
      respond(res, TaskListResponseSchema, { ok: true, data: items });
    } catch (e) {
      next(e);
    }
  });

  // POST /v1/headhunter-workspace/tasks
  router.post('/tasks', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = TaskCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      // Re-shape to satisfy exactOptionalPropertyTypes on HunterTaskInsert.
      // hunter_user_id is required by the interface (handler overrides with
      // the caller's id anyway) — include it so TS accepts the shape.
      const input: {
        hunter_user_id: string;
        title: string;
        description?: string;
        due_at?: number | null;
        priority?: 'low' | 'normal' | 'high' | 'urgent';
        related_recommendation_id?: string;
        related_candidate_user_id?: string;
      } = { hunter_user_id: user.id, title: parsed.data.title };
      if (parsed.data.description !== undefined) input.description = parsed.data.description;
      if (parsed.data.due_at !== undefined) input.due_at = parsed.data.due_at;
      if (parsed.data.priority !== undefined) input.priority = parsed.data.priority;
      if (parsed.data.related_recommendation_id !== undefined) {
        input.related_recommendation_id = parsed.data.related_recommendation_id;
      }
      if (parsed.data.related_candidate_user_id !== undefined) {
        input.related_candidate_user_id = parsed.data.related_candidate_user_id;
      }
      const row = tasks.create(user, input);
      respond(res, TaskResponseSchema, { ok: true, data: row });
    } catch (e) {
      next(e);
    }
  });

  // PUT /v1/headhunter-workspace/tasks/:id
  router.put('/tasks/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const id = String(req.params.id);
      const parsed = TaskUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      // Re-shape to satisfy exactOptionalPropertyTypes on HunterTaskUpdate.
      const patch: {
        title?: string;
        description?: string | null;
        due_at?: number | null;
        priority?: 'low' | 'normal' | 'high' | 'urgent';
      } = {};
      if (parsed.data.title !== undefined) patch.title = parsed.data.title;
      if (parsed.data.description !== undefined) patch.description = parsed.data.description;
      if (parsed.data.due_at !== undefined) patch.due_at = parsed.data.due_at;
      if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
      const row = tasks.update(user, id, patch);
      respond(res, TaskResponseSchema, { ok: true, data: row });
    } catch (e) {
      next(e);
    }
  });

  // DELETE /v1/headhunter-workspace/tasks/:id
  router.delete('/tasks/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const id = String(req.params.id);
      tasks.delete(user, id);
      respond(res, TaskDeleteResponseSchema, { ok: true, data: { deleted: true } });
    } catch (e) {
      next(e);
    }
  });

  // POST /v1/headhunter-workspace/tasks/:id/complete
  router.post('/tasks/:id/complete', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const id = String(req.params.id);
      const row = tasks.complete(user, id);
      respond(res, TaskResponseSchema, { ok: true, data: row });
    } catch (e) {
      next(e);
    }
  });

  // POST /v1/headhunter-workspace/tasks/:id/reopen
  router.post('/tasks/:id/reopen', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const id = String(req.params.id);
      const row = tasks.reopen(user, id);
      respond(res, TaskResponseSchema, { ok: true, data: row });
    } catch (e) {
      next(e);
    }
  });

  // ===== Kanban =====

  // GET /v1/headhunter-workspace/kanban
  router.get('/kanban', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const board = kanban.getBoard(user);
      respond(res, KanbanBoardResponseSchema, { ok: true, data: board });
    } catch (e) {
      next(e);
    }
  });

  // POST /v1/headhunter-workspace/kanban/move
  router.post('/kanban/move', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = KanbanMoveSchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      // Re-shape to satisfy exactOptionalPropertyTypes on MoveCardInput.
      const input: { to_column_id: number; to_position?: number | null } = {
        to_column_id: parsed.data.to_column_id,
      };
      if (parsed.data.to_position !== undefined) input.to_position = parsed.data.to_position;
      const card = kanban.moveCard(user, parsed.data.recommendation_id, input);
      respond(res, KanbanCardResponseSchema, { ok: true, data: card });
    } catch (e) {
      next(e);
    }
  });

  // POST /v1/headhunter-workspace/kanban/add
  router.post('/kanban/add', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = KanbanAddSchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const card = kanban.addCard(user, parsed.data.recommendation_id, parsed.data.to_column_id);
      respond(res, KanbanCardResponseSchema, { ok: true, data: card });
    } catch (e) {
      next(e);
    }
  });

  // POST /v1/headhunter-workspace/kanban/remove
  router.post('/kanban/remove', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = KanbanRemoveSchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const card = kanban.removeCard(user, parsed.data.recommendation_id);
      respond(res, KanbanCardResponseSchema, { ok: true, data: card });
    } catch (e) {
      next(e);
    }
  });

  // ===== Stats =====

  // GET /v1/headhunter-workspace/stats?from=&to=
  router.get('/stats', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = StatsFunnelQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid query', { issues: parsed.error.issues });
      }
      // Re-shape to satisfy exactOptionalPropertyTypes on DateRange.
      const range: { from?: number; to?: number } = {};
      if (parsed.data.from !== undefined) range.from = parsed.data.from;
      if (parsed.data.to !== undefined) range.to = parsed.data.to;
      const overview = stats.overview(user);
      const funnel = stats.funnel(user, range);
      respond(res, StatsCombinedResponseSchema, {
        ok: true,
        data: {
          overview,
          funnel,
          range: { from: range.from ?? null, to: range.to ?? null },
        },
      });
    } catch (e) {
      next(e);
    }
  });

  // 404 fallback for any unmatched path under /v1/headhunter-workspace.
  // Without this, Express's default HTML 404 would leak out (or the app-level
  // JSON 404 in server.ts would handle it, but in the test app the 404 is
  // also JSON, so we get consistent behavior across both mounts).
  router.use((req: Request, res: Response) => {
    res.status(404).json({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: `No route matched ${req.method} ${req.path}`,
        details: { method: req.method, path: req.path },
      },
    });
  });

  return router;
}