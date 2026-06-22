// tests/unit/flows/user.test.ts
import { describe, it, expect } from 'vitest';
import { userFlow, USER_TERMINAL_STATUSES } from '../../../src/main/flows/user';

describe('user flow', () => {
  it('active → suspended (admin action)', () => {
    expect(userFlow.states.active?.suspend).toBe('suspended');
  });

  it('suspended → active (admin action: unsuspend)', () => {
    expect(userFlow.states.suspended?.unsuspend).toBe('active');
  });

  it('suspended → deleted (admin action: GDPR delete)', () => {
    expect(userFlow.states.suspended?.delete).toBe('deleted');
  });

  it('active → deleted is NOT allowed (must suspend first to trigger GDPR flow)', () => {
    expect(userFlow.states.active?.delete).toBeUndefined();
  });

  it('deleted: terminal (no transitions out)', () => {
    expect(userFlow.states.deleted).toEqual({});
  });

  it('exports the 1 terminal status (deleted)', () => {
    expect(USER_TERMINAL_STATUSES.size).toBe(1);
    expect(USER_TERMINAL_STATUSES.has('deleted')).toBe(true);
  });

  it('suspend side effect writes an admin_action_log row', () => {
    const fx = userFlow.sideEffects!['active->suspended']({
      actor: 'admin_1',
      reason: 'spam',
    } as any);
    expect(fx).toEqual({
      kind: 'admin_action_log',
      action_type: 'admin.suspend_user',
      target_id: undefined, // set by handler before calling
      reason: 'spam',
    });
  });
});