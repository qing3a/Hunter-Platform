// tests/unit/flows/recommendation.test.ts
import { describe, it, expect } from 'vitest';
import { recFlow, REC_TERMINAL_STATUSES, REC_SIDE_EFFECTS } from '../../../src/main/flows/recommendation';

describe('recommendation flow', () => {
  it('matches the existing TRANSITIONS table (regression: same as modules/unlock/state-machine.ts)', () => {
    // From pending
    expect(recFlow.states.pending?.express_interest).toBe('employer_interested');
    expect(recFlow.states.pending?.reject_employer).toBe('rejected_employer');
    expect(recFlow.states.pending?.withdraw).toBe('withdrawn');
    // From employer_interested
    expect(recFlow.states.employer_interested?.approve_unlock).toBe('candidate_approved');
    expect(recFlow.states.employer_interested?.reject_candidate).toBe('rejected_candidate');
    expect(recFlow.states.employer_interested?.reject_employer).toBe('rejected_employer');
    // From candidate_approved
    expect(recFlow.states.candidate_approved?.unlock).toBe('unlocked');
    expect(recFlow.states.candidate_approved?.reject_candidate).toBe('rejected_candidate');
    // From unlocked
    expect(recFlow.states.unlocked?.place).toBe('placed');
    // Terminals
    expect(recFlow.states.rejected_employer).toEqual({});
    expect(recFlow.states.rejected_candidate).toEqual({});
    expect(recFlow.states.withdrawn).toEqual({});
    expect(recFlow.states.placed).toEqual({});
  });

  it('exports the 4 terminal status set', () => {
    expect(REC_TERMINAL_STATUSES.size).toBe(4);
    expect(REC_TERMINAL_STATUSES.has('rejected_employer')).toBe(true);
    expect(REC_TERMINAL_STATUSES.has('rejected_candidate')).toBe(true);
    expect(REC_TERMINAL_STATUSES.has('withdrawn')).toBe(true);
    expect(REC_TERMINAL_STATUSES.has('placed')).toBe(true);
  });

  it('express_interest side effect enqueues notify_unlock_request webhook', () => {
    const eff = REC_SIDE_EFFECTS['pending->employer_interested']({
      employer_id: 'e1',
      candidate_user_id: 'c1',
      recommendation_id: 'r1',
    } as any);
    expect(eff).toEqual({
      kind: 'webhook',
      target_user_id: 'c1',
      event_type: 'notify_unlock_request',
    });
  });

  it('approve_unlock side effect enqueues notify_unlock_approved to employer', () => {
    const eff = REC_SIDE_EFFECTS['employer_interested->candidate_approved']({
      employer_id: 'e1',
    } as any);
    expect(eff).toEqual({
      kind: 'webhook',
      target_user_id: 'e1',
      event_type: 'notify_unlock_approved',
    });
  });

  it('unlock side effect enqueues deliver_contact to employer (contains PII)', () => {
    const eff = REC_SIDE_EFFECTS['candidate_approved->unlocked']({
      employer_id: 'e1',
    } as any);
    expect(eff).toEqual({
      kind: 'webhook',
      target_user_id: 'e1',
      event_type: 'deliver_contact',
      contains_pii: 1,
    });
  });

  it('terminal transitions have no side effects', () => {
    expect(REC_SIDE_EFFECTS['pending->withdrawn']).toBeUndefined();
    expect(REC_SIDE_EFFECTS['pending->rejected_employer']).toBeUndefined();
    expect(REC_SIDE_EFFECTS['unlocked->placed']).toBeUndefined();
  });
});