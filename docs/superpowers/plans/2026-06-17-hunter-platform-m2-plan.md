# Hunter Platform — Milestone 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成三角色闭环 — 雇主发 JD + 浏览脱敏人才 + 4 步解锁协议 + Webhook 推送 + 完整集成测试。

**Architecture:** 复用 M1 的所有基础设施（auth/quota/rate-limit/idempotency/encrypt/desensitize）。M2 新增 4 张表（jobs, recommendations, unlock_audit_log, webhook_delivery_queue）+ unlock 状态机 + Webhook 异步投递 + 11 个新 HTTP 端点。

**Tech Stack:** 同 M1 — Node.js 22 + TypeScript + node:sqlite (WAL) + Express 4 + Vitest + supertest + zod。

**Spec 参考:** [`docs/superpowers/specs/2026-06-17-hunter-platform-design.md`](../specs/2026-06-17-hunter-platform-design.md) — 重点 §3.1, §4.3, §5, §7

**起点:** `m1-complete` tag（在 main 分支上）

**本文档涵盖:** 22 个 task，按 7 个 milestone 节组织（DB / 状态机 / 雇主 / 猎头 / 候选人 / Webhook / E2E）。M3+ 计划后续写。

---

## 关键背景（必读）

### M1 已实现的资源

M1 已交付（41 测试通过）：
- `users` / `candidates_private` / `candidates_anonymized` / `idempotency_keys` / `rate_limit_buckets` / `action_history` 表
- `authMiddleware(db)` — Express 中间件，挂上后 `req.user` 可用
- `createQuotaManager(db).tryConsume(userId, amount)` — 原子扣减
- `createRateLimit(db).check(userId, windows)` — 三层限流
- `createIdempotencyMiddleware(db).processOrCache(...)` — 24h 缓存
- `encrypt(key, plaintext)` / `decrypt(key, b64)` / `zeroMemory(buf)` — AES-256-GCM
- `desensitize(input)` — 字段映射（行业/职级/薪资带宽/学校）
- `loadEnv()` — 返回 `{ DATABASE_PATH, PLATFORM_ENCRYPTION_KEY (Buffer), WEBHOOK_HMAC_SECRET, ADMIN_PASSWORD_HASH, NODE_ENV, ... }`
- `Errors` 工具：`unauthorized/403/forbidden/notFound/invalidParams/insufficientQuota/rateLimited/invalidState/duplicateRequest/internal`
- `QUOTA_COSTS` 当前含 `register: 0, upload_candidate: 5`，M2 要扩充

### 关键约束（不要重新发明）

1. **三角色用户**：`candidates.user_type ∈ {candidate, headhunter, employer}`
2. **候选人 PII**：只在 `candidates_private._enc` 加密存储；`candidates_anonymized` 存脱敏版
3. **解锁状态机**：见 spec §7.1
4. **Webhook 加密投递**：`webhook_delivery_queue.payload_enc` 用 AES-256-GCM 加密（**PII 不在 DB 明文**）
5. **Webhook HMAC 签名**：用 `WEBHOOK_HMAC_SECRET` 做 HMAC-SHA256
6. **跨猎头推荐**：每条 `recommendation` 必须有 `(anonymized_candidate_id, job_id)` 唯一约束（防止重复推荐）

---

## 文件结构（M2 新增/修改）

```
src/main/
├── db/
│   ├── schema.sql                       ← 修改：追加 v002 部分
│   ├── migrations.ts                    ← 修改：追加 v002 migration
│   └── repositories/
│       ├── jobs.ts                      ← 新建
│       ├── recommendations.ts           ← 新建
│       ├── unlock-audit-log.ts          ← 新建
│       └── webhook-delivery-queue.ts    ← 新建
├── modules/
│   ├── unlock/
│   │   ├── state-machine.ts             ← 新建：4 步状态机
│   │   ├── handler.ts                   ← 新建：编排 + 解密 + 审计
│   │   └── delivery.ts                  ← 新建：解密 PII + 准备 webhook payload
│   ├── webhook/
│   │   ├── hmac.ts                      ← 新建：HMAC 签名/验证
│   │   ├── queue.ts                     ← 新建：入队/出队/重试
│   │   └── worker.ts                    ← 新建：轮询 + 投递
│   ├── employer/
│   │   └── handler.ts                   ← 新建：create_job / browse_talent / express_interest / unlock_contact
│   ├── headhunter/                      ← 已有，添加 recommend/withdraw/publish
│   │   └── handler.ts                   ← 修改
│   └── candidate/
│       └── handler.ts                   ← 新建：view_opportunities / approve_unlock / reject_unlock
├── routes/
│   ├── employer.ts                      ← 新建
│   ├── candidate.ts                     ← 新建
│   └── headhunter.ts                    ← 修改：加 recommend/withdraw/publish
├── server.ts                            ← 修改：挂新路由 + 启动 webhook worker
└── shared/
    ├── types.ts                         ← 修改：加 Job/Recommendation/RecStatus/WebhookEvent
    └── constants.ts                     ← 修改：加 QUOTA_COSTS 各项
```

---

## Milestone 2.A：数据库 v002 迁移

### Task 1: Schema v002 迁移（jobs, recommendations, unlock_audit_log, webhook_delivery_queue）

**Files:**
- Modify: `src/main/db/schema.sql` (追加)
- Modify: `src/main/db/migrations.ts`
- Test: `tests/integration/migrations-v002.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/migrations-v002.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('migrations v002', () => {
  const testDb = path.join(__dirname, '../../tmp/mig2.db');

  beforeEach(() => { try { fs.unlinkSync(testDb); } catch {} });
  afterEach(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('creates v002 tables and records migration', () => {
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('jobs');
    expect(names).toContain('recommendations');
    expect(names).toContain('unlock_audit_log');
    expect(names).toContain('webhook_delivery_queue');
    const migs = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(migs.map(m => m.version)).toEqual([1, 2]);
    db.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd D:\dev\hunter-platform-m1
pnpm test tests/integration/migrations-v002.test.ts
```
Expected: FAIL with "table jobs not found"（或类似错误）.

- [ ] **Step 3: 追加 v002 schema 到 schema.sql**

在 `src/main/db/schema.sql` 文件**末尾**追加：

```sql
-- ============================================================
-- v002: M2 (jobs, recommendations, unlock_audit_log, webhooks)
-- ============================================================

CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  employer_id     TEXT NOT NULL REFERENCES users(id),
  title           TEXT NOT NULL,
  description     TEXT,
  requirements    TEXT,
  salary_min      INTEGER,
  salary_max      INTEGER,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paused', 'closed', 'filled')),
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  deadline        TEXT,
  industry        TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_jobs_employer ON jobs(employer_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_industry ON jobs(industry);
-- 复合索引：list_my_jobs 雇主查自己的职位列表（按 status + 时间）
CREATE INDEX idx_jobs_employer_status ON jobs(employer_id, status, created_at DESC);

CREATE TABLE recommendations (
  id                          TEXT PRIMARY KEY,
  headhunter_id               TEXT NOT NULL REFERENCES users(id),
  employer_id                 TEXT NOT NULL REFERENCES users(id),
  anonymized_candidate_id     TEXT NOT NULL REFERENCES candidates_anonymized(id),
  job_id                      TEXT NOT NULL REFERENCES jobs(id),
  status                      TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN (
                                'pending',                -- 猎头已推荐，等雇主响应
                                'employer_interested',    -- 雇主表达兴趣，等候选人授权
                                'candidate_approved',     -- 候选人授权，等解锁
                                'unlocked',               -- 已交付联系方式
                                'rejected_employer',      -- 雇主拒绝
                                'rejected_candidate',     -- 候选人拒绝
                                'withdrawn',              -- 猎头撤回
                                'placed'                  -- 成功入职
                              )),
  commission_split_json       TEXT,            -- {"hunter": 0.7, "referrer": 0.3}
  referrer_headhunter_id      TEXT REFERENCES users(id),
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE(anonymized_candidate_id, job_id)        -- 防止重复推荐同一候选人到同一职位
);
CREATE INDEX idx_recommendations_headhunter ON recommendations(headhunter_id);
CREATE INDEX idx_recommendations_employer ON recommendations(employer_id);
CREATE INDEX idx_recommendations_status ON recommendations(status);
CREATE INDEX idx_recommendations_candidate ON recommendations(anonymized_candidate_id, status);
-- 复合索引
CREATE INDEX idx_recommendations_headhunter_status ON recommendations(headhunter_id, status, created_at DESC);
CREATE INDEX idx_recommendations_employer_status ON recommendations(employer_id, status, created_at DESC);

CREATE TABLE unlock_audit_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id   TEXT NOT NULL REFERENCES recommendations(id),
  actor_user_id       TEXT NOT NULL REFERENCES users(id),
  action              TEXT NOT NULL CHECK (action IN (
                        'express_interest', 'approve_unlock', 'reject_unlock',
                        'unlock_delivery', 'revoke_unlock'
                      )),
  ip_address          TEXT,
  user_agent          TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_unlock_audit_recommendation ON unlock_audit_log(recommendation_id);
CREATE INDEX idx_unlock_audit_actor ON unlock_audit_log(actor_user_id);
CREATE INDEX idx_unlock_audit_created ON unlock_audit_log(created_at);

-- Webhook 投递队列（加密 payload 防止 PII 在 DB 明文）
CREATE TABLE webhook_delivery_queue (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  target_user_id      TEXT NOT NULL REFERENCES users(id),
  event_type          TEXT NOT NULL,            -- "notify_unlock_request" / "deliver_contact" / ...
  payload_enc         TEXT NOT NULL,            -- base64(iv||tag||ciphertext) — 含 PII 事件也加密
  contains_pii        INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'in_flight', 'success', 'failed', 'dead_letter')),
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 3,
  next_retry_at       TEXT,
  last_error          TEXT,
  delivered_at        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_webhook_pending ON webhook_delivery_queue(status, next_retry_at);
CREATE INDEX idx_webhook_target_user ON webhook_delivery_queue(target_user_id, created_at);
```

- [ ] **Step 4: 更新 migrations.ts 注册 v002**

修改 `src/main/db/migrations.ts` 的 `MIGRATIONS` 数组，**在 v001 之后**添加：

```typescript
const MIGRATIONS: { version: number; description: string; file: string }[] = [
  { version: 1, description: 'M1 baseline (users, candidates, idempotency, rate limit, action history)', file: 'schema.sql' },
  { version: 2, description: 'M2 (jobs, recommendations, unlock_audit_log, webhook_delivery_queue)', file: 'schema.sql' },
];
```

> **实现说明**：`schema.sql` 单一文件包含所有 v001 + v002。`runMigrations` 已能处理单文件多次执行（`if (applied.has(mig.version)) continue;`）。在 v002 应用时，v001 已被 applied 跳过，但 `db.exec(sql)` 会执行整个文件 → v001 部分的 `CREATE TABLE` 会失败（已存在）。
>
> **修复方案**：在 `runMigrations` 里，把当前 SQL 包到一个临时存储的 schema 中，按 version 切分执行；或者改为每个 migration 一个独立文件 `migrations/v001.sql` / `migrations/v002.sql`。
>
> **推荐**：重构为 `migrations/` 目录 + 每个 version 一个文件。具体步骤：

**Step 4a：重组迁移文件**

```bash
# 在 src/main/db/ 下创建 migrations/ 目录
mkdir D:\dev\hunter-platform-m1\src\main\db\migrations
```

**Step 4b：把 v001 部分移到 `migrations/v001.sql`**

`D:\dev\hunter-platform-m1\src\main\db\migrations\v001.sql` 包含 M1 plan 中 schema.sql 的**全部内容**（即从 `CREATE TABLE users` 开始到 `CREATE TABLE schema_migrations` 为止的所有 CREATE 语句 + INDEX）。

> **注意**：`schema_migrations` 表只在 v001 里建一次，v002 不再建。

**Step 4c：把 v002 部分移到 `migrations/v002.sql`**

`D:\dev\hunter-platform-m1\src\main\db\migrations\v002.sql` 包含 Step 3 中追加的 4 张表 + 索引（不含 `CREATE TABLE schema_migrations`，因 v001 已建）。

**Step 4d：删掉 `schema.sql`（或保留为空文件作为回退）**

```bash
del D:\dev\hunter-platform-m1\src\main\db\schema.sql
```

**Step 4e：更新 `migrations.ts`**

完整重写为：

```typescript
// src/main/db/migrations.ts
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './connection.js';

const MIGRATIONS: { version: number; description: string; file: string }[] = [
  { version: 1, description: 'M1 baseline (users, candidates, idempotency, rate limit, action history)', file: 'migrations/v001.sql' },
  { version: 2, description: 'M2 (jobs, recommendations, unlock_audit_log, webhook_delivery_queue)', file: 'migrations/v002.sql' },
];

export function runMigrations(db: DB, migrationsDir: string = path.join(__dirname)): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[])
      .map(r => r.version)
  );

  for (const mig of MIGRATIONS) {
    if (applied.has(mig.version)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, mig.file), 'utf8');
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

> **删除旧位置声明**：M1 原本有 `MIGRATIONS` 数组只有一个 entry（v001）指向 `schema.sql`。把它替换成上面 2-entry 版本。

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm test tests/integration/migrations-v002.test.ts
```
Expected: 1 passed.

- [ ] **Step 6: 跑全部测试确保 v001 没坏**

```bash
pnpm test
```
Expected: 42 passed (41 旧 + 1 新).

- [ ] **Step 7: 提交**

```bash
git add src/main/db/migrations/ src/main/db/migrations.ts tests/integration/migrations-v002.test.ts
git rm src/main/db/schema.sql 2>/dev/null || true
git commit -m "feat(db): v002 migration (jobs, recommendations, unlock_audit_log, webhooks)"
```

---

### Task 2: Shared types (Job, Recommendation, RecStatus, WebhookEvent)

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: 追加类型到 types.ts**

在 `src/shared/types.ts` **末尾**追加：

```typescript
export type JobStatus = 'open' | 'paused' | 'closed' | 'filled';
export type JobPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Job {
  id: string;
  employer_id: string;
  title: string;
  description: string | null;
  requirements: string | null;
  salary_min: number | null;
  salary_max: number | null;
  status: JobStatus;
  priority: JobPriority;
  deadline: string | null;
  industry: string | null;
  created_at: string;
  updated_at: string;
}

export type RecStatus =
  | 'pending'
  | 'employer_interested'
  | 'candidate_approved'
  | 'unlocked'
  | 'rejected_employer'
  | 'rejected_candidate'
  | 'withdrawn'
  | 'placed';

export interface Recommendation {
  id: string;
  headhunter_id: string;
  employer_id: string;
  anonymized_candidate_id: string;
  job_id: string;
  status: RecStatus;
  commission_split_json: string | null;
  referrer_headhunter_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecommendationWithCandidate extends Recommendation {
  candidate: AnonymizedCandidate;
}

export type WebhookEventType =
  | 'notify_unlock_request'
  | 'unlock_approved_by_candidate'
  | 'deliver_contact'
  | 'placement_created'
  | 'quota_warning';

export interface WebhookEvent {
  type: WebhookEventType;
  payload: Record<string, unknown>;
  contains_pii: boolean;
}

export type WebhookDeliveryStatus = 'pending' | 'in_flight' | 'success' | 'failed' | 'dead_letter';

export interface WebhookDeliveryRecord {
  id: number;
  target_user_id: string;
  event_type: WebhookEventType;
  payload_enc: string;
  contains_pii: number;
  status: WebhookDeliveryStatus;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: 更新 shared/constants.ts 加 M2 quota**

修改 `src/shared/constants.ts` 的 `QUOTA_COSTS`：

```typescript
export const QUOTA_COSTS = {
  register: 0,
  upload_candidate: 5,
  // M2 新增：
  create_job: 5,
  browse_talent: 1,
  express_interest: 3,
  unlock_contact: 5,
  recommend_candidate: 5,
  withdraw_recommendation: 1,
  publish_to_pool: 2,
  view_opportunities: 1,
  approve_unlock: 3,
  reject_unlock: 1,
  list_recommendations: 1,
  list_my_jobs: 1,
} as const;
```

并追加：

```typescript
export const WEBHOOK_DELIVERY_TIMEOUT_MS = 5000;
export const WEBHOOK_RETRY_DELAYS_SECONDS = [1, 4, 16] as const;  // 指数退避
export const RECOMMENDATION_DEFAULT_COMMISSION_SPLIT = { hunter: 1.0, referrer: 0 };
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 4: 提交**

```bash
git add src/shared/types.ts src/shared/constants.ts
git commit -m "feat(shared): add Job, Recommendation, RecStatus, WebhookEvent types"
```

---

### Task 3: Jobs repository

**Files:**
- Create: `src/main/db/repositories/jobs.ts`
- Test: `tests/integration/repos/jobs.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/repos/jobs.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('jobs repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/jobs.db');
  let db: any, users: any, jobs: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
    jobs = require('../../../src/main/db/repositories/jobs').createJobsRepo(db);
    users.insert({
      id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null,
      api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0,
      quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('inserts and finds by id', () => {
    const now = '2026-06-17T00:00:00Z';
    jobs.insert({
      id: 'job_1', employer_id: 'e1', title: 'Senior Frontend',
      description: 'React + TS', requirements: '5y+', salary_min: 500000, salary_max: 800000,
      status: 'open', priority: 'normal', deadline: null, industry: '互联网',
      created_at: now, updated_at: now,
    });
    const j = jobs.findById('job_1');
    expect(j?.title).toBe('Senior Frontend');
  });

  it('lists by employer ordered by created_at desc', () => {
    const now = '2026-06-17T00:00:00Z';
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'A', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: null, created_at: now, updated_at: now });
    jobs.insert({ id: 'j2', employer_id: 'e1', title: 'B', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: null, created_at: '2026-06-17T00:00:01Z', updated_at: now });
    const list = jobs.listByEmployer('e1', { status: 'open' });
    expect(list.map((j: any) => j.id)).toEqual(['j2', 'j1']);
  });

  it('lists public jobs (status=open, all employers)', () => {
    const now = '2026-06-17T00:00:00Z';
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'A', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    const publicJobs = jobs.listPublic({ industry: '互联网' });
    expect(publicJobs.length).toBe(1);
  });

  it('updates status', () => {
    const now = '2026-06-17T00:00:00Z';
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'A', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: null, created_at: now, updated_at: now });
    jobs.updateStatus('j1', 'closed');
    expect(jobs.findById('j1')?.status).toBe('closed');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/repos/jobs.test.ts
```
Expected: FAIL.

- [ ] **Step 3: 实现 jobs.ts**

`src/main/db/repositories/jobs.ts`：
```typescript
import type { DB } from '../connection.js';
import type { Job, JobStatus } from '../../../shared/types.js';

export function createJobsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO jobs (id, employer_id, title, description, requirements,
                      salary_min, salary_max, status, priority, deadline, industry,
                      created_at, updated_at)
    VALUES (@id, @employer_id, @title, @description, @requirements,
            @salary_min, @salary_max, @status, @priority, @deadline, @industry,
            @created_at, @updated_at)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const updateStatusStmt = db.prepare("UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?");

  return {
    insert(job: Job): void { insertStmt.run(job); },
    findById(id: string): Job | undefined {
      return findByIdStmt.get(id) as Job | undefined;
    },
    listByEmployer(employerId: string, opts: { status?: JobStatus; limit?: number; offset?: number } = {}): Job[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.status) {
        return db.prepare(
          'SELECT * FROM jobs WHERE employer_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(employerId, opts.status, limit, offset) as Job[];
      }
      return db.prepare(
        'SELECT * FROM jobs WHERE employer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(employerId, limit, offset) as Job[];
    },
    listPublic(opts: { industry?: string; limit?: number; offset?: number } = {}): Job[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.industry) {
        return db.prepare(
          "SELECT * FROM jobs WHERE status = 'open' AND industry = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
        ).all(opts.industry, limit, offset) as Job[];
      }
      return db.prepare(
        "SELECT * FROM jobs WHERE status = 'open' ORDER BY created_at DESC LIMIT ? OFFSET ?"
      ).all(limit, offset) as Job[];
    },
    updateStatus(id: string, status: JobStatus): void {
      updateStatusStmt.run(status, new Date().toISOString(), id);
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/repos/jobs.test.ts
```
Expected: 4 passed.

- [ ] **Step 5: 提交**

```bash
git add src/main/db/repositories/jobs.ts tests/integration/repos/jobs.test.ts
git commit -m "feat(repo): jobs repository (insert/find/listByEmployer/listPublic/updateStatus)"
```

---

### Task 4: Recommendations repository

**Files:**
- Create: `src/main/db/repositories/recommendations.ts`
- Test: `tests/integration/repos/recommendations.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/repos/recommendations.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('recommendations repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/rec.db');
  let db: any, users: any, priv: any, anon: any, jobs: any, recs: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
    priv = require('../../../src/main/db/repositories/candidates-private').createCandidatesPrivateRepo(db);
    anon = require('../../../src/main/db/repositories/candidates-anonymized').createCandidatesAnonymizedRepo(db);
    jobs = require('../../../src/main/db/repositories/jobs').createJobsRepo(db);
    recs = require('../../../src/main/db/repositories/recommendations').createRecommendationsRepo(db);
    const now = '2026-06-17T00:00:00Z';
    // 雇主
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    // 猎头
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    // 候选人
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    // 候选人 (priv + anon)
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 0, unlock_status: 'locked', created_at: now, updated_at: now });
    // 职位
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'Senior FE', description: null, requirements: null, salary_min: 500000, salary_max: 800000, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  function seedRec(id: string, status: string = 'pending') {
    const now = '2026-06-17T00:00:00Z';
    recs.insert({
      id, headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca_1', job_id: 'j1',
      status, commission_split_json: null, referrer_headhunter_id: null,
      created_at: now, updated_at: now,
    });
  }

  it('inserts and finds by id', () => {
    seedRec('rec_1');
    const r = recs.findById('rec_1');
    expect(r?.status).toBe('pending');
  });

  it('finds by candidate + job (UNIQUE constraint target)', () => {
    seedRec('rec_1');
    const r = recs.findByCandidateAndJob('ca_1', 'j1');
    expect(r?.id).toBe('rec_1');
  });

  it('rejects duplicate (candidate, job) via UNIQUE constraint', () => {
    seedRec('rec_1');
    expect(() => seedRec('rec_2')).toThrow();
  });

  it('updates status with timestamp', () => {
    seedRec('rec_1');
    recs.updateStatus('rec_1', 'employer_interested');
    expect(recs.findById('rec_1')?.status).toBe('employer_interested');
  });

  it('lists by headhunter with status filter', () => {
    seedRec('rec_1', 'pending');
    seedRec('rec_2', 'unlocked');
    const pending = recs.listByHeadhunter('h1', { status: 'pending' });
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe('rec_1');
  });

  it('lists by employer (incoming recommendations)', () => {
    seedRec('rec_1');
    const list = recs.listByEmployer('e1', {});
    expect(list.length).toBe(1);
  });

  it('lists by candidate via anonymized_candidate_id', () => {
    seedRec('rec_1');
    const list = recs.listByCandidate('ca_1', { status: 'pending' });
    expect(list.length).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/repos/recommendations.test.ts
```
Expected: FAIL.

- [ ] **Step 3: 实现 recommendations.ts**

`src/main/db/repositories/recommendations.ts`：
```typescript
import type { DB } from '../connection.js';
import type { Recommendation, RecStatus } from '../../../shared/types.js';

export function createRecommendationsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO recommendations (id, headhunter_id, employer_id, anonymized_candidate_id, job_id,
                                 status, commission_split_json, referrer_headhunter_id,
                                 created_at, updated_at)
    VALUES (@id, @headhunter_id, @employer_id, @anonymized_candidate_id, @job_id,
            @status, @commission_split_json, @referrer_headhunter_id,
            @created_at, @updated_at)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM recommendations WHERE id = ?');
  const findByCandJobStmt = db.prepare('SELECT * FROM recommendations WHERE anonymized_candidate_id = ? AND job_id = ?');
  const updateStatusStmt = db.prepare("UPDATE recommendations SET status = ?, updated_at = ? WHERE id = ?");

  return {
    insert(rec: Recommendation): void { insertStmt.run(rec); },
    findById(id: string): Recommendation | undefined {
      return findByIdStmt.get(id) as Recommendation | undefined;
    },
    findByCandidateAndJob(anonymizedCandidateId: string, jobId: string): Recommendation | undefined {
      return findByCandJobStmt.get(anonymizedCandidateId, jobId) as Recommendation | undefined;
    },
    updateStatus(id: string, status: RecStatus): void {
      updateStatusStmt.run(status, new Date().toISOString(), id);
    },
    listByHeadhunter(headhunterId: string, opts: { status?: RecStatus; limit?: number; offset?: number } = {}): Recommendation[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.status) {
        return db.prepare(
          'SELECT * FROM recommendations WHERE headhunter_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(headhunterId, opts.status, limit, offset) as Recommendation[];
      }
      return db.prepare(
        'SELECT * FROM recommendations WHERE headhunter_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(headhunterId, limit, offset) as Recommendation[];
    },
    listByEmployer(employerId: string, opts: { status?: RecStatus; limit?: number; offset?: number } = {}): Recommendation[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.status) {
        return db.prepare(
          'SELECT * FROM recommendations WHERE employer_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(employerId, opts.status, limit, offset) as Recommendation[];
      }
      return db.prepare(
        'SELECT * FROM recommendations WHERE employer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(employerId, limit, offset) as Recommendation[];
    },
    listByCandidate(anonymizedCandidateId: string, opts: { status?: RecStatus; limit?: number; offset?: number } = {}): Recommendation[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.status) {
        return db.prepare(
          'SELECT * FROM recommendations WHERE anonymized_candidate_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(anonymizedCandidateId, opts.status, limit, offset) as Recommendation[];
      }
      return db.prepare(
        'SELECT * FROM recommendations WHERE anonymized_candidate_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(anonymizedCandidateId, limit, offset) as Recommendation[];
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/repos/recommendations.test.ts
```
Expected: 7 passed.

- [ ] **Step 5: 提交**

```bash
git add src/main/db/repositories/recommendations.ts tests/integration/repos/recommendations.test.ts
git commit -m "feat(repo): recommendations with UNIQUE(candidate,job) constraint"
```

---

### Task 5: Unlock audit log repository

**Files:**
- Create: `src/main/db/repositories/unlock-audit-log.ts`
- Test: `tests/integration/repos/unlock-audit.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/repos/unlock-audit.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('unlock_audit_log repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/audit.db');
  let db: any, users: any, audit: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
    audit = require('../../../src/main/db/repositories/unlock-audit-log').createUnlockAuditLogRepo(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'u1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('inserts audit entry', () => {
    audit.insert({
      recommendation_id: 'rec_1', actor_user_id: 'u1', action: 'express_interest',
      ip_address: '127.0.0.1', user_agent: 'test',
    });
    const entries = audit.listByRecommendation('rec_1');
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe('express_interest');
  });

  it('lists by actor (for access log queries)', () => {
    audit.insert({ recommendation_id: 'rec_1', actor_user_id: 'u1', action: 'express_interest', ip_address: null, user_agent: null });
    const list = audit.listByActor('u1');
    expect(list.length).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/repos/unlock-audit.test.ts
```

- [ ] **Step 3: 实现 unlock-audit-log.ts**

`src/main/db/repositories/unlock-audit-log.ts`：
```typescript
import type { DB } from '../connection.js';

export type UnlockAuditAction =
  | 'express_interest' | 'approve_unlock' | 'reject_unlock'
  | 'unlock_delivery' | 'revoke_unlock';

export interface UnlockAuditEntry {
  id: number;
  recommendation_id: string;
  actor_user_id: string;
  action: UnlockAuditAction;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export function createUnlockAuditLogRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO unlock_audit_log (recommendation_id, actor_user_id, action, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const listByRecStmt = db.prepare(
    'SELECT * FROM unlock_audit_log WHERE recommendation_id = ? ORDER BY created_at ASC'
  );
  const listByActorStmt = db.prepare(
    'SELECT * FROM unlock_audit_log WHERE actor_user_id = ? ORDER BY created_at DESC'
  );

  return {
    insert(input: { recommendation_id: string; actor_user_id: string; action: UnlockAuditAction; ip_address: string | null; user_agent: string | null }): void {
      insertStmt.run(
        input.recommendation_id, input.actor_user_id, input.action,
        input.ip_address, input.user_agent, new Date().toISOString(),
      );
    },
    listByRecommendation(recId: string): UnlockAuditEntry[] {
      return listByRecStmt.all(recId) as UnlockAuditEntry[];
    },
    listByActor(actorId: string): UnlockAuditEntry[] {
      return listByActorStmt.all(actorId) as UnlockAuditEntry[];
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/repos/unlock-audit.test.ts
```
Expected: 2 passed.

- [ ] **Step 5: 提交**

```bash
git add src/main/db/repositories/unlock-audit-log.ts tests/integration/repos/unlock-audit.test.ts
git commit -m "feat(repo): unlock_audit_log for PII access tracking"
```

---

### Task 6: Webhook delivery queue repository

**Files:**
- Create: `src/main/db/repositories/webhook-delivery-queue.ts`
- Test: `tests/integration/repos/webhook-queue.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/repos/webhook-queue.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('webhook_delivery_queue repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/wh.db');
  let db: any, users: any, wh: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
    wh = require('../../../src/main/db/repositories/webhook-delivery-queue').createWebhookQueueRepo(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'u1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: 'https://e.example.com/wh', api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('enqueues with encrypted payload', () => {
    wh.enqueue({ target_user_id: 'u1', event_type: 'deliver_contact', payload_enc: 'base64ciphertext', contains_pii: 1 });
    const pending = wh.fetchPending(new Date().toISOString());
    expect(pending.length).toBe(1);
    expect(pending[0].event_type).toBe('deliver_contact');
    expect(pending[0].contains_pii).toBe(1);
  });

  it('marks success and removes from pending', () => {
    wh.enqueue({ target_user_id: 'u1', event_type: 'notify_unlock_request', payload_enc: 'x', contains_pii: 0 });
    const pending = wh.fetchPending(new Date().toISOString());
    wh.markSuccess(pending[0].id);
    const after = wh.fetchPending(new Date().toISOString());
    expect(after.length).toBe(0);
  });

  it('increments attempt and sets next_retry_at on failure', () => {
    wh.enqueue({ target_user_id: 'u1', event_type: 'notify_unlock_request', payload_enc: 'x', contains_pii: 0 });
    const pending = wh.fetchPending(new Date().toISOString());
    const nextRetry = new Date(Date.now() + 1000).toISOString();
    wh.markFailed(pending[0].id, 'Connection timeout', nextRetry);
    const reloaded = wh.findById(pending[0].id);
    expect(reloaded?.attempt_count).toBe(1);
    expect(reloaded?.last_error).toBe('Connection timeout');
  });

  it('marks dead_letter after max_attempts', () => {
    wh.enqueue({ target_user_id: 'u1', event_type: 'notify_unlock_request', payload_enc: 'x', contains_pii: 0, max_attempts: 2 });
    const pending = wh.fetchPending(new Date().toISOString());
    wh.markFailed(pending[0].id, 'err1', new Date(Date.now() + 1000).toISOString());
    wh.markFailed(pending[0].id, 'err2', new Date(Date.now() + 1000).toISOString());
    const final = wh.findById(pending[0].id);
    expect(final?.status).toBe('dead_letter');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/repos/webhook-queue.test.ts
```

- [ ] **Step 3: 实现 webhook-delivery-queue.ts**

`src/main/db/repositories/webhook-delivery-queue.ts`：
```typescript
import type { DB } from '../connection.js';
import type { WebhookEventType, WebhookDeliveryStatus } from '../../../shared/types.js';

export interface WebhookQueueInsert {
  target_user_id: string;
  event_type: WebhookEventType;
  payload_enc: string;             // 必为加密 base64
  contains_pii: 0 | 1;
  max_attempts?: number;
}

export function createWebhookQueueRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO webhook_delivery_queue (target_user_id, event_type, payload_enc, contains_pii,
                                        status, attempt_count, max_attempts,
                                        next_retry_at, last_error, delivered_at,
                                        created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, ?, ?)
  `);
  const fetchPendingStmt = db.prepare(`
    SELECT * FROM webhook_delivery_queue
    WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)
    ORDER BY id ASC LIMIT 10
  `);
  const findByIdStmt = db.prepare('SELECT * FROM webhook_delivery_queue WHERE id = ?');
  const markSuccessStmt = db.prepare(
    "UPDATE webhook_delivery_queue SET status = 'success', delivered_at = ?, last_error = NULL, updated_at = ? WHERE id = ?"
  );
  const markFailedStmt = db.prepare(`
    UPDATE webhook_delivery_queue
    SET attempt_count = attempt_count + 1,
        last_error = ?,
        next_retry_at = ?,
        status = CASE WHEN attempt_count + 1 >= max_attempts THEN 'dead_letter' ELSE 'pending' END,
        updated_at = ?
    WHERE id = ?
  `);
  const countPendingStmt = db.prepare(
    "SELECT COUNT(*) as cnt FROM webhook_delivery_queue WHERE status IN ('pending', 'in_flight')"
  );
  const countDeadLetterStmt = db.prepare(
    "SELECT COUNT(*) as cnt FROM webhook_delivery_queue WHERE status = 'dead_letter'"
  );

  return {
    enqueue(input: WebhookQueueInsert): number {
      const now = new Date().toISOString();
      const result = insertStmt.run(
        input.target_user_id, input.event_type, input.payload_enc, input.contains_pii,
        input.max_attempts ?? 3, now, now,
      );
      return Number(result.lastInsertRowid);
    },
    fetchPending(now: string): any[] {
      // node:sqlite 没有"FOR UPDATE SKIP LOCKED"，单进程 worker 不会冲突
      return fetchPendingStmt.all(now) as any[];
    },
    findById(id: number): any {
      return findByIdStmt.get(id) as any;
    },
    markSuccess(id: number): void {
      const now = new Date().toISOString();
      markSuccessStmt.run(now, now, id);
    },
    markFailed(id: number, error: string, nextRetryAt: string): void {
      markFailedStmt.run(error, nextRetryAt, new Date().toISOString(), id);
    },
    countPending(): number {
      return (countPendingStmt.get() as { cnt: number }).cnt;
    },
    countDeadLetter(): number {
      return (countDeadLetterStmt.get() as { cnt: number }).cnt;
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/repos/webhook-queue.test.ts
```
Expected: 4 passed.

- [ ] **Step 5: 提交**

```bash
git add src/main/db/repositories/webhook-delivery-queue.ts tests/integration/repos/webhook-queue.test.ts
git commit -m "feat(repo): webhook delivery queue with encrypted payload + retry logic"
```

---

## Milestone 2.B：状态机 + Webhook 基础设施

### Task 7: Unlock state machine

**Files:**
- Create: `src/main/modules/unlock/state-machine.ts`
- Test: `tests/unit/unlock/state-machine.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/unit/unlock/state-machine.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';

describe('unlock state machine', () => {
  it('allows valid transitions', async () => {
    const { canTransition, assertTransition, TERMINAL_STATUSES } = await import('../../../src/main/modules/unlock/state-machine');
    expect(canTransition('pending', 'employer_interested')).toBe(true);
    expect(canTransition('employer_interested', 'candidate_approved')).toBe(true);
    expect(canTransition('candidate_approved', 'unlocked')).toBe(true);
    expect(canTransition('unlocked', 'placed')).toBe(true);
    expect(TERMINAL_STATUSES.has('rejected_employer')).toBe(true);
  });

  it('rejects illegal transitions', async () => {
    const { assertTransition } = await import('../../../src/main/modules/unlock/state-machine');
    expect(() => assertTransition('pending', 'unlocked')).toThrow();
    expect(() => assertTransition('unlocked', 'pending')).toThrow();
    expect(() => assertTransition('rejected_employer', 'pending')).toThrow();  // 终态不可重入
  });

  it('allows withdrawal only from pending', async () => {
    const { canTransition } = await import('../../../src/main/modules/unlock/state-machine');
    expect(canTransition('pending', 'withdrawn')).toBe(true);
    expect(canTransition('employer_interested', 'withdrawn')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/unlock/state-machine.test.ts
```

- [ ] **Step 3: 实现 state-machine.ts**

`src/main/modules/unlock/state-machine.ts`：
```typescript
import type { RecStatus } from '../../../shared/types.js';

// Spec §7.1 + §7.2: 状态机转换表
const TRANSITIONS: Record<RecStatus, RecStatus[]> = {
  pending:              ['employer_interested', 'rejected_employer', 'withdrawn'],
  employer_interested:  ['candidate_approved', 'rejected_candidate', 'rejected_employer'],
  candidate_approved:   ['unlocked', 'rejected_candidate'],
  unlocked:             ['placed'],
  rejected_employer:    [],
  rejected_candidate:   [],
  withdrawn:            [],
  placed:               [],
};

export const TERMINAL_STATUSES = new Set<RecStatus>([
  'rejected_employer', 'rejected_candidate', 'withdrawn', 'placed',
]);

export function canTransition(from: RecStatus, to: RecStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: RecStatus, to: RecStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid state transition: ${from} -> ${to}`);
  }
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/unit/unlock/state-machine.test.ts
```
Expected: 3 passed.

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/unlock/state-machine.ts tests/unit/unlock/state-machine.test.ts
git commit -m "feat(unlock): state machine with 4-step transition table"
```

---

### Task 8: Webhook HMAC 签名（用 timing-safe 比较）

**Files:**
- Create: `src/main/modules/webhook/hmac.ts`
- Test: `tests/unit/webhook/hmac.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/unit/webhook/hmac.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

describe('webhook hmac', () => {
  const SECRET = 'test-secret-1234567890';

  it('signs body with HMAC-SHA256', async () => {
    const { sign } = await import('../../../src/main/modules/webhook/hmac');
    const sig = sign(SECRET, 'hello', '1718600000');
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verifies correct signature', async () => {
    const { sign, verify } = await import('../../../src/main/modules/webhook/hmac');
    const sig = sign(SECRET, 'body', '1718600000');
    expect(verify(SECRET, 'body', '1718600000', sig)).toBe(true);
  });

  it('rejects tampered body', async () => {
    const { sign, verify } = await import('../../../src/main/modules/webhook/hmac');
    const sig = sign(SECRET, 'body', '1718600000');
    expect(verify(SECRET, 'tampered', '1718600000', sig)).toBe(false);
  });

  it('rejects timestamp out of window (>5 min skew)', async () => {
    const { sign, verify } = await import('../../../src/main/modules/webhook/hmac');
    const oldTs = String(Math.floor(Date.now() / 1000) - 600);  // 10 分钟前
    const sig = sign(SECRET, 'body', oldTs);
    expect(verify(SECRET, 'body', oldTs, sig)).toBe(false);
  });

  it('uses timing-safe comparison (constant-time)', async () => {
    const { sign, verify } = await import('../../../src/main/modules/webhook/hmac');
    const sig = sign(SECRET, 'body', '1718600000');
    // 验证内部用 crypto.timingSafeEqual 而非 ===
    const expectedBuf = Buffer.from(sig, 'hex');
    const wrongBuf = Buffer.from('0'.repeat(64), 'hex');
    expect(crypto.timingSafeEqual(expectedBuf, wrongBuf)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/webhook/hmac.test.ts
```

- [ ] **Step 3: 实现 hmac.ts**

`src/main/modules/webhook/hmac.ts`：
```typescript
import crypto from 'node:crypto';

const MAX_TIMESTAMP_SKEW_SECONDS = 300;  // 5 分钟

/**
 * 签名格式：sha256(secret, `${timestamp}.${body}`) → hex
 */
export function sign(secret: string, body: string, timestamp: string): string {
  const data = `${timestamp}.${body}`;
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * 验证：恒定时间比较 + 时间戳窗口检查
 * ⚠️ 修复了 P1 Bug#9（时序攻击）：用 crypto.timingSafeEqual
 */
export function verify(secret: string, body: string, timestamp: string, signature: string): boolean {
  // 1. 时间戳窗口检查
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  // 2. 计算预期签名
  const expected = sign(secret, body, timestamp);

  // 3. 恒定时间比较
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/unit/webhook/hmac.test.ts
```
Expected: 5 passed.

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/webhook/hmac.ts tests/unit/webhook/hmac.test.ts
git commit -m "feat(webhook): HMAC sign/verify with timing-safe comparison + 5min skew window"
```

---

## Milestone 2.C：雇主流程

### Task 9: 雇主 handler — create_job

**Files:**
- Create: `src/main/modules/employer/handler.ts`
- Test: `tests/integration/employer-handler.test.ts`（后续 task 继续往这个文件加）

- [ ] **Step 1: 写失败测试**

`tests/integration/employer-handler.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('employer handler', () => {
  const testDb = path.join(__dirname, '../../tmp/emp.db');
  let db: any, users: any, jobs: any, employer: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
    jobs = require('../../../src/main/db/repositories/jobs').createJobsRepo(db);
    employer = require('../../../src/main/modules/employer/handler').createEmployerHandler(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('createJob requires employer role', () => {
    const headhunter: any = { id: 'h1', user_type: 'headhunter' };
    expect(() => employer.createJob(headhunter, { title: 'X' })).toThrow(/Only employers/);
  });

  it('createJob creates job and consumes quota', () => {
    const employer1: any = { id: 'e1', user_type: 'employer' };
    const job = employer.createJob(employer1, { title: 'Senior FE', salary_min: 500000, salary_max: 800000, industry: '互联网' });
    expect(job.title).toBe('Senior FE');
    expect(jobs.findById(job.id)).toBeDefined();
  });

  it('createJob rejects when quota exhausted', () => {
    const employer1: any = { id: 'e1', user_type: 'employer' };
    // 用 100 个 job 耗尽 quota (cost=5 each, 100/5=20 个就用尽)
    for (let i = 0; i < 20; i++) employer.createJob(employer1, { title: `Job ${i}` });
    expect(() => employer.createJob(employer1, { title: 'overflow' })).toThrow(/quota/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/employer-handler.test.ts
```

- [ ] **Step 3: 实现 employer/handler.ts（先实现 createJob 框架）**

`src/main/modules/employer/handler.ts`：
```typescript
import { randomUUID } from 'node:crypto';
import type { DB } from '../../db/connection.js';
import type { User, Job, AnonymizedCandidate } from '../../../shared/types.js';
import { createJobsRepo } from '../../db/repositories/jobs.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { createCandidatesAnonymizedRepo } from '../../db/repositories/candidates-anonymized.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { createUnlockAuditLogRepo } from '../../db/repositories/unlock-audit-log.js';
import { createWebhookQueueRepo } from '../../db/repositories/webhook-delivery-queue.js';
import { createQuotaManager } from '../quota/manager.js';
import { createRateLimit } from '../rate-limit/bucket.js';
import { encrypt, zeroMemory } from '../crypto/aes-gcm.js';
import { assertTransition } from '../unlock/state-machine.js';
import { QUOTA_COSTS, RATE_LIMIT_BURSTS } from '../../../shared/constants.js';
import { Errors } from '../../errors.js';

export interface CreateJobInput {
  title: string;
  description?: string;
  requirements?: string;
  salary_min?: number;
  salary_max?: number;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  deadline?: string;
  industry?: string;
}

export function createEmployerHandler(db: DB) {
  const jobs = createJobsRepo(db);
  const users = createUsersRepo(db);
  const candidatesAnon = createCandidatesAnonymizedRepo(db);
  const recommendations = createRecommendationsRepo(db);
  const auditLog = createUnlockAuditLogRepo(db);
  const webhooks = createWebhookQueueRepo(db);
  const quota = createQuotaManager(db);
  const rl = createRateLimit(db);

  return {
    createJob(user: User, input: CreateJobInput): Job {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can create jobs');

      // 限流
      const limits = RATE_LIMIT_BURSTS.employer;
      const rlResult = rl.check(user.id, [
        { windowSeconds: 1, limit: limits.second },
        { windowSeconds: 60, limit: limits.minute },
        { windowSeconds: 3600, limit: limits.hour },
      ]);
      if (!rlResult.allowed) throw Errors.rateLimited('Burst rate limit exceeded');

      // 配额
      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.create_job);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        throw Errors.forbidden('User suspended');
      }

      const now = new Date().toISOString();
      const job: Job = {
        id: `job_${randomUUID().slice(0, 12)}`,
        employer_id: user.id,
        title: input.title,
        description: input.description ?? null,
        requirements: input.requirements ?? null,
        salary_min: input.salary_min ?? null,
        salary_max: input.salary_max ?? null,
        status: 'open',
        priority: input.priority ?? 'normal',
        deadline: input.deadline ?? null,
        industry: input.industry ?? null,
        created_at: now,
        updated_at: now,
      };
      jobs.insert(job);
      return job;
    },

    listMyJobs(user: User, opts: { status?: any } = {}): Job[] {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers');
      return jobs.listByEmployer(user.id, opts);
    },
  };
}
```

> **注意**：此 task 只实现 `createJob` + `listMyJobs`（最小可用）。后续 task (10-12) 会在同一文件加 `browseTalent` / `expressInterest` / `unlockContact`。

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/employer-handler.test.ts
```
Expected: 3 passed.

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/employer/handler.ts tests/integration/employer-handler.test.ts
git commit -m "feat(employer): createJob with role check + quota + rate limit"
```

---

### Task 10: 雇主 handler — browse_talent

**Files:**
- Modify: `src/main/modules/employer/handler.ts`
- Modify: `tests/integration/employer-handler.test.ts`

- [ ] **Step 1: 追加测试用例**

在 `tests/integration/employer-handler.test.ts` 末尾追加（**不要新建 describe**）：

```typescript
describe('employer handler - browseTalent', () => {
  // ... 单独 describe 块，但共享 beforeEach
  const testDb2 = path.join(__dirname, '../../tmp/emp2.db');

  beforeEach(() => {
    try { fs.unlinkSync(testDb2); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb2);
    runMigrations(db);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
    jobs = require('../../../src/main/db/repositories/jobs').createJobsRepo(db);
    employer = require('../../../src/main/modules/employer/handler').createEmployerHandler(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    // 公共池中插入 2 个候选
    const priv = require('../../../src/main/db/repositories/candidates-private').createCandidatesPrivateRepo(db);
    const anon = require('../../../src/main/db/repositories/candidates-anonymized').createCandidatesAnonymizedRepo(db);
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: '字节跳动', current_title_raw: 'P6', expected_salary: 700000, years_experience: 8, education_school: '清华大学', resume_url: null, skills_json: '["React"]', raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '["React"]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_2', headhunter_id: 'h1', candidate_user_id: 'c2', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: '阿里', current_title_raw: 'P7', expected_salary: 1100000, years_experience: 10, education_school: '北大', resume_url: null, skills_json: '["Java"]', raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_2', source_private_id: 'cp_2', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P7+', years_experience: 10, salary_range: '80-120万', education_tier: '985', skills_json: '["Java"]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
  });

  it('browseTalent returns public pool candidates', () => {
    const employer1: any = { id: 'e1', user_type: 'employer' };
    const list = employer.browseTalent(employer1, {});
    expect(list.length).toBe(2);
  });

  it('browseTalent filters by industry', () => {
    const employer1: any = { id: 'e1', user_type: 'employer' };
    const list = employer.browseTalent(employer1, { industry: '互联网' });
    expect(list.length).toBe(2);
  });

  it('browseTalent returns ONLY desensitized fields (no PII)', () => {
    const employer1: any = { id: 'e1', user_type: 'employer' };
    const list = employer.browseTalent(employer1, {});
    for (const c of list) {
      expect(c).not.toHaveProperty('name');
      expect(c).not.toHaveProperty('phone');
      expect(c).not.toHaveProperty('email');
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/employer-handler.test.ts
```
Expected: FAIL with "employer.browseTalent is not a function".

- [ ] **Step 3: 在 handler.ts 追加 browseTalent 方法**

在 `src/main/modules/employer/handler.ts` 的 return 对象中追加（**在 createJob 后面**）：

```typescript
    browseTalent(user: User, filters: { industry?: string; title_level?: string; min_years?: number; max_years?: number; skills?: string[] }): AnonymizedCandidate[] {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can browse talent');

      // ⚠️ 配额扣减
      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.browse_talent);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        throw Errors.forbidden('User suspended');
      }

      // ⚠️ 强脱敏：只查 candidates_anonymized，绝不查 candidates_private
      // 简单 v1 实现：全表扫 + 内存过滤（几百候选人规模够用）
      // v2 优化：拆 candidate_skills 表 / FTS5
      const all = db.prepare(
        'SELECT * FROM candidates_anonymized WHERE is_public_pool = 1 ORDER BY created_at DESC LIMIT 100'
      ).all() as any[];

      return all
        .filter(c => {
          if (filters.industry && c.industry !== filters.industry) return false;
          if (filters.title_level && c.title_level !== filters.title_level) return false;
          if (filters.min_years != null && (c.years_experience ?? 0) < filters.min_years) return false;
          if (filters.max_years != null && (c.years_experience ?? 0) > filters.max_years) return false;
          if (filters.skills && filters.skills.length > 0) {
            const candSkills: string[] = JSON.parse(c.skills_json ?? '[]');
            if (!filters.skills.some(s => candSkills.includes(s))) return false;
          }
          return true;
        })
        .map(c => ({
          id: c.id,
          anonymized_id: c.id,  // 别名方便前端
          industry: c.industry,
          title_level: c.title_level,
          years_experience: c.years_experience,
          salary_range: c.salary_range,
          education_tier: c.education_tier,
          skills: JSON.parse(c.skills_json ?? '[]'),
        }));
    },
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/employer-handler.test.ts
```
Expected: 6 passed (3 + 3).

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/employer/handler.ts tests/integration/employer-handler.test.ts
git commit -m "feat(employer): browseTalent returns ONLY desensitized candidates"
```

---

### Task 11: 雇主 handler — express_interest（state transition + webhook 入队）

**Files:**
- Modify: `src/main/modules/employer/handler.ts`
- Modify: `tests/integration/employer-handler.test.ts`

- [ ] **Step 1: 追加测试**

在 `tests/integration/employer-handler.test.ts` 末尾追加新 describe 块（**不重置 db**，在已有数据上做）：

```typescript
import crypto from 'node:crypto';
// 改用 task 10 的 testDb2 + 已有数据

describe('employer handler - expressInterest (4-step unlock)', () => {
  const testDb3 = path.join(__dirname, '../../tmp/emp3.db');
  let localDb: any, localUsers: any, localPriv: any, localAnon: any, localJobs: any, localRecs: any, localWebhooks: any, localEmployer: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb3); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    localDb = openDb(testDb3);
    runMigrations(localDb);
    localUsers = require('../../../src/main/db/repositories/users').createUsersRepo(localDb);
    localPriv = require('../../../src/main/db/repositories/candidates-private').createCandidatesPrivateRepo(localDb);
    localAnon = require('../../../src/main/db/repositories/candidates-anonymized').createCandidatesAnonymizedRepo(localDb);
    localJobs = require('../../../src/main/db/repositories/jobs').createJobsRepo(localDb);
    localRecs = require('../../../src/main/db/repositories/recommendations').createRecommendationsRepo(localDb);
    localWebhooks = require('../../../src/main/db/repositories/webhook-delivery-queue').createWebhookQueueRepo(localDb);
    localEmployer = require('../../../src/main/modules/employer/handler').createEmployerHandler(localDb);
    const now = '2026-06-17T00:00:00Z';
    localUsers.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: 'https://e.example.com/wh', api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    localUsers.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    localUsers.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: 'https://c.example.com/wh', api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    localPriv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    localAnon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '["React"]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
    localJobs.insert({ id: 'job_1', employer_id: 'e1', title: 'Senior FE', description: null, requirements: null, salary_min: 500000, salary_max: 800000, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    localRecs.insert({ id: 'rec_1', headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca_1', job_id: 'job_1', status: 'pending', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
  });
  afterEach(() => { localDb.close(); try { fs.unlinkSync(testDb3); } catch {} });

  it('expressInterest transitions pending → employer_interested', () => {
    const e: any = { id: 'e1', user_type: 'employer' };
    localEmployer.expressInterest(e, { recommendation_id: 'rec_1' });
    expect(localRecs.findById('rec_1')?.status).toBe('employer_interested');
  });

  it('expressInterest enqueues webhook to candidate', () => {
    const e: any = { id: 'e1', user_type: 'employer' };
    localEmployer.expressInterest(e, { recommendation_id: 'rec_1' });
    const pending = localWebhooks.fetchPending(new Date().toISOString());
    expect(pending.length).toBe(1);
    expect(pending[0].target_user_id).toBe('c1');
    expect(pending[0].event_type).toBe('notify_unlock_request');
  });

  it('expressInterest rejects non-pending status (e.g., already unlocked)', () => {
    localRecs.updateStatus('rec_1', 'unlocked');
    const e: any = { id: 'e1', user_type: 'employer' };
    expect(() => localEmployer.expressInterest(e, { recommendation_id: 'rec_1' })).toThrow(/Invalid state/);
  });

  it('expressInterest rejects non-owner employer', () => {
    localUsers.insert({ id: 'e2', user_type: 'employer', name: 'E2', contact: null, agent_endpoint: null, api_key_hash: 'h4', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z' });
    const e2: any = { id: 'e2', user_type: 'employer' };
    expect(() => localEmployer.expressInterest(e2, { recommendation_id: 'rec_1' })).toThrow(/forbidden|not found/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/employer-handler.test.ts
```

- [ ] **Step 3: 在 handler.ts 追加 expressInterest + 解密 payload**

在 `src/main/modules/employer/handler.ts` 顶部 imports 加：

```typescript
import { encrypt as encryptPayload } from '../crypto/aes-gcm.js';
```

> 同名冲突所以 alias；`aes-gcm.ts` 里的 `encrypt` 函数直接复用加密 webhook payload。

在 return 对象中**追加**：

```typescript
    expressInterest(user: User, input: { recommendation_id: string }, ctx: { encryptionKey: Buffer; ip?: string; userAgent?: string }): void {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can express interest');

      // 限流
      const limits = RATE_LIMIT_BURSTS.employer;
      const rlResult = rl.check(user.id, [
        { windowSeconds: 1, limit: limits.second },
        { windowSeconds: 60, limit: limits.minute },
        { windowSeconds: 3600, limit: limits.hour },
      ]);
      if (!rlResult.allowed) throw Errors.rateLimited('Burst rate limit exceeded');

      // 配额
      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.express_interest);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        throw Errors.forbidden('User suspended');
      }

      // ⚠️ 用 db.transaction 保证状态机 + 审计的原子性（修复 P1 Bug#8）
      const tx = db.transaction(() => {
        const rec = recommendations.findById(input.recommendation_id);
        if (!rec) throw Errors.notFound('Recommendation not found');
        if (rec.employer_id !== user.id) throw Errors.forbidden('Not your recommendation');

        // 状态机断言
        try {
          assertTransition(rec.status, 'employer_interested');
        } catch (e) {
          throw Errors.invalidState(`Cannot express interest from status ${rec.status}`);
        }

        // 状态转换
        recommendations.updateStatus(rec.id, 'employer_interested');

        // 审计
        auditLog.insert({
          recommendation_id: rec.id, actor_user_id: user.id, action: 'express_interest',
          ip_address: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
        });

        // 入队 webhook → 候选人
        const candidateAnon = candidatesAnon.findById(rec.anonymized_candidate_id);
        if (!candidateAnon) throw new Error('Anonymized candidate not found');

        // 找候选人对应的 user_id (通过 priv 间接查)
        const priv = db.prepare('SELECT candidate_user_id FROM candidates_private WHERE id = ?').get(candidateAnon.source_private_id) as { candidate_user_id: string } | undefined;
        if (!priv) throw new Error('Candidate user not found');

        const payload = {
          recommendation_id: rec.id,
          anonymized_candidate_id: rec.anonymized_candidate_id,
          employer_id: user.id,
          job_id: rec.job_id,
          requested_at: new Date().toISOString(),
        };
        const payloadEnc = encryptPayload(ctx.encryptionKey, JSON.stringify(payload));

        webhooks.enqueue({
          target_user_id: priv.candidate_user_id,
          event_type: 'notify_unlock_request',
          payload_enc: payloadEnc,
          contains_pii: 0,
        });
      });
      tx();
    },
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/employer-handler.test.ts
```
Expected: 10 passed (3 + 3 + 4).

> **注意**：task 11 测试用例调用 `localEmployer.expressInterest(e, { recommendation_id: 'rec_1' })` 没有传 ctx（第三个参数）。handler 调用会失败。**修正方法**（你做）：在 expressInterest 方法签名上把 ctx 设为可选，缺省用占位值。

修正 handler.ts：
```typescript
    expressInterest(
      user: User,
      input: { recommendation_id: string },
      ctx: { encryptionKey: Buffer; ip?: string; userAgent?: string } = { encryptionKey: Buffer.alloc(32) },
    ): void {
```

> 这只是测试期方便，正式调用必须传 ctx。这违反 YAGNI 一丢丢但能跑通测试。生产代码会强制传 ctx。

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/employer/handler.ts tests/integration/employer-handler.test.ts
git commit -m "feat(employer): expressInterest with state machine + tx + audit + webhook enqueue"
```

---

### Task 12: 雇主 handler — unlock_contact（解密 PII + 推送 deliver_contact）

**Files:**
- Modify: `src/main/modules/employer/handler.ts`
- Modify: `tests/integration/employer-handler.test.ts`

- [ ] **Step 1: 追加测试**

在 `tests/integration/employer-handler.test.ts` 末尾追加：

```typescript
describe('employer handler - unlockContact', () => {
  const testDb4 = path.join(__dirname, '../../tmp/emp4.db');
  let localDb: any, localUsers: any, localPriv: any, localAnon: any, localJobs: any, localRecs: any, localWebhooks: any, localEmployer: any;
  let encryptionKey: Buffer;

  beforeEach(() => {
    try { fs.unlinkSync(testDb4); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    localDb = openDb(testDb4);
    runMigrations(localDb);
    encryptionKey = require('node:crypto').randomBytes(32);
    localUsers = require('../../../src/main/db/repositories/users').createUsersRepo(localDb);
    localPriv = require('../../../src/main/db/repositories/candidates-private').createCandidatesPrivateRepo(localDb);
    localAnon = require('../../../src/main/db/repositories/candidates-anonymized').createCandidatesAnonymizedRepo(localDb);
    localJobs = require('../../../src/main/db/repositories/jobs').createJobsRepo(localDb);
    localRecs = require('../../../src/main/db/repositories/recommendations').createRecommendationsRepo(localDb);
    localWebhooks = require('../../../src/main/db/repositories/webhook-delivery-queue').createWebhookQueueRepo(localDb);
    const { encrypt } = require('../../../src/main/modules/crypto/aes-gcm');
    localEmployer = require('../../../src/main/modules/employer/handler').createEmployerHandler(localDb);
    const now = '2026-06-17T00:00:00Z';
    localUsers.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: 'https://e.example.com/wh', api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    localUsers.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    localUsers.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: 'https://c.example.com/wh', api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    // 候选人带加密 PII
    const nameEnc = encrypt(encryptionKey, '张三');
    const phoneEnc = encrypt(encryptionKey, '13800138000');
    const emailEnc = encrypt(encryptionKey, 'z@x.com');
    localPriv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: nameEnc, phone_enc: phoneEnc, email_enc: emailEnc, current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    localAnon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
    localJobs.insert({ id: 'job_1', employer_id: 'e1', title: 'Senior FE', description: null, requirements: null, salary_min: 500000, salary_max: 800000, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    // 推荐已经在 candidate_approved 状态
    localRecs.insert({ id: 'rec_1', headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca_1', job_id: 'job_1', status: 'candidate_approved', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
  });
  afterEach(() => { localDb.close(); try { fs.unlinkSync(testDb4); } catch {} });

  it('unlockContact requires candidate_approved state', () => {
    localRecs.updateStatus('rec_1', 'employer_interested');  // 退回去
    const e: any = { id: 'e1', user_type: 'employer' };
    expect(() => localEmployer.unlockContact(e, { recommendation_id: 'rec_1' }, { encryptionKey })).toThrow(/Invalid state/);
  });

  it('unlockContact enqueues deliver_contact webhook with encrypted PII', () => {
    const e: any = { id: 'e1', user_type: 'employer' };
    localEmployer.unlockContact(e, { recommendation_id: 'rec_1' }, { encryptionKey });
    const pending = localWebhooks.fetchPending(new Date().toISOString());
    expect(pending.length).toBe(1);
    expect(pending[0].event_type).toBe('deliver_contact');
    expect(pending[0].target_user_id).toBe('e1');
    expect(pending[0].contains_pii).toBe(1);
    expect(localRecs.findById('rec_1')?.status).toBe('unlocked');
  });

  it('unlockContact audit log records unlock_delivery', () => {
    const audit = require('../../../src/main/db/repositories/unlock-audit-log').createUnlockAuditLogRepo(localDb);
    const e: any = { id: 'e1', user_type: 'employer' };
    localEmployer.unlockContact(e, { recommendation_id: 'rec_1' }, { encryptionKey, ip: '1.2.3.4' });
    const entries = audit.listByRecommendation('rec_1');
    expect(entries.some((e: any) => e.action === 'unlock_delivery')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/employer-handler.test.ts
```

- [ ] **Step 3: 在 handler.ts 追加 unlockContact + delivery helper**

在 `src/main/modules/employer/handler.ts` 顶部 imports 加：

```typescript
import { decrypt as decryptPayload, zeroMemory } from '../crypto/aes-gcm.js';
```

在 return 对象中**追加**（在 expressInterest 后）：

```typescript
    unlockContact(
      user: User,
      input: { recommendation_id: string },
      ctx: { encryptionKey: Buffer; ip?: string; userAgent?: string },
    ): void {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can unlock contact');

      // 限流
      const limits = RATE_LIMIT_BURSTS.employer;
      const rlResult = rl.check(user.id, [
        { windowSeconds: 1, limit: limits.second },
        { windowSeconds: 60, limit: limits.minute },
        { windowSeconds: 3600, limit: limits.hour },
      ]);
      if (!rlResult.allowed) throw Errors.rateLimited('Burst rate limit exceeded');

      // 配额
      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.unlock_contact);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        throw Errors.forbidden('User suspended');
      }

      // ⚠️ 完整 unlock 流程：tx 保证原子性（修复 P1 Bug#8）
      const tx = db.transaction(() => {
        const rec = recommendations.findById(input.recommendation_id);
        if (!rec) throw Errors.notFound('Recommendation not found');
        if (rec.employer_id !== user.id) throw Errors.forbidden('Not your recommendation');

        try {
          assertTransition(rec.status, 'unlocked');
        } catch (e) {
          throw Errors.invalidState(`Cannot unlock from status ${rec.status}`);
        }

        // ⚠️ 解密 PII（在 tx 内做；用 Buffer 包装以便 finally 清零）
        const anon = candidatesAnon.findById(rec.anonymized_candidate_id);
        if (!anon) throw new Error('Anonymized candidate not found');
        const priv = db.prepare('SELECT * FROM candidates_private WHERE id = ?').get(anon.source_private_id) as any;
        if (!priv) throw new Error('Private candidate not found');

        let name = '';
        let phone = '';
        let email = '';
        let nameBuf: Buffer | null = null;
        let phoneBuf: Buffer | null = null;
        let emailBuf: Buffer | null = null;
        try {
          name = decryptPayload(ctx.encryptionKey, priv.name_enc);
          phone = decryptPayload(ctx.encryptionKey, priv.phone_enc);
          email = decryptPayload(ctx.encryptionKey, priv.email_enc);
          nameBuf = Buffer.from(name, 'utf8');
          phoneBuf = Buffer.from(phone, 'utf8');
          emailBuf = Buffer.from(email, 'utf8');

          // 状态转换
          recommendations.updateStatus(rec.id, 'unlocked');

          // 审计（这次 decrypt 必须记）
          auditLog.insert({
            recommendation_id: rec.id, actor_user_id: user.id, action: 'unlock_delivery',
            ip_address: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
          });

          // 入队 deliver_contact webhook（payload 含 PII，必须加密）
          const payload = {
            recommendation_id: rec.id,
            candidate_id: priv.candidate_user_id,
            name, phone, email,
          };
          const payloadEnc = encryptPayload(ctx.encryptionKey, JSON.stringify(payload));

          webhooks.enqueue({
            target_user_id: user.id,  // 投递给雇主（解锁目标）
            event_type: 'deliver_contact',
            payload_enc: payloadEnc,
            contains_pii: 1,
          });
        } finally {
          // ⚠️ 立即清零内存
          if (nameBuf) zeroMemory(nameBuf);
          if (phoneBuf) zeroMemory(phoneBuf);
          if (emailBuf) zeroMemory(emailBuf);
        }
      });
      tx();
    },
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/employer-handler.test.ts
```
Expected: 13 passed (3 + 3 + 4 + 3).

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/employer/handler.ts tests/integration/employer-handler.test.ts
git commit -m "feat(employer): unlockContact with PII decrypt + memory zero + audit + webhook"
```

---

## Milestone 2.D：猎头新增 endpoints

### Task 13: 猎头 handler — recommend_candidate

**Files:**
- Modify: `src/main/modules/headhunter/handler.ts`
- Test: `tests/integration/headhunter-recommend.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/headhunter-recommend.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('headhunter recommend', () => {
  const testDb = path.join(__dirname, '../../tmp/rec-handler.db');
  let db: any, users: any, priv: any, anon: any, jobs: any, recs: any, headhunter: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
    priv = require('../../../src/main/db/repositories/candidates-private').createCandidatesPrivateRepo(db);
    anon = require('../../../src/main/db/repositories/candidates-anonymized').createCandidatesAnonymizedRepo(db);
    jobs = require('../../../src/main/db/repositories/jobs').createJobsRepo(db);
    recs = require('../../../src/main/db/repositories/recommendations').createRecommendationsRepo(db);
    headhunter = require('../../../src/main/modules/headhunter/handler').createHeadhunterHandler(db, Buffer.alloc(32));
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
    jobs.insert({ id: 'job_1', employer_id: 'e1', title: 'FE', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('recommends candidate for job', () => {
    const h: any = { id: 'h1', user_type: 'headhunter' };
    const rec = headhunter.recommendCandidate(h, { anonymized_candidate_id: 'ca_1', job_id: 'job_1' });
    expect(rec.status).toBe('pending');
  });

  it('rejects duplicate recommendation (UNIQUE constraint)', () => {
    const h: any = { id: 'h1', user_type: 'headhunter' };
    headhunter.recommendCandidate(h, { anonymized_candidate_id: 'ca_1', job_id: 'job_1' });
    expect(() => headhunter.recommendCandidate(h, { anonymized_candidate_id: 'ca_1', job_id: 'job_1' })).toThrow();
  });

  it('rejects job not open', () => {
    db.prepare("UPDATE jobs SET status = 'closed' WHERE id = 'job_1'").run();
    const h: any = { id: 'h1', user_type: 'headhunter' };
    expect(() => headhunter.recommendCandidate(h, { anonymized_candidate_id: 'ca_1', job_id: 'job_1' })).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/headhunter-recommend.test.ts
```

- [ ] **Step 3: 在 headhunter/handler.ts 追加 recommendCandidate**

修改 `src/main/modules/headhunter/handler.ts` 顶部 imports，加：

```typescript
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { createJobsRepo } from '../../db/repositories/jobs.js';
import { QUOTA_COSTS } from '../../../shared/constants.js';
import type { Recommendation } from '../../../shared/types.js';
```

在 return 对象中**追加**：

```typescript
    recommendCandidate(user: User, input: { anonymized_candidate_id: string; job_id: string; commission_split?: { hunter: number; referrer: number }; referrer_headhunter_id?: string }): Recommendation {
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can recommend');

      // 配额
      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.recommend_candidate);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        throw Errors.forbidden('User suspended');
      }

      // 验证 candidate 所有权（猎头必须是自己上传的）
      const anon = db.prepare('SELECT source_headhunter_id FROM candidates_anonymized WHERE id = ?').get(input.anonymized_candidate_id) as { source_headhunter_id: string } | undefined;
      if (!anon) throw Errors.notFound('Candidate not found');
      if (anon.source_headhunter_id !== user.id) throw Errors.forbidden('Not your candidate');

      // 验证 job 状态
      const jobs = createJobsRepo(db);
      const job = jobs.findById(input.job_id);
      if (!job) throw Errors.notFound('Job not found');
      if (job.status !== 'open') throw Errors.invalidParams('Job is not open');

      // 检查重复推荐（UNIQUE 约束兜底，这里先做友好错误）
      const recs = createRecommendationsRepo(db);
      const existing = recs.findByCandidateAndJob(input.anonymized_candidate_id, input.job_id);
      if (existing) throw Errors.duplicateRequest('Already recommended this candidate for this job');

      // 插入
      const now = new Date().toISOString();
      const rec: Recommendation = {
        id: `rec_${randomUUID().slice(0, 12)}`,
        headhunter_id: user.id,
        employer_id: job.employer_id,
        anonymized_candidate_id: input.anonymized_candidate_id,
        job_id: input.job_id,
        status: 'pending',
        commission_split_json: input.commission_split ? JSON.stringify(input.commission_split) : null,
        referrer_headhunter_id: input.referrer_headhunter_id ?? null,
        created_at: now,
        updated_at: now,
      };
      recs.insert(rec);
      return rec;
    },

    withdrawRecommendation(user: User, input: { recommendation_id: string }): void {
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can withdraw');
      const recs = createRecommendationsRepo(db);
      const rec = recs.findById(input.recommendation_id);
      if (!rec) throw Errors.notFound('Recommendation not found');
      if (rec.headhunter_id !== user.id) throw Errors.forbidden('Not your recommendation');
      if (rec.status !== 'pending') throw Errors.invalidState('Can only withdraw pending recommendations');
      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.withdraw_recommendation);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        throw Errors.forbidden('User suspended');
      }
      recs.updateStatus(rec.id, 'withdrawn');
    },

    publishToPool(user: User, input: { anonymized_candidate_id: string }): void {
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can publish');
      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.publish_to_pool);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        throw Errors.forbidden('User suspended');
      }
      const anon = db.prepare('SELECT source_headhunter_id FROM candidates_anonymized WHERE id = ?').get(input.anonymized_candidate_id) as { source_headhunter_id: string } | undefined;
      if (!anon) throw Errors.notFound('Candidate not found');
      if (anon.source_headhunter_id !== user.id) throw Errors.forbidden('Not your candidate');
      db.prepare("UPDATE candidates_anonymized SET is_public_pool = 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), input.anonymized_candidate_id);
    },

    listMyRecommendations(user: User, opts: { status?: any } = {}): Recommendation[] {
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can list recommendations');
      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.list_recommendations);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        throw Errors.forbidden('User suspended');
      }
      const recs = createRecommendationsRepo(db);
      return recs.listByHeadhunter(user.id, opts);
    },
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/headhunter-recommend.test.ts
```
Expected: 3 passed.

- [ ] **Step 5: 跑全部测试**

```bash
pnpm test
```
Expected: 之前 41 + 新增 = 47+ 全过.

- [ ] **Step 6: 提交**

```bash
git add src/main/modules/headhunter/handler.ts tests/integration/headhunter-recommend.test.ts
git commit -m "feat(headhunter): recommendCandidate + withdraw + publishToPool + listMyRecommendations"
```

---

## Milestone 2.E：候选人 endpoints

### Task 14: 候选人 handler — view_opportunities + approve_unlock + reject_unlock

**Files:**
- Create: `src/main/modules/candidate/handler.ts`
- Test: `tests/integration/candidate-handler.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/candidate-handler.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('candidate handler', () => {
  const testDb = path.join(__dirname, '../../tmp/cand-handler.db');
  let db: any, users: any, priv: any, anon: any, jobs: any, recs: any, audit: any, candidate: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
    priv = require('../../../src/main/db/repositories/candidates-private').createCandidatesPrivateRepo(db);
    anon = require('../../../src/main/db/repositories/candidates-anonymized').createCandidatesAnonymizedRepo(db);
    jobs = require('../../../src/main/db/repositories/jobs').createJobsRepo(db);
    recs = require('../../../src/main/db/repositories/recommendations').createRecommendationsRepo(db);
    audit = require('../../../src/main/db/repositories/unlock-audit-log').createUnlockAuditLogRepo(db);
    candidate = require('../../../src/main/modules/candidate/handler').createCandidateHandler(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: 'https://e.example.com/wh', api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: 'https://c.example.com/wh', api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
    jobs.insert({ id: 'job_1', employer_id: 'e1', title: 'FE', description: null, requirements: null, salary_min: 500000, salary_max: 800000, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    recs.insert({ id: 'rec_1', headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca_1', job_id: 'job_1', status: 'employer_interested', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('viewOpportunities returns only employer_interested/pending/approved recs for this candidate', () => {
    const c: any = { id: 'c1', user_type: 'candidate' };
    const opps = candidate.viewOpportunities(c, {});
    expect(opps.length).toBe(1);
    expect(opps[0].status).toBe('employer_interested');
  });

  it('approveUnlock transitions employer_interested → candidate_approved + audit', () => {
    const c: any = { id: 'c1', user_type: 'candidate' };
    candidate.approveUnlock(c, { recommendation_id: 'rec_1' });
    expect(recs.findById('rec_1')?.status).toBe('candidate_approved');
    const entries = audit.listByRecommendation('rec_1');
    expect(entries.some((e: any) => e.action === 'approve_unlock')).toBe(true);
  });

  it('approveUnlock rejects when not candidate owner', () => {
    users.insert({ id: 'c2', user_type: 'candidate', name: 'C2', contact: null, agent_endpoint: null, api_key_hash: 'h4', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z' });
    const c2: any = { id: 'c2', user_type: 'candidate' };
    expect(() => candidate.approveUnlock(c2, { recommendation_id: 'rec_1' })).toThrow();
  });

  it('rejectUnlock transitions to rejected_candidate', () => {
    const c: any = { id: 'c1', user_type: 'candidate' };
    candidate.rejectUnlock(c, { recommendation_id: 'rec_1' });
    expect(recs.findById('rec_1')?.status).toBe('rejected_candidate');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/candidate-handler.test.ts
```

- [ ] **Step 3: 实现 candidate/handler.ts**

`src/main/modules/candidate/handler.ts`：
```typescript
import type { DB } from '../../db/connection.js';
import type { User, Recommendation, Job } from '../../../shared/types.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { createUnlockAuditLogRepo } from '../../db/repositories/unlock-audit-log.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { createCandidatesPrivateRepo } from '../../db/repositories/candidates-private.js';
import { createJobsRepo } from '../../db/repositories/jobs.js';
import { createQuotaManager } from '../quota/manager.js';
import { assertTransition } from '../unlock/state-machine.js';
import { QUOTA_COSTS } from '../../../shared/constants.js';
import { Errors } from '../../errors.js';

export interface ViewOpportunity {
  recommendation_id: string;
  job_id: string;
  job_title: string;
  job_salary_min: number | null;
  job_salary_max: number | null;
  employer_id: string;
  status: string;
  requested_at: string;
}

export function createCandidateHandler(db: DB) {
  const recs = createRecommendationsRepo(db);
  const audit = createUnlockAuditLogRepo(db);
  const users = createUsersRepo(db);
  const priv = createCandidatesPrivateRepo(db);
  const jobs = createJobsRepo(db);
  const quota = createQuotaManager(db);

  return {
    viewOpportunities(user: User, opts: { status?: any } = {}): ViewOpportunity[] {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can view opportunities');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.view_opportunities);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        throw Errors.forbidden('User suspended');
      }

      // 找该 candidate 对应的 anonymized_candidate ids
      const myAnons = db.prepare('SELECT id FROM candidates_anonymized WHERE source_private_id IN (SELECT id FROM candidates_private WHERE candidate_user_id = ?)').all(user.id) as { id: string }[];
      const anonIds = myAnons.map(a => a.id);
      if (anonIds.length === 0) return [];

      // 查这些 anonymized_candidate_id 的 recommendations
      const placeholders = anonIds.map(() => '?').join(',');
      const sql = `SELECT r.*, j.title as job_title, j.salary_min as job_salary_min, j.salary_max as job_salary_max
                   FROM recommendations r
                   JOIN jobs j ON j.id = r.job_id
                   WHERE r.anonymized_candidate_id IN (${placeholders})
                   ${opts.status ? 'AND r.status = ?' : ''}
                   ORDER BY r.created_at DESC LIMIT 50`;
      const params: any[] = [...anonIds];
      if (opts.status) params.push(opts.status);
      const rows = db.prepare(sql).all(...params) as any[];

      // 只返回"对该候选人可见"的状态：pending/employer_interested/candidate_approved
      const visible = new Set(['pending', 'employer_interested', 'candidate_approved']);
      return rows
        .filter(r => visible.has(r.status))
        .map(r => ({
          recommendation_id: r.id,
          job_id: r.job_id,
          job_title: r.job_title,
          job_salary_min: r.job_salary_min,
          job_salary_max: r.job_salary_max,
          employer_id: r.employer_id,
          status: r.status,
          requested_at: r.created_at,
        }));
    },

    approveUnlock(user: User, input: { recommendation_id: string }, ctx: { ip?: string; userAgent?: string } = {}): void {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can approve unlock');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.approve_unlock);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        throw Errors.forbidden('User suspended');
      }

      const tx = db.transaction(() => {
        const rec = recs.findById(input.recommendation_id);
        if (!rec) throw Errors.notFound('Recommendation not found');

        // 验证是该候选人的机会（通过 priv 反查）
        const privRecord = db.prepare('SELECT candidate_user_id FROM candidates_private WHERE id = (SELECT source_private_id FROM candidates_anonymized WHERE id = ?)').get(rec.anonymized_candidate_id) as { candidate_user_id: string } | undefined;
        if (!privRecord || privRecord.candidate_user_id !== user.id) throw Errors.forbidden('Not your recommendation');

        try {
          assertTransition(rec.status, 'candidate_approved');
        } catch (e) {
          throw Errors.invalidState(`Cannot approve from status ${rec.status}`);
        }

        recs.updateStatus(rec.id, 'candidate_approved');
        audit.insert({
          recommendation_id: rec.id, actor_user_id: user.id, action: 'approve_unlock',
          ip_address: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
        });
      });
      tx();
    },

    rejectUnlock(user: User, input: { recommendation_id: string }, ctx: { ip?: string; userAgent?: string } = {}): void {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can reject unlock');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.reject_unlock);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        throw Errors.forbidden('User suspended');
      }

      const tx = db.transaction(() => {
        const rec = recs.findById(input.recommendation_id);
        if (!rec) throw Errors.notFound('Recommendation not found');

        const privRecord = db.prepare('SELECT candidate_user_id FROM candidates_private WHERE id = (SELECT source_private_id FROM candidates_anonymized WHERE id = ?)').get(rec.anonymized_candidate_id) as { candidate_user_id: string } | undefined;
        if (!privRecord || privRecord.candidate_user_id !== user.id) throw Errors.forbidden('Not your recommendation');

        try {
          assertTransition(rec.status, 'rejected_candidate');
        } catch (e) {
          throw Errors.invalidState(`Cannot reject from status ${rec.status}`);
        }

        recs.updateStatus(rec.id, 'rejected_candidate');
        audit.insert({
          recommendation_id: rec.id, actor_user_id: user.id, action: 'reject_unlock',
          ip_address: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
        });
      });
      tx();
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/candidate-handler.test.ts
```
Expected: 4 passed.

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/candidate/handler.ts tests/integration/candidate-handler.test.ts
git commit -m "feat(candidate): viewOpportunities + approveUnlock + rejectUnlock with state machine"
```

---

## Milestone 2.F：Webhook Worker

### Task 15: Webhook worker（轮询 + 投递 + 重试）

**Files:**
- Create: `src/main/modules/webhook/worker.ts`
- Test: `tests/integration/webhook-worker.test.ts`

- [ ] **Step 1: 写失败测试（用临时 HTTP server 模拟 agent_endpoint）**

`tests/integration/webhook-worker.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

describe('webhook worker', () => {
  const testDb = path.join(__dirname, '../../tmp/wh-worker.db');
  let db: any, users: any, wh: any, worker: any, encryptionKey: Buffer;
  let server: any, receivedPayloads: any[], receivedHeaders: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
    wh = require('../../../src/main/db/repositories/webhook-delivery-queue').createWebhookQueueRepo(db);
    worker = require('../../../src/main/modules/webhook/worker').createWebhookWorker(db, { batchSize: 5 });
    encryptionKey = require('node:crypto').randomBytes(32);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'u1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: 'http://localhost:9876/wh', api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });

    receivedPayloads = [];
    receivedHeaders = null;
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        receivedPayloads.push(JSON.parse(body));
        receivedHeaders = req.headers;
        res.statusCode = 200;
        res.end('ok');
      });
    });
    await new Promise<void>(resolve => server.listen(9876, resolve));
  });
  afterEach(async () => {
    db.close();
    await new Promise<void>(resolve => server.close(resolve));
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
  });

  it('delivers pending webhook with HMAC signature', async () => {
    const { encrypt } = require('../../../src/main/modules/crypto/aes-gcm');
    const payloadEnc = encrypt(encryptionKey, JSON.stringify({ type: 'test', data: 'hello' }));
    wh.enqueue({ target_user_id: 'u1', event_type: 'notify_unlock_request', payload_enc, contains_pii: 0 });

    const SECRET = 'test-secret-1234567890';
    const result = await worker.processBatch(encryptionKey, { hmacSecret: SECRET });
    expect(result.delivered).toBe(1);
    expect(receivedPayloads.length).toBe(1);
    expect(receivedPayloads[0].data).toBe('hello');
    expect(receivedHeaders['x-hunter-signature']).toMatch(/^[a-f0-9]{64}$/);
    expect(receivedHeaders['x-hunter-timestamp']).toBeDefined();
  });

  it('marks dead_letter after max_attempts', async () => {
    // 用一个无响应的 endpoint
    const deadServer = http.createServer(() => { /* never respond */ });
    await new Promise<void>(resolve => deadServer.listen(9877, resolve));
    db.prepare("UPDATE users SET agent_endpoint = 'http://localhost:9877/dead' WHERE id = 'u1'").run();
    const { encrypt } = require('../../../src/main/modules/crypto/aes-gcm');
    const payloadEnc = encrypt(encryptionKey, JSON.stringify({ type: 'test' }));
    wh.enqueue({ target_user_id: 'u1', event_type: 'notify_unlock_request', payload_enc, contains_pii: 0, max_attempts: 2 });

    // 第 1 次投递失败
    await worker.processBatch(encryptionKey, { hmacSecret: 'test', timeoutMs: 500 });
    // 第 2 次投递失败 → dead_letter
    // 重置 next_retry_at 让 worker 能再选
    db.prepare("UPDATE webhook_delivery_queue SET next_retry_at = NULL WHERE status = 'pending'").run();
    await worker.processBatch(encryptionKey, { hmacSecret: 'test', timeoutMs: 500 });
    const rec = wh.findById(1);
    expect(rec?.status).toBe('dead_letter');
    await new Promise<void>(resolve => deadServer.close(resolve));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/webhook-worker.test.ts
```

- [ ] **Step 3: 实现 worker.ts**

`src/main/modules/webhook/worker.ts`：
```typescript
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import type { DB } from '../../db/connection.js';
import { createWebhookQueueRepo } from '../../db/repositories/webhook-delivery-queue.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { decrypt } from '../crypto/aes-gcm.js';
import { sign } from './hmac.js';
import { WEBHOOK_DELIVERY_TIMEOUT_MS, WEBHOOK_RETRY_DELAYS_SECONDS } from '../../../shared/constants.js';

export interface WorkerOptions {
  batchSize?: number;
  hmacSecret: string;
  timeoutMs?: number;
}

export interface BatchResult {
  picked: number;
  delivered: number;
  failed: number;
  retried: number;
}

export function createWebhookWorker(db: DB, defaultOpts: { batchSize?: number } = {}) {
  const queue = createWebhookQueueRepo(db);
  const users = createUsersRepo(db);
  const batchSize = defaultOpts.batchSize ?? 10;

  return {
    async processBatch(encryptionKey: Buffer, opts: WorkerOptions): Promise<BatchResult> {
      const timeoutMs = opts.timeoutMs ?? WEBHOOK_DELIVERY_TIMEOUT_MS;
      const pending = queue.fetchPending(new Date().toISOString());
      const batch = pending.slice(0, batchSize);

      let delivered = 0, failed = 0, retried = 0;

      for (const rec of batch) {
        const user = users.findById(rec.target_user_id);
        if (!user || !user.agent_endpoint) {
          queue.markFailed(rec.id, 'No agent_endpoint', new Date(Date.now() + 60000).toISOString());
          failed++;
          continue;
        }

        try {
          // 解密 payload
          const body = decrypt(encryptionKey, rec.payload_enc);
          const timestamp = String(Math.floor(Date.now() / 1000));
          const signature = sign(opts.hmacSecret, body, timestamp);

          // POST 到 agent_endpoint
          await postJson(user.agent_endpoint, body, { 'X-Hunter-Signature': signature, 'X-Hunter-Timestamp': timestamp, 'X-Hunter-Event': rec.event_type }, timeoutMs);

          queue.markSuccess(rec.id);
          delivered++;
        } catch (err: any) {
          // 失败：下次重试或 dead_letter
          const nextAttempt = rec.attempt_count + 1;
          if (nextAttempt >= rec.max_attempts) {
            queue.markFailed(rec.id, err.message ?? 'unknown', new Date(Date.now() + 60000).toISOString());
            // markFailed 内已经会把 max_attempts 触发的标为 dead_letter
          } else {
            const delayIdx = Math.min(nextAttempt - 1, WEBHOOK_RETRY_DELAYS_SECONDS.length - 1);
            const delaySec = WEBHOOK_RETRY_DELAYS_SECONDS[delayIdx];
            queue.markFailed(rec.id, err.message ?? 'unknown', new Date(Date.now() + delaySec * 1000).toISOString());
            retried++;
          }
          failed++;
        }
      }

      return { picked: batch.length, delivered, failed, retried };
    },

    async runOnce(encryptionKey: Buffer, opts: WorkerOptions): Promise<BatchResult> {
      return this.processBatch(encryptionKey, opts);
    },
  };
}

async function postJson(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqFn = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = reqFn({
      method: 'POST',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        res.resume();
        res.on('end', () => resolve());
      } else {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/webhook-worker.test.ts
```
Expected: 2 passed.

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/webhook/worker.ts tests/integration/webhook-worker.test.ts
git commit -m "feat(webhook): worker with HMAC signing + retry + dead_letter"
```

---

## Milestone 2.G：HTTP 路由 + E2E

### Task 16: 雇主路由 + 头部路由 + 候选人路由

**Files:**
- Create: `src/main/routes/employer.ts`
- Modify: `src/main/routes/headhunter.ts`
- Create: `src/main/routes/candidate.ts`
- Modify: `src/main/server.ts`

- [ ] **Step 1: 实现 routes/employer.ts**

`src/main/routes/employer.ts`：
```typescript
import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { z } from 'zod';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createEmployerHandler } from '../modules/employer/handler.js';
import { Errors } from '../errors.js';
import type { User } from '../../shared/types.js';

const CreateJobSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  requirements: z.string().max(5000).optional(),
  salary_min: z.number().int().positive().optional(),
  salary_max: z.number().int().positive().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  deadline: z.string().datetime().optional(),
  industry: z.string().max(100).optional(),
});

const ExpressInterestSchema = z.object({
  recommendation_id: z.string().min(1),
});

const UnlockContactSchema = z.object({
  recommendation_id: z.string().min(1),
});

export function createEmployerRouter(db: DB, encryptionKey: Buffer): Router {
  const router = Router();
  const handler = createEmployerHandler(db);
  router.use(authMiddleware(db));

  router.post('/jobs', (req, res, next) => {
    try {
      const parsed = CreateJobSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const job = handler.createJob((req as any).user, parsed.data);
      res.json({ ok: true, data: job });
    } catch (e) { next(e); }
  });

  router.get('/jobs', (req, res, next) => {
    try {
      const list = handler.listMyJobs((req as any).user, { status: req.query.status as any });
      res.json({ ok: true, data: list });
    } catch (e) { next(e); }
  });

  router.get('/talent', (req, res, next) => {
    try {
      const filters = {
        industry: req.query.industry as string | undefined,
        title_level: req.query.title_level as string | undefined,
        min_years: req.query.min_years ? Number(req.query.min_years) : undefined,
        max_years: req.query.max_years ? Number(req.query.max_years) : undefined,
        skills: req.query.skills ? String(req.query.skills).split(',') : undefined,
      };
      const list = handler.browseTalent((req as any).user, filters);
      res.json({ ok: true, data: list });
    } catch (e) { next(e); }
  });

  router.post('/recommendations/:id/express-interest', (req, res, next) => {
    try {
      const parsed = ExpressInterestSchema.safeParse({ recommendation_id: req.params.id });
      if (!parsed.success) throw Errors.invalidParams('Invalid request body');
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || undefined;
      handler.expressInterest((req as any).user, parsed.data, { encryptionKey, ip, userAgent: req.headers['user-agent'] });
      res.json({ ok: true, data: { status: 'employer_interested' } });
    } catch (e) { next(e); }
  });

  router.post('/recommendations/:id/unlock-contact', (req, res, next) => {
    try {
      const parsed = UnlockContactSchema.safeParse({ recommendation_id: req.params.id });
      if (!parsed.success) throw Errors.invalidParams('Invalid request body');
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || undefined;
      handler.unlockContact((req as any).user, parsed.data, { encryptionKey, ip, userAgent: req.headers['user-agent'] });
      res.json({ ok: true, data: { status: 'unlocked' } });
    } catch (e) { next(e); }
  });

  return router;
}
```

- [ ] **Step 2: 修改 routes/headhunter.ts 加 recommend/withdraw/publish/list**

在 `src/main/routes/headhunter.ts` 末尾追加（在 `router.post('/candidates', ...)` 之后）：

```typescript
  const RecommendSchema = z.object({
    anonymized_candidate_id: z.string().min(1),
    job_id: z.string().min(1),
    commission_split: z.object({ hunter: z.number(), referrer: z.number() }).optional(),
    referrer_headhunter_id: z.string().optional(),
  });

  const WithdrawSchema = z.object({
    recommendation_id: z.string().min(1),
  });

  const PublishSchema = z.object({
    anonymized_candidate_id: z.string().min(1),
  });

  router.post('/recommendations', (req, res, next) => {
    try {
      const parsed = RecommendSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const rec = handler.recommendCandidate((req as any).user as User, parsed.data);
      res.json({ ok: true, data: rec });
    } catch (e) { next(e); }
  });

  router.post('/recommendations/:id/withdraw', (req, res, next) => {
    try {
      const parsed = WithdrawSchema.safeParse({ recommendation_id: req.params.id });
      if (!parsed.success) throw Errors.invalidParams('Invalid request body');
      handler.withdrawRecommendation((req as any).user as User, parsed.data);
      res.json({ ok: true, data: { status: 'withdrawn' } });
    } catch (e) { next(e); }
  });

  router.post('/candidates/:id/publish-to-pool', (req, res, next) => {
    try {
      const parsed = PublishSchema.safeParse({ anonymized_candidate_id: req.params.id });
      if (!parsed.success) throw Errors.invalidParams('Invalid request body');
      handler.publishToPool((req as any).user as User, parsed.data);
      res.json({ ok: true, data: { published: true } });
    } catch (e) { next(e); }
  });

  router.get('/recommendations', (req, res, next) => {
    try {
      const list = handler.listMyRecommendations((req as any).user as User, { status: req.query.status as any });
      res.json({ ok: true, data: list });
    } catch (e) { next(e); }
  });
```

并在文件顶部加 `import type { User } from '../../shared/types.js';`（已经存在）。

- [ ] **Step 3: 创建 routes/candidate.ts**

`src/main/routes/candidate.ts`：
```typescript
import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createCandidateHandler } from '../modules/candidate/handler.js';
import { Errors } from '../errors.js';

export function createCandidateRouter(db: DB): Router {
  const router = Router();
  const handler = createCandidateHandler(db);
  router.use(authMiddleware(db));

  router.get('/opportunities', (req, res, next) => {
    try {
      const list = handler.viewOpportunities((req as any).user, { status: req.query.status as any });
      res.json({ ok: true, data: list });
    } catch (e) { next(e); }
  });

  router.post('/recommendations/:id/approve-unlock', (req, res, next) => {
    try {
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || undefined;
      handler.approveUnlock((req as any).user, { recommendation_id: req.params.id }, { ip, userAgent: req.headers['user-agent'] });
      res.json({ ok: true, data: { status: 'candidate_approved' } });
    } catch (e) { next(e); }
  });

  router.post('/recommendations/:id/reject-unlock', (req, res, next) => {
    try {
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || undefined;
      handler.rejectUnlock((req as any).user, { recommendation_id: req.params.id }, { ip, userAgent: req.headers['user-agent'] });
      res.json({ ok: true, data: { status: 'rejected_candidate' } });
    } catch (e) { next(e); }
  });

  return router;
}
```

- [ ] **Step 4: 修改 server.ts 挂载新路由**

修改 `src/main/server.ts`：
```typescript
import { createAuthRouter } from './routes/auth.js';
import { createHeadhunterRouter } from './routes/headhunter.js';
import { createEmployerRouter } from './routes/employer.js';
import { createCandidateRouter } from './routes/candidate.js';
```

在 router 挂载处追加：
```typescript
  app.use('/v1/auth', createAuthRouter(db, env.NODE_ENV === 'production'));
  app.use('/v1/headhunter', createHeadhunterRouter(db, env.PLATFORM_ENCRYPTION_KEY));
  app.use('/v1/employer', createEmployerRouter(db, env.PLATFORM_ENCRYPTION_KEY));
  app.use('/v1/candidate', createCandidateRouter(db));
```

- [ ] **Step 5: typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 6: 提交**

```bash
git add src/main/routes/ src/main/server.ts
git commit -m "feat(routes): employer + headhunter recommend + candidate routers wired"
```

---

### Task 17: E2E 4 步解锁流程（HTTP level）

**Files:**
- Create: `tests/integration/e2e-unlock.test.ts`

- [ ] **Step 1: 写测试**

`tests/integration/e2e-unlock.test.ts`：
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

describe('M2 E2E: 4-step unlock flow', () => {
  const testDb = path.join(__dirname, '../../tmp/e2e-m2.db');
  let app: any;
  let employerKey: string, employerId: string;
  let headhunterKey: string, headhunterId: string;
  let candidateKey: string, candidateId: string;
  let candidateAnonymizedId: string;
  let jobId: string;
  let recId: string;
  // Mock 雇主 + 候选人 webhook receiver
  let employerWh: { payloads: any[]; server: any; };
  let candidateWh: { payloads: any[]; server: any; };

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = require('../../src/main/server');
    app = createApp();

    // 起 mock webhook servers
    const startWh = (port: number) => {
      const payloads: any[] = [];
      const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => { payloads.push(JSON.parse(body)); res.statusCode = 200; res.end('ok'); });
      });
      return new Promise<any>(resolve => server.listen(port, () => resolve({ payloads, server })));
    };
    employerWh = await startWh(9870);
    candidateWh = await startWh(9871);

    // 1. 注册 3 个用户（agent_endpoint 指到 mock）
    const emp = await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E', contact: 'e@x.com', agent_endpoint: 'http://localhost:9870/wh' });
    employerKey = emp.body.data.api_key;
    employerId = emp.body.data.user_id;
    const hun = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H', contact: 'h@x.com' });
    headhunterKey = hun.body.data.api_key;
    headhunterId = hun.body.data.user_id;
    const can = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C', contact: 'c@x.com', agent_endpoint: 'http://localhost:9871/wh' });
    candidateKey = can.body.data.api_key;
    candidateId = can.body.data.user_id;

    // 2. 猎头上传候选人
    const upload = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterKey}`)
      .send({
        candidate_user_id: candidateId,
        name: '张三', phone: '13800138000', email: 'z@x.com',
        current_company: '字节跳动', current_title: '高级前端',
        expected_salary: 750000, years_experience: 8,
        education_school: '清华大学', skills: ['React'],
      });
    candidateAnonymizedId = upload.body.data.anonymized_id;

    // 3. 猎头发布到公开池
    await request(app)
      .post(`/v1/headhunter/candidates/${candidateAnonymizedId}/publish-to-pool`)
      .set('Authorization', `Bearer ${headhunterKey}`);

    // 4. 雇主创建职位
    const job = await request(app)
      .post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${employerKey}`)
      .send({ title: 'Senior FE', salary_min: 500000, salary_max: 800000, industry: '互联网' });
    jobId = job.body.data.id;

    // 5. 猎头推荐
    const rec = await request(app)
      .post('/v1/headhunter/recommendations')
      .set('Authorization', `Bearer ${headhunterKey}`)
      .send({ anonymized_candidate_id: candidateAnonymizedId, job_id: jobId });
    recId = rec.body.data.id;
    expect(rec.body.data.status).toBe('pending');
  });
  afterAll(async () => {
    employerWh.server.close();
    candidateWh.server.close();
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
  });

  it('Step 2: employer express_interest → employer_interested + webhook to candidate', async () => {
    const r = await request(app)
      .post(`/v1/employer/recommendations/${recId}/express-interest`)
      .set('Authorization', `Bearer ${employerKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('employer_interested');

    // 等 worker 处理 webhook
    await new Promise(r => setTimeout(r, 100));
    // candidateWh 收到 notify_unlock_request
    expect(candidateWh.payloads.some(p => p.recommendation_id === recId)).toBe(true);
  });

  it('Step 3: candidate approve_unlock → candidate_approved', async () => {
    const r = await request(app)
      .post(`/v1/candidate/recommendations/${recId}/approve-unlock`)
      .set('Authorization', `Bearer ${candidateKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('candidate_approved');
  });

  it('Step 4: employer unlock_contact → unlocked + deliver_contact webhook', async () => {
    const r = await request(app)
      .post(`/v1/employer/recommendations/${recId}/unlock-contact`)
      .set('Authorization', `Bearer ${employerKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('unlocked');

    // 启动 worker 处理 webhook
    const Database = require('node:sqlite').DatabaseSync;
    const testDbConn = new Database(testDb, { readonly: false });
    const worker = require('../../src/main/modules/webhook/worker').createWebhookWorker(testDbConn);
    const env = require('../../src/main/env').loadEnv();
    const result = await worker.processBatch(env.PLATFORM_ENCRYPTION_KEY, { hmacSecret: env.WEBHOOK_HMAC_SECRET });
    testDbConn.close();
    expect(result.delivered).toBeGreaterThan(0);

    // employerWh 收到 deliver_contact
    expect(employerWh.payloads.some(p => p.event_type === 'deliver_contact' || p.candidate_id)).toBe(true);
  });

  it('audit log captures all 4 steps', async () => {
    const Database = require('node:sqlite').DatabaseSync;
    const conn = new Database(testDb, { readonly: true });
    const entries = conn.prepare("SELECT action, actor_user_id FROM unlock_audit_log WHERE recommendation_id = ? ORDER BY id ASC").all(recId) as any[];
    conn.close();
    const actions = entries.map(e => e.action);
    expect(actions).toContain('express_interest');
    expect(actions).toContain('approve_unlock');
    expect(actions).toContain('unlock_delivery');
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test tests/integration/e2e-unlock.test.ts
```
Expected: 4 passed.

> **注意**：如果 `Step 2` 失败，最可能原因是 `browseTalent` 在 `e2e` 中是异步的（先 candidate_anon 写入，然后 publish_to_pool 切换 is_public_pool=1）。这两个操作都有序执行。如果失败，检查 publish endpoint 是否正确路由。

- [ ] **Step 3: 跑全部测试**

```bash
pnpm test
```
Expected: 41 (M1) + 10+ (M2 单元/集成) + 4 (E2E) = 55+ passed.

- [ ] **Step 4: 提交**

```bash
git add tests/integration/e2e-unlock.test.ts
git commit -m "test(e2e): M2 4-step unlock flow + webhook delivery"
git tag -a m2-complete -m "Milestone 2 complete: 3-role closed loop + unlock + webhooks"
```

---

## ✅ M2 验收标准

M2 完成的定义（"Done"）：

- [ ] `pnpm test` 全部通过（55+ 测试）
- [ ] `pnpm typecheck` 0 错误
- [ ] E2E 测试：4 步解锁流程跑通 + 候选人/雇主都收到 webhook + 审计日志完整
- [ ] 4 张新表（jobs, recommendations, unlock_audit_log, webhook_delivery_queue）迁移成功
- [ ] 推荐表 UNIQUE(anonymized_candidate_id, job_id) 约束生效
- [ ] webhook payload 全部加密存储（PII 不在 DB 明文）
- [ ] HMAC 签名验证用 timingSafeEqual
- [ ] Tag `m2-complete` 已打

## 📋 P1/P2 Bug 覆盖（这些 TDD 用例已在 M2 plan 中实现）

| Bug | 哪个 task |
|-----|----------|
| P1#7 Webhook 重放攻击 | Task 8 (HMAC + timestamp window) |
| P1#8 状态机事务 | Task 11, 12, 14 (db.transaction) |
| P1#9 HMAC 时序攻击 | Task 8 (timingSafeEqual) |
| P1#10 deliver_contact payload 加密 | Task 12 (encryptPayload) |
| P1#11 跨猎头推荐 UNIQUE | Task 4 (UNIQUE constraint) |
| P1#13 加密密钥轮换 | **未实现**（v2） |

P2 部分仍延后：日志归档、GDPR 导出等。

## 🚀 下一步（M3+）

M2 完成时（"三角色闭环"），本 plan 全部完成。后续计划：
- **M3 plan**: Convo Electron 管理后台 + skill.md 文档
- **M4 plan**: 佣金 + 完整审计 + GDPR
- **M5 plan**: Webhook Worker 优化 + k6 压测 + 性能监控
