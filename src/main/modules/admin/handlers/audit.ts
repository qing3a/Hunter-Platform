// Migrated from src/main/ipc/audit.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createUnlockAuditLogRepo } from '../../../db/repositories/unlock-audit-log.js';

export function createAdminAuditHandler(db: DB) {
  const audit = createUnlockAuditLogRepo(db);
  return {
    list(filter: { actor_user_id?: string; recommendation_id?: string; limit?: number }): unknown[] {
      if (filter.recommendation_id) return audit.listByRecommendation(filter.recommendation_id);
      if (filter.actor_user_id) return audit.listByActor(filter.actor_user_id);
      return db.prepare(
        'SELECT * FROM unlock_audit_log ORDER BY created_at DESC LIMIT ?'
      ).all(filter.limit ?? 100) as unknown[];
    },
  };
}