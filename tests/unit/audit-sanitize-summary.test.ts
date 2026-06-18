import { describe, it, expect } from 'vitest';
import { sanitizeSummary } from '../../src/main/modules/audit/sanitize-summary.js';

describe('sanitizeSummary', () => {
  it('returns null for null/undefined input', () => {
    expect(sanitizeSummary(null)).toBeNull();
    expect(sanitizeSummary(undefined)).toBeNull();
  });

  it('returns the object when no forbidden keys', () => {
    const obj = { anonymized_id: 'ca_123', industry: '互联网', count: 3 };
    expect(sanitizeSummary(obj)).toEqual(obj);
  });

  it('throws when key contains "phone"', () => {
    expect(() => sanitizeSummary({ user_phone: '138' })).toThrow(/PII/);
  });

  it('throws when key contains "email"', () => {
    expect(() => sanitizeSummary({ contact_email: 'a@b.c' })).toThrow(/PII/);
  });

  it('throws when key contains "name"', () => {
    expect(() => sanitizeSummary({ full_name: '张三' })).toThrow(/PII/);
  });

  it('throws case-insensitively', () => {
    expect(() => sanitizeSummary({ API_KEY: 'x' })).toThrow(/PII/);
    expect(() => sanitizeSummary({ Token: 'x' })).toThrow(/PII/);
  });

  it('does not throw on nested-allowed keys (top-level only check)', () => {
    const obj = { preview: { skills: ['React'] } };  // skills is allowed
    expect(sanitizeSummary(obj)).toEqual(obj);
  });
});