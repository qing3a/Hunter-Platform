import type { DB } from '../connection.js';

export type UnlockAuditAction =
  | 'express_interest' | 'approve_unlock' | 'reject_unlock'
  | 'unlock_delivery' | 'revoke_unlock';

export interface UnlockAuditEntry {
  id: number;
  recommendation_id: string;
  actor_user_id: string;
  action: UnlockAuditAction;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export function createUnlockAuditLogRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO unlock_audit_log (recommendation_id, actor_user_id, action, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const listByRecStmt = db.prepare(
    'SELECT * FROM unlock_audit_log WHERE recommendation_id = ? ORDER BY created_at ASC'
  );
  const listByActorStmt = db.prepare(
    'SELECT * FROM unlock_audit_log WHERE actor_user_id = ? ORDER BY created_at DESC'
  );

  return {
    insert(input: { recommendation_id: string; actor_user_id: string; action: UnlockAuditAction; ip_address: string | null; user_agent: string | null }): void {
      insertStmt.run(
        input.recommendation_id, input.actor_user_id, input.action,
        input.ip_address, input.user_agent, new Date().toISOString(),
      );
    },
    listByRecommendation(recId: string): UnlockAuditEntry[] {
      return listByRecStmt.all(recId) as unknown as UnlockAuditEntry[];
    },
    listByActor(actorId: string): UnlockAuditEntry[] {
      return listByActorStmt.all(actorId) as unknown as UnlockAuditEntry[];
    },
  };
}
