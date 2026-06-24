import { randomUUID } from 'node:crypto';
import type { DB } from '../connection.js';

export interface NotificationRow {
  id: string;
  user_id: string;
  category: string;
  title: string;
  body: string | null;
  payload_json: string | null;
  read_at: string | null;
  created_at: string;
  expires_at: string;
  dedup_key: string | null;
}

export interface NotificationInsert {
  id?: string;          // optional, auto-gen if missing
  user_id: string;
  category: string;
  title: string;
  body?: string | null;
  payload_json?: string | null;
  read_at?: string | null;
  created_at?: string;  // optional, auto-gen if missing
  expires_at?: string;  // optional, auto-gen if missing (= created_at + 30d)
  dedup_key?: string | null;
}

export interface NotificationListFilter {
  user_id: string;
  unread?: boolean;
  category?: string;
  since?: string;
  limit?: number;  // default 50
  offset?: number; // default 0
}

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

export function createNotificationsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO notifications (
      id, user_id, category, title, body, payload_json,
      read_at, created_at, expires_at, dedup_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const findByIdStmt = db.prepare('SELECT * FROM notifications WHERE id = ?');

  /**
   * Upsert with dedup semantics:
   * - If no existing row → INSERT
   * - If existing UNREAD row with same (user_id, category, dedup_key) → UPDATE
   *   (replace title/body/payload, reset created_at) — same id returned
   * - If existing READ row with same key → INSERT a new row (re-notify)
   *
   * Implemented as a 2-step process in JS to avoid a unique-partial-index
   * dance: try UPDATE first; if changes==0, INSERT a new row. (The DB has
   * only a NON-unique partial index on dedup_key, so multiple rows with the
   * same key are allowed — dedup is by-read-state, enforced in the repo.)
   */
  const updateByDedupStmt = db.prepare(`
    UPDATE notifications
    SET title = ?, body = ?, payload_json = ?, created_at = ?, expires_at = ?
    WHERE user_id = ? AND category = ? AND dedup_key = ? AND read_at IS NULL
  `);
  const findByDedupStmt = db.prepare(
    "SELECT id FROM notifications WHERE user_id = ? AND category = ? AND dedup_key = ? AND read_at IS NULL"
  );

  const markReadStmt = db.prepare(
    'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL'
  );
  const markAllReadStmt = db.prepare(
    "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL"
  );
  const deleteStmt = db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?');
  const countUnreadStmt = db.prepare(
    "SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND read_at IS NULL AND expires_at > ?"
  );

  return {
    insert(input: NotificationInsert): string {
      const now = new Date();
      const createdAt = input.created_at ?? now.toISOString();
      const expiresAt = input.expires_at ?? new Date(now.getTime() + THIRTY_DAYS_MS).toISOString();
      const id = input.id ?? `notif_${randomUUID().slice(0, 12)}`;
      insertStmt.run(
        id, input.user_id, input.category, input.title,
        input.body ?? null, input.payload_json ?? null,
        input.read_at ?? null, createdAt, expiresAt,
        input.dedup_key ?? null
      );
      return id;
    },

    upsert(input: NotificationInsert): string {
      const now = new Date();
      const createdAt = input.created_at ?? now.toISOString();
      const expiresAt = input.expires_at ?? new Date(now.getTime() + THIRTY_DAYS_MS).toISOString();

      if (input.dedup_key) {
        // Try to update an existing UNREAD row with the same dedup key
        const result = updateByDedupStmt.run(
          input.title, input.body ?? null, input.payload_json ?? null,
          createdAt, expiresAt,
          input.user_id, input.category, input.dedup_key
        );
        if (result.changes > 0) {
          const existing = findByDedupStmt.get(input.user_id, input.category, input.dedup_key) as { id: string } | undefined;
          if (existing) return existing.id;
          // Race: row got marked read between UPDATE and SELECT — fall through to INSERT
        }
      }
      // No existing unread row (or no dedup_key): INSERT a new row
      const id = input.id ?? `notif_${randomUUID().slice(0, 12)}`;
      insertStmt.run(
        id, input.user_id, input.category, input.title,
        input.body ?? null, input.payload_json ?? null,
        input.read_at ?? null, createdAt, expiresAt,
        input.dedup_key ?? null
      );
      return id;
    },

    findById(id: string): NotificationRow | null {
      const row = findByIdStmt.get(id);
      return (row as NotificationRow | undefined) ?? null;
    },

    listByUser(filter: NotificationListFilter): NotificationRow[] {
      const where: string[] = ['user_id = ?'];
      const params: (string | number)[] = [filter.user_id];
      if (filter.unread) {
        where.push('read_at IS NULL');
      }
      if (filter.category) {
        where.push('category = ?');
        params.push(filter.category);
      }
      if (filter.since) {
        where.push('created_at > ?');
        params.push(filter.since);
      }
      where.push('expires_at > ?');  // 不返回已过期的
      params.push(new Date().toISOString());
      const limit = filter.limit ?? 50;
      const offset = filter.offset ?? 0;
      const sql = `SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      return db.prepare(sql).all(...params) as NotificationRow[];
    },

    countUnread(userId: string): number {
      const row = countUnreadStmt.get(userId, new Date().toISOString()) as { cnt: number };
      return row.cnt;
    },

    markRead(id: string, userId: string, readAt: string): boolean {
      const result = markReadStmt.run(readAt, id, userId);
      return result.changes > 0;
    },

    markAllRead(userId: string, readAt: string): number {
      const result = markAllReadStmt.run(readAt, userId);
      return result.changes;
    },

    delete(id: string, userId: string): boolean {
      const result = deleteStmt.run(id, userId);
      return result.changes > 0;
    },

    deleteExpired(now: string): number {
      const result = db.prepare('DELETE FROM notifications WHERE expires_at < ?').run(now);
      return result.changes;
    },
  };
}
