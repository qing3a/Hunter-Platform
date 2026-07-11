// src/main/routes/employer-panel.ts
//
// Employer Panel (Phase 3c, Task 3) — HTTP router for /v1/employer-panel/*.
//
// Mounted by server.ts at `/v1/employer-panel`.
//
//   - All endpoints require a Bearer-token session (`router.use(authMiddleware(db))`).
//   - The handler module re-checks `user_type === 'pm'` via
//     `assertEmployer(user)` so non-employer callers receive 403 FORBIDDEN
//     from the underlying function — same pattern as the headhunter-workspace
//     router.
//
// Pattern mirrors src/main/routes/headhunter-workspace.ts:
//   - Per-router utf8-only + express.json() body parsers are attached by the
//     mounting caller (server.ts and tests/helpers/test-app.ts). The router
//     itself only registers route handlers.
//   - Auth boundary is enforced at the router level; handler modules also
//     re-check user_type so they stay safe to call from other contexts
//     (admin overrides, background workers, etc.).

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DB } from '../db/connection.js';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createEmployerDashboardHandler } from '../modules/employer/dashboard.js';
import { DashboardResponseSchema } from '../schemas/employer-panel.js';
import { respond } from '../responses.js';
import type { User } from '../../shared/types.js';

export function createEmployerPanelRouter(db: DB): Router {
  const router = Router();
  router.use(authMiddleware(db));

  const dashboard = createEmployerDashboardHandler(db);

  // GET /v1/employer-panel/dashboard
  //
  // Single-call aggregate for the SPA home/landing view. Returns seven
  // counters (active_jobs, open_positions, candidates_viewed_this_month,
  // interested_count, unlocked_count, placements_count, spend_this_month).
  // The handler enforces the employer-role check via assertEmployer(),
  // so non-employer callers receive 403 FORBIDDEN.
  router.get('/dashboard', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as Request & { user?: User }).user!;
      const data = dashboard.getDashboard(user);
      respond(res, DashboardResponseSchema, { ok: true, data });
    } catch (e) {
      next(e);
    }
  });

  return router;
}