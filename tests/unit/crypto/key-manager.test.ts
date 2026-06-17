import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

const B64_32_1 = crypto.randomBytes(32).toString('base64');
const B64_32_2 = crypto.randomBytes(32).toString('base64');
const B64_32_3 = crypto.randomBytes(32).toString('base64');

describe('key manager', () => {
  it('parses PLATFORM_ENCRYPTION_KEYS=v1:abc,v2:def into key map', async () => {
    const { parseKeyMap } = await import('../../../src/main/modules/crypto/key-manager');
    const map = parseKeyMap(`v1:${B64_32_1},v2:${B64_32_2}`);
    expect(map.get('v1')?.toString('base64')).toBe(B64_32_1);
    expect(map.get('v2')?.toString('base64')).toBe(B64_32_2);
  });

  it('getLatestKey returns the last key (highest version)', async () => {
    const { parseKeyMap, getLatestKey } = await import('../../../src/main/modules/crypto/key-manager');
    const map = parseKeyMap(`v1:${B64_32_1},v2:${B64_32_2},v3:${B64_32_3}`);
    const latest = getLatestKey(map);
    expect(latest.version).toBe('v3');
    expect(latest.key.toString('base64')).toBe(B64_32_3);
  });

  it('getKeyByVersion retrieves a specific key', async () => {
    const { parseKeyMap, getKeyByVersion } = await import('../../../src/main/modules/crypto/key-manager');
    const map = parseKeyMap(`v1:${B64_32_1},v2:${B64_32_2}`);
    const key = getKeyByVersion(map, 'v1');
    expect(key?.toString('base64')).toBe(B64_32_1);
  });

  it('throws on empty key map', async () => {
    const { getLatestKey } = await import('../../../src/main/modules/crypto/key-manager');
    expect(() => getLatestKey(new Map())).toThrow(/No encryption keys/);
  });

  it('skips invalid (non-32-byte) keys', async () => {
    const { parseKeyMap } = await import('../../../src/main/modules/crypto/key-manager');
    const map = parseKeyMap(`v1:notbase64,v2:${B64_32_2}`);
    expect(map.has('v1')).toBe(false);
    expect(map.has('v2')).toBe(true);
  });
});
