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
  const NOW = new Date('2026-06-24T12:00:00Z').getTime();

  it('returns 刚刚 for now', () => {
    expect(relativeTime(new Date(NOW), NOW)).toBe('刚刚');
  });

  it('returns 未来 for future dates', () => {
    const future = new Date(NOW + 30_000);
    expect(relativeTime(future, NOW)).toBe('未来');
  });

  it('returns X 分钟前 for minutes', () => {
    const t = new Date(NOW - 5 * 60_000);
    expect(relativeTime(t, NOW)).toBe('5 分钟前');
  });

  it('returns X 小时前 for hours', () => {
    const t = new Date(NOW - 2 * 3_600_000);
    expect(relativeTime(t, NOW)).toBe('2 小时前');
  });

  it('returns X 天前 for days', () => {
    const t = new Date(NOW - 3 * 86_400_000);
    expect(relativeTime(t, NOW)).toBe('3 天前');
  });

  it('returns X 个月前 for months', () => {
    const t = new Date(NOW - 5 * 30 * 86_400_000);
    expect(relativeTime(t, NOW)).toBe('5 个月前');
  });

  it('returns X 年前 for years', () => {
    const t = new Date(NOW - 365 * 86_400_000);
    expect(relativeTime(t, NOW)).toBe('1 年前');
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