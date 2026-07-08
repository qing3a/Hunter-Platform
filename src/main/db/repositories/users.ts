import type { DB } from '../connection.js';
import type { User } from '../../../shared/types.js';
import bcrypt from 'bcryptjs';

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

  // Candidate Portal: look up a candidate by their login email (stored in `contact`).
  // The users table has no dedicated `email` column — `contact` is the only free-form
  // field. v008 made `contact` nullable and removed the column-level UNIQUE
  // constraint (uniqueness is now enforced in app code in the register handler).
  const findCandidateByEmailStmt = db.prepare(
    "SELECT * FROM users WHERE contact = ? AND user_type = 'candidate' AND status = 'active' LIMIT 1"
  );

  // Hunter Portal (Phase 3a / Task 11): lookup a headhunter by the email they
  // typed into the OTP login screen. Same `contact` column, different user_type.
  const findHeadhunterByEmailStmt = db.prepare(
    "SELECT * FROM users WHERE contact = ? AND user_type = 'headhunter' AND status = 'active' LIMIT 1"
  );

  // Candidate Portal: update only the api_key_hash + api_key_prefix columns
  // (and updated_at). Used by the OTP flow to issue a fresh API key on first
  // login after the candidate row is created with empty api_key values.
  const setApiKeyStmt = db.prepare(
    'UPDATE users SET api_key_hash = ?, api_key_prefix = ?, updated_at = ? WHERE id = ?'
  );

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
    findCandidateByEmail(email: string): User | null {
      const row = findCandidateByEmailStmt.get(email) as User | undefined;
      return row ?? null;
    },
    findHeadhunterByEmail(email: string): User | null {
      const row = findHeadhunterByEmailStmt.get(email) as User | undefined;
      return row ?? null;
    },
    createCandidate(id: string, email: string): void {
      const now = new Date().toISOString();
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      // name: 临时使用 email 的 local-part (@ 之前); 后续 profile-completion 时会让用户填写真实姓名
      // contact: OTP 邮箱作为唯一身份字段
      // api_key_hash/prefix: 临时占位 (用 id 作为 dummy unique 值, 稍后 setApiKey 覆盖)
      //                       api_key_hash 是 UNIQUE NOT NULL, 不能为 NULL 或空字符串
      const placeholderHash = `placeholder_${id}`;
      const placeholderPrefix = 'pending';
      insertStmt.run({
        id,
        user_type: 'candidate',
        name: email.split('@')[0] || email,
        contact: email,
        agent_endpoint: null,
        api_key_hash: placeholderHash,
        api_key_prefix: placeholderPrefix,
        api_key_expires_at: null,
        prev_api_key_hash: null,
        prev_api_key_prefix: null,
        prev_api_key_expires_at: null,
        quota_per_day: 50,        // 候选人配额 (QUOTA_PER_DAY.candidate)
        quota_used: 0,
        quota_reset_at: tomorrow,
        reputation: 50,
        status: 'active',
        created_at: now,
        updated_at: now,
      } as unknown as Record<string, import('node:sqlite').SQLInputValue>);
    },
    createHeadhunter(id: string, email: string): void {
      const now = new Date().toISOString();
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      // Mirrors createCandidate() but writes user_type='headhunter' and uses
      // the headhunter quota (200/day per QUOTA_PER_DAY.headhunter). Email
      // becomes the contact field; the real display name will be filled in
      // when the hunter completes their workspace profile.
      const placeholderHash = `placeholder_${id}`;
      const placeholderPrefix = 'pending';
      insertStmt.run({
        id,
        user_type: 'headhunter',
        name: email.split('@')[0] || email,
        contact: email,
        agent_endpoint: null,
        api_key_hash: placeholderHash,
        api_key_prefix: placeholderPrefix,
        api_key_expires_at: null,
        prev_api_key_hash: null,
        prev_api_key_prefix: null,
        prev_api_key_expires_at: null,
        quota_per_day: 200,       // 猎头配额 (QUOTA_PER_DAY.headhunter)
        quota_used: 0,
        quota_reset_at: tomorrow,
        reputation: 50,
        status: 'active',
        created_at: now,
        updated_at: now,
      } as unknown as Record<string, import('node:sqlite').SQLInputValue>);
    },
    setApiKey(userId: string, apiKey: string): void {
      const prefix = apiKey.slice(0, 12);
      const hash = bcrypt.hashSync(apiKey, 4);
      setApiKeyStmt.run(hash, prefix, new Date().toISOString(), userId);
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
