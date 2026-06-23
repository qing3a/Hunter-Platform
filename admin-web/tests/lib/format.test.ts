import { describe, it, expect } from 'vitest';
import { formatDate, relativeTime, statusColor } from '../../src/lib/format';

describe('formatDate', () => {
  it('formats ISO to YYYY-MM-DD HH:MM (local)', () => {
    // Use a fixed UTC time to avoid TZ flakiness — toLocaleString differs
    // across environments. Instead verify format() components directly.
    const iso = '2026-06-24T08:30:00Z';
    const result = formatDate(iso);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
  it('returns empty for empty input', () => {
    expect(formatDate('')).toBe('');
  });
  it('returns original for invalid input', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-06-24T12:00:00Z');
  it('returns "just now" for < 60s', () => {
    expect(relativeTime('2026-06-24T11:59:30Z', now)).toBe('just now');
  });
  it('returns minutes for < 60min', () => {
    expect(relativeTime('2026-06-24T11:55:00Z', now)).toBe('5m ago');
  });
  it('returns hours for < 24h', () => {
    expect(relativeTime('2026-06-24T09:00:00Z', now)).toBe('3h ago');
  });
  it('returns days for < 30d', () => {
    expect(relativeTime('2026-06-22T12:00:00Z', now)).toBe('2d ago');
  });
  it('returns months for < 12mo', () => {
    expect(relativeTime('2026-04-24T12:00:00Z', now)).toBe('2mo ago');
  });
  it('returns years for >= 1y', () => {
    expect(relativeTime('2024-06-24T12:00:00Z', now)).toBe('2y ago');
  });
});

describe('statusColor', () => {
  it('green for active states', () => {
    expect(statusColor('active')).toBe('green');
    expect(statusColor('paid')).toBe('green');
    expect(statusColor('success')).toBe('green');
  });
  it('red for suspended/error states', () => {
    expect(statusColor('suspended')).toBe('red');
    expect(statusColor('cancelled')).toBe('red');
    expect(statusColor('error')).toBe('red');
  });
  it('yellow for pending states', () => {
    expect(statusColor('pending')).toBe('yellow');
    expect(statusColor('pending_payment')).toBe('yellow');
  });
  it('gray for unknown', () => {
    expect(statusColor('foo')).toBe('gray');
  });
});