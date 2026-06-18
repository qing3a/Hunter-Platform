# Rate Limit Redesign — Spec

**状态**: Draft
**日期**: 2026-06-19
**作者**: brainstorming session
**前置**: [2026-06-17-hunter-platform-design.md](./2026-06-17-hunter-platform-design.md), [2026-06-18-rate-limit-refinement.md](./2026-06-18-rate-limit-refinement.md) (out of scope 引用), `src/main/modules/rate-limit/bucket.ts`, `src/main/modules/register/handler.ts`, `src/shared/constants.ts`

---

## 1. 概述

### 1.1 一句话定义

把 per-user 限流从 fixed-window 改成 sliding-window-counter 算法；所有认证响应注入 IETF `RateLimit-*` 头；1h 阈值上调 1.5x 抵消滑动窗口的更严特性；剩余 < 20% 时返回软警告头。

### 1.2 触发原因

- 现有 fixed-window 算法一旦撞限，剩余整个窗口（最坏 1 小时）全部 429 → 体感差
- 客户端无法预知自己离限流还有多远 → 难以主动节流
- 限流规则只在代码里，没有公开文档 → 第三方 Agent 集成方不清楚边界

### 1.3 目标

1. 撞限后能渐进恢复（不再"锁一整窗口"）
2. 客户端能从响应头读出 remaining，主动减速
3. 限流规则公开（`/v1/skill.md` + `/v1/openapi.json`）
4. 真实用户日常使用几乎无感（1s/1min 阈值不变）
5. 服务器负载可控（1h 阈值 1.5x 仍挡 spammer）

### 1.4 非目标

- 不改 fixed-window IP register 限流（5/h）—— 走单独的 `2026-06-18-rate-limit-refinement.md` spec
- 不改 daily quota（50/200/100/天）—— 业务成本控制，独立设计
- 不加 per-endpoint 限流
- 不加 per-IP 全局限流
- 不加 global server-wide 限流
- 不切到 Redis / 多实例架构
- 不换成 token bucket / leaky bucket

---

## 2. 架构

### 2.1 请求生命周期

```
HTTP request
  ↓
  authMiddleware (从 API key 拿到 user)
  ↓
  rateLimitMiddleware (NEW) ← 滑动窗口计数 + IETF headers 注入
  ↓
  per-endpoint handler (auth/quota 检查)
  ↓
  response（headers 已注入；429 时短路返回）
```

### 2.2 模块拆分

| 模块 | 职责 | 文件 |
|------|------|------|
| `rate-limit/sliding-window.ts` | 纯算法：滑动窗口计数器，读写 SQLite | NEW |
| `rate-limit/middleware.ts` | Express middleware：检查 + 注入 headers | NEW |
| `rate-limit/headers.ts` | IETF `RateLimit-*` header 构造 | NEW |
| `rate-limit/soft-warning.ts` | 软警告判定（remaining < 20%） | NEW |
| `shared/constants.ts` | 阈值常量（更新 RATE_LIMIT_BURSTS，加 RATE_LIMIT_SOFT_WARN_RATIO / RATE_LIMIT_ALGO_VERSION） | MODIFY |
| `routes/{auth,headhunter,employer,candidate,users}.ts` | 在 authMiddleware 之后挂 rateLimitMiddleware | MODIFY（每 router 加一行） |
| `server.ts` | 不变（中间件在 router 内挂，不在 app 级别） | UNCHANGED |

### 2.3 中间件挂载点

- 挂在 `authMiddleware` 之后，路由 handler 之前
- 仅对 4 个受保护 router 的私有路由生效：
  - `/v1/users/me/*` 等
  - `/v1/headhunter/*`（除公开 dashboard / leaderboard 类的 GET，但当前该 router 全部走 auth）
  - `/v1/employer/*`
  - `/v1/candidate/*`
- **不**走新限流的 endpoint：
  - `/v1/auth/register`（已有自己的 IP 限流，5/h fixed-window，不动）
  - `/v1/health`、`/v1/skill.md`、`/v1/openapi.json`
  - `/v1/config/*`、`/v1/market/*`（公开 config 查表 + 排行榜）
  - `/view/*`、`/v1/views/*`（token-as-auth 模式）
  - `/metrics`、`/v1/metrics`（运维端点）
  - landing 页面（`/`）

### 2.4 DB schema

**不需新 migration**。复用 `rate_limit_buckets` 表（已有 `user_id`, `window_start`, `window_seconds`, `request_count`, `expires_at`）。新算法读取 2 个窗口的计数（current + previous），仍然只写 1 行 counter。

---

## 3. 算法：滑动窗口计数器

### 3.1 核心思想

Cloudflare-style 2-window 估算：用上一个窗口的计数 × 衰减权重 + 当前窗口的计数，近似"过去 N 秒"内的请求数。

### 3.2 公式

```
currentWindowStart  = floor(t / W) * W
previousWindowStart = currentWindowStart - W
elapsedInCurrent    = t - currentWindowStart   (0 < elapsed ≤ W)
weight              = (W - elapsed) / W        (previous 窗口的权重, 0 < weight < 1)

estimated_count = previous_count × weight + current_count
```

### 3.3 伪代码

```typescript
function check(userId: string, windowSeconds: number, limit: number): RateLimitResult {
  const now = new Date();
  const currentStart = bucketStart(now, windowSeconds);
  const previousStart = bucketStart(new Date(now.getTime() - windowSeconds * 1000), windowSeconds);
  const elapsed = (now.getTime() % (windowSeconds * 1000)) / 1000;
  const weight = (windowSeconds - elapsed) / windowSeconds;

  // 读两个窗口的计数（一次性 prepared statement，两行）
  const prev = readCount(userId, previousStart, windowSeconds);
  const curr = readCount(userId, currentStart, windowSeconds);

  // 估算（不增加当前窗口）
  const estimated = prev * weight + curr;
  if (estimated >= limit) {
    return {
      allowed: false,
      reason: 'RATE_LIMITED',
      violatedWindow: windowSeconds,
      retryAfterSeconds: Math.ceil(windowSeconds - elapsed),
      remaining: 0,
    };
  }

  // 写入 +1 到当前窗口
  upsertCount(userId, currentStart, windowSeconds);
  const newEstimated = prev * weight + curr + 1;
  return {
    allowed: true,
    remaining: Math.max(0, Math.floor(limit - newEstimated)),
    resetAfterSeconds: Math.ceil(windowSeconds - elapsed),
  };
}
```

### 3.4 三层叠加

每个请求对 `[1s, 60s, 3600s]` 三个窗口都跑一遍 `check`：
- 每个 `check` 调用独立返回它所在窗口的 `remaining` / `resetAfterSeconds`
- 全部 allowed → 放行；中间件把 3 个 `remaining` 和 3 个 `resetAfterSeconds` 直接拼成 header 值（顺序固定为 1s, 60s, 3600s）
- 任一 disallowed → 429；`violatedWindow` 是该窗口的**秒数**（`1` / `60` / `3600`），中间件再映射成 body 里的**名称**（`"second"` / `"minute"` / `"hour"`）；`Retry-After` = 3 个 `resetAfterSeconds` 中的**最大值**（最保守，让客户端等到所有窗口都恢复）

### 3.5 为什么不换 sliding-window-log

- sliding-window-log 存每个请求时间戳，DB 写入与 QPS 成正比
- 滑动窗口计数器 2 行/桶，IO 稳定
- 误差：窗口边界处 < 1 个请求，对限流决策无影响

---

## 4. IETF Headers + 软警告

### 4.1 成功响应（200/2xx）

所有受保护路由的 2xx 响应携带：

| Header | 示例值 | 含义 |
|---|---|---|
| `RateLimit-Limit` | `10, 50, 300` | 三个窗口上限，按 1s, 60s, 3600s 顺序 |
| `RateLimit-Remaining` | `8, 47, 285` | 三个窗口剩余 |
| `RateLimit-Reset` | `1, 34, 2105` | 三个窗口到下次重置的秒数 |

### 4.2 429 响应

| Header | 示例值 | 含义 |
|---|---|---|
| `RateLimit-Limit` | `10, 50, 300` | 同上 |
| `RateLimit-Remaining` | `0, 47, 285` | 同上 |
| `RateLimit-Reset` | `1, 34, 2105` | 同上 |
| `Retry-After` | `2105` | 最早能重试的秒数 = 3 个窗口 `resetAfterSeconds` 的最大值（最保守） |

body 形如：
```json
{
  "ok": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Burst rate limit exceeded",
    "details": {
      "violated_window": "hour",
      "retry_after_seconds": 2105
    }
  }
}
```

### 4.3 软警告

当**任一窗口** `remaining / limit < RATE_LIMIT_SOFT_WARN_RATIO (0.20)` 时，响应额外带：

| Header | 示例值 | 含义 |
|---|---|---|
| `RateLimit-Policy` | `warn` | IETF 扩展字段，标识策略提示 |
| `X-RateLimit-Warning` | `approaching-limit: hour window at 85%` | 人类可读的具体窗口与占用率 |

- 不阻断请求
- 仅作信号，客户端决定是否节流
- 触发条件：每窗口独立判断；多窗口同时触发时，warning 文案列出全部触发的窗口

### 4.4 客户端最佳实践（写入 skill.md）

- 主动读 `RateLimit-Remaining`
- 任一窗口 remaining < 20% 时主动降速
- 收到 `RateLimit-Policy: warn` 时按 `Retry-After` 调度退避
- 收到 429 时严格按 `Retry-After` 等待后再重试

---

## 5. 阈值常量

### 5.1 `src/shared/constants.ts` 改动

```typescript
// 旧值
export const RATE_LIMIT_BURSTS = {
  candidate:  { second: 10, minute: 50,  hour: 200 },
  headhunter: { second: 20, minute: 100, hour: 500 },
  employer:   { second: 30, minute: 200, hour: 800 },
} as const;

// 新值（1h × 1.5，1s/1min 不变）
export const RATE_LIMIT_BURSTS = {
  candidate:  { second: 10, minute: 50,  hour: 300 },
  headhunter: { second: 20, minute: 100, hour: 750 },
  employer:   { second: 30, minute: 200, hour: 1200 },
} as const;

// 新增：软警告触发阈值（remaining / limit 的下界）
export const RATE_LIMIT_SOFT_WARN_RATIO = 0.20;

// 新增：算法版本（用于紧急回滚 feature flag）
// 1 = fixed-window（已废弃，仅留作回滚点）
// 2 = sliding-window-counter（当前）
export const RATE_LIMIT_ALGO_VERSION = 2;
```

### 5.2 调整依据

- 1s 突发窗口（10-30/s）远高于真实 Agent 调用频率（典型 1-5/s），保持不变
- 1min 窗口（50-200/min）同理，保持不变
- 1h 窗口：fixed-window 下"窗口内 ≤ N"，sliding-window 下"任意 1 小时 ≤ N"——后者更严，所以 1.5x 抵消

### 5.3 不动的常量

- `QUOTA_PER_DAY`（candidate 50, headhunter 200, employer 100）—— 业务成本控制
- `QUOTA_COSTS` —— 各操作 quota 成本
- `RATE_LIMIT_WINDOW_SECONDS = [1, 60, 3600]` —— 三层时间窗
- `API_KEY_PREFIX_LENGTH = 12` —— 认证相关

---

## 6. 公开文档

### 6.1 `docs/superpowers/skill.md` 新增章节

```markdown
## 限流

所有认证请求受三层滑动窗口限流（1s / 60s / 3600s）：

| 用户类型 | 1s 突发 | 1min | 1h |
|---|---|---|---|
| candidate | 10 | 50 | 300 |
| headhunter | 20 | 100 | 750 |
| employer | 30 | 200 | 1200 |

每个响应包含 IETF `RateLimit-*` headers（Limit / Remaining / Reset），
你应**主动根据 Remaining 节流**，不要等到 429。

剩余 < 20% 时会有 `RateLimit-Policy: warn` 头 + `X-RateLimit-Warning` 提示。

429 时 `Retry-After` 给出秒数；body 形如：
{
  "ok": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "...",
    "details": { "violated_window": "hour", "retry_after_seconds": 1234 }
  }
}
```

### 6.2 `docs/superpowers/openapi.json` 同步

对每个受保护 endpoint：
- 每个 2xx 响应补 `headers` 段（`RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`）
- `429` 响应补全 schema（与 body 一致）

### 6.3 不新增 `GET /v1/users/me/rate-limit`

客户端从响应头即可拿到全部信息，无需单独查询 endpoint（少一次往返，节省 quota）。

---

## 7. 错误处理

| 场景 | 行为 | 理由 |
|---|---|---|
| DB 不可用（写 rate_limit_buckets 失败） | **Fail-open**：放行请求，记日志 + 增 `rate_limit_db_errors_total` 指标 | 限流器自身故障不应让业务全停 |
| 时钟回拨 | 用 `process.hrtime.bigint()` 计算 elapsed，不依赖墙钟 | NTP 校准不破坏窗口计算 |
| 用户跨窗口触限 | 429，`violated_window` = 实际超的那个 | 多窗口同时考虑，任一超即拒 |
| 短时间大量 429 | 不引入"违规次数"二级状态，滑动窗口自然恢复 | 简化状态机 |
| 客户端不读 headers | 仍会收到 429 + `Retry-After`，最坏情况等同 fixed-window | 头是优化项，不是必需 |
| IP register 限流 | 保持 fixed-window 5/h | 不在本次重构范围 |
| 多进程 / 多实例 | 单进程假设保持；多实例需换 Redis（out of scope） | 当前架构如此 |

### 7.1 监控指标（已有 prom-client）

- `rate_limit_decisions_total{result="allow"|"deny",user_type="candidate"|"headhunter"|"employer",window="1s"|"60s"|"3600s"}` —— 决策分布
- `rate_limit_db_errors_total` —— DB 写失败次数
- `rate_limit_soft_warn_total{user_type,window}` —— 软警告触发次数

---

## 8. 测试策略

### 8.1 单元测试

**`tests/unit/rate-limit/sliding-window.test.ts`**（纯算法）：
- 单窗口：低 limit 通过 / 达到 limit 拒绝
- 跨窗口：第 1 个窗口累积 50/100，第 2 个窗口刚开始时估算应正确
- 权重边界：`elapsed = 0`（weight=1）、`elapsed = window`（weight=0）两个极端
- 三层叠加：3 窗口都通过 / 1s 超 / 1min 超 / 1h 超
- 用 `vi.useFakeTimers()` 精确控制 `Date.now()`

**`tests/unit/rate-limit/headers.test.ts`**：
- 正常响应 header 顺序与格式
- 429 响应 `Retry-After` 等于 3 个窗口 reset 中的最大值
- 软警告触发：mock remaining 19% / 20% / 21% 三种情况

### 8.2 集成测试

**`tests/integration/rate-limit-headers.test.ts`**：
- supertest 打 `GET /v1/users/me`，断言 `RateLimit-Limit` 头存在且值正确
- 直接往 `rate_limit_buckets` 灌到 limit 边界，再请求，断言 429
- 校验 429 body 包含 `violated_window` 和 `retry_after_seconds`
- 校验 200 响应在"接近 limit"时携带 `RateLimit-Policy: warn`

### 8.3 回归

- 现有 `tests/integration/rate-limit.test.ts` 适配（bucket 表结构不变；可能需要 mock 时间）
- 现有 `tests/integration/e2e.test.ts` 不应被打破（E2E 不超限）

### 8.4 手动验证

`tests/load/rate-limit.js`（k6）扩展：
- 1 分钟内发 200 个 headhunter 请求
- 验证：前 ~100 个 200，后续 429 + `Retry-After` 接近 60
- 等待 60 秒后新请求恢复 200

---

## 9. 迁移与发布

### 9.1 Big-bang 切换

1. 部署新代码到 staging，跑 `tests/load/rate-limit.js` 5 分钟
2. 灰度 10% 流量 1 小时，观察 429 比例 + p99 latency
3. 100% 切流；保留旧 `rate_limit_buckets` 数据（不删）
4. 观察 24 小时，无异常即关单

### 9.2 Feature flag（紧急回滚）

```typescript
// src/shared/constants.ts
export const RATE_LIMIT_ALGO_VERSION = 2;
```

中间件首行：
```typescript
if (RATE_LIMIT_ALGO_VERSION !== 2) {
  // 切回 1 = 旧 fixed-window 逻辑（保留实现但默认不挂载）
  return next();
}
```

发布后如监控告警（`rate_limit_decisions_total{result="deny"}` > 3x 灰度前），改 flag 为 1 即回滚。

### 9.3 DB 迁移

**无**。`rate_limit_buckets` 表结构不变，新算法只换读法。

### 9.4 清理

旧 fixed-window 数据由 `cleanupExpired()` 定时清掉（已存在），7 天后自然消失。

### 9.5 客户端通知

发布前 1 周在 `docs/CHANGELOG.md` 与 README 公告：
- 算法变化（fixed → sliding）
- 阈值变化（1h × 1.5）
- 新增 IETF headers
- 推荐 Agent 实现节流逻辑

---

## 10. 风险与未决项

### 10.1 风险

| 风险 | 缓解 |
|---|---|
| 新算法有 bug 导致 429 暴增 | feature flag `RATE_LIMIT_ALGO_VERSION=1` 一键回滚 |
| 客户端没读 headers 大量 429 | CHANGELOG 提前 1 周公告 |
| 1h × 1.5 阈值挡不住真实滥用 | 灰度期看 `quota_used`；单独再调 |
| DB 故障致 fail-open 让 spammer 趁虚 | 监控 `rate_limit_db_errors_total`；超阈值人工干预 |

### 10.2 未决项

- 软警告客户端是否真会读取并节流 → 1 个月后看 `RateLimit-Policy: warn` 出现频次
- 1h × 1.5 是否过头 → 灰度期看 429 比例与真实用户行为
- Action history 是否要记 rate-limit 事件 → 当前不在 audit 范围，单独提

### 10.3 后续可考虑的演进（**不在本次范围**）

- IP register 限流改造（fixed → sliding）
- Per-endpoint 限流（昂贵 endpoint 单独再限）
- Token bucket 切换（如果未来需要支持明确 burst 上限）
- 多实例 / Redis 限流

---

## 11. 文件变更总览

### 11.1 新增

- `src/main/modules/rate-limit/sliding-window.ts`
- `src/main/modules/rate-limit/middleware.ts`
- `src/main/modules/rate-limit/headers.ts`
- `src/main/modules/rate-limit/soft-warning.ts`
- `tests/unit/rate-limit/sliding-window.test.ts`
- `tests/unit/rate-limit/headers.test.ts`
- `tests/integration/rate-limit-headers.test.ts`

### 11.2 修改

- `src/shared/constants.ts` —— 更新 RATE_LIMIT_BURSTS；新增 RATE_LIMIT_SOFT_WARN_RATIO、RATE_LIMIT_ALGO_VERSION
- `src/main/routes/users.ts` —— 挂 rateLimitMiddleware
- `src/main/routes/headhunter.ts` —— 挂 rateLimitMiddleware
- `src/main/routes/employer.ts` —— 挂 rateLimitMiddleware
- `src/main/routes/candidate.ts` —— 挂 rateLimitMiddleware
- `docs/superpowers/skill.md` —— 新增"限流"章节
- `docs/superpowers/openapi.json` —— 受保护 endpoint 补 headers / 429 schema
- `tests/load/rate-limit.js` —— 扩展 k6 场景
- `docs/CHANGELOG.md` —— 公告算法变化

### 11.3 不动

- `src/main/modules/rate-limit/bucket.ts` —— 旧 fixed-window 实现保留（仅作回滚点）
- `src/main/modules/register/handler.ts` —— IP register 限流（5/h）保持 fixed-window
- `src/main/server.ts` —— 中间件在 router 内挂
- DB schema —— 复用 `rate_limit_buckets`
- `tests/integration/rate-limit.test.ts` —— 适配后保留
- `tests/integration/e2e.test.ts` —— 不应被打破
