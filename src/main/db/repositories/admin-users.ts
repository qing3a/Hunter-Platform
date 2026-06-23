import type { DB } from '../connection.js';

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  api_key_hash: string;
  api_key_prefix: string;
  role: 'admin' | 'super';
  status: 'active' | 'suspended';
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export function createAdminUsersRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix,
      role, status, last_login_at, created_at, updated_at)
    VALUES (@id, @name, @email, @password_hash, @api_key_hash, @api_key_prefix,
      @role, @status, NULL, @created_at, @updated_at)
  `);
  const findByEmailStmt = db.prepare('SELECT * FROM admin_users WHERE email = ?');
  const findByPrefixStmt = db.prepare('SELECT * FROM admin_users WHERE api_key_prefix = ?');
  const findByIdStmt = db.prepare('SELECT * FROM admin_users WHERE id = ?');
  const updateLastLoginStmt = db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?');
  const updateApiKeyStmt = db.prepare(
    'UPDATE admin_users SET api_key_hash = ?, api_key_prefix = ?, updated_at = ? WHERE id = ?'
  );
  const countStmt = db.prepare('SELECT COUNT(*) as cnt FROM admin_users');

  return {
    insert(row: Omit<AdminUserRow, 'last_login_at'>): void {
      insertStmt.run(row);
    },
    findByEmail(email: string): AdminUserRow | undefined {
      return findByEmailStmt.get(email) as AdminUserRow | undefined;
    },
    findByApiKeyPrefix(prefix: string): AdminUserRow | undefined {
      return findByPrefixStmt.get(prefix) as AdminUserRow | undefined;
    },
    findById(id: string): AdminUserRow | undefined {
      return findByIdStmt.get(id) as AdminUserRow | undefined;
    },
    updateLastLogin(id: string, ts: string): void {
      updateLastLoginStmt.run(ts, id);
    },
    updateApiKey(id: string, hash: string, prefix: string, ts: string): void {
      updateApiKeyStmt.run(hash, prefix, ts, id);
    },
    count(): number {
      return (countStmt.get() as { cnt: number }).cnt;
    },
  };
}
