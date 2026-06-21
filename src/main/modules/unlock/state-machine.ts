// DEPRECATED: this file is a backward-compat shim. The state machine now
// lives in src/main/flows/recommendation.ts. New code should import
// from there. This shim will be removed in v1.7 (Task 10).
//
// Re-exports the legacy assertTransition / canTransition / TERMINAL_STATUSES
// names so callers that haven't migrated yet still compile. Will be deleted
// once all handlers migrate (Task 10).
export {
  recFlow, REC_SIDE_EFFECTS, REC_TERMINAL_STATUSES,
} from '../../flows/recommendation.js';

import type { RecStatus } from '../../../shared/types.js';
import { recFlow } from '../../flows/recommendation.js';

// Legacy canTransition + assertTransition — kept here so the employer
// handler (Task 7) can keep compiling until it migrates. To be removed
// in Task 10 along with this file.
export function canTransition(from: RecStatus, to: RecStatus): boolean {
  const eventMap: Record<RecStatus, Partial<Record<RecStatus, string>>> = {
    pending: { employer_interested: 'express_interest', rejected_employer: 'reject_employer', withdrawn: 'withdraw' },
    employer_interested: { candidate_approved: 'approve_unlock', rejected_candidate: 'reject_candidate', rejected_employer: 'reject_employer' },
    candidate_approved: { unlocked: 'unlock', rejected_candidate: 'reject_candidate' },
    unlocked: { placed: 'place' },
    rejected_employer: {},
    rejected_candidate: {},
    withdrawn: {},
    placed: {},
  };
  const ev = eventMap[from]?.[to];
  if (!ev) return false;
  // recFlow.states[from] is typed as `{ [Ev in E]?: S } | undefined` — we cast for the legacy lookup.
  const fromState = recFlow.states[from] as Record<string, RecStatus | undefined> | undefined;
  return Boolean(fromState?.[ev]);
}

export function assertTransition(from: RecStatus, to: RecStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid state transition: ${from} -> ${to}`);
  }
}