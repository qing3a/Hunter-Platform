# Headhunter-Created Jobs — Spec

**状态**: Draft
**日期**: 2026-06-20
**作者**: brainstorming session
**前置**: [2026-06-18-marketplace-landing.md](./2026-06-18-marketplace-landing.md) (jobs 表起源), [2026-06-20-landing-v3-redesign.md](./2026-06-20-landing-v3-redesign.md) (公开页 SQL 依赖)

---

## 1. 概述

### 1.1 一句话定义

允许**猎头**为**雇主**创建岗位（`POST /v1/headhunter/jobs`），岗位创建后 `employer_id=NULL`、`source_headhunter_id=猎头`、`status=open`，由雇主事后认领 (`POST /v1/employer/claim-jobs/:id`) 或拒绝 (`POST /v1/employer/reject-jobs/:id`)；未认领的岗位在公开页隐藏。认领后的推荐若推荐者 ≠ 建岗者，佣金按 70%（推荐者）/ 30%（建岗者）拆账。

### 1.2 触发原因

当前仅 `POST /v1/employer/jobs` 入口创建岗位，猎头无法主动发起合作。当一个**新雇主**加入平台但尚未熟悉 API 时，常依赖其信任的猎头"代发岗位"——而现有设计不支持这种自然工作流。

### 1.3 目标

1. 猎头能通过 `POST /v1/headhunter/jobs` 代建岗位
2. 雇主能通过 `GET /v1/employer/pending-claims` 看到属于自己的待认领列表
3. 雇主能 claim 或 reject 待认领 job；claim 后 `employer_id=雇主`，正常进入 marketplace
4. 未认领 job 在 landing 公开页 / `GET /v1/market/jobs` 隐藏
5. 推荐者 ≠ 建岗者时，佣金按 70/30 拆账（推荐者/建岗者）
6. 推荐者 = 建岗者时，100% 给本人（避免自付）

### 1.4 非目标

- ❌ 猎头编辑/关闭/删除已认领岗位（owner 是雇主，猎头只建不管后续）
- ❌ 拒绝后"重新激活"（让猎头重新 POST 即可）
- ❌ 猎头-雇主 IM / 站内信（webhook + agent 自己处理）
- ❌ 批量建岗
- ❌ 草稿模式（直接 open，未认领 = 隐藏）
- ❌ 雇主对猎头的"信任/拉黑"表（开放模型，不需要）
- ❌ 自动 cron 清理长期未认领 job
- ❌ 跨境/多语言的"建岗模板"（YAGNI）

---

## 2. 视觉设计

后端功能，无 UI 改动。`GET /` 公开页和 `GET /v1/market/jobs` 的 SQL 加 `AND j.employer_id IS NOT NULL` 即可，无需新增 UI 元素（"代发"徽章不做，因为未认领的就根本不显示）。

---

## 3. 数据来源

### 3.1 Schema 变更（migration v009）

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

**字段语义**：
- `source_headhunter_id` — 谁建岗（仅当猎头建时 NOT NULL）
- `created_for_employer_id` — 猎头指定的目标雇主（可空 → 任何 employer 可 claim）
- CHECK 约束保证语义不冲突：不会同时有"雇主直发 + source=猎头"，也不会"猎头建 + 雇主 ID 空"

### 3.2 公开页 SQL 补丁

`src/main/modules/view/gather-landing-data.ts` 中 recentJobs 查询（Phase 1 改造时写的）需要补：

```typescript
// 现状（gather-landing-data.ts 内的 recentJobs 查询）:
SELECT title, industry, salary_min, salary_max, required_skills_json
FROM jobs WHERE status = 'open' ORDER BY created_at DESC LIMIT 5

// 改为:
SELECT title, industry, salary_min, salary_max, required_skills_json
FROM jobs
WHERE status = 'open' AND employer_id IS NOT NULL   -- 新增这一行
ORDER BY created_at DESC LIMIT 5
```

`src/main/routes/market.ts` 同样改。`src/main/modules/view/gather-landing-data.ts` 不需要改 `openJobsCount` 字段（数字包含未认领是合理的——体现"猎头在建岗"的市场活力），但需要决定：landing 上的"在招岗位: X" 是**全部**还是**仅已认领**？本 spec 选择**包含未认领**（数据准确反映市场活动）。

### 3.3 类型扩展

`src/shared/types.ts`:

```typescript
export interface Job {
  id: string;
  employer_id: string | null;          // 改 nullable
  source_headhunter_id: string | null;  // 新增
  created_for_employer_id: string | null;  // 新增
  title: string;
  description: string | null;
  required_skills: string[];
  salary_min: number | null;
  salary_max: number | null;
  status: 'open' | 'paused' | 'closed' | 'filled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  deadline: string | null;
  industry: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## 4. 文件变更

### 4.1 新增

| 文件 | 用途 | 估算行数 |
|---|---|---|
| `src/main/db/migrations/v009_headhunter_created_jobs.sql` | Schema 迁移 | ~40 |
| `tests/unit/jobs-repo.test.ts` | jobs 表 CHECK 约束 / nullable 单元测试 | ~80 |
| `tests/unit/commission-split.test.ts` | 70/30 拆账 + 同人 100% + 雇主直发老逻辑 | ~100 |
| `tests/integration/headhunter-create-job.test.ts` | 4-5 个端点集成测试 | ~150 |
| `tests/integration/employer-claim-reject.test.ts` | 4-5 个端点集成测试 | ~150 |
| `tests/integration/headhunter-jobs-visibility.test.ts` | 公开页 / market 隐藏未认领 | ~80 |
| `tests/integration/commission-headhunter-created.test.ts` | 端到端佣金拆账 | ~120 |

### 4.2 修改

| 文件 | 改动 | 估算行数 |
|---|---|---|
| `src/main/modules/headhunter/handler.ts` | 加 `createJobForEmployer`, `listMyCreatedJobs` 函数 | +50 |
| `src/main/modules/employer/handler.ts` | 加 `claimJob`, `rejectJob`, `listPendingClaims` 函数 | +70 |
| `src/main/modules/commission/handler.ts` | `createPlacement` 入参逻辑分支（见 §5.4）| +15 |
| `src/main/modules/commission/calculator.ts` | 无需改（已支持 `referrer_headhunter_id` 透传）| 0 |
| `src/main/routes/headhunter.ts` | 加 `POST /jobs` + `GET /jobs` 路由 | +15 |
| `src/main/routes/employer.ts` | 加 `GET /pending-claims` + `POST /claim-jobs/:id` + `POST /reject-jobs/:id` 路由 | +25 |
| `src/main/routes/market.ts` | jobs 查询加 `AND employer_id IS NOT NULL` | +1 |
| `src/main/modules/view/gather-landing-data.ts` | recentJobs SQL 加 `AND employer_id IS NOT NULL` | +1 |
| `src/main/db/repositories/jobs.ts` | insert/upsert 函数加新字段；新增 `findPendingClaims(employerId)`, `findBySourceHeadhunter(headhunterId)`, `findClaimableByEmployer(employerId)` | +60 |
| `src/shared/types.ts` | `Job.employer_id` 改 nullable；加 2 个新字段 | +3 |
| `src/shared/constants.ts` | 加 `COMMISSION_SPLIT_HEADHUNTER_CREATED = { recommender: 0.7, creator: 0.3 }` | +3 |

### 4.3 不动

- `users` 表 / 注册流
- `candidates_private` / `candidates_anonymized` 表
- `recommendations` 表（commission 改造不影响 recommendations 表本身）
- `placements` 表
- 其他所有 module（register, audit, metrics, webhook, view 等）

---

## 5. 数据流

### 5.1 猎头创建岗位

```
POST /v1/headhunter/jobs  { created_for_employer_id?, title, ... }
  ↓
authMiddleware (user_type=headhunter)
  ↓
rate-limit middleware
  ↓
handler.createJobForEmployer(headhunter, input)
  ├─ quota.tryConsume(headhunter.id, QUOTA_COSTS.create_job)
  │   ├─ 不足 → 429
  │   └─ 足 → 继续
  ├─ [可选] 校验 created_for_employer_id 指向的用户 user_type='employer'
  ├─ 构造 Job { employer_id: null, source_headhunter_id: headhunter.id,
  │            created_for_employer_id, status: 'open', ... }
  └─ jobsRepo.insert(job)
  ↓
200 { ok: true, data: Job }
```

### 5.2 雇主认领

```
POST /v1/employer/claim-jobs/:id
  ↓
authMiddleware (user_type=employer)
  ↓
handler.claimJob(employer, { job_id })
  ├─ 读 jobsRepo.findById(job_id)
  │   ├─ 不存在 → 404
  │   ├─ status != 'open' → 409 INVALID_STATE
  │   ├─ employer_id != null → 409 INVALID_STATE (已被认领)
  │   └─ created_for_employer_id != null AND != employer.id → 403 FORBIDDEN
  ├─ UPDATE jobs SET employer_id = employer.id, updated_at = now
  └─ action_history insert (action='claim_job', target=job)
  ↓
200 { ok: true, data: Job }
```

### 5.3 雇主拒绝

```
POST /v1/employer/reject-jobs/:id  { reason? }
  ↓
authMiddleware (user_type=employer)
  ↓
handler.rejectJob(employer, { job_id, reason })
  ├─ 校验同 5.2（除 employer_id 校验：可能 employer_id=null 但 created_for 必须=me）
  ├─ UPDATE jobs SET status='closed', updated_at=now
  └─ action_history insert (action='reject_job', target=job, request_summary=reason)
  ↓
200 { ok: true, data: { status: 'closed' } }
```

### 5.4 佣金 70/30 拆账（placement 时触发）

修改 `src/main/modules/commission/calculator.ts` 的 `calculateCommission` 函数（或其调用方 `handler.ts` 的 `createPlacement`），加入 source_headhunter_id 维度的判断。

```
推荐候选人 → employer.expressInterest → 候选人 approve → employer.unlockContact
  → placement 创建 (handler.ts:37)
    ↓
createPlacement 中调用 calculateCommission 的入参逻辑改为:

let commissionInput;
if (job.source_headhunter_id != null) {
  if (job.source_headhunter_id === rec.headhunter_id) {
    // 同人(建岗猎头=推荐猎头)：100% 给本人, 避免自付
    commissionInput = { annual_salary, referrer_headhunter_id: null };
  } else {
    // 跨人(猎头A建岗, 猎头B推荐)：70% B / 30% A
    // 注: "job creator 优先于 referral chain"，即使 rec.referrer_headhunter_id 存在，
    //   30% 也给 job creator，原 referrer 拿 0。
    commissionInput = { annual_salary, referrer_headhunter_id: job.source_headhunter_id };
  }
} else {
  // 雇主直发岗位：老逻辑
  commissionInput = { annual_salary, referrer_headhunter_id: rec.referrer_headhunter_id };
}

const commission = calculateCommission(commissionInput);
  ↓
placements 表写入:
  - primary_headhunter_id    = rec.headhunter_id          (70%)
  - referrer_headhunter_id   = job.source_headhunter_id  (30%, 当且仅当跨人) | null (同人/雇主直发)
  - primary_share            = 70% of platform_fee
  - referrer_share           = 30% of platform_fee (or 0)
  - platform_fee             = 20% of clamped salary
```

**角色映射表**（避免歧义）：

| 场景 | primary (70%) | referrer (30%) | 备注 |
|---|---|---|---|
| 猎头 A 建岗, 猎头 A 推荐, 雇主 E 认领 | A | 0 (无 referrer) | 同人 100% |
| 猎头 A 建岗, 猎头 B 推荐, 雇主 E 认领 | B (70%) | A (30%) | **job creator 替代 referral chain** |
| 猎头 A 建岗, 猎头 B 推荐, 猎头 C referral B, 雇主 E 认领 | B (70%) | A (30%, C 拿 0) | 三方情况下 C 被覆盖 |
| 雇主 E 直发, 猎头 B 推荐, 无 referrer | B (100%) | 0 | 雇主直发老逻辑 |
| 雇主 E 直发, 猎头 B 推荐, 猎头 C referral B | B (70%) | C (30%) | 老 referral 逻辑 |
| 猎头 A 建岗, 猎头 A 推荐, 猎头 C referral A | A (100%) | 0 (referral 链被同人情覆盖) | 同人优先 |

---

## 6. 错误处理

| 错误码 | 触发 | HTTP | 测试覆盖 |
|---|---|---|---|
| `INVALID_PARAMS` | 请求体缺字段、字段超长、`salary_min > salary_max` | 400 | ✓ |
| `FORBIDDEN` | 猎头给非 employer 建岗（`created_for_employer_id` 指向 headhunter/candidate user）；雇主认领不属于自己的待领；非 headhunter 调 `POST /v1/headhunter/jobs` | 403 | ✓ |
| `NOT_FOUND` | `job_id` 不存在；`created_for_employer_id` 指向不存在的 user | 404 | ✓ |
| `INSUFFICIENT_QUOTA` | 猎头 quota 不足 | 429 | ✓ |
| `INVALID_STATE` | `job.status != 'open'` 时认领/拒绝（已 closed/filled 不可再操作）| 409 | ✓ |
| `INVALID_STATE` | 已被认领（`employer_id != null`）的 job 再次 claim | 409 (idempotent? 决定 200 no-op) | ✓ |

**idempotency 决策**：claim 端点对"已认领 + 是自己"返回 200 no-op；对"已认领 + 是别人"返回 409。这样 UI 处理简单。

DB 操作包在 BEGIN/COMMIT 里（沿用现有 `node:sqlite` 模式，无显式 transaction API）。

---

## 7. 测试策略

### 7.1 单元测试

- `tests/unit/jobs-repo.test.ts`:
  - CHECK 约束：违反 `(source NOT NULL AND employer_id NULL)` 模式 → DB 抛错
  - `insert` + `findById` 往返一致性（含 nullable 字段）
  - `findPendingClaims(employerId)` 只返回 `created_for_employer_id=me AND status=open AND employer_id IS NULL`
  - `findBySourceHeadhunter(headhunterId)` 只返回 `source_headhunter_id=me`

- `tests/unit/commission-split.test.ts`:
  - 拆账函数纯函数测试：4 种 case（猎头建/雇主直发 × 推荐者同人/不同人）
  - 边界：`source_headhunter_id=null` 时用老逻辑

### 7.2 集成测试

- `tests/integration/headhunter-create-job.test.ts`:
  1. headhunter 创建成功 + quota 扣减
  2. headhunter 不指定 `created_for_employer_id` → 200，job 入库
  3. headhunter quota 不足 → 429
  4. employer 调 `POST /v1/headhunter/jobs` → 403
  5. `GET /v1/headhunter/jobs` 只返回自己创建的

- `tests/integration/employer-claim-reject.test.ts`:
  1. 雇主认领属于自己的待领 → 200
  2. 雇主认领不属于自己（`created_for_employer_id=其他 employer`）→ 403
  3. 雇主认领无 `created_for_employer_id` 的开放 job（开放精神）→ 200
  4. 雇主拒绝 → status='closed'
  5. 拒绝后 `GET /pending-claims` 不再返回
  6. 同一 employer 重复 claim 自己的 job → 200 no-op
  7. employer A 拒绝 → employer B 认领 → 403 (已 closed)

- `tests/integration/headhunter-jobs-visibility.test.ts`:
  1. landing page 不显示未认领的（`employer_id=NULL`）
  2. `GET /v1/market/jobs` 不返回未认领的
  3. 认领后立即在 landing 出现
  4. 拒绝后从 landing 消失

- `tests/integration/commission-headhunter-created.test.ts`:
  1. 猎头 A 建 + 雇主 E 认领 + 猎头 B 推荐 + 入职 → 推荐 70% / 建岗 30%
  2. 猎头 A 建 + 猎头 A 自己推荐 + 入职 → 100% A
  3. 雇主 E 直发 + 猎头 B 推荐 + 入职 → 100% B（老逻辑回归）
  4. 猎头 A 建 + 猎头 B 推荐 + 雇主 E 未认领就 unlock → 走老逻辑还是禁止？（spec 决策：禁止，recommendation 关联 employer_id=NULL 无意义）

### 7.3 现有测试回归

- `tests/integration/employer-handler.test.ts` — 现有 `createJob` 必须继续通过
- `tests/integration/landing.test.ts` — 现有"shows real open job count"测试要继续通过
- `tests/integration/e2e.test.ts` — 端到端流程不能挂
- `tests/unit/reposition-checks.test.ts` — commission 老逻辑回归

### 7.4 视觉测试

- **不做**（无 UI 改动）

---

## 8. 实现路径

### 8.1 任务分解（5 个 phase）

**Phase 1: Schema 迁移**
- T1.1: 写 v009 SQL 文件（含 CHECK 约束、索引）
- T1.2: 单元测试 `tests/unit/jobs-repo.test.ts` 验证 CHECK 约束生效
- T1.3: 跑现有所有测试确保 schema 迁移没破现有功能

**Phase 2: 类型与共享常量**
- T2.1: 修改 `src/shared/types.ts` — `Job.employer_id` nullable + 2 个新字段
- T2.2: 修改 `src/shared/constants.ts` — 加 `COMMISSION_SPLIT_HEADHUNTER_CREATED`

**Phase 3: 端点实现（headhunter）**
- T3.1: 修改 `src/main/modules/headhunter/handler.ts` — 加 `createJobForEmployer`, `listMyCreatedJobs`
- T3.2: 修改 `src/main/routes/headhunter.ts` — 加 `POST /jobs` + `GET /jobs`
- T3.3: 集成测试 `headhunter-create-job.test.ts`

**Phase 4: 端点实现（employer claim/reject）**
- T4.1: 修改 `src/main/modules/employer/handler.ts` — 加 `claimJob`, `rejectJob`, `listPendingClaims`
- T4.2: 修改 `src/main/db/repositories/jobs.ts` — 加 3 个查询函数
- T4.3: 修改 `src/main/routes/employer.ts` — 加 3 个新路由
- T4.4: 集成测试 `employer-claim-reject.test.ts`

**Phase 5: 公开页 SQL + 佣金改造**
- T5.1: 修改 `gather-landing-data.ts` + `market.ts` — 加 `AND employer_id IS NOT NULL`
- T5.2: 修改 `commission/handler.ts` 的 `createPlacement` — 加 70/30 拆账分支（`calculator.ts` 不动）
- T5.3: 集成测试 `headhunter-jobs-visibility.test.ts` + `commission-headhunter-created.test.ts`
- T5.4: 单元测试 `commission-split.test.ts`
- T5.5: 全量 typecheck + test + smoke

### 8.2 估算代码量

- SQL 迁移: ~40 行
- 业务代码: ~250 行 (handler + route + repo)
- 共享常量/类型: ~10 行
- 单元测试: ~180 行
- 集成测试: ~500 行
- **合计**: ~980 行

### 8.3 风险点

| 风险 | 缓解 |
|---|---|
| SQLite 重建表迁移失败（数据丢失） | 备份原 jobs 表（`CREATE TABLE jobs_backup AS SELECT * FROM jobs`），迁移成功后再删；失败可回滚 |
| CHECK 约束过严阻断合法场景 | T1.2 单元测试覆盖所有合法 + 非法 case；过审前在 in-memory DB 跑一遍 |
| 佣金 70/30 计算错（边界同人 100%） | 单元测试覆盖 4 种组合；commission 模块是单点，diff 清晰 |
| landing 隐藏未认领导致"市场活动数字虚低" | 保留 `openJobsCount` 包含未认领，只隐藏 landing recentJobs 列表。`openJobsCount` 字段 = 所有 open jobs（包括未认领），符合"市场活动"语义 |
| recommendations 表外键 | recommendations.employer_id NOT NULL；未认领 job 没有 employer_id 没法被推荐——但 spec §6 决定禁止"未认领就 unlock"流程，所以没问题 |

---

## 9. 决策记录

| 决策 | 选择 | 备选 | 理由 |
|---|---|---|---|
| 归属模型 | **直发+事后认领** | 雇主导 / 草稿+审批 | 用户选定 2026-06-20 决策 |
| 配额成本 | **猎头全额付** | 雇主认领时付 / 拆账 | 用户选定 |
| 佣金分配 | **70%（推荐者）/ 30%（建岗者）** | 建岗者全拿 / 推荐者全拿 | 用户选定 |
| 授权模型 | **开放（任何猎头都行）** | 白名单 / 黑名单 | 用户选定 |
| 公开页可见性 | **未认领不显示** | 加"代发"徽章 / 无标记 | 用户选定 |
| 状态机扩展 | **不加新 status，用 `employer_id IS NULL` 表达"未认领"** | 加 `pending_claim` status | 最小改动，避免 CHECK 约束变更 |
| 拒绝行为 | **status='closed' 永久下线**，猎头要重发就再 POST | soft reject (状态保留可重开) | 简单；防止雇主 reject 后又被新 employer claim 产生混乱 |
| 多雇主 claim | **一岗一雇主**：第一个 claim 后其他人 403/409 | 允许多个 employer claim 同一岗 | 简化业务逻辑，符合"代建"语义 |
| `created_for_employer_id` 必填? | **可选**：可空 → 任何 employer 可 claim | 必填 | 灵活；同时开放给猎头"先建后指" |
| `openJobsCount` 计数 | **包含未认领** | 仅已认领 | 反映"市场活动"——未认领也算"在招中" |
| 推荐者同人 (建岗猎头自己推荐) | **100% 给本人**（避免自付） | 70/30 走流程 | 业务常识 |
| migration v009 不在事务里 | 同意（SQLite DDL 不能回滚） | 强制包事务 | 现实约束：用 backup table 兜底 |

---

## 10. 未来工作（不在本次范围）

- 雇主对猎头的"信任/拉黑"表
- 猎头编辑 / 关闭已认领岗位
- 拒绝后"重新激活"
- 批量建岗
- 草稿模式
- 自动 cron 清理长期未认领 job
- 跨境 / 多语言建岗模板
- 猎头-雇主 IM / 站内信
- 招聘需求方主动"邀请猎头"建岗（反向流程）
