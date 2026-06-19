import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createQuotaManager } from '../quota/manager.js';
import { Errors } from '../../errors.js';
import { randomBytes } from 'node:crypto';

/**
 * GDPR / data-subject erasure — soft delete for candidate accounts.
 *
 * Soft strategy (preserves statistical aggregates without keeping PII):
 *  - users.status = 'deleted', name = NULL, contact = NULL
 *  - api_key_hash → random 64-byte hex (bcrypt.compare will never match),
 *    api_key_prefix → 'deleted-', api_key_expires_at = NULL
 *    (status='deleted' already fails the auth middleware filter, but we
 *    also poison the hash for defense-in-depth in case status is later reset)
 *  - candidates_private PII fields → NULL
 *    (name_enc, phone_enc, email_enc, current_company_raw,
 *     current_title_raw, education_school)
 *  - candidates_anonymized — UNTOUCHED (industry, title_level, salary_range,
 *    education_tier are statistical dimensions needed for leaderboards /
 *    public-pool recommendations).
 *  - recommendations.status = 'withdrawn' (where anonymized_candidate_id
 *    belongs to this candidate's anonymized rows)
 *  - action_history — UNTOUCHED (audit log)
 *
 * Quota: 1 tryConsume (cost = 1).
 *
 * Idempotency: calling twice on an already-deleted user is a no-op
 * (returns ok) — the user shouldn't see a 404 just because they retried.
 */
export function createGdprHandler(db: DB) {
  const quota = createQuotaManager(db);

  /**
   * Sentinel hash written into api_key_hash so that even if status were
   * later flipped back, bcrypt.compareSync would fail (random 64-byte hex
   * can't collide with any real key).
   */
  function poisonedHash(): string {
    return randomBytes(32).toString('hex');
  }

  return {
    /**
     * Soft-delete the caller's data. Returns summary counts so the caller
     * (route handler) can include them in the response for transparency.
     */
    deleteMyData(user: User): {
      anonymized_rows_preserved: number;
      recommendations_withdrawn: number;
      private_pii_rows_cleared: number;
      deleted_at: string;
    } {
      if (user.user_type !== 'candidate') {
        throw Errors.forbidden('Only candidates can delete their own data');
      }

      // 配额 1
      const qResult = quota.tryConsume(user.id, 1);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      const now = new Date().toISOString();

      // Idempotency check: if already deleted, return summary (no-op).
      const fresh = db.prepare('SELECT status FROM users WHERE id = ?').get(user.id) as
        | { status: string }
        | undefined;
      if (!fresh) throw Errors.notFound('User not found');
      if (fresh.status === 'deleted') {
        return summarize(db, user.id, now);
      }

      db.exec('BEGIN');
      try {
        // 1. Wipe user PII + poison API key
        db.prepare(`
          UPDATE users
          SET status = 'deleted',
              name = NULL,
              contact = NULL,
              api_key_hash = ?,
              api_key_prefix = 'deleted-',
              api_key_expires_at = NULL,
              updated_at = ?
          WHERE id = ?
        `).run(poisonedHash(), now, user.id);

        // 2. Wipe candidates_private PII (keep the row + non-PII stats)
        const piiCleared = Number(db.prepare(`
          UPDATE candidates_private
          SET name_enc = NULL,
              phone_enc = NULL,
              email_enc = NULL,
              current_company_raw = NULL,
              current_title_raw = NULL,
              education_school = NULL,
              updated_at = ?
          WHERE candidate_user_id = ?
        `).run(now, user.id).changes);

        // 3. Withdraw recommendations owned by this candidate's anonymized rows
        // First find all anonymized ids belonging to this candidate
        const anonIds = db.prepare(`
          SELECT ca.id
          FROM candidates_anonymized ca
          JOIN candidates_private cp ON cp.id = ca.source_private_id
          WHERE cp.candidate_user_id = ?
        `).all(user.id) as { id: string }[];

        let recsWithdrawn = 0;
        if (anonIds.length > 0) {
          const placeholders = anonIds.map(() => '?').join(',');
          recsWithdrawn = Number(db.prepare(`
            UPDATE recommendations
            SET status = 'withdrawn', updated_at = ?
            WHERE anonymized_candidate_id IN (${placeholders})
              AND status NOT IN ('withdrawn', 'placed')
          `).run(now, ...anonIds.map(a => a.id)).changes);
        }

        db.exec('COMMIT');

        const summary = summarize(db, user.id, now);
        return {
          ...summary,
          // piiCleared is from this transaction (not re-queried), use it directly
          private_pii_rows_cleared: piiCleared,
          recommendations_withdrawn: recsWithdrawn,
        };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

function summarize(db: DB, userId: string, deletedAt: string) {
  const anonRows = (db.prepare(`
    SELECT COUNT(*) as cnt
    FROM candidates_anonymized ca
    JOIN candidates_private cp ON cp.id = ca.source_private_id
    WHERE cp.candidate_user_id = ?
  `).get(userId) as { cnt: number }).cnt;

  const recsWithdrawn = (db.prepare(`
    SELECT COUNT(*) as cnt
    FROM recommendations r
    JOIN candidates_anonymized ca ON ca.id = r.anonymized_candidate_id
    JOIN candidates_private cp ON cp.id = ca.source_private_id
    WHERE cp.candidate_user_id = ? AND r.status = 'withdrawn'
  `).get(userId) as { cnt: number }).cnt;

  return {
    anonymized_rows_preserved: anonRows,
    recommendations_withdrawn: recsWithdrawn,
    private_pii_rows_cleared: 0,  // filled in by caller (live transaction count)
    deleted_at: deletedAt,
  };
}