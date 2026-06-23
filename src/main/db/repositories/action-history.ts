import type { DB } from '../connection.js';

export interface ActionHistoryEntry {
  id: number;
  user_id: string;
  capability_name: string;
  target_type: string | null;
  target_id: string | null;
  request_summary_json: string | null;
  response_summary_json: string | null;
  status: 'success' | 'error';
  error_code: string | null;
  duration_ms: number | null;
  /** W3C trace_id (32-char hex) of the request that caused this action. NULL for pre-v011 rows. */
  trace_id: string | null;
  created_at: string;
}

/**
 * Filter for admin action_history queries. All fields optional; missing
 * fields are omitted from the SQL WHERE clause.
 */
export interface ActionHistoryListFilter {
  user_id?: string;
  capability_name?: string;
  status?: 'success' | 'error';
  since?: string;  // ISO 8601 inclusive lower bound
  until?: string;  // ISO 8601 inclusive upper bound
  limit?: number;  // default 100, max 1000 (validated in route)
  offset?: number; // default 0
}

export function createActionHistoryRepo(db: DB) {
  /**
   * Build dynamic WHERE clause + bound params for admin list queries.
   * Each defined filter is AND-joined; missing filters are omitted.
   */
  function buildWhere(filter: ActionHistoryListFilter): { sql: string; params: Array<string | number> } {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.user_id)         { where.push('user_id = ?');         params.push(filter.user_id); }
    if (filter.capability_name) { where.push('capability_name = ?'); params.push(filter.capability_name); }
    if (filter.status)          { where.push('status = ?');          params.push(filter.status); }
    if (filter.since)           { where.push('created_at >= ?');     params.push(filter.since); }
    if (filter.until)           { where.push('created_at <= ?');     params.push(filter.until); }
    return { sql: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
  }

  const listByUserStmt = db.prepare(
    'SELECT * FROM action_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  );
  // Variant with `since` (ISO 8601) filter for /v1/users/:id/history.
  const listByUserSinceStmt = db.prepare(
    'SELECT * FROM action_history WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  );
  const countByUserStmt = db.prepare(
    'SELECT COUNT(*) as cnt FROM action_history WHERE user_id = ?'
  );
  const insertStmt = db.prepare(`
    INSERT INTO action_history (
      user_id, capability_name, target_type, target_id,
      request_summary_json, response_summary_json,
      status, error_code, duration_ms, trace_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return {
    insert(entry: Omit<ActionHistoryEntry, 'id'>): number {
      const result = insertStmt.run(
        entry.user_id, entry.capability_name,
        entry.target_type ?? null, entry.target_id ?? null,
        entry.request_summary_json ?? null, entry.response_summary_json ?? null,
        entry.status, entry.error_code ?? null, entry.duration_ms ?? null,
        entry.trace_id ?? null,
        entry.created_at,
      );
      return Number(result.lastInsertRowid);
    },
    listByUser(userId: string, opts: { limit?: number; offset?: number } = {}): ActionHistoryEntry[] {
      return listByUserStmt.all(userId, opts.limit ?? 50, opts.offset ?? 0) as unknown as ActionHistoryEntry[];
    },
    /**
     * List action history for a user, optionally filtered to entries newer
     * than `since` (ISO 8601 string). Used by GET /v1/users/:id/history.
     */
    listByUserSince(
      userId: string,
      opts: { limit?: number; offset?: number; since?: string } = {},
    ): ActionHistoryEntry[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.since) {
        return listByUserSinceStmt.all(userId, opts.since, limit, offset) as unknown as ActionHistoryEntry[];
      }
      return listByUserStmt.all(userId, limit, offset) as unknown as ActionHistoryEntry[];
    },
    countByUser(userId: string): number {
      return (countByUserStmt.get(userId) as { cnt: number }).cnt;
    },
    /**
     * List action_history rows with optional filters. Returns rows + total
     * count (for pagination). Sorted by created_at DESC (newest first).
     *
     * Used by GET /v1/admin/action-history. The route layer is responsible
     * for validating limit ∈ [1, 1000] and offset ≥ 0 before calling.
     */
    list(filter: ActionHistoryListFilter): { rows: ActionHistoryEntry[]; total: number } {
      const { sql: whereSql, params } = buildWhere(filter);
      const limit = filter.limit ?? 100;
      const offset = filter.offset ?? 0;
      const total = (db.prepare(
        `SELECT COUNT(*) AS c FROM action_history${whereSql}`
      ).get(...params) as { c: number }).c;
      const rows = db.prepare(
        `SELECT * FROM action_history${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      ).all(...params, limit, offset) as unknown as ActionHistoryEntry[];
      return { rows, total };
    },
  };
}
