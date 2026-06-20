import type { DB } from '../../db/connection.js';
import { createRateLimit } from './bucket.js';
import { Errors } from '../../errors.js';

/**
 * IP-keyed rate limit for /v1/auth/register.
 *
 * Limit: 5 requests / hour / IP. Kills via `RATE_LIMIT_ENABLED=false` env var.
 * NOTE: kill switch semantics are `=== 'false'` (fail-CLOSED) to MATCH the
 * existing rate-limit/middleware.ts. Both now require the literal string "false"
 * to disable — any other value (unset, "0", "no", "off") keeps the limiter ON.
 *
 * Bucket key format: `ip:<clientIp>` (matches the legacy shim convention).
 */
export const REGISTER_IP_WINDOW_SECONDS = 3600;
export const REGISTER_IP_LIMIT_PER_HOUR = 5;

export function createRegisterIpRateLimiter(db: DB) {
  const rl = createRateLimit(db);
  return {
    /**
     * Returns true if allowed; throws Errors.rateLimited if denied.
     * Returns true unconditionally if the kill switch is engaged.
     */
    checkOrThrow(clientIp: string): true {
      if (process.env.RATE_LIMIT_ENABLED === 'false') return true;
      const result = rl.check(`ip:${clientIp}`, [{
        windowSeconds: REGISTER_IP_WINDOW_SECONDS,
        limit: REGISTER_IP_LIMIT_PER_HOUR,
      }]);
      if (!result.allowed) throw Errors.rateLimited('IP register rate limit exceeded');
      return true;
    },
    /**
     * Read-only check (does NOT throw, does NOT increment).
     * Useful for tests + monitoring.
     */
    isEnabled(): boolean {
      return process.env.RATE_LIMIT_ENABLED !== 'false';
    },
  };
}