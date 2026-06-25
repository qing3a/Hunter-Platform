# Web Admin Sub-D4 — Webhook Retry Audit + Per-Entity Detail Design

> **For agentic workers:** 这是 design spec，配套 implementation plans 见 `docs/superpowers/plans/2026-06-25-web-admin-sub-D4-plan-{1,2}.md`（待 writing-plans skill 输出）。
>
> 续接 Sub-D3（v2.3，merge `0be4134` + `1df33f2`）。本 spec 是 **Sub-project D4：webhook retry audit 修复 + 4 个 per-entity 详情页**。Sub-D5 之后做详情页 admin 快捷操作，Sub-E 做 config UI。

## ⚠️ 与已有 Sub-project 的关系

| Sub-project | 已交付 | 内容 |
|---|---|---|
| Sub-A/B | ✅ | 基础设施 + 列表 + login |
| Sub-D1 | ✅ | Audit 总表 UI |
| Sub-C | ✅ | Jobs/Recommendations + 配额调整 + details_json |
| Sub-D2 | ✅ | Per-Entity Timeline（4 entity type） |
| Sub-D3 | ✅ | Webhook 死信 + Placements 列表 + ConfirmModal |
| **Sub-D4（本 spec）** | 设计中 | **webhook retry audit + 4 个 per-entity 详情页** |

**Sub-D4 解决的痛点**：
- webhook retry 不写 audit（Sub-D3 已知 limitation）— 现在修
- 没有 per-entity 详情页（想看 user/candidate/job/rec 的完整信息 + 关联数据要跳多个 list）

---

## 1. 背景与动机

### 1.1 现状（Sub-D3 后）

| 项 | 现状 |
|----|------|
| Webhook retry | `webhooks.retry()` 只改 status，**不写 admin_action_log**（Sub-D3 known limitation） |
| Single entity endpoint | **不存在** — `GET /users/:id` / `GET /jobs/:id` 等都没有，admin-web 只有 list endpoints |
| Per-entity 详情 | **没有** — 列表页只能看单行，要看完整信息要 SQL 查 DB |
| 相关数据 | 跨表 JOIN 要 admin 自己 SQL 拼 |

### 1.2 真实需求

| 需求 | 痛点 |
|---|---|
| Ops 想知道"谁 retry 了哪个 webhook" | 查不到（无 audit log） |
| Ops 想看 user 的完整档案 | 要 SQL 查 users + candidates + placements + recommendations 多个表 |
| Ops 想看 job 的全部推荐和入职 | 要 SQL JOIN |
| Ops 想看 candidate 的解锁流水 | 要 SQL JOIN 4 表 |

### 1.3 非目标

- ❌ Sub-D5 详情页 admin 快捷操作
- ❌ Sub-E config UI
- ❌ Per-entity 编辑 UI（admin 只读）
- ❌ Realtime / 暗黑模式 / 移动端
- ❌ URL 持久化 filter
- ❌ 跨 entity 详情页（如 placement 详情 = job detail + candidate detail + headhunter 详情）
- ❌ Webhook retry audit 失败回滚（best-effort）

---

## 2. 架构总览

### 2.1 模块改动图

```
hunter-platform/
├── src/main/
│   ├── routes/admin.ts                       # 改：+4 GET :id routes；retry route 加 adminUserId
│   ├── modules/admin/handlers/
│   │   ├── webhooks.ts                        # 改：retry() 加 adminUserId + 写 admin_action_log
│   │   ├── users.ts                           # 改：+get(id)
│   │   ├── jobs.ts                            # 改：+get(id)
│   │   ├── candidates.ts                      # 改：+get(id)
│   │   └── recommendations.ts                 # 改：+get(id)
│
└── admin-web/src/
    ├── pages/
    │   ├── UserDetailPage.tsx (NEW)
    │   ├── CandidateDetailPage.tsx (NEW)
    │   ├── JobDetailPage.tsx (NEW)
    │   └── RecommendationDetailPage.tsx (NEW)
    ├── api/
    │   ├── users.ts                           # 改：+getUser
    │   ├── jobs.ts                            # 改：+getJob
    │   ├── candidates.ts                      # 改：+getCandidate
    │   └── recommendations.ts                 # 改：+getRecommendation
    ├── App.tsx                                # 改：+4 routes
    ├── pages/UsersPage.tsx                    # 改：+「详情」按钮
        /pages/CandidatesPage.tsx              # 改：+按钮
        /pages/JobsPage.tsx                    # 改：+按钮
        /pages/RecommendationsPage.tsx         # 改：+按钮
```

### 2.2 路由表（admin-web）

| Path | 鉴权 | 备注 |
|------|------|------|
| `/admin/users/:id` | bearer | **新增** |
| `/admin/candidates/:id` | bearer | **新增** |
| `/admin/jobs/:id` | bearer | **新增** |
| `/admin/recommendations/:id` | bearer | **新增** |
| 其他已有 | bearer | 不变 |

### 2.3 后端 endpoint

| Method | Path | 改动 |
|--------|------|------|
| GET | `/v1/admin/users/:id` | **新增** — 返回单条 user |
| GET | `/v1/admin/candidates/:id` | **新增** — 返回 candidate + 关联 headhunter |
| GET | `/v1/admin/jobs/:id` | **新增** — 返回 job + 关联 employer |
| GET | `/v1/admin/recommendations/:id` | **新增** — 返回 rec + 关联 job/candidate/headhunter |
| POST | `/v1/admin/webhooks/:id/retry` | **改**：加 adminUserId 参数 + 写 admin_action_log |
| 现有 list endpoints | 复用 | 详情页调 listPlacements / listRecommendations 等 |

### 2.4 数据库改动

- ❌ **0 migration**

### 2.5 Tech Stack

**沿用现有**。无新依赖。

---

## 3. 后端设计

### 3.1 Webhook retry audit 修复

```typescript
// src/main/modules/admin/handlers/webhooks.ts
import { createAdminActionLogRepo } from '../../../db/repositories/admin-action-log.js';

export function createAdminWebhooksHandler(db: DB) {
  const wh = createWebhookQueueRepo(db);
  const adminLog = createAdminActionLogRepo(db);

  return {
    listDeadLetter(filter: ListDeadLetterFilter = {}): { rows: DeadLetterRow[]; total: number } {
      // ... existing code unchanged
    },
    retry(adminUserId: string, delivery_id: number): { id: number; status: string } {
      // 破坏性变更：加 adminUserId 参数
      const rec = wh.findById(delivery_id);
      if (!rec) throw Errors.notFound('Delivery not found');
      if (rec.status !== 'dead_letter') throw Errors.invalidState(`Can only retry dead_letter, current: ${rec.status}`);
      db.prepare(
        "UPDATE webhook_delivery_queue SET status = 'pending', attempt_count = 0, last_error = NULL, next_retry_at = NULL, updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), delivery_id);
      // 新增：写 audit log
      adminLog.insert({
        admin_user_id: adminUserId,
        action: 'retry_webhook',
        target_type: 'webhook_delivery',
        target_id: String(delivery_id),
        details_json: JSON.stringify({
          event_type: rec.event_type,
          target_user_id: rec.target_user_id,
          previous_attempt_count: rec.attempt_count,
        }),
      });
      return { id: delivery_id, status: 'pending' };
    },
  };
}
```

### 3.2 4 个 GET :id endpoint

```typescript
// src/main/modules/admin/handlers/users.ts — 加
get(id: string): UserRow | null {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | null;
}

// src/main/modules/admin/handlers/jobs.ts — 加
get(id: string): JobRow | null {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | null;
}

// src/main/modules/admin/handlers/candidates.ts — 加
get(id: string): CandidateRow | null {
  return db.prepare('SELECT * FROM candidates_anonymized WHERE anonymized_id = ?').get(id) as CandidateRow | null;
}

// src/main/modules/admin/handlers/recommendations.ts — 加
get(id: string): RecommendationRow | null {
  return db.prepare(`
    SELECT r.id, r.job_id, r.anonymized_candidate_id, r.headhunter_id,
           j.title AS job_title, c.industry AS candidate_industry,
           u.name AS headhunter_name, r.status, r.created_at, r.updated_at
    FROM recommendations r
    LEFT JOIN jobs j ON j.id = r.job_id
    LEFT JOIN candidates_anonymized c ON c.anonymized_id = r.anonymized_candidate_id
    LEFT JOIN users u ON u.id = r.headhunter_id
    WHERE r.id = ?
  `).get(id) as RecommendationRow | null;
}
```

### 3.3 4 个 GET :id Route

```typescript
// src/main/routes/admin.ts
const wrapGet = (handler: (id: string) => any, schema: any) => (req: any, res: any, next: any) => {
  try {
    const id = req.params.id;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw Errors.invalidParams('id has invalid format');
    const row = handler(id);
    if (!row) throw Errors.notFound('Not found');
    respond(res, z.object({ ok: z.literal(true), data: schema }), { ok: true, data: row }, { strict: true });
  } catch (e) { next(e); }
};

router.get('/users/:id', wrapGet(users.get, UserRowSchema));
router.get('/jobs/:id', wrapGet(jobs.get, JobRowSchema));
router.get('/candidates/:id', wrapGet(candidates.get, CandidateRowSchema));
router.get('/recommendations/:id', wrapGet(recommendations.get, RecommendationRowSchema));
```

### 3.4 错误处理

| 场景 | HTTP |
|------|------|
| id 格式非法 | 400 |
| entity 不存在 | 404 |
| admin auth 缺失 | 401 |

---

## 4. 前端设计

### 4.1 4 个详情页布局

**共同结构**：
```
┌─────────────────────────────────────────────────────────────┐
│ ← 返回对应列表                                              │
│                                                              │
│ {Entity 基本信息}                                           │
│ {操作: 查看时间轴 / 调配额 / 等}                            │
│                                                              │
│ ── 相关数据 ──                                              │
│ 关联表 1（最近 5 条）                                       │
│ [查看全部 → /相关 endpoint]                                │
│                                                              │
│ 关联表 2（最近 5 条）                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**UserDetailPage 内容**：
- Header: name, user_type, status, contact, quota (used/limit), reputation, created_at
- Actions: 「查看时间轴」链接
- 相关: 关联 Placements（最近 5）+ 关联 Recommendations（最近 5）

**CandidateDetailPage**：
- Header: anonymized_id, headhunter_id, industry, title_level, unlock_status
- Actions: 「查看时间轴」
- 相关: 关联 Recommendations + 关联 Unlocks（最近 5 条 unlock_audit_log）

**JobDetailPage**：
- Header: title, employer_id, status, created_at
- Actions: 「查看时间轴」
- 相关: 关联 Recommendations + 关联 Placements

**RecommendationDetailPage**：
- Header: id, job_title, candidate_id, headhunter_name, status, created_at
- Actions: 「查看时间轴」
- 相关: 完整 Unlocks timeline（完整 history，不只 5 条）

### 4.2 API wrappers

```ts
// admin-web/src/api/users.ts — 加
export async function getUser(id: string): Promise<UserRow> {
  const env = await apiFetchRaw<UserRow>('users/' + id);
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to fetch user');
  return env.data;
}

// 类似 getJob / getCandidate / getRecommendation
```

### 4.3 4 个列表页加「详情」按钮

每个 list page 行末加（与现有「时间轴」按钮同位置）：

```tsx
<Link to={`/admin/users/${r.id}`} className="btn btn-sm" data-testid={`user-detail-${r.id}`}>详情</Link>
```

### 4.4 错误处理

| 场景 | UI |
|------|-----|
| 主 entity 失败 | 整页红色 banner「无法加载 + 重试」+ 返回列表链接 |
| entity 不存在（404） | 整页「找不到该 entity」+ 返回链接 |
| 相关数据部分失败 | 该部分「加载失败 [重试]」+ 其他部分正常 |

### 4.5 不做

- ❌ 详情页 admin 快捷操作（Sub-D5）
- ❌ URL 持久化
- ❌ Realtime / 暗黑模式

---

## 5. 数据流 + Audit 链路

### 5.1 UserDetailPage 数据流

```
[1] UsersPage 点 [详情]
    → <Link to="/admin/users/usr_1">
    → 路由到 UserDetailPage

[2] UserDetailPage mount
    → useParams id
    → useEffect 并发调 3 个 API：
      1. getUser(id)              → 基本信息
      2. listPlacements({ pageSize: 5 }) → 关联 placements（按 user_id 过滤）
      3. listRecommendations({ pageSize: 5 }) → 关联 recs（按 user_id 过滤）
    → 3 个 .then 并行更新各自 state
    → 全部 resolve → loading = false

[3] 渲染
    → 头部: getUser 数据
    → 关联表: listPlacements / listRecommendations 数据
    → 「查看时间轴」链接 → /admin/users/:id/timeline（Sub-D2）
```

### 5.2 Webhook retry 数据流（更新）

```
[1] WebhookDeadLetterPage 点 [重试]
    → retryDeadLetter(id) → POST /webhooks/:id/retry
[2] Backend: webhooks.retry(adminUserId, id)
    → UPDATE webhook_delivery_queue SET status='pending'
    → INSERT INTO admin_action_log (action='retry_webhook', ...)
[3] 响应 { id, status: 'pending' }
[4] 前端 Toast「已加入重试队列」+ 刷新列表
```

### 5.3 Audit 联动

- **webhook retry** → 新增写 admin_action_log（action='retry_webhook'）
- **详情页只读** → 不写 audit
- **关联数据 mutation**（如 placement 取消）→ 走原 endpoint，已各自写 audit

---

## 6. 测试策略

### 6.1 覆盖目标

| 层 | 范围 | 数量 |
|----|------|------|
| 后端 webhook retry | retry 写 admin_action_log | 1 |
| 后端 4 GET :id | 4 endpoint × 2 case（happy + 404） | 8 |
| 前端 API wrapper | getUser / getJob / getCandidate / getRecommendation | 4 |
| 前端页面 | 4 page × 4 case（mount + render + 404 + 关联数据空） | 16 |
| 列表页按钮 | 4 处「详情」按钮 | 4 |
| **新增总计** | | **~33** |

回归目标：1095 + 33 ≈ **1128 测试**。

### 6.2 后端测试

- `admin-webhooks.test.ts` 加：retry 后 admin_action_log 有新行
- `admin-endpoints.test.ts` 或新建：4 个 GET :id 端点各 2 case

### 6.3 前端测试

每个详情页：
1. mount 调 getX + listY + listZ
2. 渲染基本信息
3. 渲染相关数据
4. 404 显示「找不到」

每个列表页「详情」按钮：1 case

### 6.4 不做

- ❌ E2E / 视觉回归 / 性能 / Mutation testing

---

## 7. 验收标准（DoD）

1. ✅ 4 个 GET :id endpoint 工作
2. ✅ Webhook retry 写 audit log
3. ✅ 4 个详情页渲染 + 关联数据 + 错误处理
4. ✅ 4 个列表页「详情」按钮跳转
5. ✅ 「查看时间轴」链接到 Sub-D2 timeline
6. ✅ ~33 新测试通过 + 现有不退
7. ✅ 全 typecheck 干净
8. ✅ 手测 5 步全通过
9. ✅ CHANGELOG v2.4.0

---

## 8. 手测 5 步（dev 模式）

```bash
# Terminal 1
cd D:/dev/hunter-platform && npm run dev

# Terminal 2
cd D:/dev/hunter-platform/admin-web && npm run dev
```

| # | 操作 | 期望 |
|---|------|------|
| 1 | UsersPage → 点「详情」 | 进入 UserDetailPage，看到基本信息 + 关联数据 + 「查看时间轴」 |
| 2 | 同理 CandidateDetailPage / JobDetailPage / RecommendationDetailPage | 4 个都正常 |
| 3 | 详情页点「查看时间轴」 | 跳到 Sub-D2 timeline 页（之前已 work） |
| 4 | WebhookDeadLetterPage 重试一个 → 进 AuditPage Admin Actions tab | 看到 `retry_webhook` 记录 |
| 5 | 直接访问 `/admin/users/nonexistent` | 显示「找不到该用户」+ 返回链接 |

---

## 9. 部署 / 回滚

### 部署

1. 后端（Plan 1）merge → 自动部署
2. 前端（Plan 2）+ `npm run build` → nginx reload
3. DB 0 改动

### 回滚

- 后端：revert commit + 重启
- 前端：revert + rebuild
- DB 0 改动

---

## 10. 工作量

| 阶段 | 估时 |
|------|------|
| 后端（5 endpoint） | 2 小时 |
| 后端测试 | 1 小时 |
| 前端 4 page + 4 wrapper | 4 小时 |
| 前端测试 | 2 小时 |
| 手测 + 修小问题 | 1 小时 |
| **总计** | **~1 个工作日** |

---

## 11. 后续

| Sub | 内容 | 预计 |
|-----|------|------|
| Sub-D5 | 详情页 admin 快捷操作（suspend user / cancel placement） | v2.5 |
| Sub-E | webhooks/rate-limit/config 写入类 UI | v2.6 |
| Sub-D5 follow-up | filter URL 持久化扩展到详情页 | v2.5.1 |

---

## 附录 A：UI 草图（ASCII）

### UserDetailPage
```
┌──────────────────────────────────────────────────────────────┐
│ ← 返回用户列表                                              │
│                                                              │
│ 张三                                       [状态: active]    │
│ 类型: headhunter    邮箱: zhang@example.com                │
│ 配额: 50/100      创建: 2026-06-01  (3 周前)              │
│ [查看时间轴] [调配额]                                       │
│                                                              │
│ ── 相关数据 ──                                              │
│                                                              │
│ 关联的 Placements（最近 5 条）                              │
│ ┌────────┬──────────┬──────┬─────────┬─────────┐          │
│ │ ID     │ job_id   │ fee  │ status  │ created │          │
│ ├────────┼──────────┼──────┼─────────┼─────────┤          │
│ │ place1 │ job_001  │ 5000 │ paid    │ 2 周前  │          │
│ └────────┴──────────┴──────┴─────────┴─────────┘          │
│ [查看全部 →]                                                │
│                                                              │
│ 关联的 Recommendations（最近 5 条）                          │
│ ┌──────┬──────────┬────────┬─────────┐                  │
│ │ ID   │ job_id   │ status │ created │                  │
│ └──────┴──────────┴────────┴─────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

### CandidateDetailPage
```
┌──────────────────────────────────────────────────────────────┐
│ ← 返回候选人列表                                            │
│                                                              │
│ 候选人 #abc123                                              │
│ 行业: tech    职级: mid    [解锁: pending]                  │
│ 创建: 2026-06-15                                             │
│ [查看时间轴]                                                 │
│                                                              │
│ 关联的 Recommendations（最近 5 条）                          │
│ ...                                                          │
│ 关联的 Unlocks（最近 5 条）                                  │
│ ...                                                          │
└──────────────────────────────────────────────────────────────┘
```

---

**Spec 结束。** 配套 implementation plans 见 `docs/superpowers/plans/2026-06-25-web-admin-sub-D4-plan-{1,2}.md`（待 writing-plans skill 输出）。