import type { DB } from '../../../db/connection.js';
import { createAdminLoginEventsRepo, type AdminLoginEvent } from '../../../db/repositories/admin-login-events.js';

export function createAdminLoginEventsHandler(db: DB) {
  const repo = createAdminLoginEventsRepo(db);
  return {
    list(filter: { admin_user_id?: string; success?: 0 | 1; email?: string; from?: string; until?: string; limit?: number; offset?: number }): { rows: AdminLoginEvent[]; total: number } {
      return repo.list(filter);
    },
  };
}