import { describe, it, expect } from 'vitest';
import { defineCapabilitySet, canInvoke } from '../../../src/main/capabilities/types';

const sampleSet = defineCapabilitySet({
  role: 'tester',
  capabilities: [
    {
      name: 'simple',
      description: 'No preconditions',
      method: 'GET',
      path: '/v1/test/ping',
      response_schema: undefined,
      quota_cost: 0,
      preconditions: [],
      effects: [],
    },
    {
      name: 'quota-3',
      description: 'Requires 3 quota',
      method: 'POST',
      path: '/v1/test/echo',
      response_schema: undefined,
      quota_cost: 3,
      preconditions: ['user.status === "active"'],
      effects: ['consume_quota(3)'],
    },
  ],
});

describe('canInvoke', () => {
  it('returns true when no preconditions and quota available', () => {
    expect(canInvoke(sampleSet.capabilities[0], { status: 'active', quota_used: 0, quota_per_day: 50 })).toEqual({ ok: true });
  });

  it('returns INSUFFICIENT_QUOTA when quota used + cost > quota_per_day', () => {
    const r = canInvoke(sampleSet.capabilities[1], { status: 'active', quota_used: 48, quota_per_day: 50 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('INSUFFICIENT_QUOTA');
  });

  it('returns FORBIDDEN when user.status !== required', () => {
    const r = canInvoke(sampleSet.capabilities[1], { status: 'suspended', quota_used: 0, quota_per_day: 50 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('FORBIDDEN');
  });

  it('returns true when status is active and quota available', () => {
    const r = canInvoke(sampleSet.capabilities[1], { status: 'active', quota_used: 0, quota_per_day: 50 });
    expect(r.ok).toBe(true);
  });
});