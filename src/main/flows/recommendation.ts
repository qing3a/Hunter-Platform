// src/main/flows/recommendation.ts
import type { RecStatus } from '../../shared/types.js';
import { defineFlow, type Flow, type SideEffect } from './types.js';

/**
 * Recommendation state machine — replaces src/main/modules/unlock/state-machine.ts.
 *
 * Same transitions as the original TRANSITIONS table (Bug 2/3 fix preserved):
 *   pending → employer_interested, rejected_employer, withdrawn
 *   employer_interested → candidate_approved, rejected_candidate, rejected_employer
 *   candidate_approved → unlocked, rejected_candidate
 *   unlocked → placed
 *   rejected_employer / rejected_candidate / withdrawn / placed: terminal
 *
 * Side effects (webhooks) match what the handlers currently enqueue inline.
 */

export type RecEvent =
  | 'express_interest'      // employer → employer_interested
  | 'reject_employer'        // employer → rejected_employer
  | 'withdraw'               // headhunter → withdrawn
  | 'approve_unlock'         // candidate → candidate_approved
  | 'reject_candidate'       // candidate → rejected_candidate
  | 'unlock'                 // employer → unlocked
  | 'place';                 // employer → placed (post-success)

export const REC_TERMINAL_STATUSES = new Set<RecStatus>([
  'rejected_employer', 'rejected_candidate', 'withdrawn', 'placed',
]);

/** Side-effect builders, keyed by 'from->to'. Return null or a SideEffect. */
export const REC_SIDE_EFFECTS: { [k: string]: (ctx: any) => SideEffect | null } = {
  'pending->employer_interested': (ctx) => ({
    kind: 'webhook',
    target_user_id: ctx.candidate_user_id,
    event_type: 'notify_unlock_request',
  }),
  'employer_interested->candidate_approved': (ctx) => ({
    kind: 'webhook',
    target_user_id: ctx.employer_id,
    event_type: 'notify_unlock_approved',
  }),
  'candidate_approved->unlocked': (ctx) => ({
    kind: 'webhook',
    target_user_id: ctx.employer_id,
    event_type: 'deliver_contact',
    contains_pii: 1,
  }),
  // Terminal transitions intentionally have no side effect: the handler
  // already wrote an action_history row (or will, via the next business
  // step like placement creation).
};

export const recFlow: Flow<RecStatus, RecEvent> = defineFlow({
  initial: 'pending',
  states: {
    pending: {
      express_interest: 'employer_interested',
      reject_employer: 'rejected_employer',
      withdraw: 'withdrawn',
    },
    employer_interested: {
      approve_unlock: 'candidate_approved',
      reject_candidate: 'rejected_candidate',
      reject_employer: 'rejected_employer',
    },
    candidate_approved: {
      unlock: 'unlocked',
      reject_candidate: 'rejected_candidate',
    },
    unlocked: {
      place: 'placed',
    },
    rejected_employer: {},
    rejected_candidate: {},
    withdrawn: {},
    placed: {},
  },
  sideEffects: REC_SIDE_EFFECTS,
});