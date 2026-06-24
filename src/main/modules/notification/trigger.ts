import { createNotificationHandler, type SendInput } from './handler.js';
import type { DB } from '../../db/connection.js';
import { getHunterMetrics } from '../metrics/registry.js';

/**
 * Trigger — the only way other modules create notifications.
 * Swallows ALL errors so the calling business logic is never affected
 * by notification failures.
 */
export function createNotificationTrigger(db: DB) {
  const handler = createNotificationHandler(db);
  return {
    notify(input: SendInput): void {
      try {
        handler.send(input);
        try {
          getHunterMetrics().notificationsSentTotal.inc({ category: input.category });
        } catch {
          // Metrics not yet initialized (e.g. in some unit-test contexts).
        }
      } catch (e) {
        console.error('[notification trigger] failed', {
          category: input.category,
          userId: input.userId,
          err: e instanceof Error ? e.message : String(e),
        });
        try {
          getHunterMetrics().notificationsSendErrorsTotal.inc({
            category: input.category,
            error_type: e instanceof Error ? e.constructor.name : 'unknown',
          });
        } catch {
          // See above.
        }
      }
    },
  };
}

export type NotificationTrigger = ReturnType<typeof createNotificationTrigger>;
