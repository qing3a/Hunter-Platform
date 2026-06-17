import type { DB } from '../connection.js';
import type { User } from '../../../shared/types.js';

export function createUsersRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO users (id, user_type, name, contact, agent_endpoint,
                       api_key_hash, api_key_prefix, quota_per_day, quota_used,
                       quota_reset_at, reputation, status, created_at, updated_at)
    VALUES (@id, @user_type, @name, @contact, @agent_endpoint,
            @api_key_hash, @api_key_prefix, @quota_per_day, @quota_used,
            @quota_reset_at, @reputation, @status, @created_at, @updated_at)
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
