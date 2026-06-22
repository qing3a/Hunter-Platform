// Migrated from src/main/ipc/audit.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createUnlockAuditLogRepo } from '../../../db/repositories/unlock-audit-log.js';

export function createAdminAuditHandler(db: DB) {
  const audit = createUnlockAuditLogRepo(db);
  return {
    list(filter: { actor_user_id?: string; recommendation_id?: string; limit?: number }): Array<{
      id: number; recommendation_id: string | null; actor_user_id: string | null;
      action: string; ip_address: string | null; user_agent: string | null;
      created_at: string;
    }> {
      // Project only the AuditItemSchema fields.
      if (filter.recommendation_id) return audit.listByRecommendation(filter.recommendation_id) as any;
      if (filter.actor_user_id) return audit.listByActor(filter.actor_user_id) as any;
      return db.prepare(
        'SELECT id, recommendation_id, actor_user_id, action, ip_address, user_agent, created_at FROM unlock_audit_log ORDER BY created_at DESC LIMIT ?'
      ).all(filter.limit ?? 100) as any;
    },
  };
}