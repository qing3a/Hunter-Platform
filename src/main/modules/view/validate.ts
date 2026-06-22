import type { createViewTokenRepo } from './view-token-repo.js';
import type { ViewType } from './generate.js';

export type ValidateFailureReason = 'invalid' | 'expired' | 'type_mismatch';

export type ValidateResult =
  | { ok: true; resourceId: string; userId: string }
  | { ok: false; reason: ValidateFailureReason };

/**
 * Validate a view token. Multi-use within the TTL window (changed from
 * one-time-use: tokens are now valid for N accesses until they expire).
 * Returns the resourceId (the view target) and userId (the resource owner)
 * on success.
 */
export function validate(
  repo: ReturnType<typeof createViewTokenRepo>,
  token: string,
  expectedViewType: ViewType,
): ValidateResult {
  const raw = repo.lookupRaw(token);
  if (!raw) {
    return { ok: false, reason: 'invalid' };
  }
  if (new Date(raw.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (raw.view_type !== expectedViewType) {
    return { ok: false, reason: 'type_mismatch' };
  }
  // Multi-use: do not mark consumed. Token stays valid until expires_at.
  return { ok: true, resourceId: raw.view_id, userId: raw.user_id };
}
