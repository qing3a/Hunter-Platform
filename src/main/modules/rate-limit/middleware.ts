import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { RATE_LIMIT_BURSTS, RATE_LIMIT_ALGO_VERSION, RATE_LIMIT_SOFT_WARN_RATIO } from '../../../shared/constants.js';
import { slidingWindowCheck } from './sliding-window.js';
import { applyRateLimitHeaders } from './headers.js';
import { shouldWarn, buildWarningMessage } from './soft-warning.js';

const WINDOWS: { seconds: 1 | 60 | 3600; key: 'second' | 'minute' | 'hour' }[] = [
  { seconds: 1,    key: 'second' },
  { seconds: 60,   key: 'minute' },
  { seconds: 3600, key: 'hour'   },
];

/**
 * Express middleware that enforces per-user rate limits using the sliding-window-counter
 * algorithm and emits IETF `RateLimit-*` headers on every response.
 *
 * MUST be mounted AFTER `authMiddleware` so `req.user` is populated.
 */
export function createRateLimitMiddleware(db: DB): RequestHandler {
  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
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

    const limits = RATE_LIMIT_BURSTS[user.user_type];

    // FAIL-OPEN: if DB throws, log and pass through. Rate-limiter is auxiliary, not
    // business-critical — better to let 1 spammer through than block all users.
    let results: ReturnType<typeof slidingWindowCheck>[];
    try {
      results = WINDOWS.map(w =>
        slidingWindowCheck(db, user.id, w.seconds, limits[w.key]),
      );
    } catch (err) {
      console.error('rate-limit DB error; failing open:', err);
      next();
      return;
    }

    const limitValues = WINDOWS.map(w => limits[w.key]);
    applyRateLimitHeaders(res, results, limitValues);

    // Soft warning: any window remaining < 20%?
    const warnStates = WINDOWS.map((w, i) => ({
      windowSeconds: w.seconds,
      remaining: results[i]!.remaining,
      limit: limits[w.key],
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
