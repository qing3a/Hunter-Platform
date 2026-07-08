// tests/unit/candidate-portal/state-machine.test.ts
//
// Unit tests for the recFlow extensions added for the candidate self-apply
// flow (Task 8). These do NOT touch the DB — they exercise the Flow type
// directly via applyTransition to assert that the legal/illegal transitions
// are wired correctly.

import { describe, it, expect } from 'vitest';
import { applyTransition, recFlow, REC_SIDE_EFFECTS } from '../../../src/main/flows/index.js';

describe('recFlow with pending_pickup extension', () => {
  // -- pending_pickup transitions -------------------------------------------

  it('allows pending_pickup → pending (after hunter pickup)', () => {
    expect(() => applyTransition(recFlow, 'pending_pickup', 'pickup', {})).not.toThrow();
    const r = applyTransition(recFlow, 'pending_pickup', 'pickup', { candidate_user_id: 'c1' });
    expect(r.next).toBe('pending');
  });

  it('REJECTS pending_pickup → employer_interested (must go via pending first)', () => {
    expect(() => applyTransition(recFlow, 'pending_pickup', 'express_interest', {})).toThrow();
  });

  it('allows pending_pickup → withdrawn (candidate withdraw)', () => {
    expect(() => applyTransition(recFlow, 'pending_pickup', 'withdraw', {})).not.toThrow();
    const r = applyTransition(recFlow, 'pending_pickup', 'withdraw', {});
    expect(r.next).toBe('withdrawn');
  });

  // -- existing transitions still legal (regression guard) -----------------

  it('allows pending → employer_interested (existing)', () => {
    expect(() => applyTransition(recFlow, 'pending', 'express_interest', {})).not.toThrow();
  });

  // -- considering_offer transitions (offer response flow) ----------------

  it('allows employer_interested → considering_offer (candidate considers)', () => {
    const r = applyTransition(recFlow, 'employer_interested', 'consider_offer', { employer_id: 'e1' });
    expect(r.next).toBe('considering_offer');
  });

  it('allows considering_offer → candidate_approved (accept offer)', () => {
    const r = applyTransition(recFlow, 'considering_offer', 'accept_offer', { employer_id: 'e1' });
    expect(r.next).toBe('candidate_approved');
  });

  it('allows considering_offer → rejected_candidate (decline offer)', () => {
    const r = applyTransition(recFlow, 'considering_offer', 'decline_offer', { employer_id: 'e1' });
    expect(r.next).toBe('rejected_candidate');
  });

  it('REJECTS pending → pickup (no hunter before pending state)', () => {
    // pickup is only legal from pending_pickup
    expect(() => applyTransition(recFlow, 'pending', 'pickup', {})).toThrow();
  });

  // -- side effects --------------------------------------------------------

  it('pending_pickup→pending side effect notifies the candidate', () => {
    const eff = REC_SIDE_EFFECTS['pending_pickup->pending']({ candidate_user_id: 'c1' } as any);
    expect(eff).toEqual({
      kind: 'webhook',
      target_user_id: 'c1',
      event_type: 'application_picked_up',
    });
  });

  it('terminal transitions from pending_pickup have no side effects', () => {
    // Withdraw is terminal — the existing comment in the file says terminal
    // transitions intentionally have no declared side effect. Confirm.
    expect(REC_SIDE_EFFECTS['pending_pickup->withdrawn']).toBeUndefined();
  });
});
