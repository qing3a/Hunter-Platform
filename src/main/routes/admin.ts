import { Router, type Request, type Response } from 'express';
import type { DB } from '../db/connection.js';
import { renderDashboard, type DashboardData } from '../modules/view/templates/dashboard.js';

// Captured at startup so uptime is accurate relative to process start.
const SERVER_START = Date.now();

export function createAdminRouter(db: DB): Router {
  const router = Router();

  // GET /dashboard — public, no auth, no quota
  router.get('/dashboard', (_req: Request, res: Response) => {
    try {
      const data = gatherDashboardData(db);
      const html = renderDashboard(data);
      res.status(200).type('text/html; charset=utf-8').send(html);
    } catch (e) {
      console.error('Dashboard render failed:', e);
      res.status(500).type('text/html; charset=utf-8')
        .send(`<!DOCTYPE html><html><body><h1>Dashboard 暂不可用</h1><p>${(e as Error).message}</p></body></html>`);
    }
  });

  return router;
}

function gatherDashboardData(db: DB): DashboardData {
  // Users by type
  const userRows = db.prepare(
    `SELECT user_type, COUNT(*) as count FROM users WHERE status = 'active' GROUP BY user_type`
  ).all() as Array<{ user_type: string; count: number }>;
  const users = { candidate: 0, headhunter: 0, employer: 0 };
  for (const r of userRows) {
    if (r.user_type in users) (users as any)[r.user_type] = r.count;
  }

  // Candidates
  const candRow = db.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN is_public_pool = 1 THEN 1 ELSE 0 END) as public_pool
     FROM candidates_anonymized`
  ).get() as { total: number; public_pool: number | null };
  const candidates = { total: candRow.total, publicPool: candRow.public_pool ?? 0 };

  // Recommendations by status
  const recRows = db.prepare(
    `SELECT status, COUNT(*) as count FROM recommendations GROUP BY status`
  ).all() as Array<{ status: string; count: number }>;
  const recommendations: { [s: string]: number } = {};
  let totalRecommendations = 0;
  for (const r of recRows) {
    recommendations[r.status] = r.count;
    totalRecommendations += r.count;
  }

  // API calls today (action_history)
  const actionRows = db.prepare(
    `SELECT action_type, COUNT(*) as count
     FROM action_history
     WHERE created_at >= datetime('now', 'start of day')
     GROUP BY action_type
     ORDER BY count DESC`
  ).all() as Array<{ action_type: string; count: number }>;
  const endpointsToday: { [s: string]: number } = {};
  let totalEndpointsToday = 0;
  for (const r of actionRows) {
    endpointsToday[r.action_type] = r.count;
    totalEndpointsToday += r.count;
  }

  // Recent activity (last 20, anonymized — NO user_id / target_id)
  const recentRows = db.prepare(
    `SELECT created_at, action_type, status
     FROM action_history
     ORDER BY created_at DESC
     LIMIT 20`
  ).all() as Array<{ created_at: string; action_type: string; status: string }>;
  const recentActivity = recentRows.map(r => ({
    at: r.created_at,
    action_type: r.action_type,
    status: r.status,
  }));

  return {
    users,
    candidates,
    recommendations,
    totalRecommendations,
    endpointsToday,
    totalEndpointsToday,
    recentActivity,
    serverTime: new Date().toISOString(),
    uptimeHours: (Date.now() - SERVER_START) / 3600_000,
  };
}