// Deviation from M1 plan: uses `bcryptjs` (pure-JS) instead of `bcrypt`
// (native). better-sqlite3 native compilation fails on Windows without
// ClangCL; similarly `bcrypt` cannot fetch its prebuilt binary in this
// environment. `bcryptjs` has the same API (hashSync, compareSync).
//
// Cost factor note: bcryptjs is significantly slower than native bcrypt
// (pure-JS, no SIMD). For 192-bit API keys (24 random bytes base64url),
// rounds=4 is sufficient: the keyspace (2^192) is the bottleneck, not
// per-hash cost. Native bcrypt would use 10; we trade marginal security
// for test speed (~10s vs ~100s for 1000 keys).

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

export interface GeneratedApiKey {
  key: string;
  hash: string;
  prefix: string;
}

const BCRYPT_ROUNDS = 4;

export function generateApiKey(): GeneratedApiKey {
  const random = randomBytes(24).toString('base64url');  // 32 chars (base64url)
  const key = `hp_live_${random}`;
  // 12 字符 prefix = "hp_live_" (8) + 4 随机字符
  // 用于 auth 中间件按 prefix 缩小候选集（避免每个请求都全表 bcrypt）
  // 8 字符全相同，bucketing 无效
  const prefix = key.slice(0, 12);
  const hash = bcrypt.hashSync(key, BCRYPT_ROUNDS);
  return { key, hash, prefix };
}

export function verifyApiKey(key: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(key, hash);
  } catch {
    return false;
  }
}
