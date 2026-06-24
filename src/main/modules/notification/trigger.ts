import { createNotificationHandler, type SendInput } from './handler.js';
import type { DB } from '../../db/connection.js';

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
      } catch (e) {
        console.error('[notification trigger] failed', {
          category: input.category,
          userId: input.userId,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    },
  };
}

export type NotificationTrigger = ReturnType<typeof createNotificationTrigger>;
