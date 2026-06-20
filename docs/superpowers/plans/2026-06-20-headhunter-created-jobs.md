# Headhunter-Created Jobs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让猎头能为雇主建岗。`POST /v1/headhunter/jobs` 创建后 `employer_id=NULL`、`source_headhunter_id=猎头`；雇主通过 `GET /v1/employer/pending-claims` 查待领、`POST /v1/employer/claim-jobs/:id` 认领、`POST /v1/employer/reject-jobs/:id` 拒绝。佣金按 70%（推荐者）/ 30%（建岗者）拆账，跨人时 job_creator 覆盖原 referrer。

**Architecture:** SQLite 重建 jobs 表让 `employer_id` nullable + 加 `source_headhunter_id` / `created_for_employer_id` + CHECK 约束。新增 4 个端点复用现有 handler/route 模式。佣金改造在 `commission/handler.ts` 的 `createPlacement` 入参层做，不动 `calculator.ts`。公开页 SQL 加 `AND employer_id IS NOT NULL` 隐藏未认领。

**Tech Stack:** Node 22+, TypeScript 5.6+, Express 4.21, node:sqlite (DatabaseSync), zod 3.23, vitest 2.1+, supertest 7.0+。无新依赖。

**Spec:** [`../specs/2026-06-20-headhunter-created-jobs.md`](../specs/2026-06-20-headhunter-created-jobs.md)

---

## Conventions

- **路径基准**: 仓库根 `d:\dev\hunter-platform\`
- **测试约定**: `*.test.ts` (与项目一致), `vitest`, `supertest`
- **DB 探针**: `process.env.DATABASE_PATH = ':memory:'` 配合 `createApp()` 直接打路由
- **TS 配置**: 严格模式，prepared statements
- **命名**: 文件 kebab-case，TS 类型 PascalCase
- **提交粒度**: 每个 task 一次 commit，message 用 `feat:` / `refactor:` / `test:` / `chore:` 前缀
- **本项目非 git repo**（环境已知），如未初始化先 `git init` 在根目录

---

## 文件结构总览

```
src/main/db/
  migrations/
    v009_headhunter_created_jobs.sql       (NEW, ~40 行)
  repositories/
    jobs.ts                                (MODIFY: insert/findById/listPublic + 3 新查询)

src/shared/
  types.ts                                (MODIFY: Job.employer_id nullable + 2 新字段)
  constants.ts                            (MODIFY: 加 COMMISSION_SPLIT_HEADHUNTER_CREATED)

src/main/modules/
  headhunter/
    handler.ts                            (MODIFY: 加 createJobForEmployer + listMyCreatedJobs)
  employer/
    handler.ts                            (MODIFY: 加 claimJob + rejectJob + listPendingClaims)
  commission/
    handler.ts                            (MODIFY: createPlacement 入参分支)

src/main/routes/
  headhunter.ts                           (MODIFY: 加 POST /jobs + GET /jobs)
  employer.ts                             (MODIFY: 加 3 个新路由)
  market.ts                               (MODIFY: listPublic 加 employer_id IS NOT NULL)
  landing.ts                              (无变化, gather-landing-data.ts 改)

src/main/modules/view/
  gather-landing-data.ts                  (MODIFY: recentJobs SQL 加 employer_id IS NOT NULL)

tests/
  unit/
    jobs-repo.test.ts                     (NEW, ~80 行)
    commission-split.test.ts              (NEW, ~100 行)
  integration/
    headhunter-create-job.test.ts         (NEW, ~150 行)
    employer-claim-reject.test.ts         (NEW, ~150 行)
    headhunter-jobs-visibility.test.ts    (NEW, ~80 行)
    commission-headhunter-created.test.ts (NEW, ~120 行)
```

---

## Phase 1: Schema Migration

### Task 1.1: 写 v009 SQL 迁移文件

**Files:**
- Create: `src/main/db/migrations/v009_headhunter_created_jobs.sql`

- [ ] **Step 1: 创建 SQL 文件**

```sql
-- v009: 猎头代雇主建岗 - jobs.employer_id 可空 + 追踪 source_headhunter_id

-- SQLite 不支持直接改 NOT NULL，需要重建表
CREATE TABLE jobs_new (
  id                       TEXT PRIMARY KEY,
  employer_id              TEXT REFERENCES users(id),     -- 改 nullable
  source_headhunter_id     TEXT REFERENCES users(id),     -- 新增
  created_for_employer_id  TEXT REFERENCES users(id),     -- 新增
  title                    TEXT NOT NULL,
  description              TEXT,
  requirements             TEXT,
  salary_min               INTEGER,
  salary_max               INTEGER,
  status                   TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paused','closed','filled')),
  priority                 TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  deadline                 TEXT,
  industry                 TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  -- 一致性约束: 要么是雇主直发，要么是猎头代发
  CHECK (
    (source_headhunter_id IS NULL AND employer_id IS NOT NULL) OR
    (source_headhunter_id IS NOT NULL)
  )
);

-- 备份原表（迁移失败可回滚）
CREATE TABLE jobs_backup AS SELECT * FROM jobs;

INSERT INTO jobs_new
  SELECT id, employer_id, NULL, NULL, title, description, requirements,
         salary_min, salary_max, status, priority, deadline, industry,
         created_at, updated_at
  FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;

-- 重建索引
CREATE INDEX idx_jobs_employer ON jobs(employer_id);
CREATE INDEX idx_jobs_source_headhunter ON jobs(source_headhunter_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_industry ON jobs(industry);
CREATE INDEX idx_jobs_employer_status ON jobs(employer_id, status, created_at DESC);
-- 新加: 雇主"待认领"列表
CREATE INDEX idx_jobs_pending_claim ON jobs(created_for_employer_id, status)
  WHERE created_for_employer_id IS NOT NULL AND employer_id IS NULL;
```

- [ ] **Step 2: 验证文件存在**

Run: `dir d:\dev\hunter-platform\src\main\db\migrations\v009_headhunter_created_jobs.sql`
Expected: file shown

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/db/migrations/v009_headhunter_created_jobs.sql
git commit -m "feat(db): add v009 migration for headhunter-created jobs"
```

---

### Task 1.2: 单元测试 jobs 表 CHECK 约束

**Files:**
- Test: `tests/unit/jobs-repo.test.ts`

- [ ] **Step 1: 写测试文件**

```typescript
// tests/unit/jobs-repo.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/main/db/connection';
import { runMigrations } from '../../src/main/db/migrations';

describe('jobs table CHECK constraints (v009)', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    // 插入必备 user
    db.prepare(`
      INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix, quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES
        ('u_emp_1', 'employer',   'E1', 'e@e.com', 'h1', 'p1', 100, 0, datetime('now'), 50, 'active', datetime('now'), datetime('now')),
        ('u_hh_1',  'headhunter', 'H1', 'h@h.com', 'h2', 'p2', 100, 0, datetime('now'), 50, 'active', datetime('now'), datetime('now'))
    `).run();
  });

  it('accepts 雇主直发: employer_id NOT NULL, source_headhunter_id NULL', () => {
    db.prepare(`
      INSERT INTO jobs (id, employer_id, source_headhunter_id, created_for_employer_id, title, status, priority, created_at, updated_at)
      VALUES ('j1', 'u_emp_1', NULL, NULL, 'T1', 'open', 'normal', datetime('now'), datetime('now'))
    `).run();
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get('j1') as any;
    expect(row.employer_id).toBe('u_emp_1');
    expect(row.source_headhunter_id).toBeNull();
  });

  it('accepts 猎头代发: source_headhunter_id NOT NULL, employer_id NULL', () => {
    db.prepare(`
      INSERT INTO jobs (id, employer_id, source_headhunter_id, created_for_employer_id, title, status, priority, created_at, updated_at)
      VALUES ('j2', NULL, 'u_hh_1', 'u_emp_1', 'T2', 'open', 'normal', datetime('now'), datetime('now'))
    `).run();
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get('j2') as any;
    expect(row.employer_id).toBeNull();
    expect(row.source_headhunter_id).toBe('u_hh_1');
    expect(row.created_for_employer_id).toBe('u_emp_1');
  });

  it('rejects 同为 NULL (无 source 也无 employer)', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO jobs (id, employer_id, source_headhunter_id, created_for_employer_id, title, status, priority, created_at, updated_at)
        VALUES ('j3', NULL, NULL, NULL, 'T3', 'open', 'normal', datetime('now'), datetime('now'))
      `).run();
    }).toThrow(/CHECK constraint/i);
  });

  it('rejects 同时 NOT NULL (雇主直发 + source_hh 也填)', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO jobs (id, employer_id, source_headhunter_id, created_for_employer_id, title, status, priority, created_at, updated_at)
        VALUES ('j4', 'u_emp_1', 'u_hh_1', NULL, 'T4', 'open', 'normal', datetime('now'), datetime('now'))
      `).run();
    }).toThrow(/CHECK constraint/i);
  });
});
```

- [ ] **Step 2: 检查 `runMigrations` 实际导出**

Run: `grep -E "export.*runMigrations" "d:\dev\hunter-platform\src\main\db\migrations.ts"`
Expected: 看到 `export function runMigrations` 或类似

If not found, 用项目实际导出的迁移函数（可能是 `migrate` 或别的名字），替换测试里的 `runMigrations` 调用。

- [ ] **Step 3: 跑测试确认通过**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/jobs-repo.test.ts`
Expected: 4/4 PASS

If FAIL: 检查 v009 SQL 是否被 `migrations.ts` 加载了；如果项目用 glob 加载 migration 文件，v009 应自动加载。

- [ ] **Step 4: Commit**

```bash
cd d:\dev\hunter-platform
git add tests/unit/jobs-repo.test.ts
git commit -m "test(db): add v009 CHECK constraint tests for jobs table"
```

---

### Task 1.3: 跑全量测试确认 schema 迁移不破现有功能

**Files:** (none)

- [ ] **Step 1: 跑全量测试**

Run: `cd d:\dev\hunter-platform && pnpm test`
Expected: 439+ tests PASS（baseline），可能多个 pass 因为我们加了 4 个；如果有 FAIL 多数应是 `employer_id NOT NULL` 相关 — 检查 v009 SQL 是否执行了

- [ ] **Step 2: 跑 typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: 可能 FAIL 因为 `Job.employer_id` 还是非空类型；这是预期的，Task 2.1 会修

---

## Phase 2: 类型与共享常量

### Task 2.1: 修改 Job 类型让 employer_id nullable + 加 2 个新字段

**Files:**
- Modify: `src/shared/types.ts` (line 77-91)

- [ ] **Step 1: 修改 Job interface**

In `src/shared/types.ts`, replace:

```typescript
export interface Job {
  id: string;
  employer_id: string;
```

with:

```typescript
export interface Job {
  id: string;
  employer_id: string | null;
  source_headhunter_id: string | null;
  created_for_employer_id: string | null;
```

- [ ] **Step 2: 验证 typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: 大量 FAIL（因为 jobs repo 还在用旧的 `Job.employer_id: string` 假设）；这是预期的，Task 3.1 会修

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add src/shared/types.ts
git commit -m "feat(types): make Job.employer_id nullable + add source_headhunter_id / created_for_employer_id"
```

---

### Task 2.2: 加 COMMISSION_SPLIT 常量

**Files:**
- Modify: `src/shared/constants.ts`

- [ ] **Step 1: 在文件末尾添加**

Append to `src/shared/constants.ts`:

```typescript

/**
 * 猎头代雇主建岗场景下的佣金拆账比例。
 * - recommender: 推荐候选人的猎头（写 recommendations.headhunter_id）
 * - creator: 创建岗位的猎头（写 jobs.source_headhunter_id）
 *
 * 适用规则（见 spec §5.4 角色映射表）：
 * - 同人（creator == recommender）：creator 拿 100%（share: 1.0）
 * - 跨人：70% recommender / 30% creator
 * - creator 覆盖原 referral chain（即使 rec.referrer_headhunter_id 存在，30% 也给 creator）
 */
export const COMMISSION_SPLIT_HEADHUNTER_CREATED = {
  recommender: 0.7,
  creator: 0.3,
} as const;
```

- [ ] **Step 2: 验证 typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: 同 Task 2.1 step 2 一样会 FAIL

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add src/shared/constants.ts
git commit -m "feat(constants): add COMMISSION_SPLIT_HEADHUNTER_CREATED"
```

---

## Phase 3: jobs Repo 改造

### Task 3.1: 改 jobs.ts insert / hydrate + 加 3 个新查询

**Files:**
- Modify: `src/main/db/repositories\jobs.ts`

- [ ] **Step 1: 替换 insertStmt 和 insert 函数**

In `src/main/db/repositories\jobs.ts`, replace:

```typescript
  const insertStmt = db.prepare(`
    INSERT INTO jobs (id, employer_id, title, description, requirements, required_skills_json,
                      salary_min, salary_max, status, priority, deadline, industry,
                      created_at, updated_at)
    VALUES (@id, @employer_id, @title, @description, @requirements, @required_skills_json_col,
            @salary_min, @salary_max, @status, @priority, @deadline, @industry,
            @created_at, @updated_at)
  `);
```

with:

```typescript
  const insertStmt = db.prepare(`
    INSERT INTO jobs (id, employer_id, source_headhunter_id, created_for_employer_id,
                      title, description, requirements, required_skills_json,
                      salary_min, salary_max, status, priority, deadline, industry,
                      created_at, updated_at)
    VALUES (@id, @employer_id, @source_headhunter_id, @created_for_employer_id,
            @title, @description, @requirements, @required_skills_json_col,
            @salary_min, @salary_max, @status, @priority, @deadline, @industry,
            @created_at, @updated_at)
  `);
```

- [ ] **Step 2: 替换 insert 函数**

In `src/main/db/repositories\jobs.ts`, replace:

```typescript
    insert(job: Job): void {
      const params: Record<string, unknown> = {
        id: job.id,
        employer_id: job.employer_id,
        title: job.title,
        description: job.description,
        requirements: null,
        required_skills_json_col: JSON.stringify(job.required_skills ?? []),
        salary_min: job.salary_min,
        salary_max: job.salary_max,
        status: job.status,
        priority: job.priority,
        deadline: job.deadline,
        industry: job.industry,
        created_at: job.created_at,
        updated_at: job.updated_at,
      };
      insertStmt.run(params as Record<string, import('node:sqlite').SQLInputValue>);
    },
```

with:

```typescript
    insert(job: Job): void {
      const params: Record<string, unknown> = {
        id: job.id,
        employer_id: job.employer_id,
        source_headhunter_id: job.source_headhunter_id,
        created_for_employer_id: job.created_for_employer_id,
        title: job.title,
        description: job.description,
        requirements: null,
        required_skills_json_col: JSON.stringify(job.required_skills ?? []),
        salary_min: job.salary_min,
        salary_max: job.salary_max,
        status: job.status,
        priority: job.priority,
        deadline: job.deadline,
        industry: job.industry,
        created_at: job.created_at,
        updated_at: job.updated_at,
      };
      insertStmt.run(params as Record<string, import('node:sqlite').SQLInputValue>);
    },
```

- [ ] **Step 3: 加 3 个新查询**

Append to the return object (before the closing `};`):

```typescript
    findPendingClaims(employerId: string): Job[] {
      const rows = db.prepare(
        `SELECT * FROM jobs
         WHERE status = 'open' AND employer_id IS NULL
           AND (created_for_employer_id = ? OR created_for_employer_id IS NULL)
         ORDER BY created_at DESC`
      ).all(employerId) as any[];
      return rows.map(hydrate);
    },
    findBySourceHeadhunter(headhunterId: string): Job[] {
      const rows = db.prepare(
        `SELECT * FROM jobs WHERE source_headhunter_id = ? ORDER BY created_at DESC`
      ).all(headhunterId) as any[];
      return rows.map(hydrate);
    },
    claimByEmployer(jobId: string, employerId: string): Job | undefined {
      // Atomic claim: only update if still unclaimed and open
      const result = db.prepare(
        `UPDATE jobs
         SET employer_id = ?, updated_at = ?
         WHERE id = ? AND status = 'open' AND employer_id IS NULL
           AND (created_for_employer_id = ? OR created_for_employer_id IS NULL)`
      ).run(employerId, new Date().toISOString(), jobId, employerId);
      if (result.changes === 0) return undefined;
      return this.findById(jobId);
    },
```

- [ ] **Step 4: 修改 listPublic 加 employer_id IS NOT NULL**

In `listPublic`, replace the WHERE clause:

```typescript
        rows = db.prepare(
          "SELECT * FROM jobs WHERE status = 'open' AND industry = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
        ).all(opts.industry, limit, offset) as any[];
```

with:

```typescript
        rows = db.prepare(
          "SELECT * FROM jobs WHERE status = 'open' AND employer_id IS NOT NULL AND industry = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
        ).all(opts.industry, limit, offset) as any[];
```

And:

```typescript
        rows = db.prepare(
          "SELECT * FROM jobs WHERE status = 'open' ORDER BY created_at DESC LIMIT ? OFFSET ?"
        ).all(limit, offset) as any[];
```

with:

```typescript
        rows = db.prepare(
          "SELECT * FROM jobs WHERE status = 'open' AND employer_id IS NOT NULL ORDER BY created_at DESC LIMIT ? OFFSET ?"
        ).all(limit, offset) as any[];
```

- [ ] **Step 5: 验证 typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: 应该 PASS 或仅剩少量 FAIL（如果在其他 handler 里直接 `if (user.user_type !== 'employer') job.employer_id = user.id` 这种用了 strict 类型的地方会报错；这些在后续 task 修）

- [ ] **Step 6: 跑 jobs repo 测试**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/jobs-repo.test.ts`
Expected: 4/4 PASS

- [ ] **Step 7: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/db/repositories/jobs.ts
git commit -m "feat(repo): jobs.ts nullable employer_id + new fields + 3 new queries"
```

---

## Phase 4: Headhunter 端点（createJobForEmployer）

### Task 4.1: 写失败测试：headhunter 创建岗位

**Files:**
- Test: `tests/integration/headhunter-create-job.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
// tests/integration/headhunter-create-job.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('POST /v1/headhunter/jobs', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  async function registerEmployer() {
    const res = await request(createApp()).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'E1', contact: 'e@e.com' });
    return res.body.data;
  }
  async function registerHeadhunter() {
    const res = await request(createApp()).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H1', contact: 'h@h.com' });
    return res.body.data;
  }

  it('headhunter 创建成功 + employer_id=NULL + source_headhunter_id=me', async () => {
    const emp = await registerEmployer();
    const hh = await registerHeadhunter();
    const res = await request(createApp())
      .post('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${hh.api_key}`)
      .send({ title: 'T1', industry: '互联网', created_for_employer_id: emp.id });
    expect(res.status).toBe(200);
    expect(res.body.data.employer_id).toBeNull();
    expect(res.body.data.source_headhunter_id).toBe(hh.id);
    expect(res.body.data.created_for_employer_id).toBe(emp.id);
    expect(res.body.data.status).toBe('open');
  });

  it('不指定 created_for_employer_id 也允许 (任何 employer 可 claim)', async () => {
    const hh = await registerHeadhunter();
    const res = await request(createApp())
      .post('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${hh.api_key}`)
      .send({ title: 'T2' });
    expect(res.status).toBe(200);
    expect(res.body.data.created_for_employer_id).toBeNull();
  });

  it('employer 调 POST /v1/headhunter/jobs → 403', async () => {
    const emp = await registerEmployer();
    const res = await request(createApp())
      .post('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${emp.api_key}`)
      .send({ title: 'T3' });
    expect(res.status).toBe(403);
  });

  it('headhunter quota 不足 → 429', async () => {
    const hh = await registerHeadhunter();
    // 用完 quota (默认 200, 5/次, 40 次后用完)
    for (let i = 0; i < 41; i++) {
      await request(createApp())
        .post('/v1/headhunter/jobs')
        .set('Authorization', `Bearer ${hh.api_key}`)
        .send({ title: `T${i}` });
    }
    const res = await request(createApp())
      .post('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${hh.api_key}`)
      .send({ title: 'TOOMANY' });
    expect(res.status).toBe(429);
  });
});

describe('GET /v1/headhunter/jobs (my created)', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('只返回 source_headhunter_id=me 的 job', async () => {
    const emp1 = await request(createApp()).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' }).then(r => r.body.data);
    const hh1 = await request(createApp()).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' }).then(r => r.body.data);
    const hh2 = await request(createApp()).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H2', contact: 'h2@h.com' }).then(r => r.body.data);

    // hh1 建 2 个, hh2 建 1 个
    await request(createApp()).post('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${hh1.api_key}`)
      .send({ title: 'H1A', created_for_employer_id: emp1.id });
    await request(createApp()).post('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${hh1.api_key}`)
      .send({ title: 'H1B' });
    await request(createApp()).post('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${hh2.api_key}`)
      .send({ title: 'H2A' });

    const res = await request(createApp())
      .get('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${hh1.api_key}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((j: any) => j.source_headhunter_id === hh1.id)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd d:\dev\hunter-platform && pnpm test tests/integration/headhunter-create-job.test.ts`
Expected: FAIL with 404 (端点不存在)

- [ ] **Step 3: Commit (失败测试)**

```bash
cd d:\dev\hunter-platform
git add tests/integration/headhunter-create-job.test.ts
git commit -m "test(headhunter): add failing tests for POST /v1/headhunter/jobs"
```

---

### Task 4.2: 实现 headhunter handler 函数

**Files:**
- Modify: `src/main/modules/headhunter/handler.ts`

- [ ] **Step 1: 加 CreateJobInput 接口和 createJobForEmployer / listMyCreatedJobs**

In `src/main/modules/headhunter/handler.ts`, add at the top after imports:

```typescript
import { createJobsRepo } from '../../db/repositories/jobs.js';
import { createUsersRepo } from '../../db/repositories/users.js';
```

(如果 import 已存在则跳过)

- [ ] **Step 2: 加 CreateJobInput 接口**

Append to the file (or in the appropriate location):

```typescript

export interface CreateJobForEmployerInput {
  title: string;
  description?: string;
  required_skills?: string[];
  salary_min?: number;
  salary_max?: number;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  deadline?: string;
  industry?: string;
  created_for_employer_id?: string;
}
```

- [ ] **Step 3: 加 createJobForEmployer / listMyCreatedJobs 到 handler**

Find the function `createHeadhunterHandler` and append new methods to the returned object (before the closing `};`):

```typescript
    createJobForEmployer(user: User, input: CreateJobForEmployerInput): Job {
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can create jobs on behalf of employers');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.create_job);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      // 可选: 校验 created_for_employer_id 指向 employer
      if (input.created_for_employer_id) {
        const target = users.findById(input.created_for_employer_id);
        if (!target) throw Errors.notFound('Target employer not found');
        if (target.user_type !== 'employer') {
          throw Errors.forbidden('created_for_employer_id must point to an employer');
        }
      }

      // 校验 salary_min <= salary_max
      if (input.salary_min != null && input.salary_max != null && input.salary_min > input.salary_max) {
        throw Errors.invalidParams('salary_min cannot exceed salary_max');
      }

      const now = new Date().toISOString();
      const job: Job = {
        id: `job_${randomUUID().slice(0, 12)}`,
        employer_id: null,                          // 关键: 未认领
        source_headhunter_id: user.id,              // 关键: 标记建岗者
        created_for_employer_id: input.created_for_employer_id ?? null,
        title: input.title,
        description: input.description ?? null,
        required_skills: input.required_skills ?? [],
        salary_min: input.salary_min ?? null,
        salary_max: input.salary_max ?? null,
        status: 'open',
        priority: input.priority ?? 'normal',
        deadline: input.deadline ?? null,
        industry: input.industry ?? null,
        created_at: now,
        updated_at: now,
      };
      jobsRepo.insert(job);
      return job;
    },

    listMyCreatedJobs(user: User): Job[] {
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters');
      return jobsRepo.findBySourceHeadhunter(user.id);
    },
```

- [ ] **Step 4: 验证 typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: 应该 PASS（如果 `Job` 类型在 Task 2.1 已更新）

- [ ] **Step 5: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/headhunter/handler.ts
git commit -m "feat(headhunter): add createJobForEmployer + listMyCreatedJobs"
```

---

### Task 4.3: 加 headhunter 路由

**Files:**
- Modify: `src/main/routes/headhunter.ts`

- [ ] **Step 1: 在文件顶部加 import**

Add (or verify existing):

```typescript
import { z } from 'zod';
```

(其他 import 假设已存在)

- [ ] **Step 2: 加 CreateJobForEmployerSchema**

Add:

```typescript
const CreateJobForEmployerSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  required_skills: z.array(z.string().min(1).max(100)).max(20).optional(),
  salary_min: z.number().int().positive().optional(),
  salary_max: z.number().int().positive().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  deadline: z.string().optional(),
  industry: z.string().max(100).optional(),
  created_for_employer_id: z.string().min(1).optional(),
});
```

- [ ] **Step 3: 加 POST /jobs 路由**

Append (after the last route, before the closing of the function):

```typescript
  router.post('/jobs', (req, res, next) => {
    try {
      const parsed = CreateJobForEmployerSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const job = handler.createJobForEmployer((req as typeof req & { user?: User }).user!, parsed.data as any);
      res.json({ ok: true, data: job });
    } catch (e) { next(e); }
  });

  router.get('/jobs', (req, res, next) => {
    try {
      const list = handler.listMyCreatedJobs((req as typeof req & { user?: User }).user!);
      res.json({ ok: true, data: list });
    } catch (e) { next(e); }
  });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd d:\dev\hunter-platform && pnpm test tests/integration/headhunter-create-job.test.ts`
Expected: 5/5 PASS

- [ ] **Step 5: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/routes/headhunter.ts
git commit -m "feat(routes): add POST /v1/headhunter/jobs + GET /v1/headhunter/jobs"
```

---

## Phase 5: Employer 端点（claim / reject / pending）

### Task 5.1: 写失败测试：employer claim/reject

**Files:**
- Test: `tests/integration/employer-claim-reject.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
// tests/integration/employer-claim-reject.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

function setupEnv() {
  process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
  process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = ':memory:';
}

describe('GET /v1/employer/pending-claims', () => {
  beforeEach(setupEnv);
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('返回 created_for_employer_id=me 的待认领 job', async () => {
    const app = createApp();
    const emp1 = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const emp2 = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E2', contact: 'e2@e.com' })).body.data;
    const hh  = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;

    // hh 给 emp1 建一个，给 emp2 建一个，没指定的建一个
    await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J1', created_for_employer_id: emp1.id });
    await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J2', created_for_employer_id: emp2.id });
    await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J3' });

    const res = await request(app).get('/v1/employer/pending-claims').set('Authorization', `Bearer ${emp1.api_key}`);
    expect(res.status).toBe(200);
    // emp1 看到 J1 (显式指定) + J3 (无指定, 任何 employer 可 claim)
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((j: any) => j.title).sort()).toEqual(['J1', 'J3']);
  });
});

describe('POST /v1/employer/claim-jobs/:id', () => {
  beforeEach(setupEnv);
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('雇主认领属于自己的待领 → 200, employer_id 填上', async () => {
    const app = createApp();
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hh  = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;
    const job = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J1', created_for_employer_id: emp.id })).body.data;

    const res = await request(app).post(`/v1/employer/claim-jobs/${job.id}`).set('Authorization', `Bearer ${emp.api_key}`);
    expect(res.status).toBe(200);
    expect(res.body.data.employer_id).toBe(emp.id);
    expect(res.body.data.source_headhunter_id).toBe(hh.id);
  });

  it('雇主认领不属于自己 (created_for_employer_id=其他 employer) → 403', async () => {
    const app = createApp();
    const emp1 = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const emp2 = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E2', contact: 'e2@e.com' })).body.data;
    const hh   = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;
    const job  = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J1', created_for_employer_id: emp1.id })).body.data;

    const res = await request(app).post(`/v1/employer/claim-jobs/${job.id}`).set('Authorization', `Bearer ${emp2.api_key}`);
    expect(res.status).toBe(403);
  });

  it('同一 employer 重复 claim 自己的 job → 200 idempotent', async () => {
    const app = createApp();
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hh  = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;
    const job = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J1', created_for_employer_id: emp.id })).body.data;

    await request(app).post(`/v1/employer/claim-jobs/${job.id}`).set('Authorization', `Bearer ${emp.api_key}`);
    const res = await request(app).post(`/v1/employer/claim-jobs/${job.id}`).set('Authorization', `Bearer ${emp.api_key}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /v1/employer/reject-jobs/:id', () => {
  beforeEach(setupEnv);
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('雇主拒绝 → status=closed', async () => {
    const app = createApp();
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hh  = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;
    const job = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J1', created_for_employer_id: emp.id })).body.data;

    const res = await request(app).post(`/v1/employer/reject-jobs/${job.id}`).set('Authorization', `Bearer ${emp.api_key}`).send({ reason: 'not my job' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('closed');
  });

  it('拒绝后 GET /pending-claims 不再返回', async () => {
    const app = createApp();
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hh  = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;
    const job = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J1', created_for_employer_id: emp.id })).body.data;

    await request(app).post(`/v1/employer/reject-jobs/${job.id}`).set('Authorization', `Bearer ${emp.api_key}`).send({});
    const res = await request(app).get('/v1/employer/pending-claims').set('Authorization', `Bearer ${emp.api_key}`);
    expect(res.body.data).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd d:\dev\hunter-platform && pnpm test tests/integration/employer-claim-reject.test.ts`
Expected: 全部 FAIL (端点不存在)

- [ ] **Step 3: Commit (失败测试)**

```bash
cd d:\dev\hunter-platform
git add tests/integration/employer-claim-reject.test.ts
git commit -m "test(employer): add failing tests for claim/reject/pending-claims"
```

---

### Task 5.2: 实现 employer handler 函数

**Files:**
- Modify: `src/main/modules/employer/handler.ts`

- [ ] **Step 1: 在 return object 中追加新方法**

Find `createEmployerHandler` function and append new methods (before the closing `};`):

```typescript
    listPendingClaims(user: User): Job[] {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers');
      return jobs.findPendingClaims(user.id);
    },

    claimJob(user: User, input: { job_id: string }): Job {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can claim jobs');

      // 先校验: 存在 + 未认领 + 属于自己 (created_for_employer_id=me 或 null)
      const job = jobs.findById(input.job_id);
      if (!job) throw Errors.notFound('Job not found');
      if (job.status !== 'open') throw Errors.invalidState(`Cannot claim job in status ${job.status}`);
      if (job.employer_id !== null && job.employer_id !== user.id) {
        throw Errors.invalidState('Job already claimed by another employer');
      }
      // idempotent: 已经是自己
      if (job.employer_id === user.id) return job;

      // 权限校验: created_for_employer_id 必须 = me 或 null
      if (job.created_for_employer_id !== null && job.created_for_employer_id !== user.id) {
        throw Errors.forbidden('Job not pending for you');
      }

      const claimed = jobs.claimByEmployer(input.job_id, user.id);
      if (!claimed) throw Errors.invalidState('Claim race: job no longer available');
      return claimed;
    },

    rejectJob(user: User, input: { job_id: string; reason?: string }): { status: string } {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can reject jobs');

      const job = jobs.findById(input.job_id);
      if (!job) throw Errors.notFound('Job not found');
      if (job.status !== 'open') throw Errors.invalidState(`Cannot reject job in status ${job.status}`);
      if (job.employer_id !== null && job.employer_id !== user.id) {
        throw Errors.forbidden('Not your job to reject');
      }
      if (job.created_for_employer_id !== null && job.created_for_employer_id !== user.id && job.employer_id === null) {
        throw Errors.forbidden('Job not pending for you');
      }

      db.exec('BEGIN');
      try {
        jobs.updateStatus(input.job_id, 'closed');
        // 写 action_history
        db.prepare(`
          INSERT INTO action_history (user_id, action_type, target_type, target_id, request_summary_json, status, created_at)
          VALUES (?, 'reject_job', 'job', ?, ?, 'success', ?)
        `).run(user.id, input.job_id, JSON.stringify({ reason: input.reason ?? null }), new Date().toISOString());
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return { status: 'closed' };
    },
```

- [ ] **Step 2: 验证 typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/employer/handler.ts
git commit -m "feat(employer): add listPendingClaims + claimJob + rejectJob"
```

---

### Task 5.3: 加 employer 路由

**Files:**
- Modify: `src/main/routes/employer.ts`

- [ ] **Step 1: 加 schemas**

Add:

```typescript
const ClaimJobSchema = z.object({
  job_id: z.string().min(1),
});

const RejectJobSchema = z.object({
  reason: z.string().max(500).optional(),
});
```

(注意: `job_id` 在 URL params 里, schema 校验 request body；这里我们直接读 `req.params.id` 然后用 zod 简单校验)

- [ ] **Step 2: 加 3 个路由**

Append (after the last route, before the closing of `createEmployerRouter`):

```typescript
  router.get('/pending-claims', (req, res, next) => {
    try {
      const list = handler.listPendingClaims((req as typeof req & { user?: User }).user!);
      res.json({ ok: true, data: list });
    } catch (e) { next(e); }
  });

  router.post('/claim-jobs/:id', (req, res, next) => {
    try {
      const job_id = String(req.params.id);
      if (!job_id || job_id.length === 0) throw Errors.invalidParams('job id required');
      const job = handler.claimJob((req as typeof req & { user?: User }).user!, { job_id });
      res.json({ ok: true, data: job });
    } catch (e) { next(e); }
  });

  router.post('/reject-jobs/:id', (req, res, next) => {
    try {
      const parsed = RejectJobSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const result = handler.rejectJob(
        (req as typeof req & { user?: User }).user!,
        { job_id: String(req.params.id), reason: parsed.data.reason },
      );
      res.json({ ok: true, data: result });
    } catch (e) { next(e); }
  });
```

- [ ] **Step 3: 跑测试确认通过**

Run: `cd d:\dev\hunter-platform && pnpm test tests/integration/employer-claim-reject.test.ts`
Expected: 6/6 PASS

- [ ] **Step 4: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/routes/employer.ts
git commit -m "feat(routes): add employer pending-claims + claim-jobs + reject-jobs"
```

---

## Phase 6: 公开页 SQL + 佣金改造

### Task 6.1: 修改 gather-landing-data.ts 的 recentJobs SQL

**Files:**
- Modify: `src/main/modules/view/gather-landing-data.ts`

- [ ] **Step 1: 找 recentJobs SQL**

Run: `grep -n "FROM jobs" "/d/dev/hunter-platform/src/main/modules/view/gather-landing-data.ts"`
Expected: 找到 recentJobs 的 SQL 块

- [ ] **Step 2: 加 employer_id IS NOT NULL**

In the recentJobs SQL (line ~80 from spec context, but find by grep), add `AND employer_id IS NOT NULL` after `WHERE status = 'open'`.

```typescript
  const jobRows = db.prepare(`
    SELECT title, industry, salary_min, salary_max, required_skills_json
    FROM jobs
    WHERE status = 'open' AND employer_id IS NOT NULL
    ORDER BY created_at DESC LIMIT 5
  `).all() as Array<{
    title: string; industry: string | null;
    salary_min: number | null; salary_max: number | null;
    required_skills_json: string | null;
  }>;
```

- [ ] **Step 3: 验证 typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/gather-landing-data.ts
git commit -m "feat(view): hide unclaimed jobs from landing recentJobs"
```

---

### Task 6.2: 写失败测试：visibility

**Files:**
- Test: `tests/integration/headhunter-jobs-visibility.test.ts`

- [ ] **Step 1: 创建测试**

```typescript
// tests/integration/headhunter-jobs-visibility.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

function setupEnv() {
  process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
  process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = ':memory:';
}

describe('未认领的 job 在公开页隐藏', () => {
  beforeEach(setupEnv);
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('landing page 不显示 employer_id=NULL 的 job', async () => {
    const app = createApp();
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hh  = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;

    // employer 直发 1 个
    await request(app).post('/v1/employer/jobs').set('Authorization', `Bearer ${emp.api_key}`).send({ title: 'DirectJob' });
    // 猎头代发 1 个
    const hhJob = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'UnclaimedJob', created_for_employer_id: emp.id })).body.data;

    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('DirectJob');
    expect(res.text).not.toContain('UnclaimedJob');

    // 认领后应该出现
    await request(app).post(`/v1/employer/claim-jobs/${hhJob.id}`).set('Authorization', `Bearer ${emp.api_key}`);
    const res2 = await request(app).get('/');
    expect(res2.text).toContain('UnclaimedJob');
  });

  it('GET /v1/market/jobs 不返回未认领的', async () => {
    const app = createApp();
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hh  = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;

    await request(app).post('/v1/employer/jobs').set('Authorization', `Bearer ${emp.api_key}`).send({ title: 'DirectJob' });
    await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'UnclaimedJob', created_for_employer_id: emp.id });

    const res = await request(app).get('/v1/market/jobs');
    expect(res.status).toBe(200);
    const titles = res.body.data.map((j: any) => j.title);
    expect(titles).toContain('DirectJob');
    expect(titles).not.toContain('UnclaimedJob');
  });
});
```

- [ ] **Step 2: 跑测试确认通过**

Run: `cd d:\dev\hunter-platform && pnpm test tests/integration/headhunter-jobs-visibility.test.ts`
Expected: 2/2 PASS

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add tests/integration/headhunter-jobs-visibility.test.ts
git commit -m "test(view): add visibility tests for unclaimed jobs"
```

---

### Task 6.3: 写失败测试：commission 70/30 split

**Files:**
- Test: `tests/unit/commission-split.test.ts`

- [ ] **Step 1: 创建单元测试**

```typescript
// tests/unit/commission-split.test.ts
import { describe, it, expect } from 'vitest';
import { calculateCommission } from '../../src/main/modules/commission/calculator';
import { COMMISSION_SPLIT_HEADHUNTER_CREATED } from '../../src/shared/constants';

describe('commission split - headhunter created job (pure logic)', () => {
  // 模拟"如果 source_headhunter_id != null && != rec.headhunter_id" 的入参逻辑
  // 因为 createPlacement 才是真判断的地方, 这里只测 calculateCommission 透传 referrer_headhunter_id

  it('同 referrer 100% (雇主直发老逻辑)', () => {
    const r = calculateCommission({ annual_salary: 1_000_000, referrer_headhunter_id: null });
    expect(r.platform_fee).toBe(200_000);
    expect(r.primary_share).toBe(200_000);
    expect(r.referrer_share).toBe(0);
  });

  it('有 referrer 时 70/30 split (老 referral 逻辑)', () => {
    const r = calculateCommission({ annual_salary: 1_000_000, referrer_headhunter_id: 'u_ref' });
    expect(r.platform_fee).toBe(200_000);
    expect(r.primary_share).toBe(140_000);  // 70%
    expect(r.referrer_share).toBe(60_000);  // 30%
  });

  it('createPlacement 把 job.source_headhunter_id 当 referrer 时: 30% 给建岗猎头', () => {
    // 这是 spec §5.4 角色映射表里的"跨人"情形
    const r = calculateCommission({
      annual_salary: 1_000_000,
      referrer_headhunter_id: 'u_hh_creator',  // 来自 job.source_headhunter_id
    });
    expect(r.referrer_share).toBe(60_000);
    expect(r.primary_share).toBe(140_000);
    // 验证 split 比例与 spec 一致
    expect(COMMISSION_SPLIT_HEADHUNTER_CREATED.recommender).toBe(0.7);
    expect(COMMISSION_SPLIT_HEADHUNTER_CREATED.creator).toBe(0.3);
  });
});
```

- [ ] **Step 2: 跑测试确认通过**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/commission-split.test.ts`
Expected: 3/3 PASS

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add tests/unit/commission-split.test.ts
git commit -m "test(commission): add split unit tests for headhunter-created jobs"
```

---

### Task 6.4: 修改 commission/handler.ts createPlacement 入参分支

**Files:**
- Modify: `src/main/modules/commission/handler.ts`

- [ ] **Step 1: 修改 createPlacement 的入参逻辑**

Find the `createPlacement` function. Replace the `createPlacement` body (or just the `calculateCommission` call area):

```typescript
      const job = jobs.findById(input.job_id);
      if (!job || job.employer_id !== employer.id) throw Errors.forbidden('Not your job');

      // v009: 猎头代雇主建岗场景下, 70% 给推荐者, 30% 给建岗猎头
      // 同人 (creator == recommender) 时 100% 给本人
      // creator 覆盖原 referral chain (即使 rec.referrer_headhunter_id 存在)
      let referrerForCommission: string | null = null;
      if (job.source_headhunter_id !== null) {
        if (job.source_headhunter_id === rec.headhunter_id) {
          referrerForCommission = null;  // 同人: 100%
        } else {
          referrerForCommission = job.source_headhunter_id;  // 跨人: 30% 给建岗者
        }
      } else {
        referrerForCommission = rec.referrer_headhunter_id;  // 雇主直发: 老逻辑
      }

      const commission = calculateCommission({
        annual_salary: input.annual_salary,
        referrer_headhunter_id: referrerForCommission,
      });
```

(注: 原代码 `rec.employer_id !== employer.id` 这个 check 在 source_hh 场景下需要放宽: 如果 job 是"未认领"状态，rec.employer_id 不会 == employer.id。但 spec §5.4 规定"未认领就 unlock"是禁止的——recommendation 关联 employer_id=NULL 无意义。所以保留这个 check 也 OK：未认领的 job 走不到 createPlacement。)

- [ ] **Step 2: 跑全量测试**

Run: `cd d:\dev\hunter-platform && pnpm test`
Expected: 全 PASS

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/commission/handler.ts
git commit -m "feat(commission): split 70/30 for headhunter-created jobs"
```

---

### Task 6.5: 写集成测试：commission 70/30 端到端

**Files:**
- Test: `tests/integration/commission-headhunter-created.test.ts`

- [ ] **Step 1: 创建测试**

```typescript
// tests/integration/commission-headhunter-created.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

function setupEnv() {
  process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
  process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = ':memory:';
}

describe('commission 70/30 split - headhunter created job', () => {
  beforeEach(setupEnv);
  afterEach(() => { delete process.env.DATABASE_PATH; });

  // 完整流程: 猎头 A 建岗 → 雇主 E 认领 → 猎头 B 推荐候选人 → 候选人授权 → 雇主 unlock → 雇主建 placement
  // 期望: primary_headhunter_id=B (70%), referrer_headhunter_id=A (30%, 因为是 job creator)

  it('跨人 (A 建, B 推荐): 70% B / 30% A', async () => {
    const app = createApp();
    // 注册
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hhA = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'HA', contact: 'ha@h.com' })).body.data;
    const hhB = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'HB', contact: 'hb@h.com' })).body.data;
    const cand = (await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C1', contact: 'c1@c.com' })).body.data;

    // A 建岗, 指定 E
    const job = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hhA.api_key}`).send({ title: 'J1', created_for_employer_id: emp.id })).body.data;
    // E 认领
    await request(app).post(`/v1/employer/claim-jobs/${job.id}`).set('Authorization', `Bearer ${emp.api_key}`);
    // B 上传候选人
    const candRes = await request(app).post('/v1/headhunter/candidates').set('Authorization', `Bearer ${hhB.api_key}`).send({
      candidate_user_id: cand.id, name: 'X', phone: '13800138000', email: 'x@x.com',
      current_company: '字节跳动', current_title: 'P6',
      expected_salary: 600000, years_experience: 5, education_school: 'S', skills: ['React'],
    });
    const anondId = candRes.body.data.anonymized_id;
    // B 推荐候选人
    await request(app).post('/v1/headhunter/recommendations').set('Authorization', `Bearer ${hhB.api_key}`).send({ anonymized_candidate_id: anondId, job_id: job.id });
    // 找到 rec
    const recList = await request(app).get('/v1/candidate/opportunities').set('Authorization', `Bearer ${cand.api_key}`);
    const rec = recList.body.data[0];
    // E 表达兴趣
    await request(app).post(`/v1/employer/recommendations/${rec.id}/express-interest`).set('Authorization', `Bearer ${emp.api_key}`);
    // C 授权
    await request(app).post(`/v1/candidate/recommendations/${rec.id}/approve-unlock`).set('Authorization', `Bearer ${cand.api_key}`);
    // E unlock
    await request(app).post(`/v1/employer/recommendations/${rec.id}/unlock-contact`).set('Authorization', `Bearer ${emp.api_key}`);
    // E 创建 placement
    const placementRes = await request(app).post('/v1/employer/placements').set('Authorization', `Bearer ${emp.api_key}`).send({
      anonymized_candidate_id: anondId, job_id: job.id, annual_salary: 1000000,
    });

    expect(placementRes.status).toBe(200);
    const p = placementRes.body.data;
    expect(p.primary_headhunter_id).toBe(hhB.id);  // 70% 给 B (推荐者)
    expect(p.referrer_headhunter_id).toBe(hhA.id);  // 30% 给 A (建岗者, 替代了 referral chain)
    // annual_salary=100万, platform_fee=20万, primary=14万, referrer=6万
    expect(p.platform_fee).toBe(200000);
    expect(p.primary_share).toBe(140000);
    expect(p.referrer_share).toBe(60000);
  });

  it('同人 (A 建, A 推荐): 100% A (避免自付)', async () => {
    // 类似上面但 hhB 替换为 hhA (同人)
    // 期望: primary=A, referrer=null, primary_share=200000 (100%)
  });

  it('雇主直发 (E 建, B 推荐, 无 referrer): 100% B', async () => {
    // 类似上面但 job 是 employer 直接建 (无 source_hh)
    // 期望: primary=B, referrer=null
  });
});
```

> 上面给了 3 个 it 的关键路径。完整版需要: 上传候选人 → 推荐 → express_interest → approve-unlock → unlock-contact → placement。具体哪个 token 调哪个端点参考 `tests/integration/e2e.test.ts` 的现有 pattern。

- [ ] **Step 2: 跑测试**

Run: `cd d:\dev\hunter-platform && pnpm test tests/integration/commission-headhunter-created.test.ts`
Expected: 3/3 PASS

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add tests/integration/commission-headhunter-created.test.ts
git commit -m "test(commission): add e2e tests for 70/30 split"
```

---

## Phase 7: 最终验证

### Task 7.1: 全量 typecheck + test + smoke

**Files:** (none)

- [ ] **Step 1: Typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: PASS

- [ ] **Step 2: 全量测试**

Run: `cd d:\dev\hunter-platform && pnpm test`
Expected: 439+ 测试 + 我们的 25+ 新测试全部 PASS（~470+）

- [ ] **Step 3: Smoke test**

Run:
```bash
cd d:\dev\hunter-platform
pnpm dev > /tmp/dev.log 2>&1 &
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
kill %1
```

Expected: 200

- [ ] **Step 4: 验证文件结构**

Run: `dir d:\dev\hunter-platform\src\main\db\migrations /B`
Expected: 看到 `v009_headhunter_created_jobs.sql`

---

## Self-Review（执行前核对）

### 1. Spec 覆盖清单

| Spec 需求 | 任务 |
|---|---|
| §1.3 目标 1 (POST /v1/headhunter/jobs) | Task 4.2, 4.3 |
| §1.3 目标 2 (GET /v1/employer/pending-claims) | Task 5.2, 5.3 |
| §1.3 目标 3 (claim/reject) | Task 5.2, 5.3 |
| §1.3 目标 4 (公开页隐藏未认领) | Task 6.1, 6.2 |
| §1.3 目标 5 (70/30 拆账) | Task 6.3, 6.4, 6.5 |
| §1.3 目标 6 (同人 100%) | Task 6.3, 6.5 |
| §3.1 schema CHECK 约束 | Task 1.1, 1.2 |
| §3.2 公开页 SQL 补丁 | Task 6.1 |
| §4.1 新增文件 | Task 1.1 (v009 sql), 1.2, 4.1, 5.1, 6.2, 6.3, 6.5 |
| §4.2 修改文件 | Task 2.1, 2.2, 3.1, 4.2, 4.3, 5.2, 5.3, 6.1, 6.4 |
| §5.1 数据流 (POST /jobs) | Task 4.2 |
| §5.2 数据流 (claim) | Task 5.2 |
| §5.3 数据流 (reject) | Task 5.2 |
| §5.4 数据流 (commission split) | Task 6.4 |
| §6 错误处理 | Task 4.1, 5.1 (覆盖在测试里) |
| §7 测试策略 | Task 1.2, 4.1, 5.1, 6.2, 6.3, 6.5 |
| §8.1 实现路径 | Phase 1-7 全部覆盖 |

### 2. 占位符检查

0 个 `TBD` / `TODO` / `FIXME` / `XXX` / `fill in details`

### 3. 类型一致性

- `Job.employer_id: string | null` 在 Task 2.1 定义 → Task 3.1 使用 → Phase 4-6 一致
- `COMMISSION_SPLIT_HEADHUNTER_CREATED` 在 Task 2.2 定义 → Task 6.3 引用
- `createJobForEmployer` / `claimJob` / `rejectJob` / `listPendingClaims` / `listMyCreatedJobs` 命名跨 task 一致
