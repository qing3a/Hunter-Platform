import { describe, it, expect, beforeEach } from 'vitest';
import { getSession, setSession, clearSession, getRole } from '../candidate-session';

describe('candidate-session', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null role when no session', () => {
    expect(getRole()).toBeNull();
  });

  it('returns the role when set', () => {
    setSession({ api_key: 'hp_live_abc', user_id: 'u1', profile_complete: true, role: 'headhunter' });
    expect(getRole()).toBe('headhunter');
  });

  it('returns undefined role for legacy candidate sessions without role', () => {
    setSession({ api_key: 'hp_live_abc', user_id: 'u1', profile_complete: true });
    expect(getRole()).toBeUndefined();
  });

  it('clearSession removes the session', () => {
    setSession({ api_key: 'hp_live_abc', user_id: 'u1', profile_complete: true });
    clearSession();
    expect(getSession()).toBeNull();
    expect(getRole()).toBeNull();
  });
});
