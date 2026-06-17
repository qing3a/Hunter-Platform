import { describe, it, expect } from 'vitest';

describe('aes-gcm', () => {
  const KEY = Buffer.alloc(32, 1);  // 测试用 32 字节全 1

  it('round-trips plaintext', async () => {
    const { encrypt, decrypt } = await import('../../../src/main/modules/crypto/aes-gcm');
    const ct = encrypt(KEY, 'hello world');
    const pt = decrypt(KEY, ct);
    expect(pt).toBe('hello world');
  });

  it('produces different ciphertexts for same plaintext (IV randomness)', async () => {
    const { encrypt } = await import('../../../src/main/modules/crypto/aes-gcm');
    const a = encrypt(KEY, 'same');
    const b = encrypt(KEY, 'same');
    expect(a).not.toBe(b);
  });

  it('rejects tampered ciphertext', async () => {
    const { encrypt, decrypt } = await import('../../../src/main/modules/crypto/aes-gcm');
    const ct = encrypt(KEY, 'secret');
    // 翻转 1 个字节
    const buf = Buffer.from(ct, 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');
    expect(() => decrypt(KEY, tampered)).toThrow();
  });

  it('zeroMemory zeros buffer in place', async () => {
    const { zeroMemory } = await import('../../../src/main/modules/crypto/aes-gcm');
    const buf = Buffer.from('plaintext');
    zeroMemory(buf);
    expect(buf.every(b => b === 0)).toBe(true);
  });
});
