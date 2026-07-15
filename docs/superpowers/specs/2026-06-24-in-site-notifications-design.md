# Hunter Platform — 站内信（系统通知）Design

> **For agentic workers:** 这是 design spec，配套 implementation plan 在 `docs/superpowers/plans/2026-06-24-in-site-notifications-plan.md`。

**Goal:** 为平台增加**单向系统通知**（站内信）能力，覆盖猎头/雇主/候选人三方在关键业务事件（推荐接受/拒绝、解锁联系信息、查看简历、确认入职、佣金到账）发生时的实时感知。MVP 阶段**不发邮件**——通过 HTTP API 主动轮询拉取。

**Architecture:** 新增一个 `notifications` 表 + 一个 `notification` 模块 + 5 个 HTTP 端点 + 6 个集成点（直接调用 `trigger.notify()`，不引事件总线）。30 天 cron 清理过期数据。**零新依赖**。

**Tech Stack:** Node `crypto.randomUUID()`（已用）、`node:sqlite`（已用）、vitest + supertest（已用）、zod（已用）、node-cron（已用）、prom-client（已用）。无新依赖。

---

## 1. 背景与动机

### 1.1 业务缺口

平台 v1.8.0 已有完整业务流程（推荐 → 雇主接受 → 雇主解锁 → 入职确认 → 佣金发放），但**当事方完全不知道发生了什么**：

| 角色 | 缺什么 |
|------|--------|
| 猎头 | 推荐被雇主接受/拒绝后，无任何反馈，必须自己刷 API 查状态 |
| 雇主 | 解锁候选人联系信息后，无确认；候选人是否回复也无通知 |
| 候选人 | 谁看了我的简历？谁解锁了我的联系方式？入职确认通知？——全部没有 |

### 1.2 邮件方案评估后永久放弃

经评估，SMTP/第三方邮件服务（自建 SMTP、阿里云 DirectMail、抽象 Mailer 多驱动）在本项目均不合适：免费额度低、易进垃圾箱、ICP 备案周期长。

**最终采用**：
- **方案 A (开发/测试)**：OTP 仅 `console.log` 输出，零基础设施
- **方案 B (生产通知)**：站内信（本设计），由 `/v1/notifications/*` 承担所有业务通知职责

❌ **结论**：永久不接入 SMTP / 第三方邮件服务；邮件相关代码路径仅保留 console 输出。

### 1.3 站内信替代方案

- ✅ **零基础设施**（不动 SMTP/域名/备案）
- ✅ **零送达问题**（不走外部服务）
- ✅ **实时性更强**（轮询间隔可控）
- ✅ **隐私好**（数据不出平台）
- ✅ **AI Agent 友好**（项目本身就是 API-first）

### 1.4 设计原则

- **直接调用，不引事件总线**：6 个集成点全部 `trigger.notify()`，可读性 > 解耦
- **通知失败不影响主业务**：`notify()` 永远不抛错，吞掉异常记日志
- **同步写库**：SQLite 一行 INSERT 几十微秒，无需异步队列
- **轮询拉取，不推**：客户端定时调 `GET /v1/notifications?since=...`
- **30 天过期，不归档**：直接 `DELETE`，符合"通知是临时信号"语义
- **PII 不进通知**：title/body 只用公开字段（雇主名、推荐 ID），不塞加密的候选人姓名/手机

### 1.5 非目标

- ❌ 邮件 / 短信 / 推送通知（本期）
- ❌ 用户间双向聊天 / IM
- ❌ 通知订阅 / preference 设置
- ❌ Admin 通知管理端点
- ❌ 邮件验证码 / 邮箱验证
- ❌ 候选人邮件提交简历（IMAP 收件 + PDF 解析）
- ❌ 实时推送（WebSocket / SSE）—— 轮询足够
- ❌ 通知归档到冷存储——直接删

---

## 2. 架构总览

### 2.1 新增 capability 清单（共 5 个）

| Capability | 路径 | 角色 | 配额 |
|---|---|---|---|
| `notifications.list` | `GET /v1/notifications` | 任意已登录 | 0 |
| `notifications.get` | `GET /v1/notifications/:id` | 任意已登录 | 0 |
| `notifications.mark_read` | `POST /v1/notifications/:id/read` | 任意已登录 | 0 |
| `notifications.mark_all_read` | `POST /v1/notifications/read-all` | 任意已登录 | 0 |
| `notifications.delete` | `DELETE /v1/notifications/:id` | 任意已登录 | 0 |

### 2.2 数据模型

新增单表 `notifications`：

```sql
-- v016: 站内信 / 系统通知
CREATE TABLE notifications (
  id            TEXT PRIMARY KEY,            -- notif_<12位 uuid>
  user_id       TEXT NOT NULL REFERENCES users(id),
  category      TEXT NOT NULL,               -- 见 §2.3 枚举
  title         TEXT NOT NULL,               -- 人读标题
  body          TEXT,                        -- 可选详情（≤500 字符）
  payload_json  TEXT,                        -- 可选结构化数据
  read_at       TEXT,                        -- NULL=未读
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,               -- created_at + 30 天
  dedup_key     TEXT                         -- 可选：幂等去重键
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_expires ON notifications(expires_at);
CREATE UNIQUE INDEX idx_notifications_dedup
  ON notifications(user_id, category, dedup_key)
  WHERE dedup_key IS NOT NULL;
```

**关键设计**：
- `expires_at` 提前算好存进表，cron 删 `WHERE expires_at < now()` 即可
- `dedup_key` 可选字段：同 `(user_id, category, dedup_key)` 在未读时**替换**（重置 created_at），已读时插入新行
- 外键引用 `users(id)`，无 `ON DELETE CASCADE`——硬删用户是 admin 显式操作，应先清通知

### 2.3 category 枚举（MVP 6 个）

| category | 触发方 | 接收方 | 标题模板示例 |
|----------|--------|--------|--------------|
| `recommendation_accepted` | 雇主接受推荐 | 猎头 | `您的推荐已被 {{employer_name}} 接受` |
| `recommendation_rejected` | 雇主拒绝推荐 | 猎头 | `您的推荐被 {{employer_name}} 婉拒` |
| `unlock_granted` | 雇主解锁联系方式 | 候选人 | `{{employer_name}} 解锁了您的联系方式` |
| `candidate_viewed` | 雇主查看简历详情 | 候选人 | `{{employer_name}} 查看了您的简历` |
| `placement_confirmed` | 雇主确认入职 | 猎头 | `恭喜！候选人 {{candidate_name}} 已确认入职` |
| `commission_paid` | 平台发放佣金 | 猎头 | `佣金 {{amount}} 元已到账` |

### 2.4 模块边界

| 模块 | 职责 | 依赖 |
|------|------|------|
| `db/repositories/notifications.ts` | CRUD + dedup upsert | db |
| `modules/notification/handler.ts` | 业务方法（send/list/markRead/markAllRead/delete） | repo |
| `modules/notification/categories.ts` | category 枚举 + 标题模板 | 无 |
| `modules/notification/trigger.ts` | `notify()` 工厂（异常吞掉） | handler |
| `routes/notifications.ts` | HTTP 路由 + Zod 校验 | handler, auth, rate-limit |
| `schemas/notifications.ts` | Zod response schema | zod |
| `modules/cron/scheduler.ts` | 修改：注册 `notification-cleanup` 任务 | db |

### 2.5 复用现有模式

- **DB 连接 / 迁移**：`openDb()` + `runMigrations()`（`tests/integration/employer-unlock-contact.test.ts:13-16` 模式）
- **Repo 工厂**：`create<X>Repo(db)` 返回 prepared-statement 闭包（`src/main/db/repositories/action-history.ts:33-67` 模式）
- **Handler 工厂**：`create<X>Handler(db, ...deps)` 返回业务方法（`src/main/modules/headhunter/handler.ts:41-48` 模式）
- **路由**：`create<X>Router(db, ...)` 挂 `authMiddleware` + `createRateLimitMiddleware` + Zod + `respond(res, Schema, payload)`（`src/main/routes/headhunter.ts:33-57` 模式）
- **Cron 注册**：`registerJob(name, expression, fn)`（`src/main/modules/cron/scheduler.ts:27-37` 模式）
- **错误处理**：`Errors.xxx()` 从 `src/main/errors.ts`
- **ID 生成**：`randomUUID().slice(0, 12)` + 前缀（项目惯例）

---

## 3. API 端点设计

### 3.1 端点详细

| Method | Path | 用途 | 鉴权 |
|--------|------|------|------|
| `GET`    | `/v1/notifications` | 拉取列表（**主入口**） | ✅ |
| `GET`    | `/v1/notifications/:id` | 拉取单条 | ✅ |
| `POST`   | `/v1/notifications/:id/read` | 标记已读（幂等） | ✅ |
| `POST`   | `/v1/notifications/read-all` | 全部标记已读 | ✅ |
| `DELETE` | `/v1/notifications/:id` | 删除单条 | ✅ |

### 3.2 查询参数（GET list）

```
GET /v1/notifications
  ?unread=true                   # 仅未读
  &category=unlock_granted       # 按 category 过滤
  &since=2026-06-24T00:00:00Z    # 增量拉取（轮询关键）
  &limit=50                      # 默认 50，max 200
  &offset=0                      # 分页
```

**轮询推荐**：
```http
GET /v1/notifications?since=2026-06-24T09:55:00Z&limit=50
Authorization: Bearer <API_KEY>
```

Agent 维护 `latest_seen_at`，下次用 `since=<latest_seen_at>` 拉增量。

### 3.3 响应结构

**GET list**：
```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "notif_a1b2c3d4e5f6",
        "category": "recommendation_accepted",
        "title": "您的推荐已被 字节跳动 接受",
        "body": "候选人张三的简历已被雇主解锁。",
        "payload": { "recommendation_id": "rec_xyz", "employer_id": "user_emp1" },
        "read_at": null,
        "created_at": "2026-06-24T10:00:00.000Z",
        "expires_at": "2026-07-24T10:00:00.000Z"
      }
    ],
    "unread_count": 5,
    "has_more": false
  }
}
```

**POST /:id/read**：
```json
{ "ok": true, "data": { "id": "notif_a1b2c3d4e5f6", "read_at": "2026-06-24T10:05:00.000Z" } }
```

### 3.4 错误码

| 场景 | 错误码 | HTTP |
|------|--------|------|
| 未鉴权 | `UNAUTHORIZED` | 401 |
| 通知不存在 / 不属于当前用户 | `NOT_FOUND` | 404 |
| 重复 mark-read | 幂等返回当前 `read_at` | 200 |
| Zod 校验失败 | `INVALID_PARAMS` | 400 |

### 3.5 权限模型

- **读取/标记/删除**：调用方只能操作 `notifications.user_id = req.user.id` 的行（repo 层用 `user_id` 过滤）
- **写入（创建通知）**：**只有服务端** `trigger.notify()` 能写，**不提供 `POST /v1/notifications` 端点**

---

## 4. 触发器设计

### 4.1 核心抽象

```typescript
// src/main/modules/notification/trigger.ts
export interface NotificationInput {
  userId: string;
  category: NotificationCategory;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
  dedupKey?: string;
}

export function createNotificationTrigger(db: DB) {
  const handler = createNotificationHandler(db);
  return {
    notify(input: NotificationInput): void {
      try {
        handler.send(input);
      } catch (e) {
        // 关键：通知失败绝不影响主业务
        console.error('[notification trigger] failed', { category: input.category, userId: input.userId, err: e });
      }
    }
  };
}
```

**3 个铁律**：
1. **不抛异常** —— `notify()` 永远不抛错
2. **同步写库** —— 不入队列
3. **幂等** —— `dedupKey` 撞到时按规则 upsert

### 4.2 6 个集成点

| category | 集成位置 | 调用示例 |
|----------|----------|----------|
| `recommendation_accepted` | `src/main/modules/employer/handler.ts` 接受推荐分支 | `trigger.notify({ userId: rec.headhunter_id, category: 'recommendation_accepted', title: \`您的推荐已被 ${emp.name} 接受\`, payload: { recommendation_id: rec.id }, dedupKey: \`rec:${rec.id}:accept\` })` |
| `recommendation_rejected` | 同上，拒绝分支 | 同上模式 |
| `unlock_granted` | `src/main/modules/employer/handler.ts` `unlockContact` 成功后 | `trigger.notify({ userId: candidate.user_id, category: 'unlock_granted', title: \`${emp.name} 解锁了您的联系方式\`, payload: { recommendation_id: rec.id }, dedupKey: \`unlock:${candidate.id}:${emp.id}\` })` |
| `candidate_viewed` | `src/main/modules/employer/handler.ts` 查看简历详情 GET 端点 | `dedupKey: \`view:${candidate.id}:${emp.id}\` 合并多次查看 |
| `placement_confirmed` | `src/main/modules/commission/handler.ts` `confirmPlacement` 成功后 | `trigger.notify({ userId: headhunter.id, category: 'placement_confirmed', title: \`恭喜！候选人 ${cand.name} 已确认入职\`, payload: { placement_id, job_id } })` |
| `commission_paid` | 同上，发放佣金后 | `trigger.notify({ userId: headhunter.id, category: 'commission_paid', title: \`佣金 ${amount} 元已到账\`, payload: { placement_id, amount } })` |

### 4.3 dedup 行为

| 当前状态 | 新通知 dedupKey 撞到 | 行为 |
|----------|----------------------|------|
| 不存在 | — | 插入新行 |
| 存在，**未读** | 同 | **替换** title/body/payload，**重置 created_at**（避免被 30 天过期） |
| 存在，**已读** | 同 | **插入新行**（已读不再代表用户关注） |
| 存在，已过期 | 同 | 插入新行（已被 cron 清了） |

**实现**：`INSERT ... ON CONFLICT(user_id, category, dedup_key) DO UPDATE SET ... WHERE read_at IS NULL`

### 4.4 事务边界

**触发器调用必须在主业务事务内**：

```typescript
db.transaction(() => {
  // 1. 业务变更
  unlockRepo.markUnlocked(...);
  auditRepo.insert(...);
  // 2. 触发通知（同事务）
  trigger.notify({ ... });
})();
```

- **原子性**：通知和业务变更要么都成功，要么都失败
- **可读性**：客户端轮询时，事务提交后才能拉到通知——符合预期

### 4.5 不做的事

- ❌ 不引事件总线（YAGNI）
- ❌ 不做异步队列（SQLite 同步够快）
- ❌ 不写 action_history（主 handler 已写）
- ❌ 不提供 trigger 全局单例（必须通过 factory 拿，避免测试数据库混乱）

---

## 5. 清理 Cron + 错误处理 + 边界情况

### 5.1 清理过期数据

挂到现有 `src/main/modules/cron/scheduler.ts`，**每天 UTC 02:00**：

```typescript
// scheduler.ts 修改
registerJob('notification-cleanup', '0 2 * * *', () => cleanupExpiredNotifications(useDb));

function cleanupExpiredNotifications(db?: DB): void {
  const d = db ?? getDb();
  const result = d.prepare('DELETE FROM notifications WHERE expires_at < ?')
    .run(new Date().toISOString());
  console.log(`[cron notification-cleanup] deleted ${result.changes} expired notifications`);
}
```

> **不用 SQLite 触发器**——简单可见，运维能 grep；失败可重试。

### 5.2 错误处理矩阵

| 场景 | 行为 | 错误码 |
|------|------|--------|
| `trigger.notify()` 写库失败 | `console.error`，**吞掉异常** | — |
| HTTP 查询失败 | 标准 `next(e)` 中间件 | `INTERNAL_ERROR` 500 |
| 标记不属于自己的通知 | repo 层 `user_id` 过滤，更新 0 行 | `NOT_FOUND` 404 |
| 删除不属于自己的通知 | 同上 | `NOT_FOUND` 404 |
| mark-read 重复调用 | 幂等，返回**当前** `read_at` | 200 |
| Zod 校验失败 | `Errors.invalidParams(...)` | 400 |
| limit > 200 | 路由层 cap 到 200 | 200 |
| cron 清理失败 | `console.error` | — |

### 5.3 边界情况

**a) 用户软删除（`status='deleted'`）**
- 通知保留——属于历史
- 软删用户调 API 会被 `authMiddleware` 拒绝（`status='active'` 校验），无越权
- Admin 端点未来可读——合理

**b) 用户硬删除**
- 当前 schema 无 `ON DELETE CASCADE`
- 硬删前应先 `DELETE FROM notifications WHERE user_id = ?`
- 后续如需 CASCADE，写新 migration

**c) payload 含加密字段**
- **禁止**把 `candidates_private.name_enc` 等塞到 `payload_json`
- 集成点检查清单：payload 只能含**已公开**字段 ID
- 测试时验证：通知 body/title 走脱敏函数

**d) 时钟漂移**
- 所有时间用服务端 `new Date().toISOString()`
- `since` 是查询优化，DB 端 `created_at` 是权威时间

**e) 并发**
- SQLite 单写锁，trigger 同步写在事务内**已串行化**
- 无需 advisory lock

### 5.4 性能 & 容量

| 指标 | 估算 | 备注 |
|------|------|------|
| 通知量 | < 50/天 | 即使 10x 放大也才 500/天 |
| 30 天保留总行数 | < 1500 | SQLite 随便扛 |
| 单次 `GET /v1/notifications` | 微秒级 | 索引覆盖 `user_id + read_at + created_at` |
| `unread_count` | 微秒级 | 每次现算 |
| cron 清理 | < 10ms | 单条 `DELETE` |

**不做**：分页游标 / 物化视图 / Redis 缓存（YAGNI）

### 5.5 可观测性

复用 `prom-client`（`src/main/modules/metrics/`），加 3 个指标：

```
notifications_sent_total{category}              # 发送总数
notifications_send_errors_total{category,error} # 发送失败数
notifications_cleanup_deleted_total            # cron 清理行数
```

暴露在 `/v1/metrics`（项目已有）。

---

## 6. 测试策略

### 6.1 测试分层

| 层 | 文件 | 范围 |
|----|------|------|
| 单元 - repo | `tests/integration/repos/notifications.test.ts` | 真 SQLite temp，测 SQL/索引/dedup |
| 单元 - trigger | `tests/unit/notification/trigger.test.ts` | 直接调 `trigger.notify()`，验失败不抛 |
| 单元 - cron | `tests/unit/notification/cleanup-cron.test.ts` | 注入过期数据，验清理 |
| 集成 - HTTP | `tests/integration/notifications.test.ts` | supertest 启 app，验路由+鉴权+Zod |
| 集成 - 触发点 | **修改**现有测试加断言 | `employer-unlock-contact.test.ts` 等 |

### 6.2 单元测试 - repo（8 个 case）

```typescript
describe('notifications repo', () => {
  it('insert + findById returns the row')
  it('listByUser returns newest first')
  it('listByUser with unread=true filters out read rows')
  it('listByUser with since filters old rows')
  it('listByUser respects limit and offset')
  it('upsert with same dedupKey + unread → updates existing, resets created_at')
  it('upsert with same dedupKey + read → inserts new row')
  it('upsert with NULL dedupKey → always inserts (no dedup)')
});
```

### 6.3 单元测试 - trigger（5 个 case）

```typescript
describe('notification trigger', () => {
  it('notify() writes a row with correct expires_at = created_at + 30 days')
  it('notify() swallows DB errors (does not throw)')
  it('notify() with dedupKey replaces existing unread row')
  it('notify() payload is JSON-serialized to payload_json')
  it('notify() with no payload stores NULL')
});
```

### 6.4 单元测试 - cron（3 个 case）

```typescript
describe('notification cleanup cron', () => {
  it('deletes rows where expires_at < now')
  it('keeps rows where expires_at > now')
  it('logs the deleted count via console.log (smoke check via spy)')
});
```

### 6.5 集成测试 - HTTP（10 个 case）

```typescript
describe('GET /v1/notifications', () => {
  it('returns 401 without auth')
  it('returns 200 with empty list when no notifications')
  it('returns user own notifications only (not others)')
  it('filters by unread=true')
  it('filters by since=ISO')
  it('filters by category')
  it('caps limit at 200')
});

describe('POST /v1/notifications/:id/read', () => {
  it('marks own notification as read')
  it('returns 404 for other user notification')
  it('is idempotent (calling twice returns same read_at)')
});

describe('DELETE /v1/notifications/:id', () => {
  it('deletes own notification')
  it('returns 404 for other user notification')
});

describe('POST /v1/notifications/read-all', () => {
  it('marks all unread as read')
  it('does not affect already-read rows')
});
```

### 6.6 集成测试 - 触发点（6 个 trigger 集成点加 6 行断言）

**复用**已有测试，**不新建文件**：

```typescript
// 在 tests/integration/employer-unlock-contact.test.ts 里加：
import { createNotificationTrigger } from '../../src/main/modules/notification/trigger';
const localNotifTrigger = createNotificationTrigger(localDb);

// 在 'unlockContact enqueues deliver_contact webhook' 那个 it() 里加：
localNotifTrigger.notify({ userId: 'c1', category: 'unlock_granted', title: '...', dedupKey: '...' });
const list = localNotifs.listByUser('c1', {});
expect(list.length).toBe(1);
expect(list[0].category).toBe('unlock_granted');
```

> **决策**：trigger 通过依赖注入传 `createEmployerHandler(db, ..., trigger)`，避免 handler 直接 import `db`。

### 6.7 覆盖率目标

| 模块 | 行覆盖 | 分支覆盖 |
|------|--------|----------|
| `db/repositories/notifications.ts` | ≥ 95% | ≥ 90% |
| `modules/notification/trigger.ts` | 100% | 100% |
| `routes/notifications.ts` | ≥ 90% | ≥ 85% |
| `modules/notification/categories.ts` | 100% | 100% |

### 6.8 不做的事

- ❌ 不写 e2e/notifications.test.ts（HTTP 集成测试已覆盖）
- ❌ 不写 load test（< 50/天量级，测了也跑不到拐点）
- ❌ 不写 admin 通知管理测试（MVP 无该端点）
- ❌ 不测 trigger 失败的 console.error 输出（只验证不抛）
- ❌ 不写 mutation/fuzz 测试（SQL 全部参数化）

---

## 7. 实施检查清单

按依赖顺序排列：

1. ✅ **DB 迁移**：`src/main/db/migrations/v016_notifications.sql` + 在 migrations runner 注册
2. ✅ **Repo**：`src/main/db/repositories/notifications.ts`（insert/findById/listByUser/markRead/markAllRead/delete/upsert）
3. ✅ **Handler**：`src/main/modules/notification/handler.ts`（业务方法）
4. ✅ **Categories**：`src/main/modules/notification/categories.ts`（枚举 + 标题模板）
5. ✅ **Trigger**：`src/main/modules/notification/trigger.ts`（工厂 + 异常吞掉）
6. ✅ **Schemas**：`src/main/schemas/notifications.ts`（Zod response）
7. ✅ **Routes**：`src/main/routes/notifications.ts`（5 个端点 + 鉴权 + Zod）
8. ✅ **Server 注册**：在 `src/main/server.ts` 挂载 `/v1/notifications` 路由
9. ✅ **Trigger 集成**：
   - `src/main/modules/employer/handler.ts` 接受/拒绝推荐 + `unlockContact` + 简历查看
   - `src/main/modules/commission/handler.ts` 确认入职 + 发放佣金
   - 各 handler factory 加 `trigger` 依赖
10. ✅ **Cron 注册**：在 `src/main/modules/cron/scheduler.ts` 加 `notification-cleanup`
11. ✅ **Metrics**：在 `src/main/modules/metrics/` 加 3 个 prom-client 指标
12. ✅ **能力注册**：在 `src/main/capabilities/` 暴露 5 个新 capability 名
13. ✅ **Skill.md 更新**：在 `docs/superpowers/skill.md` 增加 notifications 端点文档
14. ✅ **OpenAPI 更新**：在 `docs/superpowers/openapi.json` 增加 5 个端点
15. ✅ **测试**：单元 + 集成 + 触发点断言（如 §6）
16. ✅ **capabilities:check + conformance:check**：通过

---

## 8. 风险与回滚

| 风险 | 影响 | 缓解 |
|------|------|------|
| trigger 写库失败被吞，无可见报警 | 通知丢失 | `prom-client` 暴露 `notifications_send_errors_total`，Grafana 告警 |
| 30 天后通知直接删，agent 误以为没新事件 | 用户感知不到 | `since` 已过滤掉已过期；`has_more` 提示分页 |
| dedupKey 撞到且已读，重复发 | 用户感觉"消息刷屏" | 已读后再发是预期行为（再触达）；如不喜欢可调规则 |
| 通知量随业务增长失控 | DB 撑爆 | < 50/天规模 30 天 < 1500 行；如增长到 10x 加归档 |

**回滚方案**：
- DB：删 `notifications` 表 + 删 v016 migration 应用记录
- 代码：revert 集成点的 `trigger.notify()` 调用（一行 revert）
- Cron：从 scheduler 删 `notification-cleanup` 注册
- 全部回滚 < 30 分钟

---

## 9. 未来扩展（不在本期）

- **SSE 推送**：`GET /v1/notifications/stream` 长连接
- **WebHook 推送**：复用现有 `agent_endpoint`，加 retry 队列
- **通知订阅 / preference**：用户可关闭某 category
- **Admin 通知管理**：`GET /v1/admin/users/:id/notifications`
- **聚合通知**：同一 category 1 小时内的多条合并成 1 条（"您有 3 条新推荐被接受"）
