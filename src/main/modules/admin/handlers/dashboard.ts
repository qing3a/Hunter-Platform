// Migrated from src/main/ipc/dashboard.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createJobsRepo } from '../../../db/repositories/jobs.js';
import { createUsersRepo } from '../../../db/repositories/users.js';
import { createRecommendationsRepo } from '../../../db/repositories/recommendations.js';
import { createCandidatesAnonymizedRepo } from '../../../db/repositories/candidates-anonymized.js';
import { createWebhookQueueRepo } from '../../../db/repositories/webhook-delivery-queue.js';

export interface DashboardStats {
  users: { total: number; candidate: number; headhunter: number; employer: number };
  jobs: { total: number; open: number; paused: number; closed: number; filled: number };
  recommendations: { total: number; pending: number; unlocked: number };
  candidates: { in_pool: number };
  webhooks: { pending: number; dead_letter: number };
  activity: { placements_today: number };
  timestamp: string;
  // Sub-B: today_new_users + 30-day daily-new trend
  today_new_users: number;
  trend_30d: number[];
}

export function makeAdminDashboardHandler(db: DB) {
  const users = createUsersRepo(db);
  const jobs = createJobsRepo(db);
  const recs = createRecommendationsRepo(db);
  const candidates = createCandidatesAnonymizedRepo(db);
  const webhooks = createWebhookQueueRepo(db);

  return {
    getStats(): DashboardStats {
      const userRows = db.prepare(
        "SELECT user_type, COUNT(*) as cnt FROM users WHERE status != 'deleted' GROUP BY user_type"
      ).all() as { user_type: string; cnt: number }[];
      const userCounts: { total: number; candidate: number; headhunter: number; employer: number } = {
        total: 0, candidate: 0, headhunter: 0, employer: 0,
      };
      for (const r of userRows) {
        userCounts.total += r.cnt;
        if (r.user_type === 'candidate' || r.user_type === 'headhunter' || r.user_type === 'employer') {
          userCounts[r.user_type] = r.cnt;
        }
      }

      const jobRows = db.prepare(
        'SELECT status, COUNT(*) as cnt FROM jobs GROUP BY status'
      ).all() as { status: string; cnt: number }[];
      const jobCounts: { total: number; open: number; paused: number; closed: number; filled: number } = {
        total: 0, open: 0, paused: 0, closed: 0, filled: 0,
      };
      for (const r of jobRows) {
        jobCounts.total += r.cnt;
        if (r.status === 'open' || r.status === 'paused' || r.status === 'closed' || r.status === 'filled') {
          jobCounts[r.status] = r.cnt;
        }
      }

      const recRows = db.prepare(
        'SELECT status, COUNT(*) as cnt FROM recommendations GROUP BY status'
      ).all() as { status: string; cnt: number }[];
      const recCounts: { total: number; pending: number; unlocked: number } = {
        total: 0, pending: 0, unlocked: 0,
      };
      for (const r of recRows) {
        recCounts.total += r.cnt;
        if (r.status === 'pending' || r.status === 'unlocked') {
          recCounts[r.status] = r.cnt;
        }
      }

      const candPoolCount = (db.prepare(
        'SELECT COUNT(*) as cnt FROM candidates_anonymized WHERE is_public_pool = 1'
      ).get() as { cnt: number }).cnt;

      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const placementsToday = (db.prepare(
        "SELECT COUNT(*) as cnt FROM action_history WHERE capability_name = 'employer.create_placement' AND created_at >= ?"
      ).get(todayStart.toISOString()) as { cnt: number }).cnt;

      // Sub-B: today_new_users + trend_30d
      const todayNewUsers = (db.prepare(
        `SELECT COUNT(*) as cnt FROM users WHERE created_at >= ?`
      ).get(todayStart.toISOString()) as { cnt: number }).cnt;

      const trend30d: number[] = [];
      for (let i = 29; i >= 0; i--) {
        const dayStart = new Date(todayStart);
        dayStart.setUTCDate(dayStart.getUTCDate() - i);
        const dayEnd = new Date(dayStart);
        dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
        const cnt = (db.prepare(
          `SELECT COUNT(*) as cnt FROM users WHERE created_at >= ? AND created_at < ?`
        ).get(dayStart.toISOString(), dayEnd.toISOString()) as { cnt: number }).cnt;
        trend30d.push(cnt);
      }

      return {
        users: userCounts,
        jobs: jobCounts,
        recommendations: recCounts,
        candidates: { in_pool: candPoolCount },
        webhooks: { pending: webhooks.countPending(), dead_letter: webhooks.countDeadLetter() },
        activity: { placements_today: placementsToday },
        timestamp: new Date().toISOString(),
        today_new_users: todayNewUsers,
        trend_30d: trend30d,
      };
    },
  };
}