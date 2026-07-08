// src/main/db/repositories/candidate-messages.ts
//
// Repository for the candidate_messages table (v025). One row per message
// exchanged between a candidate and a headhunter/employer. This file provides
// CRUD plus three listing helpers:
//   - inbox:        messages addressed to `user_id` (received), newest first
//   - sent:         messages from `user_id` (sent), newest first
//   - unreadCount:  count of inbox messages with read_at IS NULL
//
// We deliberately store content as plaintext TEXT: messages are scoped to
// authenticated users on both ends and are intended for direct candidate ↔
// hunter/employer coordination (e.g. scheduling intro calls, sharing links).
// Encryption would needlessly complicate search/display; if message-level
// PII protection becomes a requirement later we can swap the column to `enc TEXT`
// alongside a key-management migration.
//
// The row returns `from_name` / `from_type` (and analogously `to_name` /
// `to_type`) joined from the `users` table so the inbox/sent lists render
// without an N+1 query in the router layer.

import type { DB } from '../connection.js';

export interface MessageRow {
  id: number;
  application_id: number | null;
  from_user_id: string;
  to_user_id: string;
  content: string;
  read_at: number | null;
  created_at: number;
}

export interface MessageInsert {
  application_id?: number | null;
  from_user_id: string;
  to_user_id: string;
  content: string;
}

export interface InboxMessageRow extends MessageRow {
  from_name: string;
  from_type: string;
}

export interface SentMessageRow extends MessageRow {
  to_name: string;
  to_type: string;
}

export type MessageListItem = InboxMessageRow | SentMessageRow;

export function createCandidateMessagesRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO candidate_messages (application_id, from_user_id, to_user_id, content)
    VALUES (?, ?, ?, ?)
  `);
  const inboxStmt = db.prepare(`
    SELECT cm.*, u.name AS from_name, u.user_type AS from_type
    FROM candidate_messages cm
    JOIN users u ON u.id = cm.from_user_id
    WHERE cm.to_user_id = ?
    ORDER BY cm.created_at DESC LIMIT ? OFFSET ?
  `);
  const sentStmt = db.prepare(`
    SELECT cm.*, u.name AS to_name, u.user_type AS to_type
    FROM candidate_messages cm
    JOIN users u ON u.id = cm.to_user_id
    WHERE cm.from_user_id = ?
    ORDER BY cm.created_at DESC LIMIT ? OFFSET ?
  `);
  const findByIdStmt = db.prepare(
    'SELECT * FROM candidate_messages WHERE id = ?'
  );
  const unreadCountStmt = db.prepare(
    'SELECT COUNT(*) AS cnt FROM candidate_messages WHERE to_user_id = ? AND read_at IS NULL'
  );
  const markReadStmt = db.prepare(
    'UPDATE candidate_messages SET read_at = ? WHERE id = ? AND to_user_id = ?'
  );

  return {
    /**
     * Insert a new message. Returns the new row id.
     * `application_id` is optional — uncoupled DMs (e.g. candidate ↔ hunter
     * outside any specific application) are allowed.
     */
    insert(input: MessageInsert): number {
      const r = insertStmt.run(
        input.application_id ?? null,
        input.from_user_id,
        input.to_user_id,
        input.content,
      );
      return Number(r.lastInsertRowid);
    },

    /** Newest-first inbox for `userId`. Joins users for display name. */
    inbox(userId: string, limit: number, offset: number): InboxMessageRow[] {
      // node:sqlite's .all() returns Record<string, SQLOutputValue>[]; cast
      // through unknown to the typed projection (matches notifications.ts).
      return inboxStmt.all(userId, limit, offset) as unknown as InboxMessageRow[];
    },

    /** Newest-first sent messages for `userId`. Joins users for recipient info. */
    sent(userId: string, limit: number, offset: number): SentMessageRow[] {
      return sentStmt.all(userId, limit, offset) as unknown as SentMessageRow[];
    },

    /** Lookup by primary key (used by GET /:id and mark-read flow). */
    findById(id: number): MessageRow | null {
      const row = findByIdStmt.get(id) as MessageRow | undefined;
      return row ?? null;
    },

    /** Count of inbox messages (to_user_id = userId) with read_at IS NULL. */
    unreadCount(userId: string): number {
      const row = unreadCountStmt.get(userId) as { cnt: number };
      return row.cnt;
    },

    /**
     * Mark a single message as read. Returns true if a row was updated
     * (i.e. the caller owned the message on the receiving side). False when
     * the message doesn't exist OR the caller is not the recipient.
     */
    markRead(id: number, userId: string, readAt: number = Date.now()): boolean {
      const result = markReadStmt.run(readAt, id, userId);
      return result.changes > 0;
    },
  };
}
