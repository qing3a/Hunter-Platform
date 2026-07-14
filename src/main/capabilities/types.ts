import type { ZodTypeAny } from 'zod';
import { Errors } from '../errors.js';

/** Single capability — one declared endpoint. */
export interface Capability {
  /** Stable identifier (e.g. 'headhunter.recommend_candidate'). Used in
   *  logs, audit, x-capability-name response header, and capability:check
   *  tooling. */
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path with `:param` placeholders. Must match the actual router path. */
  path: string;
  /** Phase 1 zod response schema for this endpoint. Optional (some endpoints
   *  have dynamic shapes). */
  response_schema?: ZodTypeAny | undefined;
  /** Quota cost per invocation. 0 = free. Read from QUOTA_COSTS constants. */
  quota_cost: number;
  /** Strings of the form 'user.X === Y' or 'flow.<name>.<event>'. Evaluated
   *  by canInvoke; a flow.<name>.<event> precondition means: the
   *  transition must be legal in the named flow. */
  preconditions: string[];
  /** Human-readable side effect descriptions, used in skill.md and the
   *  capabilities endpoint. e.g. ['consume_quota(N)', 'webhook: <event>']. */
  effects: string[];
  /**
   * R1.C4 — alternate skill names from external clients (e.g. ow-recruit).
   * Lets a client that knows only its skill naming find the equivalent
   * hunter-platform capability via `findCapabilityByAlias()`. The alias is
   * NEVER advertised in the `/v1/capabilities` response (capabilities keep
   * the canonical `name` as the public contract) — it is private routing
   * metadata.
   */
  aliases?: readonly string[] | undefined;
}

export interface CapabilitySet {
  role: 'candidate' | 'hr' | 'pm' | 'pm' | 'admin' | 'auth';
  capabilities: Capability[];
}

export function defineCapabilitySet(spec: CapabilitySet): CapabilitySet {
  return spec;
}

/** Result of canInvoke: either ok or a failure with a reason that maps
 *  to a standard ApiError. */
export type CanInvokeResult =
  | { ok: true }
  | { ok: false; reason: 'INSUFFICIENT_QUOTA' | 'FORBIDDEN' | 'NOT_FOUND' };

/** User context for precondition + quota checks. */
export interface UserContext {
  status: 'active' | 'suspended' | 'deleted';
  quota_used: number;
  quota_per_day: number;
}

/**
 * Evaluate whether `user` can invoke `capability` right now. Pure function:
 * does not actually consume quota (the handler does that via
 * `quota.tryConsume`).
 *
 * Preconditions support a small subset of expressions:
 *   - 'user.status === "active"'   ← status check
 *   - 'flow.<name>.<event>'        ← state-machine check (resolved at
 *                                    handler level — we just record it)
 */
export function canInvoke(cap: Capability, user: UserContext): CanInvokeResult {
  // Quota check first (cheapest, most likely to fail)
  if (user.quota_used + cap.quota_cost > user.quota_per_day) {
    return { ok: false, reason: 'INSUFFICIENT_QUOTA' };
  }
  // Preconditions: evaluate the subset we support
  for (const pre of cap.preconditions) {
    const m = pre.match(/^user\.status\s*===\s*"(\w+)"$/);
    if (m) {
      if (user.status !== m[1]) return { ok: false, reason: 'FORBIDDEN' };
    }
    // flow.<name>.<event> is recorded as a precondition but evaluated
    // by the handler (it has the rec/job to test). canInvoke does NOT
    // call applyTransition.
  }
  return { ok: true };
}

/** Convert a canInvoke failure to the corresponding ApiError. */
export function canInvokeError(reason: Exclude<CanInvokeResult, { ok: true }>['reason']) {
  if (reason === 'INSUFFICIENT_QUOTA') return Errors.insufficientQuota();
  if (reason === 'FORBIDDEN') return Errors.forbidden('Capability not available for user in this state');
  return Errors.notFound('Capability not found');
}