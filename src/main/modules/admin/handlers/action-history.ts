// Created for /v1/admin/action-history endpoint (2026-06-23).
// Reads from action_history (business action audit log) — distinct from
// admin-handlers/audit.ts which reads from unlock_audit_log (4-step unlock flow).
import type { DB } from '../../../db/connection.js';
import {
  createActionHistoryRepo,
  type ActionHistoryListFilter,
  type ActionHistoryEntry,
} from '../../../db/repositories/action-history.js';

export function createAdminActionHistoryHandler(db: DB) {
  const repo = createActionHistoryRepo(db);
  return {
    list(filter: ActionHistoryListFilter): {
      rows: ActionHistoryEntry[];
      total: number;
    } {
      return repo.list(filter);
    },
  };
}
