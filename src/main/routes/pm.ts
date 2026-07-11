// src/main/routes/pm.ts
//
// PM Workbench (Phase 3b) — HTTP router for the PM-facing surface.
//
// Mounted by server.ts at `/v1/pm/*`. Every endpoint behind `authMiddleware`
// requires a PM session (non-PMs get 403 from the underlying handler modules'
// `assertPm()` checks).
//
// Tasks wired here:
//   - Task 2:  /projects                                          (projects module)
//              /projects/:id
//   - Task 5:  /projects/:projectId/positions(+bulk,+stats)      (positions module)
//              /positions/:id
//   - Task 6:  /projects/:projectId/decompose(, /:id/commit)     (decompose module)
//              /projects/:projectId/decompositions
//   - Task 7:  /projects/:projectId/plans, /plans, /plans/:id/select (plans module)
//   - Task 8+: /projects/:projectId/matches, ...
//
// Auth boundary: `router.use(authMiddleware(db))` is the only gate; each
// handler module re-checks `user_type === 'pm'` so the underlying functions
// stay safe to call from other contexts (admin overrides, tests, etc.).
//
// Pattern mirrors headhunter-workspace router: per-router express.json +
// utf8-only body parsers are attached by the mounting caller (server.ts
// and tests/helpers/test-app.ts when the test app boots it). The router
// itself only registers routes and a 404 fallback.
//
// Parsed body re-shaping: `exactOptionalPropertyTypes` is on, so the
// handler inputs (which declare `field?: T` not `field?: T | undefined`)
// can't accept `{ field: undefined }`. After Zod `.optional()` parsing,
// `parsed.data.field` is either `T` or `undefined`. The few endpoints
// below that need to pass partial inputs re-shape to drop `undefined`s.

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DB } from '../db/connection.js';
import { authMiddleware } from '../modules/auth/middleware.js';
import { roleGate } from '../modules/auth/role-gate.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import type { User } from '../../shared/types.js';
import { createProjectsHandler } from '../modules/pm/projects.js';
import { createPositionsHandler } from '../modules/pm/positions.js';
import { createDecomposeHandler } from '../modules/pm/decompose.js';
import { createPlansHandler } from '../modules/pm/plans.js';
import { createSandboxHandler } from '../modules/pm/sandbox.js';
import { createMatchesHandler } from '../modules/pm/matches.js';
import { createSnapshotHandler } from '../modules/pm/snapshot.js';
import { createNotesHandler } from '../modules/pm/notes.js';
import {
  CreateProjectSchema, UpdateProjectSchema, ListProjectsQuerySchema,
  CreatePositionSchema, UpdatePositionSchema, ListPositionsQuerySchema,
  BulkCreatePositionsSchema,
  CreatePlanSchema, UpdatePlanSchema, ListPlansQuerySchema,
  DecomposeRequestSchema, CommitDecompositionRequestSchema,
  ProjectCreateResponseSchema, ProjectListResponseSchema,
  ProjectDetailResponseSchema, ProjectUpdateResponseSchema, ProjectDeleteResponseSchema,
  PositionRowSchema, PositionDetailSchema,
  PositionStatsSchema,
  PositionCreateResponseSchema, PositionListResponseSchema,
  PositionUpdateResponseSchema, PositionDeleteResponseSchema,
  PositionBulkCreateResponseSchema,
  PlanCreateResponseSchema, PlanListResponseSchema,
  PlanDetailResponseSchema, PlanUpdateResponseSchema,
  PlanDeleteResponseSchema, PlanSelectResponseSchema,
  DecomposeResponseSchema, CommitDecompositionResponseSchema,
  ListDecompositionsResponseSchema,
  SandboxResponseSchema,
  ListMatchesQuerySchema,
  ListMatchesResponseSchema,
  RecomputeMatchesResponseSchema,
  SnapshotResponseSchema,
  NoteUpdateSchema,
  NoteSingleResponseSchema,
  NoteListResponseSchema,
} from '../schemas/pm.js';

export function createPmRouter(db: DB): Router {
  const router = Router();
  router.use(authMiddleware(db));
  // R1.C2 / T10 — layered defense per spec §7.2: only pm active_role.
  // The handler modules' assertPm() checks remain the source of truth.
  router.use(roleGate('pm'));

  const projects = createProjectsHandler(db);
  const positions = createPositionsHandler(db);
  const decompose = createDecomposeHandler(db);
  const plans = createPlansHandler(db);
  const sandbox = createSandboxHandler(db);
  const matches = createMatchesHandler(db);
  const snapshot = createSnapshotHandler(db);
  const notes = createNotesHandler(db);

  // ===== Projects =====

  // POST /v1/pm/projects
  router.post('/projects', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = CreateProjectSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const project = projects.createProject(user, parsed.data);
      respond(res, ProjectCreateResponseSchema, { ok: true, data: project });
    } catch (e) { next(e); }
  });

  // GET /v1/pm/projects?status=&limit=&offset=
  router.get('/projects', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = ListProjectsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid query', { issues: parsed.error.issues });
      }
      const filter: { status?: 'planning' | 'active' | 'paused' | 'completed' | 'cancelled'; limit?: number; offset?: number } = {};
      if (parsed.data.status !== undefined) filter.status = parsed.data.status;
      if (parsed.data.limit !== undefined) filter.limit = parsed.data.limit;
      if (parsed.data.offset !== undefined) filter.offset = parsed.data.offset;
      const result = projects.listProjects(user, filter);
      respond(res, ProjectListResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // GET /v1/pm/projects/:id
  router.get('/projects/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const detail = projects.getProject(user, String(req.params.id));
      respond(res, ProjectDetailResponseSchema, { ok: true, data: detail });
    } catch (e) { next(e); }
  });

  // PATCH /v1/pm/projects/:id
  router.patch('/projects/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = UpdateProjectSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const project = projects.updateProject(user, String(req.params.id), parsed.data);
      respond(res, ProjectUpdateResponseSchema, { ok: true, data: project });
    } catch (e) { next(e); }
  });

  // DELETE /v1/pm/projects/:id
  router.delete('/projects/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const result = projects.deleteProject(user, String(req.params.id));
      respond(res, ProjectDeleteResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // ===== Positions =====

  // POST /v1/pm/projects/:projectId/positions
  router.post('/projects/:projectId/positions', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = CreatePositionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const position = positions.createPosition(user, String(req.params.projectId), parsed.data);
      respond(res, PositionCreateResponseSchema, { ok: true, data: position });
    } catch (e) { next(e); }
  });

  // GET /v1/pm/projects/:projectId/positions?status=&limit=&offset=
  router.get('/projects/:projectId/positions', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = ListPositionsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid query', { issues: parsed.error.issues });
      }
      const filter: { status?: 'open' | 'paused' | 'filled'; limit?: number; offset?: number } = {};
      if (parsed.data.status !== undefined) filter.status = parsed.data.status;
      if (parsed.data.limit !== undefined) filter.limit = parsed.data.limit;
      if (parsed.data.offset !== undefined) filter.offset = parsed.data.offset;
      const result = positions.listPositions(user, String(req.params.projectId), filter);
      respond(res, PositionListResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // GET /v1/pm/projects/:projectId/positions/stats
  router.get('/projects/:projectId/positions/stats', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const stats = positions.stats(user, String(req.params.projectId));
      respond(res, PositionStatsSchema, { ok: true, data: stats });
    } catch (e) { next(e); }
  });

  // POST /v1/pm/projects/:projectId/positions/bulk
  router.post('/projects/:projectId/positions/bulk', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = BulkCreatePositionsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const result = positions.bulkCreate(user, String(req.params.projectId), parsed.data);
      respond(res, PositionBulkCreateResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // GET /v1/pm/positions/:id
  router.get('/positions/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const result = positions.getPosition(user, String(req.params.id));
      respond(res, PositionDetailSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // PATCH /v1/pm/positions/:id
  router.patch('/positions/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = UpdatePositionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const position = positions.updatePosition(user, String(req.params.id), parsed.data);
      respond(res, PositionUpdateResponseSchema, { ok: true, data: position });
    } catch (e) { next(e); }
  });

  // DELETE /v1/pm/positions/:id
  router.delete('/positions/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const result = positions.deletePosition(user, String(req.params.id));
      respond(res, PositionDeleteResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // ===== Decompose (Task 6) =====

  // POST /v1/pm/projects/:projectId/decompose
  router.post('/projects/:projectId/decompose', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = DecomposeRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const result = await decompose.decomposeProject(user, String(req.params.projectId), parsed.data);
      respond(res, DecomposeResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // POST /v1/pm/projects/:projectId/decompose/:decompositionId/commit
  router.post('/projects/:projectId/decompose/:decompositionId/commit', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = CommitDecompositionRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const result = decompose.commitDecomposition(
        user,
        String(req.params.projectId),
        String(req.params.decompositionId),
        parsed.data,
      );
      respond(res, CommitDecompositionResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // GET /v1/pm/projects/:projectId/decompositions
  router.get('/projects/:projectId/decompositions', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const limitRaw = req.query.limit;
      const offsetRaw = req.query.offset;
      const filter: { limit?: number; offset?: number } = {};
      if (typeof limitRaw === 'string') {
        const n = Number(limitRaw);
        if (Number.isFinite(n) && n > 0) filter.limit = Math.floor(n);
      }
      if (typeof offsetRaw === 'string') {
        const n = Number(offsetRaw);
        if (Number.isFinite(n) && n >= 0) filter.offset = Math.floor(n);
      }
      const result = decompose.listDecompositions(user, String(req.params.projectId), filter);
      respond(res, ListDecompositionsResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // ===== Plans (Task 7) =====

  // POST /v1/pm/projects/:projectId/plans
  router.post('/projects/:projectId/plans', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = CreatePlanSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const plan = plans.createPlan(user, String(req.params.projectId), parsed.data);
      respond(res, PlanCreateResponseSchema, { ok: true, data: plan });
    } catch (e) { next(e); }
  });

  // GET /v1/pm/projects/:projectId/plans?limit=&offset=
  router.get('/projects/:projectId/plans', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = ListPlansQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid query', { issues: parsed.error.issues });
      }
      const filter: { limit?: number; offset?: number } = {};
      if (parsed.data.limit !== undefined) filter.limit = parsed.data.limit;
      if (parsed.data.offset !== undefined) filter.offset = parsed.data.offset;
      const result = plans.listPlans(user, String(req.params.projectId), filter);
      respond(res, PlanListResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // GET /v1/pm/plans/:id
  router.get('/plans/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const plan = plans.getPlan(user, String(req.params.id));
      respond(res, PlanDetailResponseSchema, { ok: true, data: plan });
    } catch (e) { next(e); }
  });

  // PATCH /v1/pm/plans/:id
  router.patch('/plans/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = UpdatePlanSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const plan = plans.updatePlan(user, String(req.params.id), parsed.data);
      respond(res, PlanUpdateResponseSchema, { ok: true, data: plan });
    } catch (e) { next(e); }
  });

  // DELETE /v1/pm/plans/:id
  router.delete('/plans/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const result = plans.deletePlan(user, String(req.params.id));
      respond(res, PlanDeleteResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // POST /v1/pm/plans/:id/select
  router.post('/plans/:id/select', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const plan = plans.setSelectedPlan(user, String(req.params.id));
      respond(res, PlanSelectResponseSchema, { ok: true, data: plan });
    } catch (e) { next(e); }
  });

  // ===== Sandbox (Task 9) =====

  // GET /v1/pm/positions/:id/sandbox
  router.get('/positions/:id/sandbox', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const result = sandbox.getSandbox(user, String(req.params.id));
      respond(res, SandboxResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // ===== Matches (Task 10) =====

  // GET /v1/pm/positions/:id/matches?min_score=&limit=&offset=
  router.get('/positions/:id/matches', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = ListMatchesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid query', { issues: parsed.error.issues });
      }
      const filter: { min_score?: number; limit?: number; offset?: number } = {};
      if (parsed.data.min_score !== undefined) filter.min_score = parsed.data.min_score;
      if (parsed.data.limit !== undefined) filter.limit = parsed.data.limit;
      if (parsed.data.offset !== undefined) filter.offset = parsed.data.offset;
      const result = matches.listMatches(user, String(req.params.id), filter);
      respond(res, ListMatchesResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // POST /v1/pm/positions/:id/matches/recompute
  router.post('/positions/:id/matches/recompute', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const result = matches.recomputeMatches(user, String(req.params.id));
      respond(res, RecomputeMatchesResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // ===== Global Snapshot (Task 12 / S1) =====

  // GET /v1/pm/snapshot
  router.get('/snapshot', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const result = snapshot.getSnapshot(user);
      respond(res, SnapshotResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // ===== PM Private Notes (Task 16) =====

  // GET /v1/pm/notes/:candidate_user_id
  router.get('/notes/:candidate_user_id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const result = notes.getNote(user, String(req.params.candidate_user_id));
      respond(res, NoteSingleResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // PUT /v1/pm/notes/:candidate_user_id
  router.put('/notes/:candidate_user_id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const parsed = NoteUpdateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const result = notes.upsertNote(user, String(req.params.candidate_user_id), parsed.data);
      respond(res, NoteSingleResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // GET /v1/pm/notes — bulk list (Task 14 / S9 candidate-library hydration)
  router.get('/notes', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const result = notes.listMyNotes(user);
      respond(res, NoteListResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // 404 fallback for any unmatched path under /v1/pm.
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
