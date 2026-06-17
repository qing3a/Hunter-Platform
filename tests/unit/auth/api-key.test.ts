import { describe, it, expect } from 'vitest';

describe('api-key', () => {
  it('generates key with hp_live_ prefix', async () => {
    const { generateApiKey } = await import('../../../src/main/modules/auth/api-key');
    const { key, hash, prefix } = generateApiKey();
    expect(key).toMatch(/^hp_live_[A-Za-z0-9_-]{32,}$/);
    // ⚠️ prefix 必须 ≥ 12 字符才能用于 auth 中间件缩小候选集
    // 8 字符 = "hp_live_" 全相同，无 bucketing 价值
    expect(prefix.length).toBe(12);
    expect(prefix.startsWith('hp_live_')).toBe(true);
    expect(hash).not.toBe(key);
  });

  it('prefix is unique across many keys (collision check)', async () => {
    const { generateApiKey } = await import('../../../src/main/modules/auth/api-key');
    const prefixes = new Set(Array.from({ length: 1000 }, () => generateApiKey().prefix));
    // 1000 个 12 字符 prefix 中允许少量碰撞，但不应 > 1%
    expect(prefixes.size).toBeGreaterThan(990);
  });

  it('verifies correct key', async () => {
    const { generateApiKey, verifyApiKey } = await import('../../../src/main/modules/auth/api-key');
    const { key, hash } = generateApiKey();
    expect(verifyApiKey(key, hash)).toBe(true);
  });

  it('rejects wrong key', async () => {
    const { generateApiKey, verifyApiKey } = await import('../../../src/main/modules/auth/api-key');
    const { hash } = generateApiKey();
    expect(verifyApiKey('hp_live_wrongkey', hash)).toBe(false);
  });
});
