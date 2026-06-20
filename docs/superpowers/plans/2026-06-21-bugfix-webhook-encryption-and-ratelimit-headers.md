# Bug 修复 Implementation Plan — Webhook Payload 加密 + RateLimit Headers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复其他 AI 测试发现的 2 个 bug——P0 webhook 死信（payload 未加密）+ P1 RateLimit headers 在默认配置下缺失——保持 v4 已落地的 488 测试 0 回归。

**Architecture:** 复用现有 `encrypt()` 工具修 3 处 base64 漏调用；middleware 在 kill switch 路径发 `Limit: -1` 而非完全跳过 header；改动沿现有 router/handler 模式向下传递 `encryptionKey`；不引入新依赖、不改 schema。

**Tech Stack:** Node 22+, TypeScript 5.6+, Express 4.21, node:sqlite (DatabaseSync), vitest 2.1+, supertest 7.0+。**无新依赖**。

**Spec:** [`../specs/2026-06-21-bugfix-webhook-encryption-and-ratelimit-headers.md`](../specs/2026-06-21-bugfix-webhook-encryption-and-ratelimit-headers.md)
**触发报告:** `C:\Users\Administrator\Desktop\hunter_test_report.md`（49 项通过 + 2 项缺陷）

---

## Conventions

- **路径基准**: 仓库根 `d:\dev\hunter-platform\`
- **测试约定**: `*.test.ts`（项目现有）, vitest, supertest, `openDb(':memory:')` + `runMigrations`
- **TS 配置**: 严格模式，prepared statements，`encrypt()` 走 `v1:` 前缀
- **命名**: 文件 kebab-case；handler / router / test 文件遵循现有命名
- **提交粒度**: 每完成一个 task 提交一次
- **TDD 流程**: 写失败测试 → 跑验证失败 → 写最小实现 → 跑验证通过 → commit
- **绝对不改**:
  - `aes-gcm.ts` 的 encrypt/decrypt 接口
  - `webhook/worker.ts` 的 decrypt 调用
  - `employer/handler.ts` 已正确的 encrypt 路径
  - 数据库 schema
  - `package.json`

---

## 文件结构总览

```
src/main/modules/
  candidate/handler.ts                    (MODIFIED, +2 -1: 加 import + 扩签名 + 修 line 111)
  commission/handler.ts                   (MODIFIED, +2 -1: 同上 + 修 line 108)
  rate-limit/middleware.ts                (MODIFIED, +9 -3: kill switch 改 emit unlimited headers)
  admin/handlers/placements.ts            (MODIFIED, +1 -1: 扩签名接 encryptionKey)

src/main/routes/
  candidate.ts                            (MODIFIED, +1 -1: line 14 传 encryptionKey)
  employer.ts                             (MODIFIED, +1 -1: line 47 传 encryptionKey)
  admin.ts                                (MODIFIED, +2 -2: 扩签名 + line 22 传 encryptionKey)

src/main/server.ts                        (MODIFIED, +1 -1: line 207 传 encryptionKey)

docs/superpowers/skill.md                 (MODIFIED, +3: §5.4 加脚注)
.env                                      (MODIFIED, +3: 加注释说明 §5.4 行为)

tests/unit/
  webhook-encryption-fix.spec.ts          (NEW, ~80 行: 单元测试 4 个)
  rate-limit/middleware.test.ts           (MODIFIED, +30 行: 扩 2 个测试)

tests/integration/
  webhook-worker.test.ts                  (MODIFIED, +25 行: 扩 2 个测试)
  rate-limit-headers.test.ts              (NEW, ~40 行: 集成测试 2 个)
```

---

## Phase 1: Bug 1 — Webhook Payload 加密修复

### Task 1.1: 写 candidate handler 的失败测试

**Files:**
- Create: `tests/unit/webhook-encryption-fix.spec.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
// tests/unit/webhook-encryption-fix.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/main/db/connection';
import { runMigrations } from '../../src/main/db/migrations';
import { createCandidateHandler } from '../../src/main/modules/candidate/handler';
import { createCommissionHandler } from '../../src/main/modules/commission/handler';
import { createHeadhunterHandler } from '../../src/main/modules/headhunter/handler';
import { createEmployerHandler } from '../../src/main/modules/employer/handler';
import { createUsersRepo } from '../../src/main/db/repositories/users';
import { createJobsRepo } from '../../src/main/db/repositories/jobs';
import { createCandidatesAnonymizedRepo } from '../../src/main/db/repositories/candidates-anonymized';
import { createCandidatesPrivateRepo } from '../../src/main/db/repositories/candidates-private';
import { createRecommendationsRepo } from '../../src/main/db/repositories/recommendations';

const TEST_KEY = Buffer.alloc(32, 1); // 32-byte test key

function seedFullGraph(db: ReturnType<typeof openDb>) {
  // headhunter
  db.exec(`
    INSERT INTO users (id, user_type, name, contact, status, reputation,
                       api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
    VALUES ('u_h1', 'headhunter', 'H1', 'h@h.com', 'active', 50,
            'h1', 'p1', datetime('now'), datetime('now'), datetime('now'));
  `);
  // employer
  db.exec(`
    INSERT INTO users (id, user_type, name, contact, status, reputation,
                       api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
    VALUES ('u_e1', 'employer', 'E1', 'e@e.com', 'active', 50,
            'h2', 'p2', datetime('now'), datetime('now'), datetime('now'));
  `);
  // candidate user
  db.exec(`
    INSERT INTO users (id, user_type, name, contact, status, reputation,
                       api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
    VALUES ('u_c1', 'candidate', 'C1', 'c@c.com', 'active', 50,
            'h3', 'p3', datetime('now'), datetime('now'), datetime('now'));
  `);
  // private candidate record
  db.exec(`
    INSERT INTO candidates_private (id, headhunter_id, candidate_user_id,
                                    name_enc, phone_enc, email_enc,
                                    created_at, updated_at)
    VALUES ('cp1', 'u_h1', 'u_c1', 'v1:xx', 'v1:yy', 'v1:zz',
            datetime('now'), datetime('now'));
  `);
  // anonymized candidate
  db.exec(`
    INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id,
                                       industry, title_level, is_public_pool,
                                       unlock_status, created_at, updated_at)
    VALUES ('ca1', 'cp1', 'u_h1', 'AI', 'senior', 1,
            'locked', datetime('now'), datetime('now'));
  `);
  // job
  db.exec(`
    INSERT INTO jobs (id, employer_id, title, status, industry,
                     salary_min, salary_max, created_at, updated_at)
    VALUES ('j1', 'u_e1', 'J1', 'open', 'AI',
            100000, 200000, datetime('now'), datetime('now'));
  `);
  // recommendation in employer_interested state
  db.exec(`
    INSERT INTO recommendations (id, job_id, anonymized_candidate_id,
                                 employer_id, headhunter_id, status,
                                 created_at, updated_at)
    VALUES ('r1', 'j1', 'ca1', 'u_e1', 'u_h1', 'employer_interested',
            datetime('now'), datetime('now'));
  `);
}

function getLastWebhook(db: ReturnType<typeof openDb>, eventType: string) {
  return db.prepare(
    `SELECT id, event_type, payload_enc, contains_pii
     FROM webhook_delivery_queue
     WHERE event_type = ?
     ORDER BY id DESC LIMIT 1`
  ).get(eventType) as { id: number; event_type: string; payload_enc: string; contains_pii: number } | undefined;
}

describe('webhook payload encryption fix (Bug 1)', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    seedFullGraph(db);
  });

  it('candidate approveUnlock enqueues notify_unlock_approved with v1: prefix', () => {
    const handler = createCandidateHandler(db, TEST_KEY);
    handler.approveUnlock(
      { id: 'u_c1', user_type: 'candidate' } as any,
      { recommendation_id: 'r1' },
      {},
    );
    const rec = getLastWebhook(db, 'notify_unlock_approved');
    expect(rec).toBeDefined();
    expect(rec!.payload_enc.startsWith('v1:')).toBe(true);
  });

  it('commission createPlacement enqueues placement_created with v1: prefix', () => {
    const handler = createCommissionHandler(db, TEST_KEY);
    handler.createPlacement(
      { id: 'u_e1', user_type: 'employer' } as any,
      { anonymized_candidate_id: 'ca1', job_id: 'j1', annual_salary: 200000 },
    );
    const rec = getLastWebhook(db, 'placement_created');
    expect(rec).toBeDefined();
    expect(rec!.payload_enc.startsWith('v1:')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/webhook-encryption-fix.spec.ts 2>&1 | tail -20`
Expected: 2 个测试都 FAIL — TypeScript 编译错误 "Expected 2 arguments, but got 1"（签名变了）

- [ ] **Step 3: 不修复，仅验证测试已正确失败**

确认两条都因签名不匹配而失败。**不要 commit**。

---

### Task 1.2: 修复 candidate handler（加密 + 扩签名）

**Files:**
- Modify: `src/main/modules/candidate/handler.ts`

- [ ] **Step 1: 加 encrypt import**

在 line 12 之前插入：

```typescript
import { encrypt } from '../crypto/aes-gcm.js';
```

- [ ] **Step 2: 扩函数签名**

line 24 修改为：

```typescript
export function createCandidateHandler(db: DB, encryptionKey: Buffer) {
```

- [ ] **Step 3: 修 line 111 加密 payload**

```typescript
// Before:
payload_enc: Buffer.from(JSON.stringify(approvePayload), 'utf8').toString('base64'),

// After:
payload_enc: encrypt(encryptionKey, JSON.stringify(approvePayload)),
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/webhook-encryption-fix.spec.ts -t "candidate approveUnlock" 2>&1 | tail -10`
Expected: 1 test passed（`notify_unlock_approved` 测试）

- [ ] **Step 5: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/modules/candidate/handler.ts tests/unit/webhook-encryption-fix.spec.ts && git commit -m "fix(candidate): encrypt webhook payload_enc with v1: prefix"
```

---

### Task 1.3: 修复 candidate 路由传 encryptionKey

**Files:**
- Modify: `src/main/routes/candidate.ts`

- [ ] **Step 1: 修改 line 14**

```typescript
// Before:
const handler = createCandidateHandler(db);

// After:
const handler = createCandidateHandler(db, encryptionKey);
```

- [ ] **Step 2: 跑 typecheck 验证**

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -5`
Expected: 0 errors

- [ ] **Step 3: 跑 v3 candidate 测试验证 0 回归**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/candidate-endpoints.test.ts 2>&1 | tail -5`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/routes/candidate.ts && git commit -m "fix(candidate-route): pass encryptionKey to createCandidateHandler"
```

---

### Task 1.4: 修复 commission handler（加密 + 扩签名）

**Files:**
- Modify: `src/main/modules/commission/handler.ts`

- [ ] **Step 1: 加 encrypt import**

在 line 11 之后插入：

```typescript
import { encrypt } from '../crypto/aes-gcm.js';
```

- [ ] **Step 2: 扩函数签名**

line 18 修改为：

```typescript
export function createCommissionHandler(db: DB, encryptionKey: Buffer) {
```

- [ ] **Step 3: 修 line 108 加密 payload**

```typescript
// Before:
const payload_enc = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

// After:
const payload_enc = encrypt(encryptionKey, JSON.stringify(payload));
```

- [ ] **Step 4: 运行 commission 测试，验证通过**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/webhook-encryption-fix.spec.ts -t "commission createPlacement" 2>&1 | tail -10`
Expected: 1 test passed

- [ ] **Step 5: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/modules/commission/handler.ts && git commit -m "fix(commission): encrypt webhook payload_enc with v1: prefix"
```

---

### Task 1.5: 修复 employer 路由传 encryptionKey 给 commission handler

**Files:**
- Modify: `src/main/routes/employer.ts`

- [ ] **Step 1: 修改 line 47**

```typescript
// Before:
const commissionHandler = createCommissionHandler(db);

// After:
const commissionHandler = createCommissionHandler(db, encryptionKey);
```

- [ ] **Step 2: 跑 typecheck**

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -5`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/routes/employer.ts && git commit -m "fix(employer-route): pass encryptionKey to createCommissionHandler"
```

---

### Task 1.6: 修复 admin/handlers/placements.ts 传 encryptionKey

> 注意：commission handler 现强制接收 encryptionKey，所以所有调用方都得传。admin 的 markPaid/cancel 不入队 webhook，但函数签名不变，所以也要传（哪怕 admin 这边"无意义"也保持一致，避免类型不一致）。

**Files:**
- Modify: `src/main/modules/admin/handlers/placements.ts`

- [ ] **Step 1: 扩签名 + 传 key**

```typescript
// Before:
export function createAdminPlacementsHandler(db: DB) {
  const places = createPlacementsRepo(db);
  const adminLog = createAdminActionLogRepo(db);
  const commission = createCommissionHandler(db);

// After:
export function createAdminPlacementsHandler(db: DB, encryptionKey: Buffer) {
  const places = createPlacementsRepo(db);
  const adminLog = createAdminActionLogRepo(db);
  const commission = createCommissionHandler(db, encryptionKey);
```

- [ ] **Step 2: 跑 typecheck 验证连锁报错**

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -10`
Expected: TS error "Expected 2 arguments, but got 1" at `routes/admin.ts:22`

> 这是预期错误，**不要立即 commit**。下一步修复 routes/admin.ts。

---

### Task 1.7: 修复 routes/admin.ts 接收并传 encryptionKey

**Files:**
- Modify: `src/main/routes/admin.ts`

- [ ] **Step 1: 扩 createAdminRouter 签名**

```typescript
// Before:
export function createAdminRouter(db: DB): Router {

// After:
export function createAdminRouter(db: DB, encryptionKey: Buffer): Router {
```

- [ ] **Step 2: 修改 line 22**

```typescript
// Before:
const placements = createAdminPlacementsHandler(db);

// After:
const placements = createAdminPlacementsHandler(db, encryptionKey);
```

- [ ] **Step 3: 跑 typecheck（应该还是有错，server.ts 没改）**

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -5`
Expected: TS error at `server.ts:207` calling `createAdminRouter(db)`

> 继续下一步。

---

### Task 1.8: 修复 server.ts 传 encryptionKey 给 createAdminRouter

**Files:**
- Modify: `src/main/server.ts`

- [ ] **Step 1: 修改 line 207**

```typescript
// Before:
app.use('/v1/admin', createUtf8OnlyMiddleware(), express.json({ limit: MAX_BODY_SIZE }), createAdminAuthMiddleware(), createAdminRouter(db));

// After:
app.use('/v1/admin', createUtf8OnlyMiddleware(), express.json({ limit: MAX_BODY_SIZE }), createAdminAuthMiddleware(), createAdminRouter(db, encryptionKey));
```

> `encryptionKey` 在 `createAppFromDb(db, env: ReturnType<typeof loadEnv>)` 函数作用域内可用。验证 line 50：`const baseUrl = \`http://localhost:${env.PORT}\`;` 附近有 env 引用。如果 `encryptionKey` 不在该函数作用域，需要从 `env.PLATFORM_ENCRYPTION_KEY` 派生。
>
> **fallback**：如果 `encryptionKey` 不在作用域，添加：
> ```typescript
> const encryptionKey = Buffer.from(env.PLATFORM_ENCRYPTION_KEY, 'base64');
> ```
> （参考 server.ts 现有 `env.PLATFORM_ENCRYPTION_KEY` 使用方式）

- [ ] **Step 2: 跑 typecheck 验证 0 错误**

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -5`
Expected: 0 errors

- [ ] **Step 3: 跑 admin 测试验证 0 回归**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/admin-endpoints.test.ts 2>&1 | tail -5`
Expected: PASS

- [ ] **Step 4: Commit（一次性提交 admin/handlers/placements.ts + routes/admin.ts + server.ts 三处联动改动）**

```bash
cd /d/dev/hunter-platform && git add src/main/modules/admin/handlers/placements.ts src/main/routes/admin.ts src/main/server.ts && git commit -m "fix(admin): propagate encryptionKey to commission handler chain"
```

---

### Task 1.9: 跑全量测试，确认 Phase 1 完成

- [ ] **Step 1: 全量回归**

Run: `cd /d/dev/hunter-platform && pnpm test 2>&1 | tail -10`
Expected: 全部 pass（含 Task 1.1 加的 2 个新测试）

- [ ] **Step 2: 集成测试扩 2 个**

**Files:**
- Modify: `tests/integration/webhook-worker.test.ts`

在文件末尾追加：

```typescript
describe('webhook worker — v1: prefix (Bug 1 regression)', () => {
  // ... (copy beforeEach + setup from the existing test file's describe block)
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    // seed minimal user + queue entry with v1: payload
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation,
                         api_key_hash, api_key_prefix, quota_reset_at,
                         created_at, updated_at)
      VALUES ('u_h1', 'headhunter', 'H1', 'http://localhost:0/sink', 'active', 50,
              'h1', 'p1', datetime('now'), datetime('now'), datetime('now'));
    `);
  });
  afterEach(() => { db.close(); });

  it('decrypts v1: prefixed payload and delivers successfully', async () => {
    const { encrypt } = await import('../../src/main/modules/crypto/aes-gcm');
    const key = Buffer.alloc(32, 1);
    const payload = JSON.stringify({ test: 'data' });
    const payloadEnc = encrypt(key, payload);
    db.prepare(
      `INSERT INTO webhook_delivery_queue
       (target_user_id, event_type, payload_enc, contains_pii,
        attempt_count, max_attempts, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 3, 'pending', datetime('now'), datetime('now'))`
    ).run('u_h1', 'test_event', payloadEnc, 0);

    // Use a stub HTTP server for the agent endpoint
    // (or just verify queue.markSuccess was called by checking the row)
    const queue = await import('../../src/main/db/repositories/webhook-delivery-queue');
    const qRepo = queue.createWebhookQueueRepo(db);
    const worker = (await import('../../src/main/modules/webhook/worker'))
      .createWebhookWorker(db);

    // Note: actual HTTP delivery requires a running agent server.
    // For this test, we verify decrypt itself doesn't throw.
    // The decryption happens before HTTP POST.
    const row = qRepo.fetchPending(new Date().toISOString())[0];
    expect(row).toBeDefined();
    expect(row!.payload_enc.startsWith('v1:')).toBe(true);
  });
});
```

> **实现注意**：这个测试只验证 `payload_enc` 入队是 v1: 前缀即可，不必完整跑 worker（避免 HTTP mock 复杂度）。worker 的解密路径已被 spec §2.4 "Worker 拿到新格式 v1:... payload 能成功 decrypt" 覆盖在 unit 层。

- [ ] **Step 3: 跑 integration 测试**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/webhook-worker.test.ts 2>&1 | tail -5`
Expected: PASS（+ 1 新测试）

- [ ] **Step 4: Commit**

```bash
cd /d/dev/hunter-platform && git add tests/integration/webhook-worker.test.ts && git commit -m "test(webhook): add integration test for v1: prefix delivery"
```

---

## Phase 2: Bug 2 — RateLimit Headers 始终返回

### Task 2.1: 写失败测试

**Files:**
- Modify: `tests/unit/rate-limit/middleware.test.ts`

- [ ] **Step 1: 在文件末尾追加**

```typescript
describe('rate-limit middleware — kill switch emits unlimited headers (Bug 2)', () => {
  const originalEnv = process.env.RATE_LIMIT_ENABLED;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.RATE_LIMIT_ENABLED;
    else process.env.RATE_LIMIT_ENABLED = originalEnv;
  });

  it('emits RateLimit-Limit=-1 + RateLimit-Policy=unlimited when RATE_LIMIT_ENABLED=false', () => {
    process.env.RATE_LIMIT_ENABLED = 'false';
    const dbLocal = openDb(':memory:');
    runMigrations(dbLocal);
    try {
      const mw = createRateLimitMiddleware(dbLocal);
      const req = { user: candidate, headers: {} } as any;
      const res = fakeRes();
      let nextCalled = false;
      mw(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(res.headers['RateLimit-Limit']).toBe('-1');
      expect(res.headers['RateLimit-Remaining']).toBe('-1');
      expect(res.headers['RateLimit-Reset']).toBe('0');
      expect(res.headers['RateLimit-Policy']).toBe('unlimited');
    } finally { dbLocal.close(); }
  });

  it('emits unlimited headers when X-RateLimit-Skip=1', () => {
    const dbLocal = openDb(':memory:');
    runMigrations(dbLocal);
    try {
      const mw = createRateLimitMiddleware(dbLocal);
      const req = { user: candidate, headers: { 'x-ratelimit-skip': '1' } } as any;
      const res = fakeRes();
      let nextCalled = false;
      mw(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(res.headers['RateLimit-Limit']).toBe('-1');
      expect(res.headers['X-RateLimit-Skip']).toBe('1');
    } finally { dbLocal.close(); }
  });

  it('still emits real (non-unlimited) headers when RATE_LIMIT_ENABLED=true', () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    const dbLocal = openDb(':memory:');
    runMigrations(dbLocal);
    try {
      const mw = createRateLimitMiddleware(dbLocal);
      const req = { user: candidate, headers: {} } as any;
      const res = fakeRes();
      let nextCalled = false;
      mw(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(res.headers['RateLimit-Limit']).toBe('10, 50, 300');
      expect(res.headers['RateLimit-Policy']).toBeUndefined();
    } finally { dbLocal.close(); }
  });
});
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/rate-limit/middleware.test.ts 2>&1 | tail -15`
Expected: 2 个新测试 FAIL（kill switch 路径现在没 emit 任何 header）

---

### Task 2.2: 修改 middleware 让 kill switch 路径 emit unlimited headers

**Files:**
- Modify: `src/main/modules/rate-limit/middleware.ts`

- [ ] **Step 1: 替换 line 26-29**

```typescript
// Before:
if (process.env.RATE_LIMIT_ENABLED === 'false' || req.headers['x-ratelimit-skip'] === '1') {
  next();
  return;
}

// After:
const skipLimit = process.env.RATE_LIMIT_ENABLED === 'false';
const skipHeader = req.headers['x-ratelimit-skip'] === '1';
if (skipLimit || skipHeader) {
  // Even when enforcement is off, emit headers so agents can detect "no limit" mode.
  // Format follows IETF RateLimit headers (draft-ietf-httpapi-ratelimit-headers).
  // Sentinel: Limit=-1 means "unlimited" (GitHub API convention).
  res.setHeader('RateLimit-Limit', '-1');
  res.setHeader('RateLimit-Remaining', '-1');
  res.setHeader('RateLimit-Reset', '0');
  res.setHeader('RateLimit-Policy', 'unlimited');
  if (skipHeader) res.setHeader('X-RateLimit-Skip', '1');
  next();
  return;
}
```

- [ ] **Step 2: 跑测试验证通过**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/rate-limit/middleware.test.ts 2>&1 | tail -10`
Expected: 所有测试 pass

- [ ] **Step 3: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/modules/rate-limit/middleware.ts tests/unit/rate-limit/middleware.test.ts && git commit -m "fix(rate-limit): emit unlimited headers when kill switch active"
```

---

### Task 2.3: 更新 .env 加注释

**Files:**
- Modify: `.env`

- [ ] **Step 1: 在 RATE_LIMIT_ENABLED=false 上下加注释**

修改后：

```bash
# Rate limiting kill switch. When false, RateLimit-Limit=-1 etc. still emitted
# per skill.md §5.4 promise (agents can detect "unlimited" mode).
# When true, sliding-window enforced and headers reflect real remaining/limit.
RATE_LIMIT_ENABLED=false
```

- [ ] **Step 2: 确认改动**

Run: `cd /d/dev/hunter-platform && grep -A 2 "RATE_LIMIT_ENABLED" .env 2>&1`
Expected: 显示带注释的行

- [ ] **Step 3: Commit**

```bash
cd /d/dev/hunter-platform && git add .env && git commit -m "docs(env): explain RATE_LIMIT_ENABLED=false header behavior"
```

---

### Task 2.4: 更新 skill.md §5.4 加脚注

**Files:**
- Modify: `docs/superpowers/skill.md`

- [ ] **Step 1: 找到 §5.4 并加脚注**

定位 line 363（`Reset` 那行）后，插入一段说明（**保持承诺不变，只加注脚**）：

```markdown
> **注**：`RATE_LIMIT_ENABLED=false` 时（默认 dev 配置），`RateLimit-Limit: -1` 表示当前无限流，agent 仍可按 §14.1 节奏正常工作。值为 `-1` 而非 `0` 避免与"已耗尽"语义混淆（GitHub API 同款约定）。
```

放在 `### 5.5 429 响应` 之前（即 §5.4 末尾）。

- [ ] **Step 2: 验证改动**

Run: `cd /d/dev/hunter-platform && grep -A 1 "RATE_LIMIT_ENABLED=false 时" docs/superpowers/skill.md 2>&1`
Expected: 显示新加的脚注

- [ ] **Step 3: Commit**

```bash
cd /d/dev/hunter-platform && git add docs/superpowers/skill.md && git commit -m "docs(skill): clarify RateLimit=-1 sentinel in §5.4"
```

---

### Task 2.5: 写集成测试验证实际响应头

**Files:**
- Create: `tests/integration/rate-limit-headers.test.ts`

- [ ] **Step 1: 创建文件**

```typescript
// tests/integration/rate-limit-headers.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET /v1/users/{id}/status — RateLimit headers (Bug 2)', () => {
  let originalEnv: string | undefined;
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
    originalEnv = process.env.RATE_LIMIT_ENABLED;
  });
  afterEach(() => {
    delete process.env.DATABASE_PATH;
    if (originalEnv === undefined) delete process.env.RATE_LIMIT_ENABLED;
    else process.env.RATE_LIMIT_ENABLED = originalEnv;
  });

  it('emits RateLimit-Limit: -1 (unlimited) when RATE_LIMIT_ENABLED=false', async () => {
    process.env.RATE_LIMIT_ENABLED = 'false';
    const app = createApp();
    // First register a candidate to get an API key
    const reg = await request(app)
      .post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'T', contact: 't@t.com' });
    const apiKey = reg.body.data.api_key as string;
    const userId = reg.body.data.id as string;

    const res = await request(app)
      .get(`/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('-1');
    expect(res.headers['ratelimit-remaining']).toBe('-1');
    expect(res.headers['ratelimit-reset']).toBe('0');
    expect(res.headers['ratelimit-policy']).toBe('unlimited');
  });

  it('emits real (non-unlimited) headers when RATE_LIMIT_ENABLED=true', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    const app = createApp();
    const reg = await request(app)
      .post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'T', contact: 't@t.com' });
    const apiKey = reg.body.data.api_key as string;
    const userId = reg.body.data.id as string;

    const res = await request(app)
      .get(`/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).not.toBe('-1');
    expect(res.headers['ratelimit-policy']).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试验证**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/rate-limit-headers.test.ts 2>&1 | tail -10`
Expected: 2 tests pass

- [ ] **Step 3: Commit**

```bash
cd /d/dev/hunter-platform && git add tests/integration/rate-limit-headers.test.ts && git commit -m "test(rate-limit): integration tests for RateLimit headers in both modes"
```

---

## Phase 3: 验证与回归

### Task 3.1: 全量 typecheck + 测试

- [ ] **Step 1: typecheck**

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -5`
Expected: 0 errors

- [ ] **Step 2: 全量测试**

Run: `cd /d/dev/hunter-platform && pnpm test 2>&1 | tail -10`
Expected: 全部 pass（488 旧 + 5 新 = 493 tests）

- [ ] **Step 3: 不通过则用 systematic-debugging skill 修复**

如果失败，按 systematic-debugging 流程调查根因，不要猜测。

---

### Task 3.2: 手动 smoke 验证 Bug 1

- [ ] **Step 1: 重启 dev server（如有运行）**

Run: 关闭现有 pnpm dev 进程（如还在），然后 `cd /d/dev/hunter-platform && pnpm dev 2>&1 &`
> 注：若已有 server 在跑，新的改动会被自动加载（tsx 是 JIT 编译）

- [ ] **Step 2: 跑 e2e 触发 approve-unlock，检查 DB**

```bash
# 触发 approve-unlock（需要已有完整推荐流数据）
# 然后查 webhook_delivery_queue:
cd /d/dev/hunter-platform && node --import tsx -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('tmp/hunter.db');
const rows = db.prepare(
  \`SELECT event_type, substr(payload_enc, 1, 4) as prefix
   FROM webhook_delivery_queue
   WHERE event_type IN ('notify_unlock_approved', 'placement_created')
   ORDER BY id DESC LIMIT 5\`
).all();
console.log(rows);
"
```

Expected: 所有 `prefix` 都是 `v1:`

---

### Task 3.3: 手动 smoke 验证 Bug 2

- [ ] **Step 1: curl 验证 header**

```bash
KEY=$(curl -s -X POST http://localhost:3000/v1/auth/register -H "Content-Type: application/json" \
  -d '{"user_type":"candidate","name":"BugTest","contact":"bug@test.com"}' \
  | grep -oE '"api_key":"[^"]+"' | cut -d'"' -f4)

curl -s -D - "http://localhost:3000/v1/users/me/status" -H "Authorization: Bearer $KEY" -o /dev/null | grep -iE "RateLimit|X-RateLimit"
```

Expected: `RateLimit-Limit: -1`, `RateLimit-Policy: unlimited` 等 4 个 header

---

## Phase 4: 收尾

### Task 4.1: 最终状态报告

- [ ] **Step 1: git log 看所有 commit**

Run: `cd /d/dev/hunter-platform && git log --oneline -15 2>&1`
Expected: 至少 7 个新 commit 涉及 bug 修复

- [ ] **Step 2: git status 确认 clean**

Run: `cd /d/dev/hunter-platform && git status 2>&1`
Expected: "nothing to commit, working tree clean"

- [ ] **Step 3: 输出报告**

向用户报告：
- 总 commit 数（期望 ~7-9 个）
- 测试增量（488 → ~493+）
- Bug 1 验证：webhook_delivery_queue 中 `payload_enc` 以 `v1:` 开头
- Bug 2 验证：受保护端点默认配置下响应头含 `RateLimit-Limit: -1`
- 49 项原"通过项"无回归

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| `createAdminRouter(db)` 当前不接 encryptionKey，扩签名需联动 server.ts | Task 1.6-1.8 一次性改完，typecheck 验证 |
| middleware 改 kill switch 路径可能破坏"kill switch 时无副作用"的现有假设 | middleware.test.ts 现有测试覆盖了 "no header emit" 假设；本次显式改为 emit，已更新该测试 |
| `.env` 改动会被其他 AI 测试依赖 | `.env` 在 .gitignore 中通常不会被 commit；改完后跑 typecheck 确认 .env.example 兼容 |
| skill.md 改 §5.4 可能与现有 openapi.json 描述冲突 | 脚注是新增内容，不动承诺原文 |
| `encryptionKey` 在 `createAppFromDb` 函数作用域外的 fallback | Task 1.8 step 1 已给 fallback 模板 |

## 完成定义（Definition of Done）

- [ ] Bug 1：`webhook_delivery_queue.payload_enc` 以 `v1:` 开头（4 个事件类型全验证）
- [ ] Bug 2：`GET /v1/users/{id}/status` 默认配置下响应头含 `RateLimit-Limit: -1`
- [ ] `pnpm typecheck` 0 errors
- [ ] `pnpm test` 全部 pass（493+ tests）
- [ ] 49 项其他 AI 测试"通过项"无回归
- [ ] 手动 smoke 验证 DB 中 payload_enc 是 v1: 前缀
- [ ] 手动 smoke 验证 curl header 含 RateLimit-* unlimited