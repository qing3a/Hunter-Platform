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
  // Legacy shared admin password hash — deprecated in v1.5 (Sub-A of Task #3).
  // New admin auth uses per-admin api_key from admin_users table. Kept optional
  // so test environments and pre-seed prod boot don't fail validation.
  ADMIN_PASSWORD_HASH: z.string().optional(),
  DATABASE_PATH: z.string().default('./data/hunter.db'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // Set to "false" to disable ALL rate limiting (per-user sliding window + IP register limit).
  // Use only for local development / testing. Defaults to enabled in all envs.
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
  // Candidate Portal (Phase 1) — OTP 邮箱登录配置
  // OTP_LENGTH: 验证码位数 (4-8, 默认 6)
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  // OTP_TTL_SECONDS: 验证码有效期 (60-3600 秒, 默认 300 = 5 分钟)
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  // OTP_MAX_ATTEMPTS: 单个 OTP 最多尝试次数 (1-10, 默认 5)
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  // OTP_CONSOLE_ONLY: true = 控制台打印 OTP (开发/测试); false = 走真实邮件服务 (生产, Phase 2 接入)
  OTP_CONSOLE_ONLY: z.coerce.boolean().default(true),
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
