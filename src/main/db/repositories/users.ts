import type { DB } from '../connection.js';
import type { User } from '../../../shared/types.js';

export function createUsersRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO users (id, user_type, name, contact, agent_endpoint,
                       api_key_hash, api_key_prefix, api_key_expires_at,
                       prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
                       quota_per_day, quota_used, quota_reset_at, reputation,
                       status, created_at, updated_at)
    VALUES (@id, @user_type, @name, @contact, @agent_endpoint,
            @api_key_hash, @api_key_prefix, @api_key_expires_at,
            @prev_api_key_hash, @prev_api_key_prefix, @prev_api_key_expires_at,
            @quota_per_day, @quota_used, @quota_reset_at, @reputation,
            @status, @created_at, @updated_at)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
  const findByHashStmt = db.prepare('SELECT * FROM users WHERE api_key_hash = ?');

  return {
    insert(user: User): void {
      // node:sqlite's run() expects a Record<string, SQLInputValue>; cast through
      // unknown to bridge the User interface (no string index signature) to the
      // expected shape. Safe because the named-param SQL only references the
      // fields actually present in User.
      insertStmt.run(user as unknown as Record<string, import('node:sqlite').SQLInputValue>);
    },
    findById(id: string): User | undefined {
      return findByIdStmt.get(id) as User | undefined;
    },
    findByApiKeyHash(hash: string): User | undefined {
      return findByHashStmt.get(hash) as User | undefined;
    },
  };
}

/**
 * Rotate the API key for a user.
 *
 * Strategy (atomic — single UPDATE):
 *  1. Copy CURRENT hash → prev_api_key_hash (with prev_api_key_expires_at = now + gracePeriodMs)
 *  2. Write the NEW hash to api_key_hash (api_key_expires_at = NULL)
 *  3. Bump updated_at
 *
 * Auth middleware accepts either the new key OR the old key during the grace window.
 * After grace expires, only the new key works.
 *
 * Returns the old-key expiry timestamp so the caller can echo it back.
 * Returns null if the user did not exist (no row updated).
 */
export function rotateApiKey(
  db: DB,
  userId: string,
  newHash: string,
  newPrefix: string,
  gracePeriodMs: number,
): { oldKeyExpiresAt: string; updatedAt: string } | null {
  const now = Date.now();
  const oldExpiresAt = new Date(now + gracePeriodMs).toISOString();
  const newUpdatedAt = new Date(now).toISOString();

  const result = db.prepare(`
    UPDATE users
    SET prev_api_key_hash = api_key_hash,
        prev_api_key_prefix = api_key_prefix,
        prev_api_key_expires_at = ?,
        api_key_hash = ?,
        api_key_prefix = ?,
        api_key_expires_at = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(oldExpiresAt, newHash, newPrefix, newUpdatedAt, userId);

  if (result.changes === 0) return null;
  return { oldKeyExpiresAt: oldExpiresAt, updatedAt: newUpdatedAt };
}