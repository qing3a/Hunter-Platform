/**
 * Multi-key encryption manager for P1#13 (key rotation).
 *
 * M5 v1: only the latest key is used for new encryptions. The map infrastructure is
 * in place so future versions can route decrypt() to the correct historical key by
 * reading the ciphertext's `v<N>:` prefix.
 */

export type KeyMap = Map<string, Buffer>;

export interface LatestKey {
  version: string;
  key: Buffer;
}

/**
 * Parse `v1:<base64>,v2:<base64>` into a Map. Each key must base64-decode to 32 bytes;
 * invalid entries are silently skipped.
 */
export function parseKeyMap(spec: string): KeyMap {
  const map: KeyMap = new Map();
  if (!spec) return map;
  for (const pair of spec.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    const version = trimmed.slice(0, colonIdx);
    const b64 = trimmed.slice(colonIdx + 1);
    try {
      const buf = Buffer.from(b64, 'base64');
      if (buf.length === 32) map.set(version, buf);
    } catch {
      /* skip invalid */
    }
  }
  return map;
}

/** Returns the lexicographically latest key (v3 > v2 > v1). Throws if map is empty. */
export function getLatestKey(map: KeyMap): LatestKey {
  if (map.size === 0) throw new Error('No encryption keys configured');
  const versions = Array.from(map.keys()).sort();
  const latest = versions[versions.length - 1]!;
  return { version: latest, key: map.get(latest)! };
}

export function getKeyByVersion(map: KeyMap, version: string): Buffer | undefined {
  return map.get(version);
}
