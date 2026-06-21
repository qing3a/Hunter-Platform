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
 *  1. Clear prev_api_key_* slot (NULL) so any grace slot from a prior rotate is wiped
 *  2. Overwrite api_key_hash + api_key_prefix with the new values (api_key_expires_at = NULL)
 *  3. Bump updated_at
 *
 * The old key is invalidated IMMEDIATELY — there is no grace period. This is a
 * deliberate security choice: if a key is compromised, rotation must stop the
 * attacker within the same request, not up to 24h later. The auth middleware's
 * prev_api_key_* branch still exists in the schema for forward compatibility
 * and to support migrations from earlier versions, but rotate no longer populates it.
 *
 * Returns null if the user did not exist (no row updated).
 */
export function rotateApiKey(
  db: DB,
  userId: string,
  newHash: string,
  newPrefix: string,
): { updatedAt: string } | null {
  const newUpdatedAt = new Date().toISOString();

  const result = db.prepare(`
    UPDATE users
    SET prev_api_key_hash = NULL,
        prev_api_key_prefix = NULL,
        prev_api_key_expires_at = NULL,
        api_key_hash = ?,
        api_key_prefix = ?,
        api_key_expires_at = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(newHash, newPrefix, newUpdatedAt, userId);

  if (result.changes === 0) return null;
  return { updatedAt: newUpdatedAt };
}