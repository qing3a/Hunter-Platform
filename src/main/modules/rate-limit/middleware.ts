import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { RATE_LIMIT_BURSTS, RATE_LIMIT_ALGO_VERSION, RATE_LIMIT_SOFT_WARN_RATIO } from '../../../shared/constants.js';
import { slidingWindowCheck } from './sliding-window.js';
import { applyRateLimitHeaders } from './headers.js';
import { shouldWarn, buildWarningMessage } from './soft-warning.js';
import { createConfigCache, type ConfigCache } from '../config-cache.js';

const WINDOWS: { seconds: 1 | 60 | 3600; key: 'second' | 'minute' | 'hour' }[] = [
  { seconds: 1,    key: 'second' },
  { seconds: 60,   key: 'minute' },
  { seconds: 3600, key: 'hour'   },
];

/**
 * Express middleware that enforces per-user rate limits using the sliding-window-counter
 * algorithm and emits IETF `RateLimit-*` headers on every response.
 *
 * Sub-F: per-tier limits are read from config table via a lazy 10s in-memory cache
 * (key: rate_limit.tier.<user_type>.limit_per_<window>). Falls back to
 * RATE_LIMIT_BURSTS hardcoded values on miss or DB error.
 *
 * MUST be mounted AFTER `authMiddleware` so `req.user` is populated.
 */
export function createRateLimitMiddleware(db: DB, cache: ConfigCache): RequestHandler {
  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Kill switch (env: RATE_LIMIT_ENABLED=false) — disables all per-user sliding-window
    // rate limiting. For local dev / automated testing only. The header `X-RateLimit-Skip: 1`
    // also opts a single request out (handy for debugging without restarting).
    if (process.env.RATE_LIMIT_ENABLED === 'false' || req.headers['x-ratelimit-skip'] === '1') {
      // Even when enforcement is off, emit headers so agents can detect "no limit" mode.
      // Sentinel: Limit=-1 means "unlimited" (GitHub API convention).
      res.setHeader('RateLimit-Limit', '-1');
      res.setHeader('RateLimit-Remaining', '-1');
      res.setHeader('RateLimit-Reset', '0');
      res.setHeader('RateLimit-Policy', 'unlimited');
      next();
      return;
    }
    // Feature-flag: if algo is set to 1, skip entirely (fallback to old behavior)
    if (RATE_LIMIT_ALGO_VERSION !== 2) {
      next();
      return;
    }

    const user = (req as Request & { user?: User }).user;
    if (!user) {
      // Should never happen if mounted after authMiddleware; fail-safe
      res.status(500).json({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'rateLimitMiddleware: req.user missing' },
      });
      return;
    }

    // Sub-F: read per-tier limits from config table (10s cache), fall back to hardcoded
    const tier = user.user_type;
    const limits = {
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

    // FAIL-OPEN: if DB throws inside the window check, log and pass through.
    let results: ReturnType<typeof slidingWindowCheck>[];
    try {
      results = WINDOWS.map(w =>
        slidingWindowCheck(db, user.id, w.seconds, limits[w.key] as number),
      );
    } catch (err) {
      console.error('rate-limit DB error; failing open:', err);
      next();
      return;
    }

    const limitValues = WINDOWS.map(w => limits[w.key] as number);
    applyRateLimitHeaders(res, results, limitValues);

    // Soft warning: any window remaining < 20%?
    const warnStates = WINDOWS.map((w, i) => ({
      windowSeconds: w.seconds,
      remaining: results[i]!.remaining,
      limit: limits[w.key] as number,
    }));
    const triggered = warnStates.some(s => shouldWarn(s.remaining, s.limit, RATE_LIMIT_SOFT_WARN_RATIO));
    if (triggered) {
      const msg = buildWarningMessage(warnStates, RATE_LIMIT_SOFT_WARN_RATIO);
      if (msg) {
        res.setHeader('RateLimit-Policy', 'warn');
        res.setHeader('X-RateLimit-Warning', msg);
      }
    }

    // Denied?
    const denied = results.find(r => !r.allowed);
    if (denied) {
      const windowName = WINDOWS.find(w => w.seconds === denied.violatedWindowSeconds)?.key ?? 'hour';
      res.status(429).json({
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Burst rate limit exceeded',
          details: {
            violated_window: windowName,
            retry_after_seconds: denied.retryAfterSeconds,
          },
        },
      });
      return;
    }

    next();
  };
}
