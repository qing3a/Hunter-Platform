// Migrated from src/main/ipc/admin-log.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createAdminActionLogRepo } from '../../../db/repositories/admin-action-log.js';

export function createAdminAdminLogHandler(db: DB) {
  const log = createAdminActionLogRepo(db);
  return {
    list(filter: { admin_id?: string; target_type?: string; target_id?: string; limit?: number }): unknown[] {
      const opts: { limit?: number; offset?: number } = {};
      if (filter.limit !== undefined) opts.limit = filter.limit;
      if (filter.target_type && filter.target_id) {
        return log.listByTarget(filter.target_type, filter.target_id, opts);
      }
      if (filter.admin_id) {
        return log.listByAdmin(filter.admin_id, opts);
      }
      return log.listAll({ limit: filter.limit ?? 200 });
    },
  };
}