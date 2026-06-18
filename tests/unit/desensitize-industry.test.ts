import { describe, it, expect } from 'vitest';
import { lookupIndustry } from '../../src/main/modules/desensitize/mapping.js';

describe('lookupIndustry', () => {
  it('hits enumeration: 字节跳动 → 互联网', () => {
    expect(lookupIndustry('字节跳动')).toBe('互联网');
  });

  it('first-wins for ambiguous: 阿里巴巴 → 互联网 (before 电商)', () => {
    expect(lookupIndustry('阿里巴巴')).toBe('互联网');
  });

  it('fallback keyword: 宇宙银行 contains 银行 → 金融', () => {
    expect(lookupIndustry('宇宙银行')).toBe('金融');
  });

  it('fallback keyword: 某某科技 → 互联网', () => {
    expect(lookupIndustry('某某科技')).toBe('互联网');
  });

  it('returns 其他 for unmatched', () => {
    expect(lookupIndustry('某某工作室')).toBe('其他');
  });

  it('returns undefined for empty/null input', () => {
    expect(lookupIndustry(undefined)).toBeUndefined();
    expect(lookupIndustry('')).toBeUndefined();
  });
});