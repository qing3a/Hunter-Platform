import { z } from 'zod';
import { parseKeyMap, getLatestKey, getKeyByVersion, type KeyMap } from './modules/crypto/key-manager.js';

const EnvSchema = z.object({
  // Single-key mode (legacy). Internally normalized to v1: format.
  PLATFORM_ENCRYPTION_KEY: z.string().refine(
    (v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch {
        return false;
      }
    },
    { message: 'PLATFORM_ENCRYPTION_KEY must be base64 of 32 bytes' }
  ),
  // Multi-key mode (M5 P1#13). Format: v1:<b64>,v2:<b64>,...
  PLATFORM_ENCRYPTION_KEYS: z.string().optional(),
  WEBHOOK_HMAC_SECRET: z.string().min(16),
  ADMIN_PASSWORD_HASH: z.string().min(20),
  DATABASE_PATH: z.string().default('./data/hunter.db'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // Set to "false" to disable ALL rate limiting (per-user sliding window + IP register limit).
  // Use only for local development / testing. Defaults to enabled in all envs.
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
});

export type Env = Omit<z.infer<typeof EnvSchema>, 'PLATFORM_ENCRYPTION_KEY'> & {
  PLATFORM_ENCRYPTION_KEY: Buffer;
  encryptionKeyMap: KeyMap;
  latestEncryptionKey: Buffer;
};

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  const { PLATFORM_ENCRYPTION_KEY, PLATFORM_ENCRYPTION_KEYS, ...rest } = parsed.data;
  // Prefer PLATFORM_ENCRYPTION_KEYS if set; otherwise wrap the single key as v1:
  const keySpec = PLATFORM_ENCRYPTION_KEYS ?? `v1:${PLATFORM_ENCRYPTION_KEY}`;
  const keyMap = parseKeyMap(keySpec);
  if (keyMap.size === 0) {
    throw new Error('Invalid encryption key configuration: no valid 32-byte keys parsed');
  }
  const latest = getLatestKey(keyMap);
  return {
    ...rest,
    PLATFORM_ENCRYPTION_KEY: latest.key,
    encryptionKeyMap: keyMap,
    latestEncryptionKey: latest.key,
  };
}

/** Look up a specific key version (used by future decrypt resolver). */
export function getEncryptionKeyForVersion(env: Env, version: string): Buffer {
  return getKeyByVersion(env.encryptionKeyMap, version) ?? env.latestEncryptionKey;
}
