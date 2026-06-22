import type { DB } from '../../db/connection.js';

export interface ViewTokenRow {
  token: string;
  user_id: string;
  view_type: string;
  view_id: string;
  expires_at: string;
  consumed_at: string | null;  // legacy column; no longer written (multi-use tokens)
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

  return {
    create(input: CreateViewTokenInput): void {
      insertStmt.run(input.token, input.userId, input.viewType, input.viewId, input.expiresAt);
    },

    // Unfiltered lookup — used by validate to disambiguate expired vs invalid.
    // (consumed_at is no longer checked; tokens are valid until expires_at.)
    lookupRaw(token: string): ViewTokenRow | null {
      const stmt = db.prepare(`SELECT * FROM view_tokens WHERE token = ?`);
      return (stmt.get(token) as ViewTokenRow | undefined) ?? null;
    },
  };
}
