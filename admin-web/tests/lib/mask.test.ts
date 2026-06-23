import { describe, it, expect } from 'vitest';
import { maskName, maskEmail } from '../../src/lib/mask';

describe('maskName', () => {
  it('masks long names with first + *** + last2', () => {
    expect(maskName('Alice')).toBe('A***ce');
    expect(maskName('Christopher')).toBe('C***er');
  });
  it('masks 4-char names with first + ***', () => {
    expect(maskName('Anna')).toBe('A***');
  });
  it('masks 2-3 char names with first + *', () => {
    expect(maskName('Bo')).toBe('B*');
    expect(maskName('Bob')).toBe('B*b');
  });
  it('returns empty for empty input', () => {
    expect(maskName('')).toBe('');
  });
});

describe('maskEmail', () => {
  it('masks local + domain with TLD preserved', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@***.com');
    expect(maskEmail('bob@foo.io')).toBe('b***@***.io');
  });
  it('handles single-char local', () => {
    expect(maskEmail('a@example.com')).toBe('a@***.com');
  });
  it('returns empty for invalid input', () => {
    expect(maskEmail('')).toBe('');
    expect(maskEmail('noatsign')).toBe('');
  });
});