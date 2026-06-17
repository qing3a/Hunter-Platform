import cron from 'node-cron';
import { getDb } from '../../db.js';
import type { DB } from '../../db/connection.js';

type ScheduledJob = { name: string; task: cron.ScheduledTask };

const jobs: ScheduledJob[] = [];

/** Start the background scheduler (idempotent). */
export function startScheduler(db?: DB): void {
  if (jobs.length > 0) return;
  const useDb = db;
  registerJob('quota-reset', '0 0 * * *', () => resetDailyQuota(useDb));           // daily UTC 0
  registerJob('rate-limit-cleanup', '0 * * * *', () => cleanupRateLimitBuckets(useDb)); // hourly
  registerJob('audit-archive', '0 0 1 * *', () => archiveAuditLogs(useDb));         // 1st of month
}

export function stopScheduler(): void {
  for (const j of jobs) j.task.stop();
  jobs.length = 0;
}

export function getScheduledJobs(): { name: string }[] {
  return jobs.map(({ name }) => ({ name }));
}

function registerJob(name: string, expression: string, fn: () => void | Promise<void>): void {
  const task = cron.schedule(expression, () => {
    try {
      const r = fn();
      if (r instanceof Promise) r.catch((e) => console.error(`[cron ${name}]`, e));
    } catch (e) {
      console.error(`[cron ${name}]`, e);
    }
  });
  jobs.push({ name, task });
}

function resetDailyQuota(db?: DB): void {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  const d = db ?? getDb();
  const result = d.prepare(
    "UPDATE users SET quota_used = 0, quota_reset_at = ?, updated_at = ? WHERE quota_reset_at <= ? AND status = 'active'"
  ).run(tomorrow.toISOString(), now.toISOString(), now.toISOString());
  console.log(`[cron quota-reset] reset ${result.changes} users`);
}

function cleanupRateLimitBuckets(db?: DB): void {
  const d = db ?? getDb();
  const result = d.prepare('DELETE FROM rate_limit_buckets WHERE expires_at < ?').run(new Date().toISOString());
  console.log(`[cron rate-limit-cleanup] deleted ${result.changes} expired buckets`);
}

function archiveAuditLogs(db?: DB): void {
  // M5 v1: delete action_history older than 90 days. Production should archive to S3/cold storage first.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const d = db ?? getDb();
  const result = d.prepare('DELETE FROM action_history WHERE created_at < ?').run(cutoff.toISOString());
  console.log(`[cron audit-archive] archived (deleted) ${result.changes} old action_history rows`);
}
