import { createNotificationsRepo, type NotificationInsert, type NotificationListFilter, type NotificationRow } from '../../db/repositories/notifications.js';
import type { DB } from '../../db/connection.js';

export interface SendInput {
  userId: string;
  category: string;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
  dedupKey?: string;
}

export interface ListInput extends Omit<NotificationListFilter, 'user_id'> {
  userId: string;
}

export function createNotificationHandler(db: DB) {
  const repo = createNotificationsRepo(db);

  return {
    /** Look up a single notification, scoped to the requesting user. */
    findOne(id: string, userId: string): NotificationRow | null {
      const row = repo.findById(id);
      if (!row || row.user_id !== userId) return null;
      return row;
    },

    /** Send a new notification. Optionally upsert by dedupKey. */
    send(input: SendInput): string {
      const payload_json = input.payload ? JSON.stringify(input.payload) : null;
      const insert: NotificationInsert = {
        user_id: input.userId,
        category: input.category,
        title: input.title,
        body: input.body ?? null,
        payload_json,
        dedup_key: input.dedupKey ?? null,
      };
      if (input.dedupKey) {
        return repo.upsert(insert);
      }
      return repo.insert(insert);
    },

    list(input: ListInput) {
      const rows = repo.listByUser({
        user_id: input.userId,
        ...(input.unread !== undefined && { unread: input.unread }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.since !== undefined && { since: input.since }),
        ...(input.limit !== undefined && { limit: input.limit }),
        ...(input.offset !== undefined && { offset: input.offset }),
      });
      const unread_count = repo.countUnread(input.userId);
      return { rows, unread_count };
    },

    markRead(id: string, userId: string): string | null {
      // Look up first: if already read, return the original read_at (idempotent).
      // If not found OR not owned by user, return null.
      const existing = repo.findById(id);
      if (!existing || existing.user_id !== userId) return null;
      if (existing.read_at) return existing.read_at;
      const now = new Date().toISOString();
      const updated = repo.markRead(id, userId, now);
      if (!updated) return null;  // race: someone else read it; fall through to existing.read_at
      return now;
    },

    markAllRead(userId: string): number {
      return repo.markAllRead(userId, new Date().toISOString());
    },

    delete(id: string, userId: string): boolean {
      return repo.delete(id, userId);
    },
  };
}
