# Hunter Platform — Milestone 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成商业闭环 — 雇主创建入职记录 → 自动计算佣金 → 管理员查看账单 → 候选人可导出个人数据（GDPR）。

**Architecture:** 纯函数式 commission calculator + 单一 placements 表（带 P1#4 UNIQUE 约束防重复）+ admin_action_log 写中间件 + GDPR export endpoint 返回解密 PII + zod 推导的 OpenAPI 文档。

**Tech Stack:** 同 M1-M3 + zod（已装）+ 可选 `@asteasolutions/zod-to-openapi`（如需自动 OpenAPI）。

**Spec 参考:** [`docs/superpowers/specs/2026-06-17-hunter-platform-design.md`](../specs/2026-06-17-hunter-platform-design.md) — 重点 §3.1 placements + §9 佣金计算 + §11 测试 + §12 Milestone 4

**起点:** `m3-complete` tag（在 main 分支上，110 tests 通过）

**本文档涵盖:** 16 个 task，按 6 个节组织（DB / 佣金 / HTTP / GDPR / Admin UI / E2E）。M5 后续写。

---

## 关键背景

### M1-M3 已实现

- ✅ 完整三角色 API（25 个端点）+ 4 步解锁 + Webhook
- ✅ Convo Electron admin UI（7 个页面）
- ✅ skill.md（spec §5 完整 8 节）
- ✅ 110 tests 通过，0 typecheck 错误

### M4 要解决的核心问题

1. **商业闭环**：placement 记录 + 佣金计算（20% 抽成 / 70% 主猎头 / 30% 推荐人）
2. **重复 prevention**：P1#4 placements UNIQUE(candidate, job, hunter) 约束
3. **admin_action_log 落地**：M3 spec 定义了表但 M3 代码没写日志；M4 加中间件自动写
4. **GDPR**：Article 20 数据可携带权 — 候选人可导出全部个人数据
5. **OpenAPI**：可由 zod schema 自动生成

### 不做的事（保留给 M5+）

- ❌ 真实支付集成（M4 只记录 `pending_payment` → `paid`，不接 Stripe）
- ❌ 加密密钥轮换（v2）
- ❌ 性能压测 / 监控（M5）
- ❌ M3 admin 操作的回填日志（M4 只对新操作写）

---

## Milestone 4.A：数据库 v003（placements + admin_action_log）

### Task 1: Schema v003 迁移

**Files:**
- Create: `src/main/db/migrations/v003.sql`
- Modify: `src/main/db/migrations.ts`
- Test: `tests/integration/migrations-v003.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/migrations-v003.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('migrations v003', () => {
  const testDb = path.join(__dirname, '../../tmp/mig3.db');

  beforeEach(() => { try { fs.unlinkSync(testDb); } catch {} });
  afterEach(() => { try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('creates v003 tables and records migration', () => {
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('placements');
    expect(names).toContain('admin_action_log');
    const migs = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(migs.map(m => m.version)).toEqual([1, 2, 3]);
    db.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd D:\dev\hunter-platform
pnpm test tests/integration/migrations-v003.test.ts
```
Expected: FAIL with "table placements not found".

- [ ] **Step 3: 创建 v003.sql**

`src/main/db/migrations/v003.sql`：
```sql
-- ============================================================
-- v003: M4 (placements + admin_action_log 实际使用)
-- ============================================================

-- 入职记录（商业闭环核心）
CREATE TABLE placements (
  id                      TEXT PRIMARY KEY,
  job_id                  TEXT NOT NULL REFERENCES jobs(id),
  candidate_user_id       TEXT NOT NULL REFERENCES users(id),
  primary_headhunter_id   TEXT NOT NULL REFERENCES users(id),
  referrer_headhunter_id  TEXT REFERENCES users(id),
  anonymized_candidate_id TEXT NOT NULL REFERENCES candidates_anonymized(id),
  annual_salary           INTEGER NOT NULL,
  platform_fee            INTEGER NOT NULL,    -- platform_fee = annual_salary * 0.20
  primary_share           INTEGER NOT NULL,    -- 主猎头分成
  referrer_share          INTEGER NOT NULL DEFAULT 0,
  candidate_bonus         INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'pending_payment'
                          CHECK (status IN ('pending_payment', 'paid', 'cancelled')),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  UNIQUE(anonymized_candidate_id, job_id, primary_headhunter_id)  -- P1#4: 防止重复
);
CREATE INDEX idx_placements_job ON placements(job_id);
CREATE INDEX idx_placements_candidate ON placements(candidate_user_id);
CREATE INDEX idx_placements_primary_headhunter ON placements(primary_headhunter_id);
CREATE INDEX idx_placements_status ON placements(status, created_at DESC);

-- 管理员操作日志（M3 spec 定义但未实现；M4 起开始写）
CREATE TABLE admin_action_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id   TEXT NOT NULL,            -- v1 单管理员，记为 'admin'
  action          TEXT NOT NULL,            -- "suspend_user", "adjust_quota", "remove_candidate", "mark_paid", ...
  target_type     TEXT,                     -- "user", "candidate", "placement", "config"
  target_id       TEXT,
  details_json    TEXT,                     -- 操作详情（不含 PII）
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_admin_action_admin ON admin_action_log(admin_user_id, created_at);
CREATE INDEX idx_admin_action_target ON admin_action_log(target_type, target_id);
```

- [ ] **Step 4: 注册 v003 到 migrations.ts**

修改 `src/main/db/migrations.ts` 的 `MIGRATIONS` 数组：

```typescript
const MIGRATIONS: { version: number; description: string; file: string }[] = [
  { version: 1, description: 'M1 baseline (users, candidates, idempotency, rate limit, action history)', file: 'migrations/v001.sql' },
  { version: 2, description: 'M2 (jobs, recommendations, unlock_audit_log, webhook_delivery_queue)', file: 'migrations/v002.sql' },
  { version: 3, description: 'M4 (placements, admin_action_log)', file: 'migrations/v003.sql' },
];
```

- [ ] **Step 5: 跑测试**

```bash
pnpm test tests/integration/migrations-v003.test.ts
```
Expected: 1 passed.

- [ ] **Step 6: 跑全部测试 + typecheck**

```bash
pnpm test
pnpm typecheck
```

- [ ] **Step 7: 提交**

```bash
git add src/main/db/migrations/v003.sql src/main/db/migrations.ts tests/integration/migrations-v003.test.ts
git commit -m "feat(db): v003 migration (placements + admin_action_log)"
```

---

### Task 2: Placements repository

**Files:**
- Create: `src/main/db/repositories/placements.ts`
- Test: `tests/integration/repos/placements.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/repos/placements.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('placements repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/place.db');
  let db: any, users: any, priv: any, anon: any, jobs: any, recs: any, places: any;

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
    places = require('../../../src/main/db/repositories/placements').createPlacementsRepo(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 0, unlock_status: 'unlocked', created_at: now, updated_at: now });
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'A', description: null, requirements: null, salary_min: 500000, salary_max: 800000, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  function seedPlacement(id: string, status: string = 'pending_payment', primaryHeadhunter: string = 'h1') {
    const now = '2026-06-17T00:00:00Z';
    places.insert({
      id, job_id: 'j1', candidate_user_id: 'c1', primary_headhunter_id: primaryHeadhunter,
      referrer_headhunter_id: null, anonymized_candidate_id: 'ca_1',
      annual_salary: 600000, platform_fee: 120000, primary_share: 84000, referrer_share: 0, candidate_bonus: 0,
      status, created_at: now, updated_at: now,
    });
  }

  it('inserts and finds by id', () => {
    seedPlacement('pl_1');
    expect(places.findById('pl_1')?.annual_salary).toBe(600000);
  });

  it('rejects duplicate (P1#4 UNIQUE constraint)', () => {
    seedPlacement('pl_1');
    expect(() => seedPlacement('pl_2')).toThrow();
  });

  it('updates status (pending_payment → paid)', () => {
    seedPlacement('pl_1', 'pending_payment');
    places.updateStatus('pl_1', 'paid');
    expect(places.findById('pl_1')?.status).toBe('paid');
  });

  it('lists by employer via job', () => {
    seedPlacement('pl_1');
    seedPlacement('pl_2');
    const list = places.listByEmployer('e1', {});
    expect(list.length).toBe(2);
  });

  it('lists by primary_headhunter', () => {
    seedPlacement('pl_1', 'pending_payment', 'h1');
    const list = places.listByPrimaryHeadhunter('h1', {});
    expect(list.length).toBe(1);
  });

  it('sums paid amounts per headhunter (for billing)', () => {
    seedPlacement('pl_1', 'paid');
    seedPlacement('pl_2', 'pending_payment');  // 不应计入
    const total = places.sumPaidByHeadhunter('h1');
    expect(total).toBe(84000);  // 仅 pl_1 的 primary_share
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/repos/placements.test.ts
```

- [ ] **Step 3: 实现 placements.ts**

`src/main/db/repositories/placements.ts`：
```typescript
import type { DB } from '../connection.js';

export type PlacementStatus = 'pending_payment' | 'paid' | 'cancelled';

export interface Placement {
  id: string;
  job_id: string;
  candidate_user_id: string;
  primary_headhunter_id: string;
  referrer_headhunter_id: string | null;
  anonymized_candidate_id: string;
  annual_salary: number;
  platform_fee: number;
  primary_share: number;
  referrer_share: number;
  candidate_bonus: number;
  status: PlacementStatus;
  created_at: string;
  updated_at: string;
}

export function createPlacementsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO placements (id, job_id, candidate_user_id, primary_headhunter_id, referrer_headhunter_id,
                            anonymized_candidate_id, annual_salary, platform_fee, primary_share,
                            referrer_share, candidate_bonus, status, created_at, updated_at)
    VALUES (@id, @job_id, @candidate_user_id, @primary_headhunter_id, @referrer_headhunter_id,
            @anonymized_candidate_id, @annual_salary, @platform_fee, @primary_share,
            @referrer_share, @candidate_bonus, @status, @created_at, @updated_at)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM placements WHERE id = ?');
  const updateStatusStmt = db.prepare("UPDATE placements SET status = ?, updated_at = ? WHERE id = ?");
  const sumPaidStmt = db.prepare(
    "SELECT COALESCE(SUM(primary_share), 0) AS total FROM placements WHERE primary_headhunter_id = ? AND status = 'paid'"
  );

  return {
    insert(p: Placement): void { insertStmt.run(p); },
    findById(id: string): Placement | undefined {
      return findByIdStmt.get(id) as Placement | undefined;
    },
    updateStatus(id: string, status: PlacementStatus): void {
      updateStatusStmt.run(status, new Date().toISOString(), id);
    },
    listByEmployer(employerId: string, opts: { status?: PlacementStatus; limit?: number; offset?: number } = {}): Placement[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.status) {
        return db.prepare(
          "SELECT p.* FROM placements p JOIN jobs j ON j.id = p.job_id WHERE j.employer_id = ? AND p.status = ? ORDER BY p.created_at DESC LIMIT ? OFFSET ?"
        ).all(employerId, opts.status, limit, offset) as Placement[];
      }
      return db.prepare(
        "SELECT p.* FROM placements p JOIN jobs j ON j.id = p.job_id WHERE j.employer_id = ? ORDER BY p.created_at DESC LIMIT ? OFFSET ?"
      ).all(employerId, limit, offset) as Placement[];
    },
    listByPrimaryHeadhunter(headhunterId: string, opts: { status?: PlacementStatus; limit?: number; offset?: number } = {}): Placement[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.status) {
        return db.prepare(
          "SELECT * FROM placements WHERE primary_headhunter_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
        ).all(headhunterId, opts.status, limit, offset) as Placement[];
      }
      return db.prepare(
        "SELECT * FROM placements WHERE primary_headhunter_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
      ).all(headhunterId, limit, offset) as Placement[];
    },
    sumPaidByHeadhunter(headhunterId: string): number {
      return (sumPaidStmt.get(headhunterId) as { total: number }).total;
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/repos/placements.test.ts
```
Expected: 6 passed.

- [ ] **Step 5: 提交**

```bash
git add src/main/db/repositories/placements.ts tests/integration/repos/placements.test.ts
git commit -m "feat(repo): placements with UNIQUE(candidate,job,hunter) + sumPaidByHeadhunter"
```

---

### Task 3: admin_action_log repository

**Files:**
- Create: `src/main/db/repositories/admin-action-log.ts`
- Test: `tests/integration/repos/admin-action-log.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/repos/admin-action-log.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('admin_action_log repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/admin-log.db');
  let db: any, log: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    log = require('../../../src/main/db/repositories/admin-action-log').createAdminActionLogRepo(db);
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('inserts and lists by admin', () => {
    log.insert({ admin_user_id: 'admin', action: 'suspend_user', target_type: 'user', target_id: 'u1', details_json: '{"reason":"x"}' });
    const list = log.listByAdmin('admin', {});
    expect(list.length).toBe(1);
    expect(list[0].action).toBe('suspend_user');
  });

  it('listByTarget filters by target_type + target_id', () => {
    log.insert({ admin_user_id: 'admin', action: 'remove_candidate', target_type: 'candidate', target_id: 'c1' });
    log.insert({ admin_user_id: 'admin', action: 'mark_paid', target_type: 'placement', target_id: 'p1' });
    const forCand = log.listByTarget('candidate', 'c1', {});
    expect(forCand.length).toBe(1);
    expect(forCand[0].action).toBe('remove_candidate');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/repos/admin-action-log.test.ts
```

- [ ] **Step 3: 实现 admin-action-log.ts**

`src/main/db/repositories/admin-action-log.ts`：
```typescript
import type { DB } from '../connection.js';

export interface AdminActionEntry {
  id: number;
  admin_user_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details_json: string | null;
  created_at: string;
}

export function createAdminActionLogRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO admin_action_log (admin_user_id, action, target_type, target_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const listByAdminStmt = db.prepare(
    'SELECT * FROM admin_action_log WHERE admin_user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  );
  const listByTargetStmt = db.prepare(
    'SELECT * FROM admin_action_log WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  );
  const listAllStmt = db.prepare(
    'SELECT * FROM admin_action_log ORDER BY created_at DESC LIMIT ? OFFSET ?'
  );

  return {
    insert(input: { admin_user_id: string; action: string; target_type?: string; target_id?: string; details_json?: string }): void {
      insertStmt.run(
        input.admin_user_id, input.action,
        input.target_type ?? null, input.target_id ?? null,
        input.details_json ?? null, new Date().toISOString(),
      );
    },
    listByAdmin(adminId: string, opts: { limit?: number; offset?: number } = {}): AdminActionEntry[] {
      return listByAdminStmt.all(adminId, opts.limit ?? 100, opts.offset ?? 0) as AdminActionEntry[];
    },
    listByTarget(targetType: string, targetId: string, opts: { limit?: number; offset?: number } = {}): AdminActionEntry[] {
      return listByTargetStmt.all(targetType, targetId, opts.limit ?? 100, opts.offset ?? 0) as AdminActionEntry[];
    },
    listAll(opts: { limit?: number; offset?: number } = {}): AdminActionEntry[] {
      return listAllStmt.all(opts.limit ?? 100, opts.offset ?? 0) as AdminActionEntry[];
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/repos/admin-action-log.test.ts
```
Expected: 2 passed.

- [ ] **Step 5: 提交**

```bash
git add src/main/db/repositories/admin-action-log.ts tests/integration/repos/admin-action-log.test.ts
git commit -m "feat(repo): admin_action_log for admin operations audit"
```

---

## Milestone 4.B：佣金计算模块

### Task 4: Commission calculator（纯函数，无 DB）

**Files:**
- Create: `src/main/modules/commission/calculator.ts`
- Test: `tests/unit/commission/calculator.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/unit/commission/calculator.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';

describe('commission calculator', () => {
  it('default 20% platform / 70% hunter / 0% referrer (no referrer)', async () => {
    const { calculateCommission } = await import('../../../src/main/modules/commission/calculator');
    const r = calculateCommission({ annual_salary: 1_000_000, referrer_headhunter_id: null });
    expect(r.platform_fee).toBe(200_000);      // 20%
    expect(r.primary_share).toBe(140_000);     // 70% of 200k
    expect(r.referrer_share).toBe(0);
    expect(r.candidate_bonus).toBe(0);
  });

  it('with referrer: splits 70/30 between primary and referrer', async () => {
    const { calculateCommission } = await import('../../../src/main/modules/commission/calculator');
    const r = calculateCommission({ annual_salary: 1_000_000, referrer_headhunter_id: 'h2' });
    expect(r.platform_fee).toBe(200_000);
    expect(r.primary_share).toBe(140_000);     // 70% × 200k
    expect(r.referrer_share).toBe(60_000);     // 30% × 200k
  });

  it('clamps salary to min/max (no error)', async () => {
    const { calculateCommission } = await import('../../../src/main/modules/commission/calculator');
    const low = calculateCommission({ annual_salary: 50_000, referrer_headhunter_id: null });
    expect(low.platform_fee).toBe(40_000);   // 200k × 20% = 40k
    const high = calculateCommission({ annual_salary: 10_000_000, referrer_headhunter_id: null });
    expect(high.platform_fee).toBe(1_000_000); // 5M × 20% = 1M
  });

  it('negative salary returns zero commission', async () => {
    const { calculateCommission } = await import('../../../src/main/modules/commission/calculator');
    const r = calculateCommission({ annual_salary: -100, referrer_headhunter_id: null });
    expect(r.platform_fee).toBe(0);
    expect(r.primary_share).toBe(0);
  });

  it('uses custom rates', async () => {
    const { calculateCommission } = await import('../../../src/main/modules/commission/calculator');
    const r = calculateCommission({
      annual_salary: 1_000_000, referrer_headhunter_id: 'h2',
      platform_fee_rate: 0.30, primary_share_rate: 0.60, referrer_share_rate: 0.40,
    });
    expect(r.platform_fee).toBe(300_000);
    expect(r.primary_share).toBe(180_000);   // 60% × 300k
    expect(r.referrer_share).toBe(120_000);   // 40% × 300k
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/commission/calculator.test.ts
```

- [ ] **Step 3: 实现 calculator.ts**

`src/main/modules/commission/calculator.ts`：
```typescript
export interface CommissionRates {
  platform_fee_rate: number;     // 默认 0.20
  primary_share_rate: number;    // 默认 0.70
  referrer_share_rate: number;   // 默认 0.30
}

export interface CommissionInput {
  annual_salary: number;
  referrer_headhunter_id: string | null;
  rates?: Partial<CommissionRates>;
  salary_min?: number;           // 默认 200_000
  salary_max?: number;           // 默认 5_000_000
}

export interface CommissionResult {
  platform_fee: number;
  primary_share: number;
  referrer_share: number;
  candidate_bonus: number;
  clamped_salary: number;
}

const DEFAULT_RATES: CommissionRates = {
  platform_fee_rate: 0.20,
  primary_share_rate: 0.70,
  referrer_share_rate: 0.30,
};

export function calculateCommission(input: CommissionInput): CommissionResult {
  const rates: CommissionRates = { ...DEFAULT_RATES, ...input.rates };
  const min = input.salary_min ?? 200_000;
  const max = input.salary_max ?? 5_000_000;
  const clamped = Math.max(0, Math.min(max, Math.max(min, input.annual_salary)));

  if (clamped === 0) {
    return { platform_fee: 0, primary_share: 0, referrer_share: 0, candidate_bonus: 0, clamped_salary: 0 };
  }

  const platform_fee = Math.round(clamped * rates.platform_fee_rate);

  let primary_share: number;
  let referrer_share: number;
  if (input.referrer_headhunter_id) {
    primary_share = Math.round(platform_fee * rates.primary_share_rate);
    referrer_share = Math.round(platform_fee * rates.referrer_share_rate);
  } else {
    primary_share = platform_fee;  // 无 referrer 时主猎头独享
    referrer_share = 0;
  }

  return {
    platform_fee,
    primary_share,
    referrer_share,
    candidate_bonus: 0,  // v1 不做
    clamped_salary: clamped,
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/unit/commission/calculator.test.ts
```
Expected: 5 passed.

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/commission/calculator.ts tests/unit/commission/calculator.test.ts
git commit -m "feat(commission): pure-function calculator with rate clamping"
```

---

### Task 5: Placements handler（创建 + 状态转换）

**Files:**
- Create: `src/main/modules/commission/handler.ts`
- Test: `tests/integration/commission-handler.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/commission-handler.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('commission handler', () => {
  const testDb = path.join(__dirname, '../../tmp/comm-handler.db');
  let db: any, users: any, priv: any, anon: any, jobs: any, recs: any, places: any, handler: any;

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
    places = require('../../../src/main/db/repositories/placements').createPlacementsRepo(db);
    handler = require('../../../src/main/modules/commission/handler').createCommissionHandler(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 0, unlock_status: 'unlocked', created_at: now, updated_at: now });
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'A', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    recs.insert({ id: 'r1', headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca_1', job_id: 'j1', status: 'unlocked', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('createPlacement requires employer role', () => {
    const h: any = { id: 'h1', user_type: 'headhunter' };
    expect(() => handler.createPlacement(h, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 })).toThrow();
  });

  it('createPlacement requires recommendation in unlocked status', () => {
    db.prepare("UPDATE recommendations SET status = 'pending' WHERE id = 'r1'").run();
    const e: any = { id: 'e1', user_type: 'employer' };
    expect(() => handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 })).toThrow(/INVALID_STATE/);
  });

  it('createPlacement computes commission and inserts', () => {
    const e: any = { id: 'e1', user_type: 'employer' };
    const p = handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 1_000_000 });
    expect(p.platform_fee).toBe(200_000);
    expect(p.primary_share).toBe(200_000);  // no referrer
    expect(p.status).toBe('pending_payment');
  });

  it('createPlacement rejects duplicate (P1#4)', () => {
    const e: any = { id: 'e1', user_type: 'employer' };
    handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 1_000_000 });
    expect(() => handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 1_000_000 })).toThrow();
  });

  it('markPaid transitions pending_payment → paid', () => {
    const e: any = { id: 'e1', user_type: 'employer' };
    const p = handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 });
    handler.markPaid('admin', p.id);
    expect(places.findById(p.id)?.status).toBe('paid');
  });

  it('markPaid rejects when status is not pending_payment', () => {
    const e: any = { id: 'e1', user_type: 'employer' };
    const p = handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 });
    handler.markPaid('admin', p.id);
    expect(() => handler.markPaid('admin', p.id)).toThrow(/INVALID_STATE/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/commission-handler.test.ts
```

- [ ] **Step 3: 实现 handler.ts**

`src/main/modules/commission/handler.ts`：
```typescript
import { randomUUID } from 'node:crypto';
import type { DB } from '../../db/connection.js';
import { createPlacementsRepo, type Placement } from '../../db/repositories/placements.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { createAdminActionLogRepo } from '../../db/repositories/admin-action-log.js';
import { createJobsRepo } from '../../db/repositories/jobs.js';
import { calculateCommission } from './calculator.js';
import { Errors } from '../../errors.js';
import type { User } from '../../../shared/types.js';

export interface CreatePlacementInput {
  anonymized_candidate_id: string;
  job_id: string;
  annual_salary: number;
}

export function createCommissionHandler(db: DB) {
  const places = createPlacementsRepo(db);
  const recs = createRecommendationsRepo(db);
  const jobs = createJobsRepo(db);
  const adminLog = createAdminActionLogRepo(db);

  return {
    createPlacement(employer: User, input: CreatePlacementInput): Placement {
      if (employer.user_type !== 'employer') throw Errors.forbidden('Only employers can create placements');

      // 验证 recommendation 存在 + status=unlocked
      const rec = recs.findByCandidateAndJob(input.anonymized_candidate_id, input.job_id);
      if (!rec) throw Errors.notFound('No recommendation for this candidate + job');
      if (rec.employer_id !== employer.id) throw Errors.forbidden('Not your recommendation');
      if (rec.status !== 'unlocked') throw Errors.invalidState(`recommendation status is ${rec.status}, must be 'unlocked'`);

      // 验证 job 归属
      const job = jobs.findById(input.job_id);
      if (!job || job.employer_id !== employer.id) throw Errors.forbidden('Not your job');

      // 计算佣金
      const commission = calculateCommission({
        annual_salary: input.annual_salary,
        referrer_headhunter_id: rec.referrer_headhunter_id,
      });

      // 写 placement
      const now = new Date().toISOString();
      const placement: Placement = {
        id: `pl_${randomUUID().slice(0, 12)}`,
        job_id: input.job_id,
        candidate_user_id: db.prepare('SELECT candidate_user_id FROM candidates_anonymized WHERE id = ?').get(input.anonymized_candidate_id) as any
          ? (db.prepare('SELECT candidate_user_id FROM candidates_anonymized WHERE id = ?').get(input.anonymized_candidate_id) as { candidate_user_id: string }).candidate_user_id
          : (() => { throw Errors.notFound('Anonymized candidate not found'); })(),
        primary_headhunter_id: rec.headhunter_id,
        referrer_headhunter_id: rec.referrer_headhunter_id,
        anonymized_candidate_id: input.anonymized_candidate_id,
        annual_salary: input.annual_salary,
        platform_fee: commission.platform_fee,
        primary_share: commission.primary_share,
        referrer_share: commission.referrer_share,
        candidate_bonus: 0,
        status: 'pending_payment',
        created_at: now,
        updated_at: now,
      };
      places.insert(placement);
      return placement;
    },

    markPaid(adminUserId: string, placementId: string): Placement {
      const p = places.findById(placementId);
      if (!p) throw Errors.notFound('Placement not found');
      if (p.status !== 'pending_payment') {
        throw Errors.invalidState(`Cannot mark paid: current status is ${p.status}`);
      }
      places.updateStatus(placementId, 'paid');
      adminLog.insert({
        admin_user_id: adminUserId,
        action: 'mark_paid',
        target_type: 'placement',
        target_id: placementId,
        details_json: JSON.stringify({ amount: p.primary_share + p.referrer_share }),
      });
      return places.findById(placementId)!;
    },

    listPlacements(employer: User, opts: { status?: 'pending_payment' | 'paid' | 'cancelled' } = {}): Placement[] {
      if (employer.user_type !== 'employer') throw Errors.forbidden('Only employers');
      return places.listByEmployer(employer.id, opts);
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/commission-handler.test.ts
```
Expected: 6 passed.

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/commission/handler.ts tests/integration/commission-handler.test.ts
git commit -m "feat(commission): placements handler (create + markPaid + list)"
```

---

## Milestone 4.C：HTTP 路由（雇主 + GDPR）

### Task 6: 雇主 placements 路由

**Files:**
- Modify: `src/main/routes/employer.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/employer-placements.test.ts`：
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('POST /v1/employer/placements', () => {
  const testDb = path.join(__dirname, '../../tmp/emp-place.db');
  let app: any, employerKey: string, headhunterKey: string, candidateId: string, jobId: string, anonymizedId: string, recId: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = require('../../src/main/server');
    app = createApp();

    const e = await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E', contact: 'e@x.com' });
    employerKey = e.body.data.api_key;
    const h = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H', contact: 'h@x.com' });
    headhunterKey = h.body.data.api_key;
    const c = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C', contact: 'c@x.com' });
    candidateId = c.body.data.user_id;

    const up = await request(app).post('/v1/headhunter/candidates').set('Authorization', `Bearer ${headhunterKey}`).send({
      candidate_user_id: candidateId, name: 'X', phone: '13800000000', email: 'x@x.com',
      current_company: '字节跳动', current_title: 'P6', expected_salary: 700000, years_experience: 8,
      education_school: '清华', skills: ['React'],
    });
    anonymizedId = up.body.data.anonymized_id;
    const job = await request(app).post('/v1/employer/jobs').set('Authorization', `Bearer ${employerKey}`).send({ title: 'A' });
    jobId = job.body.data.id;
    const rec = await request(app).post('/v1/headhunter/recommendations').set('Authorization', `Bearer ${headhunterKey}`).send({ anonymized_candidate_id: anonymizedId, job_id: jobId });
    recId = rec.body.data.id;
    // 跑 4 步解锁
    await request(app).post(`/v1/employer/recommendations/${recId}/express-interest`).set('Authorization', `Bearer ${employerKey}`);
    await request(app).post(`/v1/candidate/recommendations/${recId}/approve-unlock`).set('Authorization', `Bearer ${c.body.data.api_key}`);
    await request(app).post(`/v1/employer/recommendations/${recId}/unlock-contact`).set('Authorization', `Bearer ${employerKey}`);
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('creates placement with computed commission', async () => {
    const r = await request(app)
      .post('/v1/employer/placements')
      .set('Authorization', `Bearer ${employerKey}`)
      .send({ anonymized_candidate_id: anonymizedId, job_id: jobId, annual_salary: 1_000_000 });
    expect(r.status).toBe(200);
    expect(r.body.data.platform_fee).toBe(200_000);
    expect(r.body.data.primary_share).toBe(200_000);
    expect(r.body.data.status).toBe('pending_payment');
  });

  it('rejects non-employer', async () => {
    const r = await request(app)
      .post('/v1/employer/placements')
      .set('Authorization', `Bearer ${headhunterKey}`)
      .send({ anonymized_candidate_id: anonymizedId, job_id: jobId, annual_salary: 1_000_000 });
    expect(r.status).toBe(403);
  });

  it('rejects duplicate (P1#4 UNIQUE)', async () => {
    await request(app).post('/v1/employer/placements').set('Authorization', `Bearer ${employerKey}`).send({ anonymized_candidate_id: anonymizedId, job_id: jobId, annual_salary: 1_000_000 });
    const r = await request(app).post('/v1/employer/placements').set('Authorization', `Bearer ${employerKey}`).send({ anonymized_candidate_id: anonymizedId, job_id: jobId, annual_salary: 1_000_000 });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/employer-placements.test.ts
```
Expected: FAIL with 404 (route not found).

- [ ] **Step 3: 在 routes/employer.ts 追加 placements 路由**

在 `src/main/routes/employer.ts` 文件**末尾**追加（保留所有现有内容）：

```typescript
import { createCommissionHandler } from '../modules/commission/handler.js';

const CreatePlacementSchema = z.object({
  anonymized_candidate_id: z.string().min(1),
  job_id: z.string().min(1),
  annual_salary: z.number().int().positive(),
});

// 在 createEmployerRouter 函数内、return router 之前追加：
  const commissionHandler = createCommissionHandler(db);

  router.post('/placements', (req, res, next) => {
    try {
      const parsed = CreatePlacementSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const placement = commissionHandler.createPlacement((req as any).user, parsed.data);
      res.json({ ok: true, data: placement });
    } catch (e) { next(e); }
  });

  router.get('/placements', (req, res, next) => {
    try {
      const list = commissionHandler.listPlacements((req as any).user, { status: req.query.status as any });
      res.json({ ok: true, data: list });
    } catch (e) { next(e); }
  });
```

> 头部 `import { z } from 'zod';` 应该已经存在。`Errors` 也应该已经 import。

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/employer-placements.test.ts
```
Expected: 3 passed.

- [ ] **Step 5: 提交**

```bash
git add src/main/routes/employer.ts tests/integration/employer-placements.test.ts
git commit -m "feat(employer): POST/GET /v1/employer/placements with commission"
```

---

### Task 7: 候选人 GDPR 数据导出

**Files:**
- Create: `src/main/modules/candidate/export.ts`
- Create: `src/main/routes/candidate.ts` (追加 GET /v1/candidate/export)
- Test: `tests/integration/candidate-export.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/integration/candidate-export.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('candidate GDPR export', () => {
  const testDb = path.join(__dirname, '../../tmp/gdpr.db');
  let db: any, users: any, priv: any, anon: any, recs: any, audit: any, exporter: any;
  let encryptionKey: Buffer;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    encryptionKey = crypto.randomBytes(32);
    users = require('../../../src/main/db/repositories/users').createUsersRepo(db);
    priv = require('../../../src/main/db/repositories/candidates-private').createCandidatesPrivateRepo(db);
    anon = require('../../../src/main/db/repositories/candidates-anonymized').createCandidatesAnonymizedRepo(db);
    recs = require('../../../src/main/db/repositories/recommendations').createRecommendationsRepo(db);
    audit = require('../../../src/main/db/repositories/unlock-audit-log').createUnlockAuditLogRepo(db);
    const { encrypt } = require('../../../src/main/modules/crypto/aes-gcm');
    const { createCandidateExport } = require('../../../src/main/modules/candidate/export');
    exporter = createCandidateExport(db, encryptionKey);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1',
      name_enc: encrypt(encryptionKey, '张三'), phone_enc: encrypt(encryptionKey, '13800138000'), email_enc: encrypt(encryptionKey, 'z@x.com'),
      current_company_raw: '字节跳动', current_title_raw: 'P6', expected_salary: 700000, years_experience: 8, education_school: '清华',
      resume_url: null, skills_json: '["React"]', raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '["React"]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
    recs.insert({ id: 'r1', headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca_1', job_id: 'j1', status: 'pending', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
    audit.insert({ recommendation_id: 'r1', actor_user_id: 'e1', action: 'express_interest', ip_address: null, user_agent: null });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('exports decrypted PII + recommendations + audit', () => {
    const c: any = { id: 'c1', user_type: 'candidate' };
    const data = exporter.exportMyData(c);
    expect(data.user.email).toBeNull();  // user.contact 未设
    expect(data.candidates_private[0].name).toBe('张三');  // decrypted
    expect(data.candidates_private[0].phone).toBe('13800138000');
    expect(data.candidates_anonymized[0].industry).toBe('互联网');
    expect(data.recommendations.length).toBe(1);
    expect(data.audit_log_entries.length).toBe(1);
    expect(data.exported_at).toBeDefined();
  });

  it('rejects non-candidate', () => {
    const h: any = { id: 'h1', user_type: 'headhunter' };
    expect(() => exporter.exportMyData(h)).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/candidate-export.test.ts
```

- [ ] **Step 3: 实现 export.ts**

`src/main/modules/candidate/export.ts`：
```typescript
import { createRequire } from 'node:module';
const nodeRequire = createRequire(import.meta.url);
const Database = nodeRequire('node:sqlite') as typeof import('node:sqlite');

import type { DB } from '../../db/connection.js';
import { createCandidatesPrivateRepo } from '../../db/repositories/candidates-private.js';
import { createCandidatesAnonymizedRepo } from '../../db/repositories/candidates-anonymized.js';
import { createUnlockAuditLogRepo } from '../../db/repositories/unlock-audit-log.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { decrypt, zeroMemory } from '../crypto/aes-gcm.js';
import { Errors } from '../../errors.js';
import type { User } from '../../../shared/types.js';

export interface ExportedData {
  user: { id: string; user_type: string; name: string; contact: string | null; agent_endpoint: string | null; reputation: number; status: string; created_at: string };
  candidates_private: Array<Record<string, unknown>>;
  candidates_anonymized: Array<Record<string, unknown>>;
  recommendations: Array<Record<string, unknown>>;
  audit_log_entries: Array<Record<string, unknown>>;
  exported_at: string;
  format_version: string;
}

export function createCandidateExport(db: DB, encryptionKey: Buffer) {
  const users = createUsersRepo(db);
  const priv = createCandidatesPrivateRepo(db);
  const anon = createCandidatesAnonymizedRepo(db);
  const audit = createUnlockAuditLogRepo(db);

  return {
    exportMyData(user: User): ExportedData {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can export their data');

      // 1. User record (no PII beyond what they already know)
      const userRecord = users.findById(user.id);
      if (!userRecord) throw Errors.notFound('User not found');
      const userExport = {
        id: userRecord.id, user_type: userRecord.user_type, name: userRecord.name,
        contact: userRecord.contact, agent_endpoint: userRecord.agent_endpoint,
        reputation: userRecord.reputation, status: userRecord.status, created_at: userRecord.created_at,
      };

      // 2. Candidates private (decrypt PII) — 注意：清零内存
      const myAnons = db.prepare('SELECT id FROM candidates_anonymized WHERE source_private_id IN (SELECT id FROM candidates_private WHERE candidate_user_id = ?)').all(user.id) as { id: string }[];
      const myPrivIds = db.prepare('SELECT id FROM candidates_private WHERE candidate_user_id = ?').all(user.id) as { id: string }[];

      const privExports: any[] = [];
      const nameBufs: Buffer[] = [];
      const phoneBufs: Buffer[] = [];
      const emailBufs: Buffer[] = [];
      try {
        for (const { id } of myPrivIds) {
          const p = priv.findById(id);
          if (!p) continue;
          const nameBuf = Buffer.from(decrypt(encryptionKey, p.name_enc), 'utf8');
          const phoneBuf = Buffer.from(decrypt(encryptionKey, p.phone_enc), 'utf8');
          const emailBuf = Buffer.from(decrypt(encryptionKey, p.email_enc), 'utf8');
          nameBufs.push(nameBuf); phoneBufs.push(phoneBuf); emailBufs.push(emailBuf);
          privExports.push({
            id: p.id, headhunter_id: p.headhunter_id,
            name: nameBuf.toString('utf8'),
            phone: phoneBuf.toString('utf8'),
            email: emailBuf.toString('utf8'),
            current_company: p.current_company_raw,
            current_title: p.current_title_raw,
            expected_salary: p.expected_salary,
            years_experience: p.years_experience,
            education_school: p.education_school,
            skills: JSON.parse(p.skills_json ?? '[]'),
            created_at: p.created_at,
          });
        }
      } finally {
        nameBufs.forEach(zeroMemory);
        phoneBufs.forEach(zeroMemory);
        emailBufs.forEach(zeroMemory);
      }

      // 3. Candidates anonymized
      const anonExports = myAnons.map(a => anon.findById(a.id)).filter(Boolean);

      // 4. Recommendations
      const recExports: any[] = [];
      for (const a of myAnons) {
        recExports.push(...db.prepare('SELECT * FROM recommendations WHERE anonymized_candidate_id = ?').all(a.id));
      }

      // 5. Audit log (where candidate is the actor)
      const auditExports = audit.listByActor(user.id);

      return {
        user: userExport,
        candidates_private: privExports,
        candidates_anonymized: anonExports,
        recommendations: recExports,
        audit_log_entries: auditExports,
        exported_at: new Date().toISOString(),
        format_version: '1.0',
      };
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/integration/candidate-export.test.ts
```
Expected: 2 passed.

- [ ] **Step 5: 在 routes/candidate.ts 追加 export 端点**

修改 `src/main/routes/candidate.ts`：

```typescript
// 头部追加 import
import { createCandidateExport } from '../modules/candidate/export.js';

// 在 createCandidateRouter 函数内、router.use(authMiddleware(db)) 之后追加：
  const exportHandler = createCandidateExport(db, /* encryptionKey */ require('crypto').randomBytes(32));
  // ⚠️ 上面 encryptionKey 是 hardcoded！正确的做法是从 env 注入
  //     实际修复：在 createCandidateRouter 签名加 encryptionKey 参数

  router.get('/export-my-data', (req, res, next) => {
    try {
      const data = exportHandler.exportMyData((req as any).user);
      res.setHeader('Content-Disposition', 'attachment; filename="my-data.json"');
      res.json(data);
    } catch (e) { next(e); }
  });
```

> **更稳妥的做法**：修改 `createCandidateRouter(db)` 为 `createCandidateRouter(db, encryptionKey)`，从 env 传入。在 server.ts 调用处也改。

修改后端点 + createCandidateRouter + server.ts 路由调用：

```typescript
// src/main/routes/candidate.ts 头部
import { createCandidateExport } from '../modules/candidate/export.js';
// 删除 require('crypto') 那行

export function createCandidateRouter(db: DB, encryptionKey: Buffer): Router {
  // ... 原有代码
  const exportHandler = createCandidateExport(db, encryptionKey);
  // ... 新增端点
}
```

```typescript
// src/main/server.ts 修改
app.use('/v1/candidate', createCandidateRouter(db, env.PLATFORM_ENCRYPTION_KEY));
```

- [ ] **Step 6: 跑测试 + typecheck**

```bash
pnpm test tests/integration/candidate-export.test.ts
pnpm typecheck
```

- [ ] **Step 7: 提交**

```bash
git add src/main/modules/candidate/export.ts src/main/routes/candidate.ts src/main/server.ts tests/integration/candidate-export.test.ts
git commit -m "feat(candidate): GDPR export-my-data endpoint with decrypted PII"
```

---

## Milestone 4.D：Admin IPC + 页面

### Task 8: Admin commission IPC handler

**Files:**
- Create: `src/main/ipc/placements.ts`
- Test: `tests/unit/ipc/placements.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/unit/ipc/placements.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('admin:placements', () => {
  const testDb = path.join(__dirname, '../../../tmp/place-ipc.db');
  let db: any, ipc: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { openDb } = require('../../../src/main/db/connection');
    const { runMigrations } = require('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    ipc = require('../../../src/main/ipc/placements').createPlacementsIpc(db);
    const places = require('../../../src/main/db/repositories/placements').createPlacementsRepo(db);
    const now = '2026-06-17T00:00:00Z';
    places.insert({ id: 'p1', job_id: 'j1', candidate_user_id: 'c1', primary_headhunter_id: 'h1', referrer_headhunter_id: null, anonymized_candidate_id: 'ca_1', annual_salary: 600000, platform_fee: 120000, primary_share: 120000, referrer_share: 0, candidate_bonus: 0, status: 'pending_payment', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('list returns placements', () => {
    const list = ipc.list({});
    expect(list.length).toBe(1);
  });

  it('markPaid updates status and logs admin action', () => {
    const result = ipc.markPaid('admin', 'p1');
    expect(result.status).toBe('paid');
    const log = require('../../../src/main/db/repositories/admin-action-log').createAdminActionLogRepo(db);
    const entries = log.listByTarget('placement', 'p1', {});
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe('mark_paid');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/ipc/placements.test.ts
```

- [ ] **Step 3: 实现 placements.ts**

`src/main/ipc/placements.ts`：
```typescript
import type { DB } from '../db/connection.js';
import { createPlacementsRepo } from '../db/repositories/placements.js';
import { createAdminActionLogRepo } from '../db/repositories/admin-action-log.js';
import { createCommissionHandler } from '../modules/commission/handler.js';
import { Errors } from '../errors.js';

export function createPlacementsIpc(db: DB) {
  const places = createPlacementsRepo(db);
  const adminLog = createAdminActionLogRepo(db);
  const commission = createCommissionHandler(db);

  return {
    list(filter: { status?: 'pending_payment' | 'paid' | 'cancelled' }): unknown[] {
      return places.listByEmployer('admin', filter);  // ⚠️ admin 看全部
    },
    markPaid(adminUserId: string, placementId: string): { id: string; status: 'paid' } {
      const result = commission.markPaid(adminUserId, placementId);
      return { id: result.id, status: result.status as 'paid' };
    },
    cancel(adminUserId: string, placementId: string): { id: string; status: 'cancelled' } {
      const p = places.findById(placementId);
      if (!p) throw Errors.notFound('Placement not found');
      if (p.status === 'paid') throw Errors.invalidState('Cannot cancel paid placement');
      places.updateStatus(placementId, 'cancelled');
      adminLog.insert({
        admin_user_id: adminUserId, action: 'cancel_placement',
        target_type: 'placement', target_id: placementId,
        details_json: JSON.stringify({ previous_status: p.status }),
      });
      return { id: placementId, status: 'cancelled' };
    },
    summary(): {
      pending_count: number; paid_count: number; total_paid_amount: number;
      total_platform_revenue: number; total_hunter_payout: number;
    } {
      const rows = db.prepare(
        "SELECT status, COUNT(*) as cnt, COALESCE(SUM(platform_fee), 0) as total_fee, COALESCE(SUM(primary_share), 0) as total_primary, COALESCE(SUM(referrer_share), 0) as total_referrer FROM placements GROUP BY status"
      ).all() as { status: string; cnt: number; total_fee: number; total_primary: number; total_referrer: number }[];
      let pending_count = 0, paid_count = 0, total_platform_revenue = 0, total_hunter_payout = 0;
      for (const r of rows) {
        if (r.status === 'pending_payment') pending_count = r.cnt;
        if (r.status === 'paid') paid_count = r.cnt;
        total_platform_revenue += r.total_fee;
        total_hunter_payout += r.total_primary + r.total_referrer;
      }
      return {
        pending_count, paid_count, total_paid_amount: total_hunter_payout,
        total_platform_revenue, total_hunter_payout,
      };
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/unit/ipc/placements.test.ts
```
Expected: 2 passed.

- [ ] **Step 5: 注册到 ipc/index.ts**

在 `src/main/ipc/index.ts` 追加：

```typescript
import { createPlacementsIpc } from './placements.js';

let placementsIpc: any;

// 在 registerAdminIpc() 内：
placementsIpc = createPlacementsIpc(db);

ipcMain.handle('admin:placements:list', (_e, filter) => placementsIpc.list(filter ?? {}));
ipcMain.handle('admin:placements:markPaid', (_e, { placement_id }) => placementsIpc.markPaid('admin', placement_id));
ipcMain.handle('admin:placements:cancel', (_e, { placement_id }) => placementsIpc.cancel('admin', placement_id));
ipcMain.handle('admin:placements:summary', () => placementsIpc.summary());
```

- [ ] **Step 6: 跑全部测试 + typecheck**

```bash
pnpm test
pnpm typecheck
```

- [ ] **Step 7: 提交**

```bash
git add src/main/ipc/placements.ts src/main/ipc/index.ts tests/unit/ipc/placements.test.ts
git commit -m "feat(admin): placements IPC (list/markPaid/cancel/summary) with admin log"
```

---

### Task 9: Admin action log IPC + CommissionBilling 页面

**Files:**
- Create: `src/main/ipc/admin-log.ts`
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/pages/CommissionBilling.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: 实现 admin-log.ts**

`src/main/ipc/admin-log.ts`：
```typescript
import type { DB } from '../db/connection.js';
import { createAdminActionLogRepo } from '../db/repositories/admin-action-log.js';

export function createAdminLogIpc(db: DB) {
  const log = createAdminActionLogRepo(db);
  return {
    list(filter: { admin_id?: string; target_type?: string; target_id?: string; limit?: number }): unknown[] {
      if (filter.target_type && filter.target_id) {
        return log.listByTarget(filter.target_type, filter.target_id, { limit: filter.limit });
      }
      if (filter.admin_id) {
        return log.listByAdmin(filter.admin_id, { limit: filter.limit });
      }
      return log.listAll({ limit: filter.limit ?? 200 });
    },
  };
}
```

- [ ] **Step 2: 注册到 ipc/index.ts**

追加：
```typescript
import { createAdminLogIpc } from './admin-log.js';

let adminLogIpc: any;
// 在 registerAdminIpc() 内：
adminLogIpc = createAdminLogIpc(db);
ipcMain.handle('admin:adminLog:list', (_e, filter) => adminLogIpc.list(filter ?? {}));
```

- [ ] **Step 3: 修改 preload 暴露新方法**

在 `src/preload/index.ts` 的 `admin` 对象内追加：

```typescript
    placements: {
      list: (filter: { status?: string }): Promise<any> =>
        ipcRenderer.invoke('admin:placements:list', filter),
      markPaid: (placement_id: string): Promise<any> =>
        ipcRenderer.invoke('admin:placements:markPaid', { placement_id }),
      cancel: (placement_id: string): Promise<any> =>
        ipcRenderer.invoke('admin:placements:cancel', { placement_id }),
      summary: (): Promise<any> => ipcRenderer.invoke('admin:placements:summary'),
    },
    adminLog: {
      list: (filter: { admin_id?: string; target_type?: string; target_id?: string; limit?: number }): Promise<any> =>
        ipcRenderer.invoke('admin:adminLog:list', filter),
    },
```

- [ ] **Step 4: 实现 CommissionBilling 页面**

`src/renderer/src/pages/CommissionBilling.tsx`：
```typescript
import { useEffect, useState } from 'react';

interface Placement {
  id: string;
  job_id: string;
  candidate_user_id: string;
  primary_headhunter_id: string;
  referrer_headhunter_id: string | null;
  annual_salary: number;
  platform_fee: number;
  primary_share: number;
  referrer_share: number;
  status: 'pending_payment' | 'paid' | 'cancelled';
  created_at: string;
}

interface Summary {
  pending_count: number; paid_count: number; total_paid_amount: number;
  total_platform_revenue: number; total_hunter_payout: number;
}

export default function CommissionBilling(): JSX.Element {
  const [list, setList] = useState<Placement[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = async () => {
    setError(null); setInfo(null);
    const [r1, r2] = await Promise.all([
      window.api.admin.placements.list({}),
      window.api.admin.placements.summary(),
    ]);
    if (r1.ok) setList(r1.data); else setError(r1.error?.message);
    if (r2.ok) setSummary(r2.data); else setError(r2.error?.message);
  };

  useEffect(() => { void load(); }, []);

  const markPaid = async (id: string) => {
    if (!confirm(`Mark ${id} as paid?`)) return;
    const r = await window.api.admin.placements.markPaid(id);
    if (r.ok) { setInfo(`Marked ${id} as paid`); await load(); }
    else setError(r.error?.message);
  };

  const cancel = async (id: string) => {
    if (!confirm(`Cancel ${id}?`)) return;
    const r = await window.api.admin.placements.cancel(id);
    if (r.ok) { setInfo(`Cancelled ${id}`); await load(); }
    else setError(r.error?.message);
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>佣金账单</h1>
      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}
      {summary && (
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <div className="stat"><div className="label">待结算</div><div className="value">{summary.pending_count}</div></div>
          <div className="stat"><div className="label">已结算</div><div className="value">{summary.paid_count}</div></div>
          <div className="stat"><div className="label">平台收入</div><div className="value">¥{summary.total_platform_revenue.toLocaleString()}</div></div>
          <div className="stat"><div className="label">猎头已付</div><div className="value">¥{summary.total_hunter_payout.toLocaleString()}</div></div>
        </div>
      )}
      <div className="card">
        <button onClick={load}>刷新</button>
        <table>
          <thead><tr><th>ID</th><th>职位</th><th>候选人</th><th>猎头</th><th>年薪</th><th>平台费</th><th>猎头分成</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td><code>{p.id}</code></td>
                <td><code>{p.job_id.slice(0, 12)}</code></td>
                <td><code>{p.candidate_user_id.slice(0, 12)}</code></td>
                <td><code>{p.primary_headhunter_id.slice(0, 12)}</code></td>
                <td>¥{p.annual_salary.toLocaleString()}</td>
                <td>¥{p.platform_fee.toLocaleString()}</td>
                <td>¥{(p.primary_share + p.referrer_share).toLocaleString()}</td>
                <td>{p.status}</td>
                <td>
                  {p.status === 'pending_payment' && (
                    <>
                      <button onClick={() => markPaid(p.id)}>标记已付</button>
                      <button className="danger" style={{ marginLeft: 4 }} onClick={() => cancel(p.id)}>取消</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 实现 AdminActionsLog 页面**

`src/renderer/src/pages/AdminActionsLog.tsx`：
```typescript
import { useEffect, useState } from 'react';

interface AdminLogEntry {
  id: number;
  admin_user_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details_json: string | null;
  created_at: string;
}

export default function AdminActionsLog(): JSX.Element {
  const [list, setList] = useState<AdminLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const r = await window.api.admin.adminLog.list({});
    if (r.ok) setList(r.data);
    else setError(r.error?.message);
  };

  useEffect(() => { void load(); }, []);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>管理员操作日志</h1>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <button onClick={load}>刷新</button>
        <p style={{ fontSize: 12, color: '#64748b' }}>记录 admin 执行的 suspend / adjustQuota / markPaid / cancel / remove 等操作</p>
        <table>
          <thead><tr><th>时间</th><th>动作</th><th>目标类型</th><th>目标</th><th>详情</th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td><code>{e.action}</code></td>
                <td>{e.target_type ?? '—'}</td>
                <td><code>{e.target_id?.slice(0, 16) ?? '—'}</code></td>
                <td><code style={{ fontSize: 11 }}>{e.details_json?.slice(0, 60) ?? '—'}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 修改 Sidebar 导航**

修改 `src/renderer/src/components/Sidebar.tsx`：

```typescript
export type PageName = 'dashboard' | 'users' | 'candidates' | 'audit' | 'webhooks' | 'rateLimit' | 'config' | 'billing' | 'adminLog';

export const PAGE_TITLES: Record<PageName, string> = {
  // ... 原有 7 个
  billing: '佣金账单',
  adminLog: '管理员操作',
};

export const PAGE_ORDER: PageName[] = ['dashboard', 'users', 'candidates', 'audit', 'webhooks', 'rateLimit', 'billing', 'adminLog', 'config'];
```

- [ ] **Step 7: 修改 App.tsx 注册新页面**

```typescript
import CommissionBilling from './pages/CommissionBilling';
import AdminActionsLog from './pages/AdminActionsLog';

const PAGES: Record<PageName, () => JSX.Element> = {
  // ... 原有 7 个
  billing: CommissionBilling,
  adminLog: AdminActionsLog,
  config: ConfigCenter,
};
```

- [ ] **Step 8: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 9: 提交**

```bash
git add src/main/ipc/admin-log.ts src/main/ipc/index.ts src/preload/index.ts src/renderer/src/pages/CommissionBilling.tsx src/renderer/src/pages/AdminActionsLog.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx
git commit -m "feat(admin): CommissionBilling + AdminActionsLog pages + IPC"
```

---

## Milestone 4.E：OpenAPI 文档 + E2E

### Task 10: OpenAPI 文档生成（手动 + zod）

**Files:**
- Create: `docs/superpowers/openapi.json`
- Modify: `docs/superpowers/skill.md`（追加 OpenAPI 链接）

- [ ] **Step 1: 写失败测试**

`tests/integration/openapi.test.ts`：
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('OpenAPI documentation', () => {
  const testDb = path.join(__dirname, '../../tmp/openapi.db');
  const openapiPath = path.join(__dirname, '../../../docs/superpowers/openapi.json');

  beforeAll(() => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('openapi.json exists and is valid JSON', () => {
    expect(fs.existsSync(openapiPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
    expect(content.openapi).toBe('3.0.0');
    expect(content.paths['/v1/auth/register']).toBeDefined();
    expect(content.paths['/v1/employer/placements']).toBeDefined();
  });

  it('GET /v1/openapi.json returns 200 (server endpoint)', async () => {
    const request = (await import('supertest')).default;
    const { createApp } = await import('../../../src/main/server');
    const app = createApp();
    const res = await request(app).get('/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/integration/openapi.test.ts
```

- [ ] **Step 3: 写 OpenAPI 文档**

创建 `docs/superpowers/openapi.json`（基于现有 zod schema + 路径手写）：

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "Hunter Platform API",
    "version": "1.0.0",
    "description": "猎头中介 API 平台。详细见 skill.md。"
  },
  "servers": [{ "url": "https://api.hunter-platform.com/v1", "description": "Production" }],
  "components": {
    "securitySchemes": {
      "ApiKey": { "type": "http", "scheme": "bearer" }
    },
    "schemas": {
      "User": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "user_type": { "type": "string", "enum": ["candidate", "headhunter", "employer"] },
          "name": { "type": "string" },
          "contact": { "type": ["string", "null"] },
          "agent_endpoint": { "type": ["string", "null"] },
          "quota_per_day": { "type": "integer" },
          "quota_used": { "type": "integer" },
          "reputation": { "type": "integer" },
          "status": { "type": "string", "enum": ["active", "suspended", "deleted"] },
          "created_at": { "type": "string", "format": "date-time" }
        }
      },
      "AnonymizedCandidate": {
        "type": "object",
        "properties": {
          "industry": { "type": ["string", "null"] },
          "title_level": { "type": ["string", "null"] },
          "years_experience": { "type": ["integer", "null"] },
          "salary_range": { "type": ["string", "null"] },
          "education_tier": { "type": ["string", "null"] },
          "skills": { "type": "array", "items": { "type": "string" } }
        }
      },
      "Placement": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "job_id": { "type": "string" },
          "candidate_user_id": { "type": "string" },
          "primary_headhunter_id": { "type": "string" },
          "referrer_headhunter_id": { "type": ["string", "null"] },
          "annual_salary": { "type": "integer" },
          "platform_fee": { "type": "integer" },
          "primary_share": { "type": "integer" },
          "referrer_share": { "type": "integer" },
          "status": { "type": "string", "enum": ["pending_payment", "paid", "cancelled"] }
        }
      },
      "ErrorResponse": {
        "type": "object",
        "properties": {
          "ok": { "type": "boolean", "enum": [false] },
          "error": {
            "type": "object",
            "properties": {
              "code": { "type": "string" },
              "message": { "type": "string" },
              "details": { "type": "object" }
            }
          }
        }
      }
    }
  },
  "security": [{ "ApiKey": [] }],
  "paths": {
    "/auth/register": {
      "post": {
        "summary": "注册用户",
        "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "required": ["user_type", "name"], "properties": { "user_type": { "type": "string", "enum": ["candidate", "headhunter", "employer"] }, "name": { "type": "string" }, "contact": { "type": "string" }, "agent_endpoint": { "type": "string", "format": "uri" } } } } } },
        "responses": { "200": { "description": "OK", "content": { "application/json": { "schema": { "type": "object", "properties": { "ok": { "type": "boolean" }, "data": { "type": "object", "properties": { "user_id": { "type": "string" }, "api_key": { "type": "string" }, "quota_per_day": { "type": "integer" }, "user_type": { "type": "string" } } } } } } } }
      }
    },
    "/users/{id}/status": { "get": { "summary": "查询用户状态", "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }], "responses": { "200": { "description": "OK" } } } },
    "/headhunter/candidates": {
      "post": { "summary": "上传候选人（自动脱敏）", "responses": { "200": { "description": "OK", "content": { "application/json": { "schema": { "type": "object", "properties": { "anonymized_id": { "type": "string" }, "preview": { "$ref": "#/components/schemas/AnonymizedCandidate" } } } } } } } },
      "get": { "summary": "我的候选人列表", "responses": { "200": { "description": "OK" } } }
    },
    "/headhunter/recommendations": {
      "post": { "summary": "推荐给雇主", "responses": { "200": { "description": "OK" } } },
      "get": { "summary": "我的推荐列表", "responses": { "200": { "description": "OK" } } }
    },
    "/headhunter/candidates/{id}/publish-to-pool": { "post": { "summary": "发布到公开池", "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }], "responses": { "200": { "description": "OK" } } } },
    "/headhunter/recommendations/{id}/withdraw": { "post": { "summary": "撤回推荐", "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }], "responses": { "200": { "description": "OK" } } } },
    "/employer/jobs": {
      "post": { "summary": "创建职位", "responses": { "200": { "description": "OK" } } },
      "get": { "summary": "我的职位列表", "responses": { "200": { "description": "OK" } } }
    },
    "/employer/talent": { "get": { "summary": "浏览脱敏人才池", "responses": { "200": { "description": "OK" } } } },
    "/employer/recommendations/{id}/express-interest": { "post": { "summary": "表达兴趣", "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }], "responses": { "200": { "description": "OK" } } } },
    "/employer/recommendations/{id}/unlock-contact": { "post": { "summary": "解锁联系方式", "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }], "responses": { "200": { "description": "OK" } } } },
    "/employer/placements": {
      "post": {
        "summary": "创建入职记录（自动计算佣金）",
        "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "required": ["anonymized_candidate_id", "job_id", "annual_salary"], "properties": { "anonymized_candidate_id": { "type": "string" }, "job_id": { "type": "string" }, "annual_salary": { "type": "integer" } } } } },
        "responses": { "200": { "description": "OK", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Placement" } } } } }
      },
      "get": { "summary": "我的入职记录列表", "responses": { "200": { "description": "OK" } } }
    },
    "/candidate/opportunities": { "get": { "summary": "查看匹配机会", "responses": { "200": { "description": "OK" } } } },
    "/candidate/recommendations/{id}/approve-unlock": { "post": { "summary": "授权解锁", "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }], "responses": { "200": { "description": "OK" } } } },
    "/candidate/recommendations/{id}/reject-unlock": { "post": { "summary": "拒绝解锁", "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }], "responses": { "200": { "description": "OK" } } } },
    "/candidate/export-my-data": { "get": { "summary": "GDPR 数据导出（GDPR Article 20）", "responses": { "200": { "description": "OK", "content": { "application/json": { "schema": { "type": "object" } } } } } } },
    "/candidate/delete-my-data": { "post": { "summary": "GDPR 撤回（GDPR Article 17）", "responses": { "200": { "description": "OK" } } } },
    "/skill.md": { "get": { "summary": "skill.md 集成文档", "responses": { "200": { "description": "Markdown" } } } },
    "/health": { "get": { "summary": "健康检查", "responses": { "200": { "description": "OK" } } } }
  }
}
```

- [ ] **Step 4: 在 server.ts 暴露 /v1/openapi.json**

修改 `src/main/server.ts` 的 `createAppFromDb`，在 skill.md 端点后追加：

```typescript
  const openapiPath = path.join(process.cwd(), 'docs/superpowers/openapi.json');
  app.get('/v1/openapi.json', (_req, res) => {
    try {
      const content = fs.readFileSync(openapiPath, 'utf8');
      res.type('application/json').send(content);
    } catch {
      res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'openapi.json not found' } });
    }
  });
```

- [ ] **Step 5: 跑测试**

```bash
pnpm test tests/integration/openapi.test.ts
```
Expected: 2 passed.

- [ ] **Step 6: 提交**

```bash
git add docs/superpowers/openapi.json src/main/server.ts tests/integration/openapi.test.ts
git commit -m "docs(api): OpenAPI 3.0 spec + GET /v1/openapi.json endpoint"
```

---

### Task 11: M4 端到端集成测试

**Files:**
- Create: `tests/integration/e2e-m4.test.ts`

- [ ] **Step 1: 写测试**

`tests/integration/e2e-m4.test.ts`：
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('M4 E2E: placement + GDPR + admin billing', () => {
  const testDb = path.join(__dirname, '../../tmp/e2e-m4.db');
  let app: any;
  let employerKey: string, employerId: string;
  let headhunterKey: string;
  let candidateKey: string, candidateId: string;
  let jobId: string, anonymizedId: string, recId: string, placementId: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = require('../../src/main/server');
    app = createApp();

    // Setup: 3 users + candidate + job + recommendation + 4-step unlock
    const e = await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E', contact: 'e@x.com' });
    employerKey = e.body.data.api_key; employerId = e.body.data.user_id;
    const h = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H', contact: 'h@x.com' });
    headhunterKey = h.body.data.api_key;
    const c = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C', contact: 'c@x.com' });
    candidateKey = c.body.data.api_key; candidateId = c.body.data.user_id;
    const up = await request(app).post('/v1/headhunter/candidates').set('Authorization', `Bearer ${headhunterKey}`).send({
      candidate_user_id: candidateId, name: '张三', phone: '13800138000', email: 'z@x.com',
      current_company: '字节跳动', current_title: 'P6', expected_salary: 800000, years_experience: 8, education_school: '清华', skills: ['React'],
    });
    anonymizedId = up.body.data.anonymized_id;
    const job = await request(app).post('/v1/employer/jobs').set('Authorization', `Bearer ${employerKey}`).send({ title: 'Senior FE' });
    jobId = job.body.data.id;
    const rec = await request(app).post('/v1/headhunter/recommendations').set('Authorization', `Bearer ${headhunterKey}`).send({ anonymized_candidate_id: anonymizedId, job_id: jobId });
    recId = rec.body.data.id;
    await request(app).post(`/v1/employer/recommendations/${recId}/express-interest`).set('Authorization', `Bearer ${employerKey}`);
    await request(app).post(`/v1/candidate/recommendations/${recId}/approve-unlock`).set('Authorization', `Bearer ${candidateKey}`);
    await request(app).post(`/v1/employer/recommendations/${recId}/unlock-contact`).set('Authorization', `Bearer ${employerKey}`);
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('employer creates placement with computed commission', async () => {
    const r = await request(app).post('/v1/employer/placements').set('Authorization', `Bearer ${employerKey}`).send({
      anonymized_candidate_id: anonymizedId, job_id: jobId, annual_salary: 1_200_000,
    });
    expect(r.status).toBe(200);
    expect(r.body.data.platform_fee).toBe(240_000);
    expect(r.body.data.primary_share).toBe(240_000);
    expect(r.body.data.status).toBe('pending_payment');
    placementId = r.body.data.id;
  });

  it('rejects duplicate placement (P1#4)', async () => {
    const r = await request(app).post('/v1/employer/placements').set('Authorization', `Bearer ${employerKey}`).send({
      anonymized_candidate_id: anonymizedId, job_id: jobId, annual_salary: 1_200_000,
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('candidate can export all their data (GDPR)', async () => {
    const r = await request(app).get('/v1/candidate/export-my-data').set('Authorization', `Bearer ${candidateKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.user.id).toBe(candidateId);
    expect(r.body.data.candidates_private.length).toBeGreaterThan(0);
    expect(r.body.data.candidates_private[0].name).toBe('张三');   // decrypted
    expect(r.body.data.candidates_private[0].phone).toBe('13800138000');
  });

  it('GET /v1/openapi.json returns valid OpenAPI 3.0', async () => {
    const r = await request(app).get('/v1/openapi.json');
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe('3.0.0');
    expect(r.body.paths['/v1/employer/placements']).toBeDefined();
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test tests/integration/e2e-m4.test.ts
```
Expected: 4 passed.

- [ ] **Step 3: 跑全部测试 + typecheck**

```bash
pnpm test
pnpm typecheck
```
Expected: 130+ passed (110 + 20+ new), 0 errors.

- [ ] **Step 4: 提交 + 打 tag**

```bash
git add tests/integration/e2e-m4.test.ts
git commit -m "test(e2e): M4 placement + GDPR + OpenAPI flow"
git tag -a m4-complete -m "Milestone 4 complete: commission + audit + GDPR + OpenAPI"
```

---

## ✅ M4 验收标准

M4 完成的定义（"Done"）：

- [ ] `pnpm test` 全部通过（130+ 测试）
- [ ] `pnpm typecheck` 0 错误
- [ ] `POST /v1/employer/placements` 创建成功，佣金自动计算
- [ ] P1#4 UNIQUE 约束生效（重复创建返回错误）
- [ ] 雇主可查询自己的 placements 列表
- [ ] Admin 可 `mark_paid` / `cancel` placement（写 admin_action_log）
- [ ] `GET /v1/candidate/export-my-data` 返回解密 PII
- [ ] `GET /v1/openapi.json` 返回 valid OpenAPI 3.0
- [ ] 管理后台新增 **佣金账单** 页面 + **管理员操作** 页面
- [ ] Tag `m4-complete` 已打

## 📋 P1/P2 Bug 覆盖状态

| Bug | 状态 |
|-----|------|
| P1#4 placements UNIQUE | ✅ M4 Task 1 |
| P1#13 加密密钥轮换 | ⏳ v2 |
| P1#14 技能搜索性能 | ⏳ M5 |
| P2 日志归档 | ⏳ v2（admin_action_log 已存）|
| P2 GDPR 导出 | ✅ M4 Task 7 |
| P2 Convo 多管理员 | ⏳ v2（单 admin 够用）|

## 🚀 下一步（M5）

- **M5 plan**: Webhook Worker 优化 + k6 压测 + 性能监控（prom-client）+ 加密密钥轮换基础
