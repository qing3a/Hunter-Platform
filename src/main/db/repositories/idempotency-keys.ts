import type { DB } from '../connection.js';

export interface IdempotencyRecord {
  key: string;
  user_id: string;
  request_hash: string;
  response_json: string;
  status_code: number;
  expires_at: string;
  created_at: string;
}

export function createIdempotencyRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO idempotency_keys (key, user_id, request_hash, response_json, status_code, expires_at, created_at)
    VALUES (@key, @user_id, @request_hash, @response_json, @status_code, @expires_at, @created_at)
  `);
  const findStmt = db.prepare('SELECT * FROM idempotency_keys WHERE key = ?');

  return {
    insert(rec: IdempotencyRecord): void {
      insertStmt.run(rec as unknown as Record<string, import('node:sqlite').SQLInputValue>);
    },
    findByKey(key: string): IdempotencyRecord | undefined {
      return findStmt.get(key) as IdempotencyRecord | undefined;
    },
    cleanupExpired(): number {
      const r = db.prepare('DELETE FROM idempotency_keys WHERE expires_at < ?')
        .run(new Date().toISOString());
      return Number(r.changes);
    },
  };
}
