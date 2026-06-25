# Web Admin Sub-D6 — Filter URL Persistence Sweep Design

> **For agentic workers:** 这是 design spec，配套 implementation plan 见 `docs/superpowers/plans/2026-06-25-web-admin-sub-D6-plan.md`（待 writing-plans skill 输出）。
>
> 续接 Sub-D5（v2.5.0，merge `35d0304`）。本 spec 是 **Sub-project D6：filter URL 持久化全站应用**。后续 backlog：Sub-E（config UI）等。

## ⚠️ 与已有 Sub-project 的关系

| Sub-project | 已交付 | 内容 |
|---|---|---|
| Sub-D2 follow-up | ✅ | 4 个 timeline page 用 `useTimelineFilters` 做 URL 持久化 |
| Small Fixes | ✅ | 抽 `useUrlParam` 通用 hook + `useTimelineFilters` 重构使用 |
| **Sub-D6（本 spec）** | 设计中 | **把剩下 7 个有 filter 的 page 全部迁到 `useUrlParam` URL 持久化** |

**Sub-D6 解决的痛点**：
- 7 个 list page（UsersPage / CandidatesPage / JobsPage / RecommendationsPage / PlacementsPage / WebhookDeadLetterPage / AuditPage）当前用 `useState` 存 filter，刷新 / 分享链接会丢 filter
- 唯一做了 URL 持久化的是 4 个 timeline page（Sub-D2 follow-up）
- 一致性差：同样模式散落 7 处
- `useUrlParam` 已存在（Small Fixes），直接复用

---

## 1. 背景与动机

### 1.1 现状（Sub-D5 后）

| Page | Filter | URL 持久化 | 备注 |
|------|--------|------|------|
| UserTimelinePage | source/from/until/actor/page | ✅ | Sub-D2 follow-up |
| CandidateTimelinePage | 同上 | ✅ | Sub-D2 follow-up |
| JobTimelinePage | 同上 | ✅ | Sub-D2 follow-up |
| RecommendationTimelinePage | 同上 | ✅ | Sub-D2 follow-up |
| **UsersPage** | user_type/status/keyword | ❌ | **本 spec 改** |
| **CandidatesPage** | unlock_status/keyword | ❌ | **本 spec 改** |
| **JobsPage** | status/keyword/from/until | ❌ | **本 spec 改** |
| **RecommendationsPage** | status/keyword/from/until | ❌ | **本 spec 改** |
| **PlacementsPage** | status/from/until | ❌ | **本 spec 改** |
| **WebhookDeadLetterPage** | event_type/min_attempts/from/until | ❌ | **本 spec 改** |
| **AuditPage** Admin Actions tab | actor search | ❌ | **本 spec 改** |

### 1.2 真实需求

| 需求 | 痛点 |
|---|---|
| 分享带 filter 的 URL 给同事 | 当前 filter 不在 URL，同事看到的不是同一份 |
| 刷新页面 filter 不丢 | 当前刷就丢，要重新选 |
| Filter 在所有 list page 一致行为 | 现在 4 个 page 行为，7 个 page 不行为 |

### 1.3 非目标

- ❌ URL 持久化能力改进（useUrlParam 现状够用）
- ❌ 新的 `useUrlParams` (plural) 抽象（agent 在 small-fixes 提过，scope 控制在 Sub-D6 之后）
- ❌ 后端改动（0 backend 改动）
- ❌ Realtime 刷新 / 暗黑模式

---

## 2. 架构总览

### 2.1 模块改动图

```
hunter-platform/
└── admin-web/src/
    ├── pages/
    │   ├── UsersPage.tsx                    # 改：useState filter → useUrlParam
    │   ├── CandidatesPage.tsx               # 改
    │   ├── JobsPage.tsx                     # 改
    │   ├── RecommendationsPage.tsx           # 改
    │   ├── PlacementsPage.tsx               # 改
    │   ├── WebhookDeadLetterPage.tsx        # 改
    │   └── AuditPage.tsx                    # 改（Admin Actions tab actor）
    ├── tests/pages/
    │   ├── UsersPage.test.tsx               # 改：+URL persistence test
    │   ├── CandidatesList.test.tsx          # 改
    │   ├── JobsPage.test.tsx                # 改
    │   ├── RecommendationsPage.test.tsx      # 改
    │   ├── PlacementsPage.test.tsx          # 改
    │   ├── WebhookDeadLetterPage.test.tsx   # 改
    │   └── AuditPage.test.tsx               # 改
    └── components/                          # 0 改动
```

### 2.2 后端 endpoint

**0 改动**。所有 page 调用的现有 list endpoint 已支持 filter + pagination。

### 2.3 数据库改动

**0 migration**。

### 2.4 Tech Stack

**沿用现有**：React 18, react-router-dom, vanilla CSS, vitest+jsdom+RTL

**复用**：Small Fixes 已建的 `useUrlParam` hook

**无新依赖**。

---

## 3. 后端改动

**0 改动**。

---

## 4. 前端设计

### 4.1 通用迁移模式

7 个 page 都用同一模式迁移：

**改前**（典型）：
```tsx
const [userType, setUserType] = useState<string>('');
const [status, setStatus] = useState<string>('');
const [keyword, setKeyword] = useState('');
// ... more useState
const [page, setPage] = useState(1);
```

**改后**：
```tsx
const [userType, setUserType] = useUrlParam<string>('user_type', '');
const [status, setStatus] = useUrlParam<string>('status', '');
const [keyword, setKeyword] = useUrlParam<string>('keyword', '');
// ... more useUrlParam
const [page, setPage] = useUrlParam<number>('page', 1, (v) => v && /^\d+$/.test(v) ? Math.max(1, parseInt(v, 10)) : null);
```

注意：
- `useState` → `useUrlParam`（1-1 替换）
- `setPage(1)`（filter 变化重置 page 到 1）行为保留——`useUrlParam` setter 每次都删 URL 中的 page（与 useTimelineFilters 模式一致）
- keyword（空字符串 default）= 不写到 URL
- page = 1 default = 不写到 URL

### 4.2 7 个 page 迁移细节

| Page | Filter keys | 备注 |
|------|------------|------|
| **UsersPage** | `user_type` / `status` / `keyword` / `page` | 已有 SearchBar + columns |
| **CandidatesPage** | `unlock_status` / `keyword` / `page` | |
| **JobsPage** | `status` / `keyword` / `from` / `until` / `page` | has from/until 也要 URL 化 |
| **RecommendationsPage** | `status` / `keyword` / `from` / `until` / `page` | |
| **PlacementsPage** | `status` / `from` / `until` / `page` | |
| **WebhookDeadLetterPage** | `event_type` / `min_attempts` / `from` / `until` / `page` | min_attempts 是 number |
| **AuditPage** Admin Actions tab | `actor` / `page` | 1 个 filter 字段 + page |

### 4.3 useUrlParam parser 用法（特殊 filter）

```ts
// number 类型（WebhookDeadLetterPage 的 min_attempts）
const [minAttempts, setMinAttempts] = useUrlParam<number>('min_attempts', 0, (v) => v ? Number(v) : null);

// page 类型（所有 page 都有）
const [page, setPage] = useUrlParam<number>('page', 1, (v) => v && /^\d+$/.test(v) ? Math.max(1, parseInt(v, 10)) : null);
```

### 4.3.1 useState 残留的清理

**保留** useState 的：
- `useState<TimelineItem[]>([])` for rows data
- `useState<Pagination>(...)` for pagination
- `useState<loading>(true)` for loading
- `useState<ConfirmState>(...)` for confirm modal
- `useState<drawer>(...)` for detail drawer

**替换** useState 的：
- 所有 filter 字段（user_type / status / keyword / from / until / event_type / min_attempts / actor）
- page

### 4.4 错误处理

| 场景 | 行为 |
|------|------|
| URL 含非法 filter value | `useUrlParam` parser 返回 default（不会 throw） |
| 刷新 | URL 保留 filter，组件 mount 时读 URL |
| 分享 URL | 同事打开看到相同 filter |
| 清除 filter | setter 传 default，URL 删 key |

### 4.5 不做

- ❌ 跨 tab 同步 filter（如 AuditPage 3 个 tab 共享 URL？NO——保持各自独立）
- ❌ `useUrlParams` (plural) 抽象批量 reset
- ❌ 任何新 backend endpoint
- ❌ 任何 UI 视觉改动

---

## 5. 数据流 + 失败链路

### 5.1 Filter 加载流程

```
[1] User mount page
    → useUrlParam 读 URL
    → 渲染初始 UI（filter 已设置）

[2] User 改 filter
    → setter 调 useSearchParams
    → URL 更新（replace: true，不污染 history）
    → useEffect 触发（filter state 变化）
    → load(filter) 调 API
    → 列表更新

[3] User 刷新浏览器
    → URL 含 filter
    → useUrlParam 读 URL
    → mount 时 filter 已是上次值
    → 列表显示上次 filter 的结果
```

### 5.2 失败链路

| 场景 | 行为 |
|------|------|
| URL 含 garbage value | parser 返回 default，无 throw |
| API 失败 | 不影响 URL（setter 在 API 前调用），列表显示 error state |
| 401 | client.ts 处理跳 login（清 URL 也清 localStorage） |

---

## 6. 测试策略

### 6.1 覆盖目标

每个 page 加 2 case（共 14 个新测试）：
- 1. 初始 mount URL 无 filter → 调 API with default filter
- 2. 改 filter → URL 更新 + 重新 fetch

| Page | Cases |
|------|-------|
| UsersPage | 2 |
| CandidatesPage | 2 |
| JobsPage | 2 |
| RecommendationsPage | 2 |
| PlacementsPage | 2 |
| WebhookDeadLetterPage | 2 |
| AuditPage | 2 |
| **新增总计** | **14** |

回归目标：180 + 14 = **194 admin-web 测试**。

### 6.2 不做

- ❌ E2E（Playwright）
- ❌ 视觉回归

---

## 7. 验收标准（DoD）

1. ✅ 7 个 list page 全部用 `useUrlParam` 替代 `useState` for filter + page
2. ✅ Filter URL 持久化行为一致（与 Sub-D2 follow-up 一致）
3. ✅ 14 个新测试通过
4. ✅ 全 typecheck 干净
5. ✅ 手测 3 步（dev 模式）
6. ✅ CHANGELOG v2.6.0

---

## 8. 手测 3 步

```bash
cd D:/dev/hunter-platform && npm run dev
cd D:/dev/hunter-platform/admin-web && npm run dev
```

| # | 操作 | 期望 |
|---|------|------|
| 1 | 任一 list page（如 UsersPage）改 filter → URL 变化 | filter 状态 + URL 同步 |
| 2 | 复制 URL 在新 tab 打开 | filter 还原 |
| 3 | 改 AuditPage Admin Actions 的 actor 搜索 → URL 包含 actor 参数 | 与 list page 一致 |

---

## 9. 部署 / 回滚

### 部署
- `npm run build` → nginx reload
- 0 backend 改动

### 回滚
- Revert commit + rebuild

---

## 10. 工作量

| 阶段 | 估时 |
|------|------|
| 7 个 page 迁移（每页 ~10 行替换） | 2 小时 |
| 7 个 test 文件加 case | 2-3 小时 |
| 跑测试 + typecheck + 修小问题 | 1 小时 |
| **总计** | **~5-6 小时** |

---

## 11. 后续

| Sub | 内容 | 预计 |
|-----|------|------|
| Sub-E | webhooks/rate-limit/config UI | v2.7 |
| Sub-D6 follow-up | `useUrlParams` (plural) 通用化 | v2.6.1 |

---

**Spec 结束。** 配套 implementation plan 见 `docs/superpowers/plans/2026-06-25-web-admin-sub-D6-plan.md`（待 writing-plans skill 输出）。