// Migrated from src/main/ipc/webhooks.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createWebhookQueueRepo } from '../../../db/repositories/webhook-delivery-queue.js';
import { createAdminActionLogRepo } from '../../../db/repositories/admin-action-log.js';
import { Errors } from '../../../errors.js';

export type DeadLetterRow = {
  id: number;
  target_user_id: string;
  event_type: string;
  attempt_count: number;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ListDeadLetterFilter = {
  event_type?: string;
  min_attempt_count?: number;
  from?: string;
  until?: string;
  limit?: number;
  offset?: number;
};

export function createAdminWebhooksHandler(db: DB) {
  const wh = createWebhookQueueRepo(db);
  const adminLog = createAdminActionLogRepo(db);
  return {
    listDeadLetter(filter: ListDeadLetterFilter = {}): { rows: DeadLetterRow[]; total: number } {
      const where: string[] = ["status = 'dead_letter'"];
      const params: any[] = [];
      if (filter.event_type) {
        where.push('event_type = ?');
        params.push(filter.event_type);
      }
      if (filter.min_attempt_count !== undefined && filter.min_attempt_count !== null) {
        where.push('attempt_count >= ?');
        params.push(filter.min_attempt_count);
      }
      if (filter.from) {
        where.push('updated_at >= ?');
        params.push(filter.from);
      }
      if (filter.until) {
        where.push('updated_at < ?');
        params.push(filter.until);
      }
      const whereSql = where.join(' AND ');
      const total = (db.prepare(
        `SELECT COUNT(*) AS cnt FROM webhook_delivery_queue WHERE ${whereSql}`
      ).get(...params) as { cnt: number }).cnt;
      const rows = db.prepare(`
        SELECT id, target_user_id, event_type, attempt_count, last_error, next_retry_at, created_at, updated_at
        FROM webhook_delivery_queue WHERE ${whereSql}
        ORDER BY updated_at DESC LIMIT ? OFFSET ?
      `).all(...params, filter.limit ?? 20, filter.offset ?? 0) as DeadLetterRow[];
      return { rows, total };
    },
    retry(adminUserId: string, delivery_id: number): { id: number; status: string } {
      const rec = wh.findById(delivery_id);
      if (!rec) throw Errors.notFound('Delivery not found');
      if (rec.status !== 'dead_letter') throw Errors.invalidState(`Can only retry dead_letter, current: ${rec.status}`);
      db.prepare(
        "UPDATE webhook_delivery_queue SET status = 'pending', attempt_count = 0, last_error = NULL, next_retry_at = NULL, updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), delivery_id);
      // Sub-D4: write audit log (best-effort, no rollback if this fails)
      try {
        adminLog.insert({
          admin_user_id: adminUserId,
          action: 'retry_webhook',
          target_type: 'webhook_delivery',
          target_id: String(delivery_id),
          details_json: JSON.stringify({
            event_type: rec.event_type,
            target_user_id: rec.target_user_id,
            previous_attempt_count: rec.attempt_count,
          }),
        });
      } catch (e) {
        console.error('[webhooks.retry] audit log insert failed:', e);
        // best-effort: do not rollback retry
      }
      return { id: delivery_id, status: 'pending' };
    },
  };
}