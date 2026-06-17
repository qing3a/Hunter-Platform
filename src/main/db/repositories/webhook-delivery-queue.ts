import type { DB } from '../connection.js';
import type { WebhookEventType, WebhookDeliveryStatus, WebhookDeliveryRecord } from '../../../shared/types.js';

export interface WebhookQueueInsert {
  target_user_id: string;
  event_type: WebhookEventType;
  payload_enc: string;
  contains_pii: 0 | 1;
  max_attempts?: number;
}

export function createWebhookQueueRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO webhook_delivery_queue (target_user_id, event_type, payload_enc, contains_pii,
                                        status, attempt_count, max_attempts,
                                        next_retry_at, last_error, delivered_at,
                                        created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, ?, ?)
  `);
  const fetchPendingStmt = db.prepare(`
    SELECT * FROM webhook_delivery_queue
    WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)
    ORDER BY id ASC LIMIT 10
  `);
  const findByIdStmt = db.prepare('SELECT * FROM webhook_delivery_queue WHERE id = ?');
  const markSuccessStmt = db.prepare(
    "UPDATE webhook_delivery_queue SET status = 'success', delivered_at = ?, last_error = NULL, updated_at = ? WHERE id = ?"
  );
  const markFailedStmt = db.prepare(`
    UPDATE webhook_delivery_queue
    SET attempt_count = attempt_count + 1,
        last_error = ?,
        next_retry_at = ?,
        status = CASE WHEN attempt_count + 1 >= max_attempts THEN 'dead_letter' ELSE 'pending' END,
        updated_at = ?
    WHERE id = ?
  `);
  const countPendingStmt = db.prepare(
    "SELECT COUNT(*) as cnt FROM webhook_delivery_queue WHERE status IN ('pending', 'in_flight')"
  );
  const countDeadLetterStmt = db.prepare(
    "SELECT COUNT(*) as cnt FROM webhook_delivery_queue WHERE status = 'dead_letter'"
  );

  return {
    enqueue(input: WebhookQueueInsert): number {
      const now = new Date().toISOString();
      const result = insertStmt.run(
        input.target_user_id, input.event_type, input.payload_enc, input.contains_pii,
        input.max_attempts ?? 3, now, now,
      );
      return Number(result.lastInsertRowid);
    },
    fetchPending(now: string): WebhookDeliveryRecord[] {
      return fetchPendingStmt.all(now) as unknown as WebhookDeliveryRecord[];
    },
    findById(id: number): WebhookDeliveryRecord | undefined {
      return findByIdStmt.get(id) as WebhookDeliveryRecord | undefined;
    },
    markSuccess(id: number): void {
      const now = new Date().toISOString();
      markSuccessStmt.run(now, now, id);
    },
    markFailed(id: number, error: string, nextRetryAt: string): void {
      markFailedStmt.run(error, nextRetryAt, new Date().toISOString(), id);
    },
    countPending(): number {
      return (countPendingStmt.get() as { cnt: number }).cnt;
    },
    countDeadLetter(): number {
      return (countDeadLetterStmt.get() as { cnt: number }).cnt;
    },
  };
}
