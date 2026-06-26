import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createConfigCache } from '../../src/main/modules/config-cache';

type FakeDB = {
  prepare: ReturnType<typeof vi.fn>;
};

function fakeDb(rowsByKey: Record<string, unknown>): FakeDB {
  return {
    prepare: vi.fn().mockImplementation((sql: string) => ({
      get: vi.fn().mockImplementation((key: string) => {
        if (sql.includes('SELECT') && key in rowsByKey) {
          return { key, value_json: JSON.stringify(rowsByKey[key]) };
        }
        return undefined;
      }),
    })),
  };
}

describe('configCache (Sub-F)', () => {
  beforeEach(() => { vi.useRealTimers(); });

  it('1. first get triggers DB read + caches result', async () => {
    const db = fakeDb({ 'rate_limit.tier.headhunter.limit_per_minute': 200 });
    const cache = createConfigCache(db as any);
    const v = await cache.get<number>('rate_limit.tier.headhunter.limit_per_minute');
    expect(v).toBe(200);
    expect(db.prepare).toHaveBeenCalledTimes(1);
  });

  it('2. within TTL, second get does NOT re-read DB', async () => {
    const db = fakeDb({ k: 42 });
    const cache = createConfigCache(db as any, 10_000);
    await cache.get('k');
    await cache.get('k');
    await cache.get('k');
    expect(db.prepare).toHaveBeenCalledTimes(1);
  });

  it('3. after TTL expires, next get re-reads DB', async () => {
    vi.useFakeTimers();
    const db = fakeDb({ k: 42 });
    const cache = createConfigCache(db as any, 1_000);
    await cache.get('k');
    expect(db.prepare).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_001);
    await cache.get('k');
    expect(db.prepare).toHaveBeenCalledTimes(2);
  });

  it('4. invalidate(key) forces next get to re-read DB', async () => {
    const db = fakeDb({ k: 42 });
    const cache = createConfigCache(db as any);
    await cache.get('k');
    cache.invalidate('k');
    await cache.get('k');
    expect(db.prepare).toHaveBeenCalledTimes(2);
  });

  it('5. invalidate() (no arg) clears all', async () => {
    const db = fakeDb({ a: 1, b: 2 });
    const cache = createConfigCache(db as any);
    await cache.get('a');
    await cache.get('b');
    cache.invalidate();
    await cache.get('a');
    await cache.get('b');
    expect(db.prepare).toHaveBeenCalledTimes(4);
  });

  it('6. getOrDefault returns fallback when DB throws', async () => {
    const db: FakeDB = { prepare: vi.fn().mockImplementation(() => { throw new Error('db down'); }) };
    const cache = createConfigCache(db as any);
    const v = await cache.getOrDefault<number>('k', () => 99);
    expect(v).toBe(99);
  });

  it('7. getOrDefault returns fallback when key not in DB', async () => {
    const db = fakeDb({});
    const cache = createConfigCache(db as any);
    const v = await cache.getOrDefault<number>('missing', () => 7);
    expect(v).toBe(7);
  });

  it('8. getOrDefault returns DB value when key exists', async () => {
    const db = fakeDb({ k: 123 });
    const cache = createConfigCache(db as any);
    const v = await cache.getOrDefault<number>('k', () => 999);
    expect(v).toBe(123);
  });

  it('9. get returns undefined for missing key (not via getOrDefault)', async () => {
    const db = fakeDb({});
    const cache = createConfigCache(db as any);
    const v = await cache.get<number>('missing');
    expect(v).toBeUndefined();
  });

  it('10. corrupt JSON in DB → getOrDefault falls back + warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db: FakeDB = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ key: 'k', value_json: 'not json{{{' }),
      }),
    };
    const cache = createConfigCache(db as any);
    const v = await cache.getOrDefault<number>('k', () => 5);
    expect(v).toBe(5);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
