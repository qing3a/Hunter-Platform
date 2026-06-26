import type { DB } from '../../../db/connection.js';
import { createAdminActionLogRepo } from '../../../db/repositories/admin-action-log.js';
import { Errors } from '../../../errors.js';
import { RATE_LIMIT_BURSTS } from '../../../../shared/constants.js';
import { createConfigCache } from '../../config-cache.js';

export type ConfigEntry = {
  key: string;
  value: unknown;
  updated_at: string;
  updated_by_admin_user_id: string | null;
};

export type RateLimitsResponse = {
  tiers: Record<string, Record<string, number>>;
  windows: string[];
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

    set(adminUserId: string, key: string, value: unknown, reason: string): ConfigEntry {
      if (!KEY_RE.test(key)) {
        throw Errors.invalidParams('Invalid config key format: must be lowercase.dotted.path (e.g. platform.fee.pct)');
      }
      const trimmedReason = (typeof reason === 'string' ? reason : '').trim();
      if (trimmedReason.length < 3) {
        throw Errors.invalidParams('reason is required (>= 3 chars)');
      }
      if (trimmedReason.length > 500) {
        throw Errors.invalidParams('reason must be <= 500 chars');
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
        details_json: JSON.stringify({ value, reason: trimmedReason }),
      });
      return { key, value, updated_at: now, updated_by_admin_user_id: adminUserId };
    },

    // Sub-G: read all per-tier rate-limit thresholds from config (TTL=0, always fresh)
    async getRateLimits(): Promise<RateLimitsResponse> {
      const cache = createConfigCache(db);
      const tiers = ['candidate', 'headhunter', 'employer'] as const;
      const result: Record<string, Record<string, number>> = {};
      for (const tier of tiers) {
        result[tier] = {
          second: await cache.getOrDefault<number>(
            `rate_limit.tier.${tier}.limit_per_second`,
            () => RATE_LIMIT_BURSTS[tier].second,
          ),
          minute: await cache.getOrDefault<number>(
            `rate_limit.tier.${tier}.limit_per_minute`,
            () => RATE_LIMIT_BURSTS[tier].minute,
          ),
          hour: await cache.getOrDefault<number>(
            `rate_limit.tier.${tier}.limit_per_hour`,
            () => RATE_LIMIT_BURSTS[tier].hour,
          ),
        };
      }
      return { tiers: result, windows: ['second', 'minute', 'hour'] };
    },
  };
}
