import { z } from 'zod';

const EnvSchema = z.object({
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
  WEBHOOK_HMAC_SECRET: z.string().min(16),
  ADMIN_PASSWORD_HASH: z.string().min(20),
  DATABASE_PATH: z.string().default('./data/hunter.db'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = Omit<z.infer<typeof EnvSchema>, 'PLATFORM_ENCRYPTION_KEY'> & {
  PLATFORM_ENCRYPTION_KEY: Buffer;
};

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  const { PLATFORM_ENCRYPTION_KEY, ...rest } = parsed.data;
  return {
    ...rest,
    PLATFORM_ENCRYPTION_KEY: Buffer.from(PLATFORM_ENCRYPTION_KEY, 'base64'),
  };
}
