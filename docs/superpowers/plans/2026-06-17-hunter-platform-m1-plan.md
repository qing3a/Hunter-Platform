# Hunter Platform — Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可运行的猎头中介 API 平台核心基础 — 用户注册/认证、配额、限流、加密、脱敏、候选人上传。

**Architecture:** Node.js + Express + TypeScript + better-sqlite3 (WAL) 后端。Convo Electron 渲染进程作为管理后台（仅在 M3 接入）。M1 仅实现 API server + 单角色 (headhunter) 的核心动作；三角色闭环在 M2。

**Tech Stack:**
- Runtime: Node.js 22+, TypeScript 5.6+
- HTTP: Express 4
- DB: better-sqlite3 (WAL 模式)
- Testing: Vitest + supertest
- Crypto: Node.js `crypto` (AES-256-GCM)
- Lint: ESLint + Prettier（沿用 Convo 配置）

**Spec 参考:** [`docs/superpowers/specs/2026-06-17-hunter-platform-design.md`](../specs/2026-06-17-hunter-platform-design.md)

**本文档覆盖:** §1-§8 全部 + §11 测试。Webhooks / 解锁流程 / 管理员后台 / 佣金 / 性能在 M2-M5 计划中。

---

## Milestone 0：项目脚手架

### Task 1: 初始化 TypeScript 项目

**Files:**
- Create: `package.json` (修改)
- Create: `tsconfig.json` (修改)
- Create: `vitest.config.ts`

- [ ] **Step 1: 添加依赖**

在 `package.json` `dependencies` 添加：
```json
{
  "better-sqlite3": "^11.5.0",
  "bcrypt": "^5.1.1",
  "express": "^4.21.0"
}
```

在 `devDependencies` 添加：
```json
{
  "@types/better-sqlite3": "^7.6.11",
  "@types/bcrypt": "^5.0.2",
  "@types/express": "^5.0.0",
  "@types/supertest": "^6.0.2",
  "supertest": "^7.0.0"
}
```

- [ ] **Step 2: 安装**

```bash
cd C:\Users\Administrator\ZCodeProject
pnpm install
```
Expected: 依赖装好，`node_modules/better-sqlite3` 存在。

- [ ] **Step 3: 创建 vitest 配置**

创建 `vitest.config.ts`：
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',  // SQLite 需要单进程
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
```

- [ ] **Step 4: 验证 vitest 能跑**

创建 `tests/smoke.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

运行：
```bash
pnpm test
```
Expected: 1 passed。

- [ ] **Step 5: 提交**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts tests/smoke.test.ts
git commit -m "chore: scaffold M1 dependencies + vitest"
```

---

### Task 2: 环境变量加载与校验

**Files:**
- Create: `src/main/env.ts`
- Create: `tests/unit/env.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/unit/env.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('env', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it('loads required env vars', () => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$test';
    process.env.DATABASE_PATH = './data/test.db';
    process.env.NODE_ENV = 'test';

    const { loadEnv } = require('../../src/main/env');
    const env = loadEnv();
    expect(env.PLATFORM_ENCRYPTION_KEY).toBeInstanceOf(Buffer);
    expect(env.PLATFORM_ENCRYPTION_KEY.length).toBe(32);
  });

  it('throws when PLATFORM_ENCRYPTION_KEY missing', () => {
    delete process.env.PLATFORM_ENCRYPTION_KEY;
    const { loadEnv } = require('../../src/main/env');
    expect(() => loadEnv()).toThrow(/PLATFORM_ENCRYPTION_KEY/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test tests/unit/env.test.ts
```
Expected: FAIL with "Cannot find module '../../src/main/env'"。

- [ ] **Step 3: 实现 env.ts**

`src/main/env.ts`：
```typescript
import { z } from 'zod';

// 注意：实际项目需先 `pnpm add zod`（在 Task 1 一起加也可）
const EnvSchema = z.object({
  PLATFORM_ENCRYPTION_KEY: z.string().refine(
    (v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch { return false; }
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

export type Env = z.infer<typeof EnvSchema> & {
  PLATFORM_ENCRYPTION_KEY: Buffer;
};

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return {
    ...parsed.data,
    PLATFORM_ENCRYPTION_KEY: Buffer.from(parsed.data.PLATFORM_ENCRYPTION_KEY, 'base64'),
  };
}
```

如果还没装 zod，在 package.json devDependencies 加 `"zod": "^3.23.8"` 并 `pnpm install`。

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test tests/unit/env.test.ts
```
Expected: 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/main/env.ts tests/unit/env.test.ts package.json pnpm-lock.yaml
git commit -m "feat(env): validate required env vars with zod"
```

---

## Milestone 1.A：数据库层

### Task 3: SQLite 连接（WAL 模式）

**Files:**
- Create: `src/main/db/connection.ts`
- Create: `tests/integration/db-connection.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/db-connection.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('db connection', () => {
  const testDb = path.join(__dirname, '../../tmp/test.db');

  beforeEach(() => { try { fs.unlinkSync(testDb); } catch {} });
  afterEach(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('opens with WAL mode', () => {
    const { openDb } = require('../../src/main/db/connection');
    const db = openDb(testDb);
    const result = db.pragma('journal_mode', { simple: true });
    expect(result).toBe('wal');
    db.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/db-connection.test.ts
```
Expected: FAIL with "Cannot find module"。

- [ ] **Step 3: 实现 connection.ts**

`src/main/db/connection.ts`：
```typescript
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');  // WAL 模式下 NORMAL 安全
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test tests/integration/db-connection.test.ts
```
Expected: 1 passed。

- [ ] **Step 5: 提交**

```bash
git add src/main/db/connection.ts tests/integration/db-connection.test.ts
git commit -m "feat(db): open SQLite with WAL mode + foreign keys"
```

---

### Task 4: Schema v001 迁移

**Files:**
- Create: `src/main/db/schema.sql`
- Create: `src/main/db/migrations.ts`
- Create: `tests/integration/migrations.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/migrations.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('migrations', () => {
  const testDb = path.join(__dirname, '../../tmp/mig.db');

  beforeEach(() => { try { fs.unlinkSync(testDb); } catch {} });
  afterEach(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('creates v001 schema and records migration', () => {
    const { openDb } = require('../../src/main/db/connection');
    const { runMigrations } = require('../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('candidates_private');
    expect(tableNames).toContain('candidates_anonymized');
    expect(tableNames).toContain('idempotency_keys');
    expect(tableNames).toContain('rate_limit_buckets');
    expect(tableNames).toContain('action_history');
    expect(tableNames).toContain('schema_migrations');
    const mig = db.prepare('SELECT version FROM schema_migrations').get();
    expect(mig).toEqual({ version: 1 });
    db.close();
  });

  it('is idempotent on second run', () => {
    const { openDb } = require('../../src/main/db/connection');
    const { runMigrations } = require('../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    runMigrations(db);  // 第二次不应报错
    const migs = db.prepare('SELECT * FROM schema_migrations').all();
    expect(migs.length).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/migrations.test.ts
```
Expected: FAIL with "Cannot find module"。

- [ ] **Step 3: 写 v001 schema（仅 M1 需要的表）**

`src/main/db/schema.sql`：
```sql
-- v001: M1 baseline (users, candidates, idempotency, rate limit, action history)

CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  user_type       TEXT NOT NULL CHECK (user_type IN ('candidate', 'headhunter', 'employer')),
  name            TEXT NOT NULL,
  contact         TEXT,
  agent_endpoint  TEXT,
  api_key_hash    TEXT NOT NULL UNIQUE,
  api_key_prefix  TEXT NOT NULL,
  quota_per_day   INTEGER NOT NULL DEFAULT 100,
  quota_used      INTEGER NOT NULL DEFAULT 0,
  quota_reset_at  TEXT NOT NULL,
  reputation      INTEGER NOT NULL DEFAULT 50,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_users_api_key_hash ON users(api_key_hash);
CREATE INDEX idx_users_user_type ON users(user_type);

CREATE TABLE candidates_private (
  id                  TEXT PRIMARY KEY,
  headhunter_id       TEXT NOT NULL REFERENCES users(id),
  candidate_user_id   TEXT NOT NULL REFERENCES users(id),
  name_enc            TEXT NOT NULL,
  phone_enc           TEXT NOT NULL,
  email_enc           TEXT NOT NULL,
  current_company_raw TEXT,
  current_title_raw   TEXT,
  expected_salary     INTEGER,
  years_experience    INTEGER,
  education_school    TEXT,
  resume_url          TEXT,
  skills_json         TEXT,
  raw_payload_json    TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_candidates_private_headhunter ON candidates_private(headhunter_id);
CREATE INDEX idx_candidates_private_candidate_user ON candidates_private(candidate_user_id);

CREATE TABLE candidates_anonymized (
  id                    TEXT PRIMARY KEY,
  source_private_id     TEXT NOT NULL REFERENCES candidates_private(id),
  source_headhunter_id  TEXT NOT NULL REFERENCES users(id),
  industry              TEXT,
  title_level           TEXT,
  years_experience      INTEGER,
  salary_range          TEXT,
  education_tier        TEXT,
  skills_json           TEXT,
  is_public_pool        INTEGER NOT NULL DEFAULT 0,
  unlock_status         TEXT NOT NULL DEFAULT 'locked' CHECK (unlock_status IN ('locked', 'unlocked', 'revoked')),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX idx_candidates_anon_public ON candidates_anonymized(is_public_pool, created_at);
CREATE INDEX idx_candidates_anon_headhunter ON candidates_anonymized(source_headhunter_id);

CREATE TABLE idempotency_keys (
  key             TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  request_hash    TEXT NOT NULL,
  response_json   TEXT NOT NULL,
  status_code     INTEGER NOT NULL,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_idempotency_user ON idempotency_keys(user_id, created_at);
CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);

CREATE TABLE rate_limit_buckets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  window_start    TEXT NOT NULL,
  window_seconds  INTEGER NOT NULL,
  request_count   INTEGER NOT NULL DEFAULT 0,
  expires_at      TEXT NOT NULL,
  UNIQUE(user_id, window_start, window_seconds)
);
CREATE INDEX idx_rate_limit_user ON rate_limit_buckets(user_id, window_start);
CREATE INDEX idx_rate_limit_expires ON rate_limit_buckets(expires_at);

CREATE TABLE action_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL REFERENCES users(id),
  action_type     TEXT NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  request_summary_json  TEXT,
  response_summary_json TEXT,
  status          TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_code      TEXT,
  duration_ms     INTEGER,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_action_history_user ON action_history(user_id, created_at);
CREATE INDEX idx_action_history_type ON action_history(action_type, created_at);

CREATE TABLE schema_migrations (
  version       INTEGER PRIMARY KEY,
  description   TEXT NOT NULL,
  applied_at    TEXT NOT NULL
);
```

- [ ] **Step 4: 实现迁移 runner**

`src/main/db/migrations.ts`：
```typescript
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

const MIGRATIONS: { version: number; description: string; file: string }[] = [
  { version: 1, description: 'M1 baseline (users, candidates, idempotency, rate limit, action history)', file: 'schema.sql' },
];

export function runMigrations(db: Database.Database, schemaDir: string = path.join(__dirname)): void {
  // Ensure schema_migrations table exists (for upgrade scenarios, but harmless on first run)
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[])
      .map(r => r.version)
  );

  for (const mig of MIGRATIONS) {
    if (applied.has(mig.version)) continue;
    const sql = fs.readFileSync(path.join(schemaDir, mig.file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)'
      ).run(mig.version, mig.description, new Date().toISOString());
    });
    tx();
  }
}
```

- [ ] **Step 5: 跑测试**

```bash
pnpm test tests/integration/migrations.test.ts
```
Expected: 2 passed。

- [ ] **Step 6: 提交**

```bash
git add src/main/db/schema.sql src/main/db/migrations.ts tests/integration/migrations.test.ts
git commit -m "feat(db): v001 schema + migrations runner"
```

---

### Task 5: 共享类型定义

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/constants.ts`
- Create: `src/main/errors.ts`

- [ ] **Step 1: 写 shared/types.ts**

```typescript
// src/shared/types.ts
export type UserType = 'candidate' | 'headhunter' | 'employer';

export type UserStatus = 'active' | 'suspended' | 'deleted';

export interface User {
  id: string;
  user_type: UserType;
  name: string;
  contact: string | null;
  agent_endpoint: string | null;
  api_key_hash: string;
  api_key_prefix: string;
  quota_per_day: number;
  quota_used: number;
  quota_reset_at: string;
  reputation: number;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'INSUFFICIENT_QUOTA'
  | 'RATE_LIMITED'
  | 'INVALID_STATE'
  | 'DUPLICATE_REQUEST'
  | 'INTERNAL_ERROR';

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: Record<string, unknown> } };

export interface AnonymizedCandidate {
  industry: string | null;
  title_level: string | null;
  years_experience: number | null;
  salary_range: string | null;
  education_tier: string | null;
  skills: string[];
}
```

- [ ] **Step 2: 写 shared/constants.ts**

```typescript
// src/shared/constants.ts
export const QUOTA_PER_DAY = {
  candidate: 50,
  headhunter: 200,
  employer: 100,
} as const;

export const RATE_LIMIT_BURSTS = {
  candidate:  { second: 10, minute: 50,  hour: 200 },
  headhunter: { second: 20, minute: 100, hour: 500 },
  employer:   { second: 30, minute: 200, hour: 800 },
} as const;

export const QUOTA_COSTS = {
  register: 0,
  upload_candidate: 5,
  // M2+:
  // create_job: 5,
  // browse_talent: 1,
  // express_interest: 3,
  // recommend_candidate: 5,
  // approve_unlock: 3,
} as const;

export const MAX_BODY_SIZE = '4kb';
export const IDEMPOTENCY_TTL_HOURS = 24;
export const API_KEY_PREFIX_LENGTH = 12;  // ⚠️ 必须 ≥ 12 才能用于 auth bucketing（8 字符全相同）
export const RATE_LIMIT_WINDOW_SECONDS = [1, 60, 3600] as const;
```

- [ ] **Step 3: 写 errors.ts**

`src/main/errors.ts`：
```typescript
import type { ErrorCode } from '../shared/types.js';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const Errors = {
  unauthorized: (msg = 'Invalid or missing API key') =>
    new ApiError('UNAUTHORIZED', msg, 401),
  forbidden: (msg = 'Permission denied') =>
    new ApiError('FORBIDDEN', msg, 403),
  notFound: (msg = 'Resource not found') =>
    new ApiError('NOT_FOUND', msg, 404),
  invalidParams: (msg: string, details?: Record<string, unknown>) =>
    new ApiError('INVALID_PARAMS', msg, 400, details),
  insufficientQuota: (msg = 'Daily quota exhausted') =>
    new ApiError('INSUFFICIENT_QUOTA', msg, 429),
  rateLimited: (msg = 'Burst rate limit exceeded', details?: Record<string, unknown>) =>
    new ApiError('RATE_LIMITED', msg, 429, details),
  invalidState: (msg: string) =>
    new ApiError('INVALID_STATE', msg, 409),
  duplicateRequest: (msg = 'Idempotency key reused with different body') =>
    new ApiError('DUPLICATE_REQUEST', msg, 409),
  internal: (msg = 'Internal server error') =>
    new ApiError('INTERNAL_ERROR', msg, 500),
};
```

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors。

- [ ] **Step 5: 提交**

```bash
git add src/shared/types.ts src/shared/constants.ts src/main/errors.ts
git commit -m "feat(shared): error class + types + constants"
```

---

## Milestone 1.B：核心模块

### Task 6: Crypto 模块（AES-256-GCM）

**Files:**
- Create: `src/main/modules/crypto/aes-gcm.ts`
- Create: `tests/unit/crypto/aes-gcm.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/unit/crypto/aes-gcm.test.ts`：
```typescript
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
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/crypto/aes-gcm.test.ts
```
Expected: FAIL with "Cannot find module"。

- [ ] **Step 3: 实现 aes-gcm.ts**

`src/main/modules/crypto/aes-gcm.ts`：
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encrypt(key: Buffer, plaintext: string): string {
  if (key.length !== 32) throw new Error('Key must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(key: Buffer, ciphertextB64: string): string {
  if (key.length !== 32) throw new Error('Key must be 32 bytes');
  const buf = Buffer.from(ciphertextB64, 'base64');
  if (buf.length < 12 + 16 + 1) throw new Error('Ciphertext too short');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

export function zeroMemory(buf: Buffer | null | undefined): void {
  if (Buffer.isBuffer(buf)) buf.fill(0);
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/unit/crypto/aes-gcm.test.ts
```
Expected: 4 passed。

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/crypto/aes-gcm.ts tests/unit/crypto/aes-gcm.test.ts
git commit -m "feat(crypto): AES-256-GCM encrypt/decrypt/zeroMemory"
```

---

### Task 7: 脱敏引擎

**Files:**
- Create: `src/main/modules/desensitize/mapping.ts`
- Create: `src/main/modules/desensitize/engine.ts`
- Create: `tests/unit/desensitize/engine.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/unit/desensitize/engine.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';

describe('desensitize engine', () => {
  it('maps company to industry', async () => {
    const { desensitize } = await import('../../../src/main/modules/desensitize/engine');
    const result = desensitize({
      current_company: '字节跳动',
      current_title: '高级前端工程师',
      expected_salary: 750000,
      years_experience: 8,
      education_school: '清华大学',
    });
    expect(result.industry).toBe('互联网');
    expect(result.title_level).toBe('P6');
    expect(result.salary_range).toBe('60-80万');
    expect(result.education_tier).toBe('985');
    expect(result.years_experience).toBe(8);
  });

  it('returns "其他" for unknown company', async () => {
    const { desensitize } = await import('../../../src/main/modules/desensitize/engine');
    const result = desensitize({
      current_company: '某某不知名公司',
      current_title: '工程师',
      expected_salary: 100000,
      years_experience: 1,
      education_school: '某学院',
    });
    expect(result.industry).toBe('其他');
    expect(result.education_tier).toBe('普通');
  });

  it('handles missing fields gracefully', async () => {
    const { desensitize } = await import('../../../src/main/modules/desensitize/engine');
    const result = desensitize({});
    expect(result.industry).toBe(null);
    expect(result.years_experience).toBe(null);
  });

  it('clamps salary to band range', async () => {
    const { desensitize } = await import('../../../src/main/modules/desensitize/engine');
    expect(desensitize({ expected_salary: 50000 }).salary_range).toBe('0-20万');
    expect(desensitize({ expected_salary: 15000000 }).salary_range).toBe('200万+');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/desensitize/engine.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 写 mapping.ts**

`src/main/modules/desensitize/mapping.ts`：
```typescript
// v1 手写配置；v2 可接 LLM 推导
export const INDUSTRY_MAP: Record<string, string> = {
  '字节跳动': '互联网', '阿里巴巴': '互联网', '腾讯': '互联网', '百度': '互联网',
  '美团': '互联网', '京东': '互联网', '小米': '互联网', '华为': '通信/硬件',
  '招商银行': '金融', '中国银行': '金融', '工商银行': '金融',
  '中金': '金融', '高盛': '金融',
};

export const TITLE_LEVEL_PATTERNS: { regex: RegExp; level: string }[] = [
  { regex: /P[5-7]|高级工程师|高级开发/, level: 'P6' },
  { regex: /P[8-9]|资深|Staff/, level: 'P7+' },
  { regex: /M[1-2]|经理|主管/, level: 'M1' },
  { regex: /M[3-4]|总监/, level: 'M2' },
  { regex: /VP|副总裁|总裁/, level: 'VP' },
];

export const SALARY_BANDS: { min: number; max: number | null; label: string }[] = [
  { min: 0,       max: 200000,   label: '0-20万' },
  { min: 200000,  max: 400000,   label: '20-40万' },
  { min: 400000,  max: 600000,   label: '40-60万' },
  { min: 600000,  max: 800000,   label: '60-80万' },
  { min: 800000,  max: 1200000,  label: '80-120万' },
  { min: 1200000, max: 2000000,  label: '120-200万' },
  { min: 2000000, max: null,     label: '200万+' },
];

// 985 完整列表（v1 含全部 39 所 + 211 全部 73 所放外部 JSON；这里只列示例）
export const SCHOOL_TIERS: Record<string, string> = {
  '清华大学': '985', '北京大学': '985', '复旦大学': '985',
  '上海交通大学': '985', '浙江大学': '985', '中国科学技术大学': '985',
  // ... 其余见 config/school_tiers.json
};
```

- [ ] **Step 4: 写 engine.ts**

`src/main/modules/desensitize/engine.ts`：
```typescript
import type { AnonymizedCandidate } from '../../../shared/types.js';
import { INDUSTRY_MAP, TITLE_LEVEL_PATTERNS, SALARY_BANDS, SCHOOL_TIERS } from './mapping.js';

export interface DesensitizeInput {
  current_company?: string;
  current_title?: string;
  expected_salary?: number;
  years_experience?: number;
  education_school?: string;
  skills?: string[];
}

export function desensitize(input: DesensitizeInput): AnonymizedCandidate {
  return {
    industry: input.current_company ? (INDUSTRY_MAP[input.current_company] ?? '其他') : null,
    title_level: input.current_title ? (matchTitleLevel(input.current_title) ?? '未分类') : null,
    years_experience: input.years_experience ?? null,
    salary_range: input.expected_salary != null ? matchSalaryBand(input.expected_salary) : null,
    education_tier: input.education_school ? (SCHOOL_TIERS[input.education_school] ?? '普通') : null,
    skills: input.skills ?? [],
  };
}

function matchTitleLevel(title: string): string | null {
  for (const { regex, level } of TITLE_LEVEL_PATTERNS) {
    if (regex.test(title)) return level;
  }
  return null;
}

function matchSalaryBand(salary: number): string {
  for (const band of SALARY_BANDS) {
    if (salary >= band.min && (band.max === null || salary < band.max)) return band.label;
  }
  return SALARY_BANDS[SALARY_BANDS.length - 1].label;  // 兜底
}
```

- [ ] **Step 5: 跑测试**

```bash
pnpm test tests/unit/desensitize/engine.test.ts
```
Expected: 4 passed。

- [ ] **Step 6: 提交**

```bash
git add src/main/modules/desensitize/ tests/unit/desensitize/
git commit -m "feat(desensitize): field mapping engine with graceful degradation"
```

---

### Task 8: API Key 生成与验证

**Files:**
- Create: `src/main/modules/auth/api-key.ts`
- Create: `tests/unit/auth/api-key.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/unit/auth/api-key.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';

describe('api-key', () => {
  it('generates key with hp_live_ prefix', async () => {
    const { generateApiKey } = await import('../../../src/main/modules/auth/api-key');
    const { key, hash, prefix } = generateApiKey();
    expect(key).toMatch(/^hp_live_[A-Za-z0-9]{32,}$/);
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
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/auth/api-key.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 api-key.ts**

`src/main/modules/auth/api-key.ts`：
```typescript
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';

export interface GeneratedApiKey {
  key: string;
  hash: string;
  prefix: string;
}

const BCRYPT_ROUNDS = 10;

export function generateApiKey(): GeneratedApiKey {
  const random = randomBytes(24).toString('base64url');  // 32 字符
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
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/unit/auth/api-key.test.ts
```
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/auth/api-key.ts tests/unit/auth/api-key.test.ts
git commit -m "feat(auth): API key gen/verify with bcrypt"
```

---

### Task 9: User Repository

**Files:**
- Create: `src/main/db/repositories/users.ts`
- Create: `tests/integration/repos/users.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/repos/users.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('users repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/users.db');
  let db: any;
  let users: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('inserts and finds by id', () => {
    users.insert({
      id: 'user_1', user_type: 'headhunter', name: 'Bob', contact: 'b@x.com',
      agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_',
      quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z',
      reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
    const u = users.findById('user_1');
    expect(u?.name).toBe('Bob');
  });

  it('finds by api key hash', () => {
    users.insert({
      id: 'user_2', user_type: 'candidate', name: 'A', contact: null,
      agent_endpoint: null, api_key_hash: 'unique-hash-2', api_key_prefix: 'hp_live_',
      quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z',
      reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
    const u = users.findByApiKeyHash('unique-hash-2');
    expect(u?.id).toBe('user_2');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/repos/users.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 users.ts**

`src/main/db/repositories/users.ts`：
```typescript
import type Database from 'better-sqlite3';
import type { User } from '../../../shared/types.js';

export function createUsersRepo(db: Database.Database) {
  const insertStmt = db.prepare(`
    INSERT INTO users (id, user_type, name, contact, agent_endpoint,
                       api_key_hash, api_key_prefix, quota_per_day, quota_used,
                       quota_reset_at, reputation, status, created_at, updated_at)
    VALUES (@id, @user_type, @name, @contact, @agent_endpoint,
            @api_key_hash, @api_key_prefix, @quota_per_day, @quota_used,
            @quota_reset_at, @reputation, @status, @created_at, @updated_at)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
  const findByHashStmt = db.prepare('SELECT * FROM users WHERE api_key_hash = ?');

  return {
    insert(user: User): void {
      insertStmt.run(user);
    },
    findById(id: string): User | undefined {
      return findByIdStmt.get(id) as User | undefined;
    },
    findByApiKeyHash(hash: string): User | undefined {
      return findByHashStmt.get(hash) as User | undefined;
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/repos/users.test.ts
```
Expected: 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/main/db/repositories/users.ts tests/integration/repos/users.test.ts
git commit -m "feat(repo): users repository"
```

---

### Task 10: 配额原子扣减（防竞态）

**Files:**
- Create: `src/main/modules/quota/manager.ts`
- Create: `tests/integration/quota.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/quota.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('quota manager', () => {
  const testDb = path.join(__dirname, '../../tmp/quota.db');
  let db: any, users: any, quota: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
    quota = require('../../../src/main/modules/quota/manager').createQuotaManager(db);
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  function seedUser(id: string, used: number, perDay: number) {
    users.insert({
      id, user_type: 'headhunter', name: id, contact: null, agent_endpoint: null,
      api_key_hash: `h-${id}`, api_key_prefix: 'hp_live_', quota_per_day: perDay,
      quota_used: used, quota_reset_at: '2026-06-18T00:00:00Z',
      reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
  }

  it('decrements quota atomically', () => {
    seedUser('u1', 0, 100);
    const result = quota.tryConsume('u1', 5);
    expect(result.ok).toBe(true);
    expect(result.quota_used).toBe(5);
  });

  it('rejects when quota would be exceeded', () => {
    seedUser('u2', 98, 100);
    const result = quota.tryConsume('u2', 5);  // 98+5=103 > 100
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_QUOTA');
  });

  it('rejects suspended user', () => {
    seedUser('u3', 0, 100);
    db.prepare("UPDATE users SET status='suspended' WHERE id='u3'").run();
    const result = quota.tryConsume('u3', 5);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('FORBIDDEN');
  });

  it('handles concurrent decrements correctly (race condition test)', () => {
    seedUser('u4', 0, 10);
    // 模拟 20 个并发请求，每个消耗 1
    const results = Array.from({ length: 20 }, () => quota.tryConsume('u4', 1));
    const successCount = results.filter((r: any) => r.ok).length;
    // 只应有 10 次成功（quota=10）
    expect(successCount).toBe(10);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/quota.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 manager.ts**

`src/main/modules/quota/manager.ts`：
```typescript
import type Database from 'better-sqlite3';
import { Errors } from '../../errors.js';

export type ConsumeResult =
  | { ok: true; quota_used: number; quota_per_day: number }
  | { ok: false; reason: 'INSUFFICIENT_QUOTA' | 'FORBIDDEN' | 'NOT_FOUND' };

export function createQuotaManager(db: Database.Database) {
  // 单条 SQL 原子完成：状态检查 + 余量检查 + 扣减
  const consumeStmt = db.prepare(`
    UPDATE users
    SET quota_used = quota_used + ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'active'
      AND quota_used + ? <= quota_per_day
    RETURNING quota_used, quota_per_day
  `);

  return {
    tryConsume(userId: string, amount: number): ConsumeResult {
      const now = new Date().toISOString();
      const row = consumeStmt.get(amount, now, userId, amount) as
        | { quota_used: number; quota_per_day: number }
        | undefined;

      if (row) return { ok: true, quota_used: row.quota_used, quota_per_day: row.quota_per_day };

      // 区分失败原因
      const user = db.prepare('SELECT status FROM users WHERE id = ?').get(userId) as
        | { status: string }
        | undefined;
      if (!user) return { ok: false, reason: 'NOT_FOUND' };
      if (user.status !== 'active') return { ok: false, reason: 'FORBIDDEN' };
      return { ok: false, reason: 'INSUFFICIENT_QUOTA' };
    },

    resetDaily(userId: string, newResetAt: string): void {
      db.prepare(
        'UPDATE users SET quota_used = 0, quota_reset_at = ?, updated_at = ? WHERE id = ?'
      ).run(newResetAt, new Date().toISOString(), userId);
    },

    resetAllExpired(currentResetBefore: string): number {
      const result = db.prepare(
        "UPDATE users SET quota_used = 0, quota_reset_at = ?, updated_at = ? WHERE quota_reset_at <= ? AND status = 'active'"
      ).run(currentResetBefore, new Date().toISOString(), currentResetBefore);
      return result.changes;
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/quota.test.ts
```
Expected: 4 passed（重点关注并发测试）。

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/quota/manager.ts tests/integration/quota.test.ts
git commit -m "feat(quota): atomic decrement (single SQL) prevents race"
```

---

### Task 11: 限流桶（三层）

**Files:**
- Create: `src/main/modules/rate-limit/bucket.ts`
- Create: `tests/integration/rate-limit.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/rate-limit.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('rate limit bucket', () => {
  const testDb = path.join(__dirname, '../../tmp/rl.db');
  let db: any, rl: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    rl = require('../../../src/main/modules/rate-limit/bucket').createRateLimit(db);
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('allows requests under limit', () => {
    const result = rl.check('user_1', [{ windowSeconds: 60, limit: 10 }]);
    expect(result.allowed).toBe(true);
  });

  it('rejects when over limit', () => {
    for (let i = 0; i < 10; i++) rl.check('user_2', [{ windowSeconds: 60, limit: 10 }]);
    const result = rl.check('user_2', [{ windowSeconds: 60, limit: 10 }]);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('RATE_LIMITED');
  });

  it('supports IP-style user_id (no user record needed)', () => {
    const result = rl.check('ip:1.2.3.4', [{ windowSeconds: 60, limit: 5 }]);
    expect(result.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/rate-limit.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 bucket.ts**

`src/main/modules/rate-limit/bucket.ts`：
```typescript
import type Database from 'better-sqlite3';

export interface RateLimitWindow {
  windowSeconds: number;
  limit: number;
}

export type RateLimitResult =
  | { allowed: true; remaining: Record<number, number> }
  | { allowed: false; reason: 'RATE_LIMITED'; violatedWindow: number };

export function createRateLimit(db: Database.Database) {
  const upsertStmt = db.prepare(`
    INSERT INTO rate_limit_buckets (user_id, window_start, window_seconds, request_count, expires_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (user_id, window_start, window_seconds)
    DO UPDATE SET request_count = request_count + 1
    RETURNING request_count
  `);

  function bucketStart(now: Date, windowSeconds: number): string {
    const ms = now.getTime();
    const bucketMs = Math.floor(ms / (windowSeconds * 1000)) * windowSeconds * 1000;
    return new Date(bucketMs).toISOString();
  }

  return {
    check(userId: string, windows: RateLimitWindow[]): RateLimitResult {
      const now = new Date();
      const remaining: Record<number, number> = {};
      for (const w of windows) {
        const start = bucketStart(now, w.windowSeconds);
        const expires = new Date(new Date(start).getTime() + w.windowSeconds * 1000 * 2).toISOString();
        const row = upsertStmt.get(userId, start, w.windowSeconds, expires) as { request_count: number };
        const remainingCount = Math.max(0, w.limit - row.request_count);
        remaining[w.windowSeconds] = remainingCount;
        if (row.request_count > w.limit) {
          return { allowed: false, reason: 'RATE_LIMITED', violatedWindow: w.windowSeconds };
        }
      }
      return { allowed: true, remaining };
    },

    cleanupExpired(): number {
      const result = db.prepare('DELETE FROM rate_limit_buckets WHERE expires_at < ?')
        .run(new Date().toISOString());
      return result.changes;
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/rate-limit.test.ts
```
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/rate-limit/bucket.ts tests/integration/rate-limit.test.ts
git commit -m "feat(rate-limit): 3-tier buckets with atomic upsert"
```

---

### Task 12: 幂等中间件

**Files:**
- Create: `src/main/modules/idempotency/middleware.ts`
- Create: `src/main/db/repositories/idempotency-keys.ts`
- Create: `tests/integration/idempotency.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/idempotency.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('idempotency middleware', () => {
  const testDb = path.join(__dirname, '../../tmp/idem.db');
  let db: any, users: any, mw: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
    users.insert({
      id: 'u1', user_type: 'headhunter', name: 'A', contact: null, agent_endpoint: null,
      api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0,
      quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
    mw = require('../../../src/main/modules/idempotency/middleware').createIdempotencyMiddleware(db);
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('returns cached response on duplicate', () => {
    const key = 'idem-key-1';
    const body = JSON.stringify({ foo: 'bar' });
    const hash = crypto.createHash('sha256').update(body).digest('hex');
    const r1 = mw.processOrCache(key, 'u1', hash, 200, JSON.stringify({ ok: true, data: { id: 1 } }));
    expect(r1.cacheHit).toBe(false);
    const r2 = mw.processOrCache(key, 'u1', hash, 200, JSON.stringify({ ok: true, data: { id: 2 } }));
    expect(r2.cacheHit).toBe(true);
    expect(JSON.parse(r2.body)).toEqual({ ok: true, data: { id: 1 } });
  });

  it('returns DUPLICATE_REQUEST on different body with same key', () => {
    const key = 'idem-key-2';
    const r1 = mw.processOrCache(key, 'u1', 'hash1', 200, '{}');
    const r2 = mw.processOrCache(key, 'u1', 'hash2', 200, '{}');
    expect(r2.duplicate).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/idempotency.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 idempotency-keys 仓库**

`src/main/db/repositories/idempotency-keys.ts`：
```typescript
import type Database from 'better-sqlite3';

export interface IdempotencyRecord {
  key: string;
  user_id: string;
  request_hash: string;
  response_json: string;
  status_code: number;
  expires_at: string;
  created_at: string;
}

export function createIdempotencyRepo(db: Database.Database) {
  const insertStmt = db.prepare(`
    INSERT INTO idempotency_keys (key, user_id, request_hash, response_json, status_code, expires_at, created_at)
    VALUES (@key, @user_id, @request_hash, @response_json, @status_code, @expires_at, @created_at)
  `);
  const findStmt = db.prepare('SELECT * FROM idempotency_keys WHERE key = ?');

  return {
    insert(rec: IdempotencyRecord): void { insertStmt.run(rec); },
    findByKey(key: string): IdempotencyRecord | undefined {
      return findStmt.get(key) as IdempotencyRecord | undefined;
    },
    cleanupExpired(): number {
      const r = db.prepare('DELETE FROM idempotency_keys WHERE expires_at < ?')
        .run(new Date().toISOString());
      return r.changes;
    },
  };
}
```

- [ ] **Step 4: 实现 middleware**

`src/main/modules/idempotency/middleware.ts`：
```typescript
import type Database from 'better-sqlite3';
import { createIdempotencyRepo } from '../../db/repositories/idempotency-keys.js';
import { IDEMPOTENCY_TTL_HOURS } from '../../../shared/constants.js';

export interface ProcessResult {
  cacheHit: boolean;
  duplicate: boolean;
  statusCode: number;
  body: string;
}

export function createIdempotencyMiddleware(db: Database.Database) {
  const repo = createIdempotencyRepo(db);

  return {
    processOrCache(
      key: string,
      userId: string,
      requestHash: string,
      statusCode: number,
      responseBody: string,
    ): ProcessResult {
      const existing = repo.findByKey(key);
      const now = new Date();

      if (existing) {
        if (existing.expires_at < now.toISOString()) {
          // 已过期，按新请求处理
        } else if (existing.request_hash !== requestHash) {
          return { cacheHit: false, duplicate: true, statusCode: 409, body: '' };
        } else {
          return { cacheHit: true, duplicate: false, statusCode: existing.status_code, body: existing.response_json };
        }
      }

      // 缓存响应（仅脱敏后的响应，含 PII 不应调用此函数）
      const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_HOURS * 3600 * 1000).toISOString();
      repo.insert({
        key, user_id: userId, request_hash: requestHash,
        response_json: responseBody, status_code: statusCode,
        expires_at: expiresAt, created_at: now.toISOString(),
      });
      return { cacheHit: false, duplicate: false, statusCode, body: responseBody };
    },
  };
}
```

- [ ] **Step 5: 跑测试**

```bash
pnpm test tests/integration/idempotency.test.ts
```
Expected: 2 passed。

- [ ] **Step 6: 提交**

```bash
git add src/main/db/repositories/idempotency-keys.ts src/main/modules/idempotency/middleware.ts tests/integration/idempotency.test.ts
git commit -m "feat(idempotency): middleware with 24h cache + dup detection"
```

---

## Milestone 1.C：HTTP 服务 + Register 端点

### Task 13: Express 服务器骨架

**Files:**
- Create: `src/main/server.ts`
- Create: `src/main/index.ts`
- Create: `tests/integration/server.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/server.test.ts`：
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('health endpoint', () => {
  const testDb = path.join(__dirname, '../../tmp/srv.db');
  let app: any;

  beforeAll(() => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = require('../../src/main/server');
    app = createApp();
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('GET /v1/health returns ok', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe('healthy');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/server.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 server.ts**

`src/main/server.ts`：
```typescript
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { openDb } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { loadEnv } from './env.js';
import { ApiError } from './errors.js';

export function createApp(): Express {
  const env = loadEnv();
  const db = openDb(env.DATABASE_PATH);
  runMigrations(db);

  const app = express();
  app.use(express.json({ limit: '4kb' }));

  // Routes
  app.get('/v1/health', (_req, res) => {
    res.json({ ok: true, data: { status: 'healthy', timestamp: new Date().toISOString() } });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({
        ok: false,
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  return app;
}
```

- [ ] **Step 4: 实现 index.ts**

`src/main/index.ts`：
```typescript
import { createApp } from './server.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const app = createApp();
app.listen(env.PORT, () => {
  console.log(`Hunter platform API listening on port ${env.PORT}`);
});
```

- [ ] **Step 5: 跑测试**

```bash
pnpm test tests/integration/server.test.ts
```
Expected: 1 passed。

- [ ] **Step 6: 提交**

```bash
git add src/main/server.ts src/main/index.ts tests/integration/server.test.ts
git commit -m "feat(server): Express app skeleton + health endpoint"
```

---

### Task 14: Auth 中间件

**Files:**
- Create: `src/main/modules/auth/middleware.ts`
- Create: `tests/integration/auth-middleware.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/auth-middleware.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('auth middleware', () => {
  const testDb = path.join(__dirname, '../../tmp/auth.db');
  let db: any, users: any, verifyApiKey: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
    ({ verifyApiKey } = await import('../../../src/main/modules/auth/api-key'));
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  function seedUser(id: string, hash: string, prefix: string) {
    users.insert({
      id, user_type: 'headhunter', name: id, contact: null, agent_endpoint: null,
      api_key_hash: hash, api_key_prefix: prefix, quota_per_day: 100, quota_used: 0,
      quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
  }

  it('authenticates valid key and resolves user', async () => {
    const { generateApiKey } = await import('../../../src/main/modules/auth/api-key');
    const { key, hash, prefix } = generateApiKey();
    seedUser('u1', hash, prefix);
    const { authMiddleware } = await import('../../../src/main/modules/auth/middleware');
    const mw = authMiddleware(db, users);
    const req: any = { headers: { authorization: `Bearer ${key}` } };
    let resolvedUser: any = null;
    await new Promise<void>((resolve, reject) => {
      mw(req, {} as any, (err?: any) => err ? reject(err) : resolve()).catch(reject);
    }).then(() => { resolvedUser = req.user; });
    expect(resolvedUser?.id).toBe('u1');
  });

  it('rejects missing authorization header', async () => {
    const { authMiddleware } = await import('../../../src/main/modules/auth/middleware');
    const mw = authMiddleware(db, users);
    const req: any = { headers: {} };
    let caught: any;
    await new Promise<void>((resolve) => {
      mw(req, {} as any, (err?: any) => { caught = err; resolve(); });
    });
    expect(caught).toBeDefined();
    expect(caught.code).toBe('UNAUTHORIZED');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/auth-middleware.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 middleware.ts**

`src/main/modules/auth/middleware.ts`：
```typescript
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import type { User } from '../../../shared/types.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { verifyApiKey } from './api-key.js';
import { Errors } from '../../errors.js';

declare module 'express-serve-static-core' {
  interface Request { user?: User }
}

export function authMiddleware(db: Database.Database, usersRepo = createUsersRepo(db)): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) throw Errors.unauthorized();
      const key = auth.slice(7);
      const prefix = key.slice(0, 8);

      // 通过 prefix 缩小候选集 → 再 bcrypt 验证
      const candidates = db.prepare(
        'SELECT * FROM users WHERE api_key_prefix = ? AND status = ?'
      ).all(prefix, 'active') as User[];

      const matched = candidates.find(u => verifyApiKey(key, u.api_key_hash));
      if (!matched) throw Errors.unauthorized();

      req.user = matched;
      next();
    } catch (e) { next(e); }
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/auth-middleware.test.ts
```
Expected: 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/auth/middleware.ts tests/integration/auth-middleware.test.ts
git commit -m "feat(auth): Express middleware with prefix-bucketed key lookup"
```

---

### Task 15: POST /v1/auth/register 端点

**Files:**
- Create: `src/main/modules/register/handler.ts`
- Create: `src/main/routes/auth.ts`
- Create: `tests/integration/register.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/register.test.ts`：
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('POST /v1/auth/register', () => {
  const testDb = path.join(__dirname, '../../tmp/reg.db');
  let app: any;

  beforeAll(() => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = require('../../src/main/server');
    app = createApp();
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('registers a new headhunter', async () => {
    const res = await request(app)
      .post('/v1/auth/register')
      .send({
        user_type: 'headhunter',
        name: '猎头-Bob',
        contact: 'bob@example.com',
        agent_endpoint: 'https://bob.example.com/webhook',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.user_id).toMatch(/^user_/);
    expect(res.body.data.api_key).toMatch(/^hp_live_/);
  });

  it('rejects duplicate contact within 24h', async () => {
    const payload = { user_type: 'candidate', name: 'A', contact: 'dup@x.com' };
    const r1 = await request(app).post('/v1/auth/register').send(payload);
    expect(r1.status).toBe(200);
    const r2 = await request(app).post('/v1/auth/register').send(payload);
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('DUPLICATE_REQUEST');
  });

  it('rejects missing required fields', async () => {
    const res = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
  });

  it('rejects non-HTTPS agent_endpoint in production', async () => {
    process.env.NODE_ENV = 'production';
    const { createApp } = require('../../src/main/server');
    const prodApp = createApp();
    const res = await request(prodApp)
      .post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'A', contact: 'a@x.com', agent_endpoint: 'http://insecure.example.com' });
    expect(res.status).toBe(400);
    process.env.NODE_ENV = 'test';
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/register.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 handler.ts**

`src/main/modules/register/handler.ts`：
```typescript
import type Database from 'better-sqlite3';
import { createUsersRepo } from '../../db/repositories/users.js';
import { createRateLimit } from '../rate-limit/bucket.js';
import { generateApiKey } from '../auth/api-key.js';
import { QUOTA_PER_DAY } from '../../../shared/constants.js';
import type { UserType, User } from '../../../shared/types.js';
import { Errors } from '../../errors.js';
import { randomUUID } from 'node:crypto';

export function createRegisterHandler(db: Database.Database) {
  const users = createUsersRepo(db);
  const rl = createRateLimit(db);
  const findByContactStmt = db.prepare(
    "SELECT id FROM users WHERE contact = ? AND created_at > datetime('now', '-1 day') AND status != 'deleted'"
  );

  return {
    handle(userType: UserType, name: string, contact: string | undefined, agentEndpoint: string | undefined, clientIp: string, isProduction: boolean): User & { api_key: string } {
      // 1. IP 限流：1h 内同 IP 最多 5 次
      const rlResult = rl.check(`ip:${clientIp}`, [{ windowSeconds: 3600, limit: 5 }]);
      if (!rlResult.allowed) throw Errors.rateLimited('IP register rate limit exceeded');

      // 2. contact 重复检查
      if (contact && findByContactStmt.get(contact)) {
        throw Errors.duplicateRequest('Contact already registered within 24h');
      }

      // 3. agent_endpoint HTTPS 校验（生产）
      if (isProduction && agentEndpoint && !agentEndpoint.startsWith('https://')) {
        throw Errors.invalidParams('agent_endpoint must be HTTPS in production');
      }

      // 4. 生成 API key
      const { key, hash, prefix } = generateApiKey();
      const userId = `user_${randomUUID().slice(0, 12)}`;
      const now = new Date().toISOString();
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

      const user: User = {
        id: userId,
        user_type: userType,
        name,
        contact: contact ?? null,
        agent_endpoint: agentEndpoint ?? null,
        api_key_hash: hash,
        api_key_prefix: prefix,
        quota_per_day: QUOTA_PER_DAY[userType],
        quota_used: 0,
        quota_reset_at: tomorrow,
        reputation: 50,
        status: 'active',
        created_at: now,
        updated_at: now,
      };
      users.insert(user);

      return { ...user, api_key: key };
    },
  };
}
```

- [ ] **Step 4: 实现 routes/auth.ts**

`src/main/routes/auth.ts`：
```typescript
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { createRegisterHandler } from '../modules/register/handler.js';
import { Errors } from '../errors.js';

const RegisterSchema = z.object({
  user_type: z.enum(['candidate', 'headhunter', 'employer']),
  name: z.string().min(1).max(100),
  contact: z.string().min(1).max(200).optional(),
  agent_endpoint: z.string().url().optional(),
});

export function createAuthRouter(db: Database.Database, isProduction: boolean): Router {
  const router = Router();
  const handler = createRegisterHandler(db);

  router.post('/register', (req, res, next) => {
    try {
      const parsed = RegisterSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
      const user = handler.handle(parsed.data.user_type, parsed.data.name, parsed.data.contact, parsed.data.agent_endpoint, ip, isProduction);
      res.json({
        ok: true,
        data: {
          user_id: user.id,
          api_key: user.api_key,
          quota_per_day: user.quota_per_day,
          user_type: user.user_type,
        },
      });
    } catch (e) { next(e); }
  });

  return router;
}
```

- [ ] **Step 5: 挂载路由到 server**

修改 `src/main/server.ts`：
```typescript
// 在 app.use(express.json...) 后添加：
import { createAuthRouter } from './routes/auth.js';
app.use('/v1/auth', createAuthRouter(db, env.NODE_ENV === 'production'));
```

- [ ] **Step 6: 跑测试**

```bash
pnpm test tests/integration/register.test.ts
```
Expected: 4 passed。

- [ ] **Step 7: 提交**

```bash
git add src/main/modules/register/handler.ts src/main/routes/auth.ts tests/integration/register.test.ts src/main/server.ts
git commit -m "feat(register): POST /v1/auth/register with IP rate limit + HTTPS check"
```

---

## Milestone 1.D：候选人上传

### Task 16: Candidates 仓库

**Files:**
- Create: `src/main/db/repositories/candidates-private.ts`
- Create: `src/main/db/repositories/candidates-anonymized.ts`
- Create: `tests/integration/repos/candidates.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/repos/candidates.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('candidates repositories', () => {
  const testDb = path.join(__dirname, '../../../tmp/cand.db');
  let db: any, priv: any, anon: any, users: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    priv = require('../../../src/main/db/repositories/candidates-private').createCandidatesPrivateRepo(db);
    anon = require('../../../src/main/db/repositories/candidates-anonymized').createCandidatesAnonymizedRepo(db);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
    users.insert({
      id: 'h1', user_type: 'headhunter', name: 'Hunter', contact: null, agent_endpoint: null,
      api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0,
      quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
    users.insert({
      id: 'c1', user_type: 'candidate', name: 'Cand', contact: null, agent_endpoint: null,
      api_key_hash: 'c', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0,
      quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('inserts private and anonymized pair', () => {
    priv.insert({
      id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1',
      name_enc: 'n', phone_enc: 'p', email_enc: 'e',
      current_company_raw: '字节跳动', current_title_raw: '高级前端',
      expected_salary: 750000, years_experience: 8, education_school: '清华大学',
      resume_url: null, skills_json: '["React"]', raw_payload_json: null,
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
    const p = priv.findById('cp_1');
    expect(p?.current_company_raw).toBe('字节跳动');

    anon.insert({
      id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1',
      industry: '互联网', title_level: 'P6', years_experience: 8,
      salary_range: '60-80万', education_tier: '985', skills_json: '["React"]',
      is_public_pool: 0, unlock_status: 'locked',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
    const a = anon.findById('ca_1');
    expect(a?.industry).toBe('互联网');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/repos/candidates.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 candidates-private 仓库**

`src/main/db/repositories/candidates-private.ts`：
```typescript
import type Database from 'better-sqlite3';

export interface CandidatePrivate {
  id: string;
  headhunter_id: string;
  candidate_user_id: string;
  name_enc: string;
  phone_enc: string;
  email_enc: string;
  current_company_raw: string | null;
  current_title_raw: string | null;
  expected_salary: number | null;
  years_experience: number | null;
  education_school: string | null;
  resume_url: string | null;
  skills_json: string | null;
  raw_payload_json: string | null;
  created_at: string;
  updated_at: string;
}

export function createCandidatesPrivateRepo(db: Database.Database) {
  const insertStmt = db.prepare(`
    INSERT INTO candidates_private (id, headhunter_id, candidate_user_id,
      name_enc, phone_enc, email_enc, current_company_raw, current_title_raw,
      expected_salary, years_experience, education_school, resume_url,
      skills_json, raw_payload_json, created_at, updated_at)
    VALUES (@id, @headhunter_id, @candidate_user_id,
      @name_enc, @phone_enc, @email_enc, @current_company_raw, @current_title_raw,
      @expected_salary, @years_experience, @education_school, @resume_url,
      @skills_json, @raw_payload_json, @created_at, @updated_at)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM candidates_private WHERE id = ?');

  return {
    insert(c: CandidatePrivate): void { insertStmt.run(c); },
    findById(id: string): CandidatePrivate | undefined {
      return findByIdStmt.get(id) as CandidatePrivate | undefined;
    },
  };
}
```

- [ ] **Step 4: 实现 candidates-anonymized 仓库**

`src/main/db/repositories/candidates-anonymized.ts`：
```typescript
import type Database from 'better-sqlite3';

export interface CandidateAnonymized {
  id: string;
  source_private_id: string;
  source_headhunter_id: string;
  industry: string | null;
  title_level: string | null;
  years_experience: number | null;
  salary_range: string | null;
  education_tier: string | null;
  skills_json: string | null;
  is_public_pool: number;
  unlock_status: 'locked' | 'unlocked' | 'revoked';
  created_at: string;
  updated_at: string;
}

export function createCandidatesAnonymizedRepo(db: Database.Database) {
  const insertStmt = db.prepare(`
    INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id,
      industry, title_level, years_experience, salary_range, education_tier,
      skills_json, is_public_pool, unlock_status, created_at, updated_at)
    VALUES (@id, @source_private_id, @source_headhunter_id,
      @industry, @title_level, @years_experience, @salary_range, @education_tier,
      @skills_json, @is_public_pool, @unlock_status, @created_at, @updated_at)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM candidates_anonymized WHERE id = ?');

  return {
    insert(c: CandidateAnonymized): void { insertStmt.run(c); },
    findById(id: string): CandidateAnonymized | undefined {
      return findByIdStmt.get(id) as CandidateAnonymized | undefined;
    },
  };
}
```

- [ ] **Step 5: 跑测试**

```bash
pnpm test tests/integration/repos/candidates.test.ts
```
Expected: 1 passed。

- [ ] **Step 6: 提交**

```bash
git add src/main/db/repositories/candidates-private.ts src/main/db/repositories/candidates-anonymized.ts tests/integration/repos/candidates.test.ts
git commit -m "feat(repo): candidates private + anonymized"
```

---

### Task 17: POST /v1/headhunter/candidates 端点

**Files:**
- Create: `src/main/modules/headhunter/handler.ts`
- Create: `src/main/routes/headhunter.ts`
- Create: `tests/integration/upload-candidate.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/upload-candidate.test.ts`：
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('POST /v1/headhunter/candidates', () => {
  const testDb = path.join(__dirname, '../../tmp/upload.db');
  let app: any, headhunterKey: string, candidateKey: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = require('../../src/main/server');
    app = createApp();

    // 预创建猎头 + 候选人
    const h = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H', contact: 'h1@x.com' });
    headhunterKey = h.body.data.api_key;
    const c = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C', contact: 'c1@x.com' });
    candidateKey = c.body.data.api_key;
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('uploads and desensitizes candidate', async () => {
    const c = await request(app).get('/v1/health');  // warmup
    const me = await request(app).get('/v1/health');  // get candidate user_id
    // 实际拿 user_id
    const candidateUserId = c.body.data.timestamp;  // placeholder, replace below

    const r = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterKey}`)
      .send({
        candidate_user_id: 'PLACEHOLDER',  // 修复
        name: '张三',
        phone: '13800138000',
        email: 'z@x.com',
        current_company: '字节跳动',
        current_title: '高级前端工程师',
        expected_salary: 750000,
        years_experience: 8,
        education_school: '清华大学',
        skills: ['React', 'TypeScript'],
      });
    expect(r.status).toBe(200);
    expect(r.body.data.preview.industry).toBe('互联网');
    expect(r.body.data.preview.title_level).toBe('P6');
    expect(r.body.data.preview.salary_range).toBe('60-80万');
    // PII 绝对不返回
    expect(r.body.data.preview).not.toHaveProperty('name');
    expect(r.body.data.preview).not.toHaveProperty('phone');
    expect(r.body.data.preview).not.toHaveProperty('email');
  });

  it('rejects unauthenticated request', async () => {
    const r = await request(app).post('/v1/headhunter/candidates').send({});
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/upload-candidate.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 headhunter handler**

`src/main/modules/headhunter/handler.ts`：
```typescript
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createCandidatesPrivateRepo } from '../../db/repositories/candidates-private.js';
import { createCandidatesAnonymizedRepo } from '../../db/repositories/candidates-anonymized.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { createQuotaManager } from '../quota/manager.js';
import { createRateLimit } from '../rate-limit/bucket.js';
import { encrypt, zeroMemory } from '../crypto/aes-gcm.js';
import { desensitize } from '../desensitize/engine.js';
import { QUOTA_COSTS, RATE_LIMIT_BURSTS } from '../../../shared/constants.js';
import { Errors } from '../../errors.js';
import type { User, AnonymizedCandidate } from '../../../shared/types.js';

export interface UploadCandidateInput {
  candidate_user_id: string;
  name: string;
  phone: string;
  email: string;
  current_company?: string;
  current_title?: string;
  expected_salary?: number;
  years_experience?: number;
  education_school?: string;
  skills?: string[];
}

export function createHeadhunterHandler(db: Database.Database, encryptionKey: Buffer) {
  const priv = createCandidatesPrivateRepo(db);
  const anon = createCandidatesAnonymizedRepo(db);
  const users = createUsersRepo(db);
  const quota = createQuotaManager(db);
  const rl = createRateLimit(db);

  return {
    async uploadCandidate(user: User, input: UploadCandidateInput): Promise<{ anonymized_id: string; preview: AnonymizedCandidate }> {
      // 1. 验证 user 是 headhunter
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can upload candidates');

      // 2. 验证 candidate_user_id 存在且是 candidate 类型
      const candidateUser = users.findById(input.candidate_user_id);
      if (!candidateUser) throw Errors.invalidParams('candidate_user_id not found');
      if (candidateUser.user_type !== 'candidate') throw Errors.invalidParams('Referenced user is not a candidate');

      // 3. 突发限流
      const limits = RATE_LIMIT_BURSTS.headhunter;
      const rlResult = rl.check(user.id, [
        { windowSeconds: 1, limit: limits.second },
        { windowSeconds: 60, limit: limits.minute },
        { windowSeconds: 3600, limit: limits.hour },
      ]);
      if (!rlResult.allowed) throw Errors.rateLimited('Burst rate limit exceeded', { remaining: rlResult.remaining });

      // 4. 配额扣减
      const quotaResult = quota.tryConsume(user.id, QUOTA_COSTS.upload_candidate);
      if (!quotaResult.ok) {
        if (quotaResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (quotaResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      // 5. 加密 PII（用 Buffer 包装以便清零）
      const nameBuf = Buffer.from(input.name, 'utf8');
      const phoneBuf = Buffer.from(input.phone, 'utf8');
      const emailBuf = Buffer.from(input.email, 'utf8');
      try {
        const nameEnc = encrypt(encryptionKey, input.name);
        const phoneEnc = encrypt(encryptionKey, input.phone);
        const emailEnc = encrypt(encryptionKey, input.email);

        // 6. 脱敏
        const preview = desensitize({
          current_company: input.current_company,
          current_title: input.current_title,
          expected_salary: input.expected_salary,
          years_experience: input.years_experience,
          education_school: input.education_school,
          skills: input.skills,
        });

        // 7. 写库
        const now = new Date().toISOString();
        const privId = `cp_${randomUUID().slice(0, 12)}`;
        const anonId = `ca_${randomUUID().slice(0, 12)}`;

        priv.insert({
          id: privId, headhunter_id: user.id, candidate_user_id: input.candidate_user_id,
          name_enc: nameEnc, phone_enc: phoneEnc, email_enc: emailEnc,
          current_company_raw: input.current_company ?? null,
          current_title_raw: input.current_title ?? null,
          expected_salary: input.expected_salary ?? null,
          years_experience: input.years_experience ?? null,
          education_school: input.education_school ?? null,
          resume_url: null, skills_json: JSON.stringify(input.skills ?? []),
          raw_payload_json: null,
          created_at: now, updated_at: now,
        });

        anon.insert({
          id: anonId, source_private_id: privId, source_headhunter_id: user.id,
          industry: preview.industry, title_level: preview.title_level,
          years_experience: preview.years_experience, salary_range: preview.salary_range,
          education_tier: preview.education_tier, skills_json: JSON.stringify(preview.skills),
          is_public_pool: 0, unlock_status: 'locked',
          created_at: now, updated_at: now,
        });

        return { anonymized_id: anonId, preview };
      } finally {
        // 立即清零内存中的 PII
        zeroMemory(nameBuf);
        zeroMemory(phoneBuf);
        zeroMemory(emailBuf);
      }
    },
  };
}
```

- [ ] **Step 4: 实现 headhunter 路由**

`src/main/routes/headhunter.ts`：
```typescript
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createHeadhunterHandler } from '../modules/headhunter/handler.js';
import { Errors } from '../errors.js';

const UploadSchema = z.object({
  candidate_user_id: z.string().min(1),
  name: z.string().min(1).max(100),
  phone: z.string().min(1).max(50),
  email: z.string().email(),
  current_company: z.string().max(200).optional(),
  current_title: z.string().max(100).optional(),
  expected_salary: z.number().int().positive().optional(),
  years_experience: z.number().int().min(0).max(60).optional(),
  education_school: z.string().max(200).optional(),
  skills: z.array(z.string()).optional(),
});

export function createHeadhunterRouter(db: Database.Database, encryptionKey: Buffer): Router {
  const router = Router();
  const handler = createHeadhunterHandler(db, encryptionKey);

  router.use(authMiddleware(db));

  router.post('/candidates', async (req, res, next) => {
    try {
      const parsed = UploadSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const result = await handler.uploadCandidate(req.user!, parsed.data);
      res.json({ ok: true, data: result });
    } catch (e) { next(e); }
  });

  return router;
}
```

- [ ] **Step 5: 挂载路由**

修改 `src/main/server.ts`：
```typescript
import { createHeadhunterRouter } from './routes/headhunter.js';
// ... 在 auth router 后面：
app.use('/v1/headhunter', createHeadhunterRouter(db, env.PLATFORM_ENCRYPTION_KEY));
```

- [ ] **Step 6: 修复测试 (替换 PLACEHOLDER)**

`tests/integration/upload-candidate.test.ts` 第 1 个 it：补充实际 candidate_user_id 拿取逻辑：

```typescript
it('uploads and desensitizes candidate', async () => {
  // 通过 status endpoint 或 db 直查拿 candidate user_id
  // 简化：直接查 db（测试允许）
  const Database = require('better-sqlite3');
  const testDbConn = new Database(testDb);
  const candidateRow = testDbConn.prepare("SELECT id FROM users WHERE user_type = 'candidate' LIMIT 1").get() as { id: string };
  testDbConn.close();

  const r = await request(app)
    .post('/v1/headhunter/candidates')
    .set('Authorization', `Bearer ${headhunterKey}`)
    .send({
      candidate_user_id: candidateRow.id,
      name: '张三',
      phone: '13800138000',
      email: 'z@x.com',
      current_company: '字节跳动',
      current_title: '高级前端工程师',
      expected_salary: 750000,
      years_experience: 8,
      education_school: '清华大学',
      skills: ['React', 'TypeScript'],
    });
  expect(r.status).toBe(200);
  expect(r.body.data.preview.industry).toBe('互联网');
  expect(r.body.data.preview.title_level).toBe('P6');
  expect(r.body.data.preview.salary_range).toBe('60-80万');
  expect(r.body.data.preview).not.toHaveProperty('name');
  expect(r.body.data.preview).not.toHaveProperty('phone');
  expect(r.body.data.preview).not.toHaveProperty('email');
});
```

- [ ] **Step 7: 跑测试**

```bash
pnpm test tests/integration/upload-candidate.test.ts
```
Expected: 2 passed。

- [ ] **Step 8: 提交**

```bash
git add src/main/modules/headhunter/handler.ts src/main/routes/headhunter.ts tests/integration/upload-candidate.test.ts src/main/server.ts
git commit -m "feat(headhunter): POST /v1/headhunter/candidates with desensitize + quota"
```

---

## Milestone 1.E：M1 完成验证

### Task 18: 端到端集成测试

**Files:**
- Create: `tests/integration/e2e.test.ts`

- [ ] **Step 1: 写完整 E2E 测试**

`tests/integration/e2e.test.ts`：
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('M1 end-to-end', () => {
  const testDb = path.join(__dirname, '../../tmp/e2e.db');
  let app: any;
  let headhunterKey: string, headhunterId: string;
  let candidateKey: string, candidateId: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = require('../../src/main/server');
    app = createApp();

    const h = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'E2E Hunter', contact: 'e2e-h@x.com' });
    headhunterKey = h.body.data.api_key;
    headhunterId = h.body.data.user_id;

    const c = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'E2E Cand', contact: 'e2e-c@x.com' });
    candidateKey = c.body.data.api_key;
    candidateId = c.body.data.user_id;
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('full flow: register -> upload -> verify desensitized + quota consumed', async () => {
    // 1. 上传候选人
    const upload = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterKey}`)
      .send({
        candidate_user_id: candidateId,
        name: '张三', phone: '13800138000', email: 'z@x.com',
        current_company: '阿里巴巴', current_title: 'P7 工程师',
        expected_salary: 1000000, years_experience: 10,
        education_school: '北京大学', skills: ['Java', 'Kafka'],
      });
    expect(upload.status).toBe(200);
    expect(upload.body.data.preview.industry).toBe('互联网');
    expect(upload.body.data.preview.title_level).toBe('P6');  // 高级工程师 regex 匹配
    expect(upload.body.data.preview.salary_range).toBe('80-120万');

    // 2. 配额被扣减到 5
    const Database = require('better-sqlite3');
    const conn = new Database(testDb, { readonly: true });
    const user = conn.prepare('SELECT quota_used FROM users WHERE id = ?').get(headhunterId) as { quota_used: number };
    expect(user.quota_used).toBe(5);
    conn.close();

    // 3. PII 已加密存储（DB 中不可见明文）
    const conn2 = new Database(testDb, { readonly: true });
    const priv = conn2.prepare('SELECT name_enc, phone_enc FROM candidates_private LIMIT 1').get() as { name_enc: string; phone_enc: string };
    expect(priv.name_enc).not.toContain('张三');
    expect(priv.phone_enc).not.toContain('13800138000');
    conn2.close();
  });

  it('rejects upload with insufficient quota after exhausting', async () => {
    // 已用 5/200，再发 50 次消耗 5*50=250 应失败
    // 简化：直接发 40 次（消耗 200），第 41 次失败
    for (let i = 0; i < 39; i++) {
      await request(app)
        .post('/v1/headhunter/candidates')
        .set('Authorization', `Bearer ${headhunterKey}`)
        .send({
          candidate_user_id: candidateId,
          name: 'X', phone: '13900000000', email: `x${i}@x.com`,
          skills: ['X'],
        });
    }
    const r = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterKey}`)
      .send({
        candidate_user_id: candidateId,
        name: 'Y', phone: '13900000001', email: 'y@x.com',
        skills: ['Y'],
      });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('INSUFFICIENT_QUOTA');
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test tests/integration/e2e.test.ts
```
Expected: 2 passed。

- [ ] **Step 3: 跑全部测试 + typecheck**

```bash
pnpm test
pnpm typecheck
```
Expected: 所有测试通过，typecheck 0 errors。

- [ ] **Step 4: 提交 + 打 tag**

```bash
git add tests/integration/e2e.test.ts
git commit -m "test(e2e): M1 end-to-end scenarios"
git tag -a m1-complete -m "Milestone 1 complete: core API + headhunter upload"
```

---

## ✅ M1 验收标准

M1 完成的定义（"Done"）：

- [ ] `pnpm test` 全部通过
- [ ] `pnpm typecheck` 0 错误
- [ ] `pnpm dev` 启动后能 curl 注册用户和上传候选人
- [ ] DB 中 PII 字段全部为加密 base64（明文搜索不到）
- [ ] `quota_used` 在并发扣减下不出现负数或越界
- [ ] Idempotency-Key 同 key 同 body 返回缓存，不同 body 返回 409
- [ ] Register 端点 1h 内同 IP 第 6 次返回 429

## 📋 P1/P2 Bug 覆盖（writing-plans 时补全测试）

M2+ 的 writing-plans 会为以下 11 个 bug 写专项 TDD 测试：

| Bug | 何时补测试 |
|-----|----------|
| Webhook 重放攻击 (P1) | M5 worker 实现时 |
| HMAC 时序攻击 (P1) | M5 worker 实现时 |
| 状态机事务 (P1) | M2 unlock handler |
| 跨猎头推荐冲突 (P1) | M2 recommend |
| 加密密钥轮换 (P1) | M3 admin 配置中心 |
| 技能搜索性能 (P1) | M5 性能测试 |
| 日志归档 (P2) | M4 audit log |
| Convo 单管理员 (P2) | M3 admin |
| HTTPS 强制 (P2) | M3 admin / 已部分覆盖 |
| GDPR 数据导出 (P2) | M4 audit |
| Email 验证 (P2) | v2 |

---

## 🚀 下一步（M2 计划）

M2 完成时（"三角色闭环"），本 plan 全部完成。后续计划：

- **M2 plan**: 雇主 / 候选人 API + 推荐 + 4 步解锁 + Webhook 队列（M1 的 Next Steps）
- **M3 plan**: Convo Electron 管理后台 + skill.md
- **M4 plan**: 佣金 + 完整审计
- **M5 plan**: Webhook Worker + 压测 + 性能监控

每个后续 plan 都会从 M1 增量构建。
