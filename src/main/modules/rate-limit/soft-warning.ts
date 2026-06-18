import { RATE_LIMIT_SOFT_WARN_RATIO } from '../../../shared/constants.js';

const WINDOW_NAME: Record<number, string> = {
  1: 'second',
  60: 'minute',
  3600: 'hour',
};

/** True when remaining / limit < threshold (default 0.20). Boundary: exactly 20% is NOT triggered. */
export function shouldWarn(remaining: number, limit: number, ratio = RATE_LIMIT_SOFT_WARN_RATIO): boolean {
  if (limit <= 0) return false;
  return remaining / limit < ratio;
}

export interface WarningWindowState {
  windowSeconds: number;
  remaining: number;
  limit: number;
}

/**
 * Build a human-readable warning message listing all windows currently above the soft-warn
 * threshold. Format: `approaching-limit: <name> window at <pct>%, <name> window at <pct>%`
 * Returns empty string when no window triggers.
 */
export function buildWarningMessage(
  windows: WarningWindowState[],
  ratio = RATE_LIMIT_SOFT_WARN_RATIO,
): string {
  const triggered = windows
    .filter(w => shouldWarn(w.remaining, w.limit, ratio))
    .map(w => {
      const used = 1 - w.remaining / w.limit;
      const name = WINDOW_NAME[w.windowSeconds] ?? `${w.windowSeconds}s`;
      return `${name} window at ${Math.round(used * 100)}%`;
    });
  return triggered.length === 0 ? '' : `approaching-limit: ${triggered.join(', ')}`;
}
