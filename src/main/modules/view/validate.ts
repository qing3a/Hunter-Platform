import type { createViewTokenRepo } from './view-token-repo.js';
import type { ViewType } from './generate.js';

export type ValidateFailureReason = 'invalid' | 'expired' | 'consumed' | 'type_mismatch';

export type ValidateResult =
  | { ok: true; resourceId: string; userId: string }
  | { ok: false; reason: ValidateFailureReason };

export function validateAndConsume(
  repo: ReturnType<typeof createViewTokenRepo>,
  token: string,
  expectedViewType: ViewType,
): ValidateResult {
  // findValid already filters: consumed_at IS NULL AND expires_at > now
  // We need to distinguish 'invalid' / 'expired' / 'consumed' / 'type_mismatch',
  // so we use a raw unfiltered lookup and check status explicitly.
  const raw = repo.lookupRaw(token);
  if (!raw) {
    // No row at all (truly invalid)
    return { ok: false, reason: 'invalid' };
  }
  if (raw.consumed_at !== null) {
    return { ok: false, reason: 'consumed' };
  }
  if (new Date(raw.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (raw.view_type !== expectedViewType) {
    return { ok: false, reason: 'type_mismatch' };
  }
  // All good — atomically consume
  const consumed = repo.markConsumed(token, new Date().toISOString());
  if (!consumed) {
    // Lost the race to another concurrent request
    return { ok: false, reason: 'consumed' };
  }
  return { ok: true, resourceId: raw.view_id, userId: raw.user_id };
}