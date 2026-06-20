# P0 修复实施计划：注册 IP 限流加固 + 4KB Body Limit 拆分

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加固 `/v1/auth/register` 的 IP 限流（kill-switch 风险），拆分 `express.json` 全局 4KB 限制（解锁 5000 字 description 写入），把 `openapi:check` 接入 vitest globalSetup（防止 spec 漂移）。

**Architecture:**
- **Task A**：`createRateLimit()` 复用现有 IP-keyed sliding window，新增显式 `registerIpRateLimiter(db)` factory + 集成测试覆盖（验证 kill switch 语义）；同时移除 register handler 里直接读 `process.env.RATE_LIMIT_ENABLED` 的逻辑，让 kill switch 集中在一个文件里（防止多入口不一致）。
- **Task B**：删除 `server.ts:45` 的全局 `express.json({ limit: '4kb' })`，改成在 router mount 处按需注入：`/v1/employer` 走 64KB（容纳 5000 字中文描述），其它保持 4KB。
- **Task C**：`vitest.config.ts` 加 `globalSetup: './tests/global-setup.ts'`，在新文件里跑 `pnpm openapi:check` 等价的检查逻辑（避免 shell-out 引入复杂度）。

**Tech Stack:** Express 4.21, supertest, vitest, TypeScript strict + `exactOptionalPropertyTypes`, better-sqlite3, zod。

---

## 背景

来自安全审计的三处 P0/P2 风险：

### #1 — `/v1/auth/register` 限流（**已部分实现，需加固**）

外部审计报告称"register 无 IP 限流"。**验证发现**：`src/main/modules/register/handler.ts:27-31` 已经有 IP-keyed 限流：

```typescript
if (process.env.RATE_LIMIT_ENABLED !== 'false') {
  const rlResult = rl.check(`ip:${clientIp}`, [{ windowSeconds: 3600, limit: 5 }]);
  if (!rlResult.allowed) throw Errors.rateLimited('IP register rate limit exceeded');
}
```

**但**：
- `RATE_LIMIT_ENABLED=false` 直接绕过 — 与 `rate-limit/middleware.ts:26` 的 fail-closed 语义**相反**（middleware 看 `=== 'false'` 才关闭，register 看 `!== 'false'` 才开启）。两处不一致，运维误配置会导致其中一处静默关闭。
- 没有任何**测试**验证这条限流真的生效（grep `tests/` 0 命中针对 register 的 429 测试）。
- `agent_endpoint` 仍是 `z.string().url().optional()` —— **本次不做修改**，留给后续 task（需要先决定怎么 HEAD 验证可达性，是否启用 CAPTCHA）。

### #3 — 全局 4KB body limit 与 `description: max(5000)` 冲突

- `src/main/server.ts:45` 全局 `app.use(express.json({ limit: '4kb' }))`
- `src/main/routes/employer.ts:13` `description: z.string().max(5000).optional()`
- 5000 字符 UTF-8 中文约 15KB，4KB 直接 413。Schema 护栏实际上永远到不了。
- 这是真实 bug：中文 JD 描述超过约 1300 汉字就被拒。

### #4 — openapi.json 漂移

- `.github/workflows/` 不存在，没有 CI
- 但 vitest 是项目唯一的"绿/红"门。把 `openapi:check` 接进 vitest globalSetup 是零外部依赖的解法。

---

## 文件结构变更

```
src/main/
├── server.ts                              # 修改：移除全局 json limit
├── routes/
│   ├── employer.ts                        # 修改：router-level json(64kb)
│   └── auth.ts                            # 修改：router-level json(4kb) — 已隐含
├── modules/register/
│   └── handler.ts                         # 修改：使用新工厂 + 移除 process.env 直读
└── modules/rate-limit/
    └── register-limiter.ts                # 新建：registerIpRateLimiter factory

tests/
├── integration/
│   ├── register-ip-rate-limit.test.ts     # 新建：覆盖 5/h 限制 + kill switch 语义
│   └── employer-jobs-large-description.test.ts  # 新建：覆盖 5000 字中文 JD
└── global-setup.ts                        # 新建：跑 openapi:check
vitest.config.ts                           # 修改：注册 globalSetup
src/shared/constants.ts                    # 修改：BODY_LIMITS 常量
docs/superpowers/
└── skill.md                               # 修改：§X 加 admin body size 注释（如必要）
```

---

## Task A: 注册 IP 限流加固（kill switch 一致性 + 测试覆盖）

**Files:**
- Modify: `src/main/modules/register/handler.ts`（移除 process.env 直读，使用 factory）
- Create: `src/main/modules/rate-limit/register-limiter.ts`（统一 IP 限流入口）
- Create: `tests/integration/register-ip-rate-limit.test.ts`（5/h/IP + 多 IP 隔离 + kill switch）

- [ ] **Step 1：写失败的集成测试**

```typescript
// tests/integration/register-ip-rate-limit.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

const testDb = path.join(__dirname, '../../tmp/reg-rl.db');
let app: any;

describe('POST /v1/auth/register — IP rate limiting', () => {
  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    // 默认开启限流（与 production 一致）
    delete process.env.RATE_LIMIT_ENABLED;
    const { createApp } = await import('../../src/main/server');
    app = createApp();
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });
  beforeEach(async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const db = openDb(testDb);
    db.exec("DELETE FROM rate_limit_buckets");
    db.close();
  });

  it('allows first 5 registrations from the same IP', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/v1/auth/register')
        .set('X-Forwarded-For', '10.0.0.1')
        .send({ user_type: 'candidate', name: `n${i}`, contact: `c${i}@x.com` });
      expect(res.status).toBe(200);
    }
  });

  it('6th registration from same IP returns 429', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/v1/auth/register')
        .set('X-Forwarded-For', '10.0.0.2')
        .send({ user_type: 'candidate', name: `n${i}`, contact: `c${i}@x.com` });
    }
    const sixth = await request(app).post('/v1/auth/register')
      .set('X-Forwarded-For', '10.0.0.2')
      .send({ user_type: 'candidate', name: 'overflow', contact: 'over@x.com' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');
  });

  it('different IPs are isolated', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/v1/auth/register')
        .set('X-Forwarded-For', '10.0.0.3')
        .send({ user_type: 'candidate', name: `a${i}`, contact: `a${i}@x.com` });
    }
    // Different IP should NOT be blocked
    const other = await request(app).post('/v1/auth/register')
      .set('X-Forwarded-For', '10.0.0.4')
      .send({ user_type: 'candidate', name: 'b', contact: 'b@x.com' });
    expect(other.status).toBe(200);
  });

  it('RATE_LIMIT_ENABLED=false disables IP limit (kill switch works)', async () => {
    process.env.RATE_LIMIT_ENABLED = 'false';
    // Force re-import by clearing module cache (only way to re-read env)
    // NOTE: this test verifies the EXPLICITLY-DOCUMENTED kill switch behavior.
    // It's intentionally the last test so prior tests' buckets don't leak.
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../src/main/db/connection');
    const db = openDb(testDb);
    const { runMigrations } = await import('../../src/main/db/migrations');
    runMigrations(db);
    db.close();
    const { createApp } = await import('../../src/main/server?fresh');
    // Re-import with fresh cache to pick up new env
    const mod = await import(`../../src/main/server?t=${Date.now()}`);
    const app2 = mod.createApp();
    for (let i = 0; i < 10; i++) {
      const res = await request(app2).post('/v1/auth/register')
        .set('X-Forwarded-For', '10.0.0.5')
        .send({ user_type: 'candidate', name: `k${i}`, contact: `k${i}@x.com` });
      expect(res.status).toBe(200);
    }
    delete process.env.RATE_LIMIT_ENABLED;
  });
});
```

- [ ] **Step 2：跑测试看红**

Run: `pnpm vitest run tests/integration/register-ip-rate-limit.test.ts`
Expected: 测试**部分通过**（`allows first 5` 和 `different IPs` 已存在行为；`6th returns 429` 应过；`kill switch` 因 module cache 可能 skip）。主要验证**第 6 次被拒**这条覆盖到位。

- [ ] **Step 3：建 register-limiter 工厂**

```typescript
// src/main/modules/rate-limit/register-limiter.ts
import type { DB } from '../../db/connection.js';
import { createRateLimit } from './bucket.js';
import { Errors } from '../../errors.js';

/**
 * IP-keyed rate limit for /v1/auth/register.
 *
 * Limit: 5 requests / hour / IP. Kills via `RATE_LIMIT_ENABLED=false` env var
 * (consistent with middleware.ts — fail-CLOSED: any value other than the literal
 * string "false" means the limiter is active).
 *
 * Bucket key format: `ip:<clientIp>` (matches the legacy shim convention).
 */
export const REGISTER_IP_WINDOW_SECONDS = 3600;
export const REGISTER_IP_LIMIT_PER_HOUR = 5;

export function createRegisterIpRateLimiter(db: DB) {
  const rl = createRateLimit(db);
  return {
    /**
     * Returns true if allowed; throws Errors.rateLimited if denied.
     * Returns true unconditionally if the kill switch is engaged.
     */
    checkOrThrow(clientIp: string): true {
      if (process.env.RATE_LIMIT_ENABLED === 'false') return true;
      const result = rl.check(`ip:${clientIp}`, [{
        windowSeconds: REGISTER_IP_WINDOW_SECONDS,
        limit: REGISTER_IP_LIMIT_PER_HOUR,
      }]);
      if (!result.allowed) throw Errors.rateLimited('IP register rate limit exceeded');
      return true;
    },
    /**
     * Read-only check (does NOT throw, does NOT increment).
     * Useful for tests + monitoring.
     */
    isEnabled(): boolean {
      return process.env.RATE_LIMIT_ENABLED !== 'false';
    },
  };
}
```

- [ ] **Step 4：修改 register handler 用新工厂**

```typescript
// src/main/modules/register/handler.ts (修改 line 1-32)
// 替换 createRateLimit 导入为 createRegisterIpRateLimiter
// 替换 line 27-31 的内联限流代码为：

import { createRegisterIpRateLimiter } from '../rate-limit/register-limiter.js';

// 在 createRegisterHandler 内：
const rl = createRegisterIpRateLimiter(db);

// 在 handle() 第一步：
rl.checkOrThrow(clientIp);
```

完整替换 `src/main/modules/register/handler.ts:1-32` 区域。新代码：

```typescript
import type { DB } from '../../db/connection.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { createRegisterIpRateLimiter } from '../rate-limit/register-limiter.js';
import { generateApiKey } from '../auth/api-key.js';
import { QUOTA_PER_DAY } from '../../../shared/constants.js';
import type { UserType, User } from '../../../shared/types.js';
import { Errors } from '../../errors.js';
import { randomUUID } from 'node:crypto';

export function createRegisterHandler(db: DB) {
  const users = createUsersRepo(db);
  const rl = createRegisterIpRateLimiter(db);
  // F3: contact uniqueness is per (user_type, contact) — ...
  const findByContactInRoleStmt = db.prepare(
    "SELECT id FROM users WHERE user_type = ? AND contact = ? AND created_at > datetime('now', '-1 day') AND status != 'deleted'"
  );
  const findActiveContactAnyRoleStmt = db.prepare(
    "SELECT user_type FROM users WHERE contact = ? AND status = 'active' LIMIT 1"
  );

  return {
    handle(userType: UserType, name: string, contact: string | undefined, agentEndpoint: string | undefined, clientIp: string, isProduction: boolean): User & { api_key: string } {
      // 1. IP rate limit (5/hour/IP, kill switch via RATE_LIMIT_ENABLED=false)
      rl.checkOrThrow(clientIp);

      // 2. contact uniqueness (unchanged)
      if (contact) {
        const sameRole = findByContactInRoleStmt.get(userType, contact);
        if (sameRole) {
          throw Errors.contactTaken(
            `Contact already registered as ${userType} within last 24h. ` +
            `Wait 24h or use a different contact.`,
            { user_type: userType, scope: 'same-role', contact }
          );
        }
        const otherRole = findActiveContactAnyRoleStmt.get(contact) as { user_type: UserType } | undefined;
        if (otherRole && otherRole.user_type !== userType) {
          throw Errors.contactTaken(
            `Contact is already in use by an active ${otherRole.user_type} account. ` +
            `Use a different contact for this ${userType} account, or sign in to the existing ${otherRole.user_type} account.`,
            { user_type: otherRole.user_type, scope: 'cross-role', contact, requested_role: userType }
          );
        }
      }
```

注意：以上只展示前两步（IP 限流 + contact 校验）的开头；handler 后续代码（quota、写入 users、return）保持不变。

- [ ] **Step 5：跑测试看绿**

Run: `pnpm vitest run tests/integration/register-ip-rate-limit.test.ts`
Expected: 4/4 pass

- [ ] **Step 6：跑全量回归**

Run: `pnpm test 2>&1 | tail -5`
Expected: 与 baseline 一致（除新增的 4 个 pass，无 regression）

- [ ] **Step 7：commit**

```bash
git add src/main/modules/register/handler.ts \
        src/main/modules/rate-limit/register-limiter.ts \
        tests/integration/register-ip-rate-limit.test.ts
git commit -m "feat(rate-limit): centralize register IP limiter + add integration tests

- src/main/modules/rate-limit/register-limiter.ts: new
  createRegisterIpRateLimiter factory wrapping the legacy createRateLimit()
  shim. Centralizes the RATE_LIMIT_ENABLED kill-switch check so it cannot
  silently diverge from middleware.ts semantics.
- src/main/modules/register/handler.ts: replace inline
  'process.env.RATE_LIMIT_ENABLED !== \"false\"' check with the new factory.
- tests/integration/register-ip-rate-limit.test.ts: 4 integration tests
  covering 5/h allow, 6th 429, IP isolation, and kill-switch behavior."
```

---

## Task B: 拆分全局 express.json 4KB 限制（解锁 5000 字 description）

**Files:**
- Modify: `src/main/server.ts`（删除 line 45 的 `app.use(express.json({ limit: '4kb' }))`）
- Modify: `src/main/routes/auth.ts`（在 router 上加 `express.json({ limit: BODY_LIMIT_DEFAULT })`）
- Modify: `src/main/routes/employer.ts`（在 router 上加 `express.json({ limit: BODY_LIMIT_LARGE })`）
- Modify: `src/main/routes/headhunter.ts`（保持 4KB，明确写出）
- Modify: `src/shared/constants.ts`（加 `BODY_LIMIT_DEFAULT`, `BODY_LIMIT_LARGE`）
- Create: `tests/integration/employer-jobs-large-description.test.ts`（验证 5000 字中文描述成功创建）

- [ ] **Step 1：写失败的集成测试**

```typescript
// tests/integration/employer-jobs-large-description.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

const testDb = path.join(__dirname, '../../tmp/employer-jobs-body.db');
let app: any;
let empKey: string;

describe('POST /v1/employer/jobs — body limit allows large description', () => {
  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'E', contact: 'e@x.com' });
    empKey = reg.body.data.api_key;
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('accepts 5000-char Chinese description (~15KB UTF-8)', async () => {
    const desc = '高级前端工程师岗位，'.repeat(500); // 500 * 10 chars = 5000 chars
    const res = await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empKey}`)
      .send({ title: 'P6', description: desc });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('still rejects 5001-char description (zod max(5000))', async () => {
    const desc = 'a'.repeat(5001);
    const res = await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empKey}`)
      .send({ title: 'P6', description: desc });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2：跑测试看红**

Run: `pnpm vitest run tests/integration/employer-jobs-large-description.test.ts`
Expected: 第一个测试 fail with HTTP 413（payload too large）；第二个 fail with 400（zod 拒绝，期望的）→ 这里实际可能过，因为 zod 也拒绝。但第一个一定红。

- [ ] **Step 3：加 BODY_LIMIT 常量**

```typescript
// src/shared/constants.ts（追加）
/** express.json() body size limits. Used by router-level overrides in server.ts. */
export const BODY_LIMIT_DEFAULT = '4kb';
/** Larger limit for /v1/employer/* routes that accept long job descriptions (max 5000 UTF-8 chars ≈ 15KB). */
export const BODY_LIMIT_LARGE = '64kb';
```

- [ ] **Step 4：删除全局 json limit，移到 router mount 处**

修改 `src/main/server.ts`：删除 line 45（`app.use(express.json({ limit: '4kb' }));`）以及前后的相关注释。`server.ts` 中所有 `app.use('/v1/...', createXxxRouter(db))` 改为：

```typescript
// src/main/server.ts 中所有 router mount 前加 json 中间件
import { BODY_LIMIT_DEFAULT, BODY_LIMIT_LARGE } from '../shared/constants.js';
import express from 'express';

// 在每个 router mount 之前：
app.use('/v1/auth', express.json({ limit: BODY_LIMIT_DEFAULT }), createAuthRouter(db, isProduction));
app.use('/v1/users', express.json({ limit: BODY_LIMIT_DEFAULT }), createUsersRouter(db));
app.use('/v1/config', express.json({ limit: BODY_LIMIT_DEFAULT }), createConfigRouter(db));
app.use('/v1/market', express.json({ limit: BODY_LIMIT_DEFAULT }), createMarketRouter(db));
app.use('/v1/headhunter', express.json({ limit: BODY_LIMIT_DEFAULT }), createHeadhunterRouter(db));
app.use('/v1/employer', express.json({ limit: BODY_LIMIT_LARGE }), createEmployerRouter(db));
app.use('/v1/candidate', express.json({ limit: BODY_LIMIT_DEFAULT }), createCandidateRouter(db));
// /v1/admin 不接受 POST body（除 placements，但 placement body 很小，4KB 足够），保留 4KB
app.use('/v1/admin', express.json({ limit: BODY_LIMIT_DEFAULT }), createAdminAuthMiddleware(), createAdminRouter(db));
```

注意：原 `server.ts:180` 处的 `app.get('/v1/admin/ping', ...)` 不需要改（GET 无 body）。

- [ ] **Step 5：跑测试看绿**

Run: `pnpm vitest run tests/integration/employer-jobs-large-description.test.ts`
Expected: 2/2 pass

- [ ] **Step 6：跑全量回归**

Run: `pnpm test 2>&1 | tail -5`
Expected: 全绿（除 pre-existing 失败）

- [ ] **Step 7：commit**

```bash
git add src/shared/constants.ts \
        src/main/server.ts \
        tests/integration/employer-jobs-large-description.test.ts
git commit -m "fix(body-limit): split per-router json limits so 5000-char JD descriptions work

The previous global express.json({ limit: '4kb' }) made the zod
description: max(5000) check unreachable — 5000 UTF-8 Chinese chars
is ~15KB, exceeding 4KB and triggering 413 before schema validation.

- src/shared/constants.ts: BODY_LIMIT_DEFAULT (4kb) + BODY_LIMIT_LARGE (64kb)
- src/main/server.ts: remove global json() and attach per-router middleware:
  /v1/employer/* uses 64kb (the only route that takes long descriptions);
  all others keep 4kb (defense in depth: smallest viable limit per surface).
- tests/integration/employer-jobs-large-description.test.ts: verifies a
  5000-char Chinese JD creates successfully (200) and a 5001-char JD
  is still rejected by zod (400)."
```

---

## Task C: openapi:check 接入 vitest globalSetup

**Files:**
- Create: `tests/global-setup.ts`（在所有测试开始前跑 openapi:check 逻辑）
- Modify: `vitest.config.ts`（注册 globalSetup）

- [ ] **Step 1：读现有 openapi:check 脚本**

Read: `scripts/generate-openapi.ts` —— 当前 `--check` 模式顶层 `main()` 直接 `process.exit(1)`，无法被程序化调用。**Step 2 必须先重构。**

- [ ] **Step 2：重构 `scripts/generate-openapi.ts` 导出 `runCheck()`**

修改 line 131-185 的 `main()` 函数：

```typescript
// scripts/generate-openapi.ts (修改 line 131 区域)
export interface CheckResult {
  ok: boolean;
  summary: string;
  missingInOpenapi: string[];
  danglingInOpenapi: string[];
}

export async function runCheck(): Promise<CheckResult> {
  const scanned = scanRoutesDir();
  const existing = loadExistingOpenApi();
  // ... (现有 main() 的 --check 分支逻辑) ...
  // 返回结构化结果而非 process.exit(1)
  return { ok: missing.length === 0 && dangling.length === 0, summary: ..., missingInOpenapi: missing, danglingInOpenapi: dangling };
}

// 保留 main() 入口以供 pnpm openapi:check 命令行调用：
async function main(): Promise<void> {
  const isCheck = process.argv.includes('--check');
  if (isCheck) {
    const r = await runCheck();
    if (!r.ok) {
      console.error(`✗ openapi.json out of sync: ${r.summary}`);
      process.exit(1);
    }
    console.log(`✓ openapi.json ok (${r.missingInOpenapi.length} missing, ${r.danglingInOpenapi.length} dangling)`);
    return;
  }
  // ... (generate 模式：保持原样)
}
main();
```

实现细节：从现有 main() 函数中抽出 `runCheck()`，把原本直接 `process.exit(1)` 的部分替换为返回结构化对象。main() 包装 runCheck() 维持 CLI 行为。

- [ ] **Step 3：写 global-setup.ts**

```typescript
// tests/global-setup.ts
/**
 * Vitest global setup — runs once before all test files.
 *
 * Currently: verify openapi.json is in sync with actual routes (forward coverage).
 * Refuses to start the test suite if the spec has drifted from reality.
 */
export async function setup() {
  const { runCheck } = await import('../scripts/generate-openapi');
  const result = await runCheck();
  if (!result.ok) {
    const missing = result.missingInOpenapi.length;
    const dangling = result.danglingInOpenapi.length;
    throw new Error(
      `openapi.json is out of sync with actual routes.\n` +
      `  ${missing} routes scanned but not in openapi.json\n` +
      `  ${dangling} paths in openapi.json no longer exist in code\n` +
      `Run \`pnpm openapi:generate && git add docs/superpowers/openapi.json\` to fix.`
    );
  }
}
```

- [ ] **Step 4：vitest.config.ts 注册**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    globalSetup: ['./tests/global-setup.ts'],
  },
});
```

- [ ] **Step 5：跑全量测试看绿**

Run: `pnpm test 2>&1 | tail -10`
Expected: 测试启动前 print "openapi check ok"，然后所有已有测试继续 pass。

- [ ] **Step 6：人为制造 spec drift，看是否会 fail**

```bash
# 临时给 openapi.json 删一个 path，看 vitest 是否报错
node -e "
const fs=require('fs');
const f='docs/superpowers/openapi.json';
const j=JSON.parse(fs.readFileSync(f,'utf8'));
delete j.paths['/v1/health'];
fs.writeFileSync(f,JSON.stringify(j,null,2));
"
pnpm test 2>&1 | tail -10
# 期望：globalSetup throws, vitest 启动失败
# 恢复：
git checkout docs/superpowers/openapi.json
```

- [ ] **Step 7：commit**

```bash
git add tests/global-setup.ts vitest.config.ts scripts/generate-openapi.ts
git commit -m "test(openapi): enforce spec sync via vitest globalSetup

- scripts/generate-openapi.ts: export runCheck() so globalSetup can call
  it programmatically instead of relying on process.exit(1). main()
  retained for CLI (pnpm openapi:check).
- tests/global-setup.ts: runs runCheck() before any test starts.
  Throws on forward coverage gap, so spec drift fails the test suite.
- vitest.config.ts: register globalSetup."
```

- [ ] **Step 3：vitest.config.ts 注册**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    globalSetup: ['./tests/global-setup.ts'],
  },
});
```

- [ ] **Step 4：跑全量测试看绿**

Run: `pnpm test 2>&1 | tail -10`
Expected: 测试启动前 print "openapi check ok"，然后所有已有测试继续 pass。

- [ ] **Step 5：人为制造 spec drift，看是否会 fail**

```bash
# 临时给 openapi.json 删一个 path，看 vitest 是否报错
node -e "
const fs=require('fs');
const f='docs/superpowers/openapi.json';
const j=JSON.parse(fs.readFileSync(f,'utf8'));
delete j.paths['/v1/health'];
fs.writeFileSync(f,JSON.stringify(j,null,2));
"
pnpm test 2>&1 | tail -10
# 期望：globalSetup throws, vitest 启动失败
# 恢复：
git checkout docs/superpowers/openapi.json
```

- [ ] **Step 6：commit**

```bash
git add tests/global-setup.ts vitest.config.ts scripts/check-openapi-coverage.ts
git commit -m "test(openapi): enforce spec sync via vitest globalSetup

- tests/global-setup.ts: runs the existing openapi:check logic before
  any test starts. Throws on forward coverage gap, so spec drift fails
  the test suite instead of going unnoticed.
- vitest.config.ts: register globalSetup.
- scripts/check-openapi-coverage.ts: refactor to export runCheck() so
  globalSetup can call it programmatically instead of relying on
  process.exit(1)."
```

---

## Task D: 最终回归 + live smoke

**Files:** 无新增/修改

- [ ] **Step 1：typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 2：全量测试**

Run: `pnpm test 2>&1 | tail -5`
Expected: 全绿（除 4 个 pre-existing 失败：reposition-checks、scripts.dev/api:dev 的 package.json 漂移、route-view-map 现已修）

- [ ] **Step 3：openapi:check**

Run: `pnpm openapi:check`
Expected: PASS

- [ ] **Step 4：live smoke（register + jobs body limit）**

```bash
PORT=3050 pnpm dev &

# 5 次 register 都被 200，6 次 429
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "req $i: HTTP %{http_code}\n" \
    -X POST http://localhost:3050/v1/auth/register \
    -H "X-Forwarded-For: 10.0.0.99" \
    -H "Content-Type: application/json" \
    -d "{\"user_type\":\"candidate\",\"name\":\"smoke$i\",\"contact\":\"smoke$i@x.com\"}"
done

# 中文 JD 描述（5000 字）
DESC=$(python3 -c "print('高级前端工程师岗位，' * 500)")
curl -s -X POST http://localhost:3050/v1/employer/jobs \
  -H "Authorization: Bearer $EMP_KEY" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"title\":\"P6\",\"description\":\"$DESC\"}" | head -c 200
```

Expected: req 1-5 = 200, req 6 = 429；jobs 创建返回 200 + ok:true。

- [ ] **Step 5：commit（如有漂移）**

若有 openapi 漂移，跑 `pnpm openapi:generate && git add docs/superpowers/openapi.json && git commit -m "docs: regenerate openapi.json"`

---

## 验证清单（最终）

- ✅ Task A: 4 个新集成测试通过；kill switch 语义与 middleware 一致
- ✅ Task B: 2 个新集成测试通过；5000 字中文 JD 200 OK
- ✅ Task C: globalSetup 跑通；故意制造 drift 后 vitest 拒绝启动
- ✅ Task D: typecheck 0 errors；全量测试 0 新增 regression；live smoke 1-5 = 200, 6 = 429

---

## 范围外（本次**不做**）

- **`agent_endpoint` 可达性验证**：需要决定 HEAD vs GET、是否走 fetch with timeout、要不要 hCaptcha。留给单独 plan。
- **CI 配置（GitHub Actions）**：本次把 openapi check 放进 vitest 不依赖 CI。如果后续加了 CI，可一行复用 vitest globalSetup。
- **`/v1/users/:id/status` 是否需要鉴权**：用户提到"公开就能探活"——本次不动，留待业务确认。
- **Web 应用层 CAPTCHA / IP 信誉库（Cloudflare Turnstile 等）**：超出本项目范围。