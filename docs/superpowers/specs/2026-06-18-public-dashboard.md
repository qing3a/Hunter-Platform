# Public Operations Dashboard — Spec

**状态**: Draft
**日期**: 2026-06-18
**作者**: brainstorming session
**前置**: [2026-06-17-hunter-platform-design.md](./2026-06-17-hunter-platform-design.md)

---

## 1. 概述

### 1.1 一句话定义

新增 **公开的 operations dashboard 页面** `GET /dashboard`：不需要 auth，只展示**聚合摘要**数据（无 PII、无个人详情），让任何人都能一眼看到平台运行状态。

### 1.2 触发原因

v0.2.1 已完成 5 个新 endpoint + 各种修复，但**没有 aggregate 概览页**。要查看系统状态只能：
- 跑 SQL 直查 DB（需要 Node 工具）
- 用 `/v1/health` 看 health，但只返回 1 行 JSON
- 用 `/v1/metrics` 看 Prometheus，但只给监控用

需要一个**人眼友好的概览页**——既能给运维看，也能给新访问者 demo。

### 1.3 目标

1. `GET /dashboard` 返回 SSR HTML 页面（**不需要 auth**）
2. 4 大板块：用户量、推荐状态、调用量、活动 feed
3. 全部数据是**聚合 / 计数 / 截断 top-N**，无 PII
4. 视觉清晰、可一眼读懂

### 1.4 非目标

- 不做用户级数据展示（无个人信息）
- 不做管理操作（纯只读）
- 不做图表（简单数字 + 表格）
- 不做实时刷新（页面是快照）
- 不做 admin-only 鉴权（v1 公开）

---

## 2. 视觉设计（HTML 结构）

```
┌──────────────────────────────────────────────────────────────────┐
│ Hunter Platform · Operations Dashboard                            │
│ 🟢 Healthy · 2026-06-19 13:45 UTC · uptime 2h 14m              │
└──────────────────────────────────────────────────────────────────┘

┌─ Users & Candidates ──────────────┐
│ Total users:    42                  │
│   ├─ candidate: 15                  │
│   ├─ headhunter: 12                 │
│   └─ employer:   15                 │
│ Anonymized candidates: 28          │
│   Public pool:  10                  │
└────────────────────────────────────┘

┌─ Recommendation Pipeline ──────────┐
│ Status         Count                │
│ pending                  5          │
│ employer_interested       2          │
│ candidate_approved       1          │
│ unlocked                 3          │
│ placed                   1          │
│ rejected_employer        0          │
│ rejected_candidate       1          │
│ withdrawn                0          │
│ Total                   13          │
└────────────────────────────────────┘

┌─ API Calls Today ──────────────────┐
│ Total:   147                         │
│ Top endpoints (today):              │
│   GET /v1/users/{id}/status    42    │
│   POST /v1/auth/register       18    │
│   POST /v1/headhunter/candidates 12  │
│   GET /v1/employer/talent       9   │
│   GET /v1/market/leaderboard    8   │
│   ... (top 10)                     │
└────────────────────────────────────┘

┌─ Recent Activity (last 20) ────────┐
│ Time          Action            Status │
│ 13:44:55  upload_candidate    success │
│ 13:44:12  register           success  │
│ 13:43:01  express_interest   success  │
│ 13:42:30  browse_talent      success  │
│ ...                                  │
│ (no user_id shown — anonymous feed) │
└────────────────────────────────────┘
```

---

## 3. 数据来源（DB query）

### 3.1 Section 1: Users & Candidates

```sql
-- Total users by type
SELECT user_type, COUNT(*) as count
FROM users
WHERE status = 'active'
GROUP BY user_type;

-- Anonymized candidates
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN is_public_pool = 1 THEN 1 ELSE 0 END) as public_pool
FROM candidates_anonymized;
```

### 3.2 Section 2: Recommendation Status

```sql
SELECT status, COUNT(*) as count
FROM recommendations
GROUP BY status;
```

8 个状态（从 spec §5 RecStatus）：pending / employer_interested / candidate_approved / unlocked / placed / rejected_employer / rejected_candidate / withdrawn

### 3.3 Section 3: API Calls Today

```sql
-- Use action_history table (created_at is ISO datetime)
SELECT action_type, COUNT(*) as count
FROM action_history
WHERE created_at >= datetime('now', 'start of day')
GROUP BY action_type
ORDER BY count DESC
LIMIT 10;

-- Total count for today
SELECT COUNT(*) as total
FROM action_history
WHERE created_at >= datetime('now', 'start of day');
```

### 3.4 Section 4: Recent Activity

```sql
-- Last 20 actions, no user details (privacy)
SELECT created_at, action_type, status
FROM action_history
ORDER BY created_at DESC
LIMIT 20;
```

**明确不含 `user_id` / `target_id` / 任何可识别信息**。

---

## 4. 视觉 / CSS

复用 view layer 的 `templates/shared-css.ts`：
- 卡片用 `class="card"`
- 数字用大字号
- 状态用色块（绿=success / 黄=pending / 红=rejected）
- 表格用 `class="kv"`

---

## 5. 文件变更

### 5.1 新增

| 文件 | 用途 |
|------|------|
| `src/main/routes/admin.ts` | `/dashboard` HTML route + 数据查询 |
| `src/main/modules/view/templates/dashboard.ts` | 4 个 section 的 HTML 渲染函数 |
| `tests/integration/dashboard.test.ts` | 3 个集成测试 |

### 5.2 修改

| 文件 | 改动 |
|------|------|
| `src/main/server.ts` | 加 `app.use('/dashboard', ...)` 或 `app.get('/dashboard', ...)` |

### 5.3 不动

- 业务 endpoint 行为不变
- auth/quota 不影响 dashboard（公开 + 不扣 quota）
- view layer 其它页面不变

---

## 6. 错误处理

| 场景 | 行为 |
|------|------|
| DB 查询失败 | 显示 "Dashboard 暂不可用"，返回 500 |
| 无数据 | 显示 0（不是空白） |
| 未知 action_type | 仍显示原值（不规范化） |

dashboard 是 ops 工具，失败时优雅降级即可，不需要复杂错误码。

---

## 7. 测试策略

| 测试 | 内容 |
|------|------|
| `GET /dashboard` returns 200 + HTML | 健康检查 |
| HTML contains 4 section headings | 验证 4 板块都在 |
| HTML contains numeric counts (e.g., `<dd>42</dd>`) | 验证数据来自 DB（注册用户后 count 应增加）|
| HTML does NOT contain user_id / contact / email | 验证无 PII |
| HTML is valid (parses as document) | snapshot |

总计 ~5 个 it。

---

## 8. 实现路径

1. **T1**: `GET /dashboard` HTML 渲染（RED → GREEN）— 用空 DB 跑基础结构
2. **T2**: 4 个 section 数据查询 + 注入到 HTML
3. **T3**: 集成测试覆盖 4 个 section 计数 + 无 PII
4. **T4**: typecheck + 全测试 + commit + push

预计代码 ~200 行（route + template + 5 tests）。

---

## 9. 决策记录

| 决策 | 选择 | 备选 | 理由 |
|------|-----|------|------|
| 鉴权 | **公开** | Bearer auth / Admin only | 用户要"公开但只摘要"，方便 demo |
| 路由位置 | `GET /dashboard` | `/v1/admin/dashboard` | dashboard 是**人类看的页面**，不是 API endpoint |
| 鉴权配额 | **不消耗** | 扣 1 quota | 公开页面，无 user 上下文 |
| 实时刷新 | **静态快照** | JS 自动刷新 | 简单，v1 不需要 |
| 数据隐私 | **完全聚合** | 可看个人 ID | "只摘要"硬约束：绝无 user_id / target_id / contact |
| 视觉风格 | **复用 view layer CSS** | 新 CSS | 保持一致 |

---

## 10. 未来工作

- 加 admin 角色 + 仅 admin 可看 dashboard
- 加时间窗口选择（today / 7d / 30d / all）
- 加简单图表（用 inline SVG）
- 导出 dashboard 为 markdown / JSON
- 实时刷新（WebSocket 或 SSE）