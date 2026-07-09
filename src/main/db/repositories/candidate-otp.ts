import type { DB } from '../connection.js';

export interface OtpRow {
  id: number;
  email: string;
  code_hash: string;
  attempts: number;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

export interface OtpInsert {
  email: string;
  code_hash: string;
  expires_at: number;
}

export function createCandidateOtpRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO candidate_otp_codes (email, code_hash, expires_at)
    VALUES (?, ?, ?)
  `);
  const findActiveStmt = db.prepare(`
    SELECT * FROM candidate_otp_codes
    WHERE email = ? AND consumed_at IS NULL AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1
  `);
  const incrementAttemptsStmt = db.prepare(`
    UPDATE candidate_otp_codes SET attempts = attempts + 1 WHERE id = ?
  `);
  const markConsumedStmt = db.prepare(`
    UPDATE candidate_otp_codes SET consumed_at = ? WHERE id = ?
  `);
  const deleteByEmailStmt = db.prepare(`
    DELETE FROM candidate_otp_codes WHERE email = ?
  `);

  return {
    insert(input: OtpInsert): number {
      const result = insertStmt.run(input.email, input.code_hash, input.expires_at);
      return Number(result.lastInsertRowid);
    },
    findActive(email: string, now: number = Date.now()): OtpRow | null {
      const row = findActiveStmt.get(email, now) as OtpRow | undefined;
      return row ?? null;
    },
    incrementAttempts(id: number): void {
      incrementAttemptsStmt.run(id);
    },
    markConsumed(id: number, consumedAt: number = Date.now()): void {
      markConsumedStmt.run(consumedAt, id);
    },
    deleteByEmail(email: string): number {
      return Number(deleteByEmailStmt.run(email).changes);
    },
  };
}
