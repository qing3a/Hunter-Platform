import { describe, it, expect } from 'vitest';

describe('unlock state machine (legacy shim)', () => {
  it('allows valid transitions', async () => {
    const { canTransition, assertTransition, REC_TERMINAL_STATUSES } = await import('../../../src/main/modules/unlock/state-machine');
    expect(canTransition('pending', 'employer_interested')).toBe(true);
    expect(canTransition('employer_interested', 'candidate_approved')).toBe(true);
    expect(canTransition('candidate_approved', 'unlocked')).toBe(true);
    expect(canTransition('unlocked', 'placed')).toBe(true);
    expect(REC_TERMINAL_STATUSES.has('rejected_employer')).toBe(true);
  });

  it('rejects illegal transitions', async () => {
    const { assertTransition } = await import('../../../src/main/modules/unlock/state-machine');
    expect(() => assertTransition('pending', 'unlocked')).toThrow();
    expect(() => assertTransition('unlocked', 'pending')).toThrow();
    expect(() => assertTransition('rejected_employer', 'pending')).toThrow();
  });

  it('allows withdrawal only from pending', async () => {
    const { canTransition } = await import('../../../src/main/modules/unlock/state-machine');
    expect(canTransition('pending', 'withdrawn')).toBe(true);
    expect(canTransition('employer_interested', 'withdrawn')).toBe(false);
  });
});
