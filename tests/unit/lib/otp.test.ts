import { describe, it, expect } from 'vitest';
import { generateOtp, hashOtp, verifyOtp } from '../../../src/main/lib/otp.js';

describe('otp lib', () => {
  it('generateOtp returns 6-digit numeric string by default', () => {
    const code = generateOtp();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('generateOtp respects custom length', () => {
    expect(generateOtp(4)).toMatch(/^\d{4}$/);
    expect(generateOtp(8)).toMatch(/^\d{8}$/);
  });

  it('hashOtp + verifyOtp round-trips', () => {
    const code = generateOtp();
    const hash = hashOtp(code);
    expect(hash).not.toBe(code);
    expect(verifyOtp(code, hash)).toBe(true);
  });

  it('verifyOtp rejects wrong code', () => {
    const code = generateOtp();
    const hash = hashOtp(code);
    expect(verifyOtp('000000', hash)).toBe(false);
  });
});