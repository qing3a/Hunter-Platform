// Migrated from src/main/ipc/webhooks.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createWebhookQueueRepo } from '../../../db/repositories/webhook-delivery-queue.js';
import { Errors } from '../../../errors.js';

export function createAdminWebhooksHandler(db: DB) {
  const wh = createWebhookQueueRepo(db);
  return {
    listDeadLetter(limit = 50): Array<{
      id: number; target_user_id: string; event_type: string;
      attempt_count: number; last_error: string | null; next_retry_at: string | null;
      created_at: string; updated_at: string;
    }> {
      return db.prepare(
        `SELECT id, target_user_id, event_type, attempt_count, last_error, next_retry_at, created_at, updated_at
         FROM webhook_delivery_queue
         WHERE status = 'dead_letter'
         ORDER BY updated_at DESC LIMIT ?`
      ).all(limit) as any;
    },
    retry(delivery_id: number): { id: number; status: string } {
      const rec = wh.findById(delivery_id);
      if (!rec) throw Errors.notFound('Delivery not found');
      if (rec.status !== 'dead_letter') throw Errors.invalidState(`Can only retry dead_letter, current: ${rec.status}`);
      db.prepare(
        "UPDATE webhook_delivery_queue SET status = 'pending', attempt_count = 0, last_error = NULL, next_retry_at = NULL, updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), delivery_id);
      return { id: delivery_id, status: 'pending' };
    },
  };
}