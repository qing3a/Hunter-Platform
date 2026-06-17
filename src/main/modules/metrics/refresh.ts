import { getDb } from '../../db.js';
import { createWebhookQueueRepo } from '../../db/repositories/webhook-delivery-queue.js';
import { getHunterMetrics } from './registry.js';
import type { DB } from '../../db/connection.js';

let interval: NodeJS.Timeout | null = null;

/** Refresh webhook queue/dead-letter gauges. Pass an explicit db in tests. */
export function refreshWebhookMetrics(db?: DB): void {
  const useDb = db ?? getDb();
  const queue = createWebhookQueueRepo(useDb);
  const m = getHunterMetrics();
  m.webhookPendingCount.set(queue.countPending());
  m.webhookDeadLetterCount.set(queue.countDeadLetter());
}

export function startMetricsRefresh(intervalMs: number = 10_000, db?: DB): void {
  if (interval) return;
  refreshWebhookMetrics(db);
  interval = setInterval(() => refreshWebhookMetrics(db), intervalMs);
}

export function stopMetricsRefresh(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
