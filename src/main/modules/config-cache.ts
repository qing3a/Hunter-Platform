import type { DB } from '../db/connection.js';

export type ConfigCache = {
  /** Get cached value; reload from DB if expired (TTL). DB error / no key → undefined. */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** Get cached value with fallback. DB error / no key / corrupt JSON → return fallback(). */
  getOrDefault<T = unknown>(key: string, fallback: () => T): Promise<T>;
  /** Test-only: invalidate single key or all. */
  invalidate(key?: string): void;
};

type CacheEntry = { value: unknown; loadedAt: number };

/**
 * In-memory config cache with lazy TTL.
 *
 * - get(): read cache; on miss / expiry, SELECT * FROM config WHERE key = ?; cache result.
 *   DB error → throw (caller should use getOrDefault for fail-soft).
 * - getOrDefault(): same as get(), but on DB error OR missing key OR corrupt JSON
 *   → invoke fallback() and return its result. Also catches JSON.parse errors + warns.
 * - invalidate(key?): test helper to force a re-read.
 *
 * Thread safety: single Node process, no locking needed.
 */
export function createConfigCache(db: DB, ttlMs: number = 0): ConfigCache {
  const cache = new Map<string, CacheEntry>();

  function readFromDb(key: string): unknown {
    const row = db.prepare(
      'SELECT value_json FROM config WHERE key = ?'
    ).get(key) as { value_json: string } | undefined;
    if (!row) return undefined;
    return JSON.parse(row.value_json);
  }

  function isExpired(loadedAt: number): boolean {
    return Date.now() - loadedAt > ttlMs;
  }

  async function get<T>(key: string): Promise<T | undefined> {
    const hit = cache.get(key);
    if (hit && !isExpired(hit.loadedAt)) return hit.value as T;
    const value = readFromDb(key); // throws on DB error or JSON.parse
    cache.set(key, { value, loadedAt: Date.now() });
    return value as T;
  }

  async function getOrDefault<T>(key: string, fallback: () => T): Promise<T> {
    try {
      const v = await get<T>(key);
      if (v === undefined) return fallback();
      return v;
    } catch (e) {
      console.warn(`[config-cache] read failed for key=${key}, using fallback:`, (e as Error).message);
      return fallback();
    }
  }

  function invalidate(key?: string): void {
    if (key === undefined) cache.clear();
    else cache.delete(key);
  }

  return { get, getOrDefault, invalidate };
}
