import { describe, it, expect } from 'vitest';
import { shouldWarn, buildWarningMessage } from '../../../src/main/modules/rate-limit/soft-warning';

describe('soft warning', () => {
  it('shouldWarn returns false when remaining / limit >= 0.20', () => {
    expect(shouldWarn(2, 10)).toBe(false);  // 20% exactly — boundary NOT triggered
    expect(shouldWarn(3, 10)).toBe(false);
    expect(shouldWarn(5, 10)).toBe(false);
  });

  it('shouldWarn returns true when remaining / limit < 0.20', () => {
    expect(shouldWarn(1, 10)).toBe(true);
    expect(shouldWarn(0, 10)).toBe(true);
    expect(shouldWarn(19, 100)).toBe(true);
  });

  it('shouldWarn handles limit=0 edge case (returns false, no division by zero)', () => {
    expect(shouldWarn(0, 0)).toBe(false);
    expect(shouldWarn(5, 0)).toBe(false);
  });

  it('buildWarningMessage lists triggered windows with their usage %', () => {
    const msg = buildWarningMessage([
      { windowSeconds: 1,   remaining: 8,  limit: 10 },   // 80% used → not triggered
      { windowSeconds: 60,  remaining: 5,  limit: 50 },   // 90% used → triggered
      { windowSeconds: 3600,remaining: 50, limit: 300 },  // 16.7% remaining (83% used) → triggered
    ], 0.20);
    expect(msg).toBe('approaching-limit: minute window at 90%, hour window at 83%');
  });

  it('buildWarningMessage returns empty string when no window triggers', () => {
    const msg = buildWarningMessage([
      { windowSeconds: 1,   remaining: 8, limit: 10 },
      { windowSeconds: 60,  remaining: 45, limit: 50 },
      { windowSeconds: 3600,remaining: 280, limit: 300 },
    ], 0.20);
    expect(msg).toBe('');
  });

  it('buildWarningMessage lists multiple triggered windows', () => {
    const msg = buildWarningMessage([
      { windowSeconds: 1,   remaining: 1,  limit: 10 },   // triggered
      { windowSeconds: 60,  remaining: 5,  limit: 50 },   // triggered
      { windowSeconds: 3600,remaining: 250, limit: 300 }, // 83% not triggered
    ], 0.20);
    expect(msg).toContain('second');
    expect(msg).toContain('minute');
    expect(msg).not.toContain('hour');
  });
});
