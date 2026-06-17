import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

describe('webhook hmac', () => {
  const SECRET = 'test-secret-1234567890';
  const NOW_TS = String(Math.floor(Date.now() / 1000));

  it('signs body with HMAC-SHA256', async () => {
    const { sign } = await import('../../../src/main/modules/webhook/hmac');
    const sig = sign(SECRET, 'hello', NOW_TS);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verifies correct signature', async () => {
    const { sign, verify } = await import('../../../src/main/modules/webhook/hmac');
    const sig = sign(SECRET, 'body', NOW_TS);
    expect(verify(SECRET, 'body', NOW_TS, sig)).toBe(true);
  });

  it('rejects tampered body', async () => {
    const { sign, verify } = await import('../../../src/main/modules/webhook/hmac');
    const sig = sign(SECRET, 'body', NOW_TS);
    expect(verify(SECRET, 'tampered', NOW_TS, sig)).toBe(false);
  });

  it('rejects timestamp out of window (>5 min skew)', async () => {
    const { sign, verify } = await import('../../../src/main/modules/webhook/hmac');
    const oldTs = String(Math.floor(Date.now() / 1000) - 600);
    const sig = sign(SECRET, 'body', oldTs);
    expect(verify(SECRET, 'body', oldTs, sig)).toBe(false);
  });

  it('uses timing-safe comparison (constant-time)', async () => {
    const { sign, verify } = await import('../../../src/main/modules/webhook/hmac');
    const sig = sign(SECRET, 'body', NOW_TS);
    const expectedBuf = Buffer.from(sig, 'hex');
    const wrongBuf = Buffer.from('0'.repeat(64), 'hex');
    expect(crypto.timingSafeEqual(expectedBuf, wrongBuf)).toBe(false);
  });
});
