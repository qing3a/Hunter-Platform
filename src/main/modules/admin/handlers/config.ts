import type { DB } from '../../../db/connection.js';
import { createAdminActionLogRepo } from '../../../db/repositories/admin-action-log.js';

export type ConfigEntry = {
  key: string;
  value: unknown;
  updated_at: string;
  updated_by_admin_user_id: string | null;
};

const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

export function createAdminConfigHandler(db: DB) {
  const adminLog = createAdminActionLogRepo(db);
  return {
    list(): ConfigEntry[] {
      const rows = db.prepare(
        'SELECT key, value_json, updated_at, updated_by_admin_user_id FROM config ORDER BY key'
      ).all() as Array<{ key: string; value_json: string; updated_at: string; updated_by_admin_user_id: string | null }>;
      return rows.map(r => ({
        key: r.key,
        value: JSON.parse(r.value_json),
        updated_at: r.updated_at,
        updated_by_admin_user_id: r.updated_by_admin_user_id,
      }));
    },

    set(adminUserId: string, key: string, value: unknown): ConfigEntry {
      if (!KEY_RE.test(key)) {
        throw new Error('Invalid config key format: must be lowercase.dotted.path (e.g. platform.fee.pct)');
      }
      const valueJson = JSON.stringify(value);
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO config (key, value_json, updated_at, updated_by_admin_user_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at,
          updated_by_admin_user_id = excluded.updated_by_admin_user_id
      `).run(key, valueJson, now, adminUserId);
      adminLog.insert({
        admin_user_id: adminUserId,
        action: 'update_config',
        target_type: 'config',
        target_id: key,
        details_json: JSON.stringify({ value }),
      });
      return { key, value, updated_at: now, updated_by_admin_user_id: adminUserId };
    },
  };
}
