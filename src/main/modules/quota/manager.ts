import type { DB } from '../../db/connection.js';

export type ConsumeResult =
  | { ok: true; quota_used: number; quota_per_day: number }
  | { ok: false; reason: 'INSUFFICIENT_QUOTA' | 'FORBIDDEN' | 'NOT_FOUND' };

export function createQuotaManager(db: DB) {
  // 单条 SQL 原子完成：状态检查 + 余量检查 + 扣减
  const consumeStmt = db.prepare(`
    UPDATE users
    SET quota_used = quota_used + ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'active'
      AND quota_used + ? <= quota_per_day
    RETURNING quota_used, quota_per_day
  `);

  return {
    tryConsume(userId: string, amount: number): ConsumeResult {
      const now = new Date().toISOString();
      const row = consumeStmt.get(amount, now, userId, amount) as
        | { quota_used: number; quota_per_day: number }
        | undefined;

      if (row) return { ok: true, quota_used: row.quota_used, quota_per_day: row.quota_per_day };

      // 区分失败原因
      const user = db.prepare('SELECT status FROM users WHERE id = ?').get(userId) as
        | { status: string }
        | undefined;
      if (!user) return { ok: false, reason: 'NOT_FOUND' };
      if (user.status !== 'active') return { ok: false, reason: 'FORBIDDEN' };
      return { ok: false, reason: 'INSUFFICIENT_QUOTA' };
    },

    resetDaily(userId: string, newResetAt: string): void {
      db.prepare(
        'UPDATE users SET quota_used = 0, quota_reset_at = ?, updated_at = ? WHERE id = ?'
      ).run(newResetAt, new Date().toISOString(), userId);
    },

    resetAllExpired(currentResetBefore: string): number {
      const result = db.prepare(
        "UPDATE users SET quota_used = 0, quota_reset_at = ?, updated_at = ? WHERE quota_reset_at <= ? AND status = 'active'"
      ).run(currentResetBefore, new Date().toISOString(), currentResetBefore);
      return Number(result.changes);
    },
  };
}
