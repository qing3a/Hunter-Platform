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
 * Candidate Portal Phase 1 extensions:
 *   pending_pickup → pending           (headhunter picks up the self-apply)
 *   pending_pickup → withdrawn         (candidate withdraws before pickup)
 *   pending_pickup → employer_interested is NOT allowed — pickup must come
 *     first so a headhunter owns the relationship. Direct interest-skip is
 *     reserved for headhunter-initiated recs.
 *   considering_offer is a NEW pre-employer-interested state; transitions to
 *     and from it are wired here so the same Flow guards everything.
 *
 * Side effects (webhooks) match what the handlers currently enqueue inline.
 */

export type RecEvent =
  | 'express_interest'      // employer → employer_interested
  | 'reject_employer'        // employer → rejected_employer
  | 'withdraw'               // headhunter OR candidate → withdrawn
  | 'pickup'                 // headhunter → pending (from pending_pickup)
  | 'consider_offer'         // candidate → considering_offer
  | 'accept_offer'           // candidate → candidate_approved
  | 'decline_offer'          // candidate → rejected_candidate
  | 'approve_unlock'         // candidate → candidate_approved (legacy path)
  | 'reject_candidate'       // candidate → rejected_candidate (legacy path)
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
  'pending_pickup->pending': (ctx) => ({
    // Notify the candidate that their application is now being handled.
    kind: 'webhook',
    target_user_id: ctx.candidate_user_id,
    event_type: 'application_picked_up',
  }),
  'employer_interested->candidate_approved': (ctx) => ({
    kind: 'webhook',
    target_user_id: ctx.employer_id,
    event_type: 'notify_unlock_approved',
  }),
  'employer_interested->considering_offer': (ctx) => ({
    // Candidate has acknowledged the offer and is reviewing it.
    kind: 'webhook',
    target_user_id: ctx.employer_id,
    event_type: 'application_under_review',
  }),
  'considering_offer->candidate_approved': (ctx) => ({
    kind: 'webhook',
    target_user_id: ctx.employer_id,
    event_type: 'notify_unlock_approved',
  }),
  'considering_offer->rejected_candidate': (ctx) => ({
    kind: 'webhook',
    target_user_id: ctx.employer_id,
    event_type: 'application_declined',
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

export const recFlow: Flow<RecStatus, RecEvent> = defineFlow<RecStatus, RecEvent>({
  initial: 'pending',
  states: {
    pending: {
      express_interest: 'employer_interested',
      reject_employer: 'rejected_employer',
      withdraw: 'withdrawn',
    },
    pending_pickup: {
      // Headhunter claims the self-applied application; this converts it to a
      // normal "pending" rec. We do NOT allow express_interest from here —
      // pickup must come first so a hunter owns the relationship.
      pickup: 'pending',
      withdraw: 'withdrawn',
    },
    employer_interested: {
      approve_unlock: 'candidate_approved',
      reject_candidate: 'rejected_candidate',
      reject_employer: 'rejected_employer',
      consider_offer: 'considering_offer',
    },
    considering_offer: {
      accept_offer: 'candidate_approved',
      decline_offer: 'rejected_candidate',
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