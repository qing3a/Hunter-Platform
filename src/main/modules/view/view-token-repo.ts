import type { DB } from '../../db/connection.js';

export interface ViewTokenRow {
  token: string;
  user_id: string;
  view_type: string;
  view_id: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface CreateViewTokenInput {
  token: string;
  userId: string;
  viewType: string;
  viewId: string;
  expiresAt: string;
}

export function createViewTokenRepo(db: DB) {
  const insertStmt = db.prepare(
    `INSERT INTO view_tokens (token, user_id, view_type, view_id, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  const findValidStmt = db.prepare(
    `SELECT * FROM view_tokens
     WHERE token = ?
       AND consumed_at IS NULL
       AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  );

  // Atomic: only marks if consumed_at is still NULL. Returns true if updated.
  const markConsumedStmt = db.prepare(
    `UPDATE view_tokens
     SET consumed_at = ?
     WHERE token = ? AND consumed_at IS NULL`
  );

  return {
    create(input: CreateViewTokenInput): void {
      insertStmt.run(input.token, input.userId, input.viewType, input.viewId, input.expiresAt);
    },

    findValid(token: string): ViewTokenRow | null {
      return (findValidStmt.get(token) as ViewTokenRow | undefined) ?? null;
    },

    markConsumed(token: string, consumedAt: string): boolean {
      const result = markConsumedStmt.run(consumedAt, token);
      return (result as { changes: number }).changes === 1;
    },

    // Unfiltered lookup — used by validate to disambiguate expired vs consumed vs invalid.
    // Exists for this single purpose; not part of the public API for callers.
    lookupRaw(token: string): ViewTokenRow | null {
      const stmt = db.prepare(`SELECT * FROM view_tokens WHERE token = ?`);
      return (stmt.get(token) as ViewTokenRow | undefined) ?? null;
    },
  };
}