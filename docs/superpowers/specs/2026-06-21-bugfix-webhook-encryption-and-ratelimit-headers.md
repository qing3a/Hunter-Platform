# Bug 修复 Spec — Webhook Payload 加密 + RateLimit Headers

**状态**: Draft
**日期**: 2026-06-21
**作者**: 自查报告（基于其他 AI 测试报告 `C:\Users\Administrator\Desktop\hunter_test_report.md`）
**优先级**: Bug 1 = P0（业务功能失效）｜ Bug 2 = P1（违反文档契约）
**前置**: 已存在的 v4 landing 改动 / 不动其他模块

---

## 1. 概述

### 1.1 一句话定义

修复其他 AI 测试发现的两处 bug：
- **Bug 1 (P0)**：`notify_unlock_approved` 和 `placement_created` 两个 webhook 事件 payload 入队时未加密，worker `decrypt()` 必失败 → 3 次重试 → dead_letter
- **Bug 2 (P1)**：`.env` 默认 `RATE_LIMIT_ENABLED=false` 时，受保护端点不返回 `RateLimit-*` 响应头，违反 `skill.md §5.4` 承诺

### 1.2 触发原因

外部 AI 测试 `http://localhost:3000` 完整功能后，写入报告：
- 49 项断言通过（注册/认证/RBAC/状态机/4 步解锁/跨猎头分账/GDPR/view_url 单次性/UTF-8 校验/7 参数 talent 过滤/公开 market/Admin/OpenAPI）
- **2 项真实缺陷**

本 spec 是对这 2 项缺陷的修复方案。

### 1.3 目标

1. Bug 1：3 处代码改动 + 1 处类型签名扩展 → 4 个 webhook 事件全部能正常投递
2. Bug 2：1 处 middleware 改动 + 1 处 .env 注释 → 默认配置下 `RateLimit-*` 始终返回

### 1.4 非目标

- ❌ 不动 `webhook_delivery_queue` 表结构
- ❌ 不重写 webhook worker
- ❌ 不改 `aes-gcm.ts` 的 `encrypt()` / `decrypt()` 接口
- ❌ 不动其他任何已通过的端点（49 项）
- ❌ 不改 skill.md §5.4 的承诺内容（保留"每个受保护 endpoint 都带 RateLimit-* headers"）
- ❌ 不做其他 AI 报告中 P2 项（rotate-key、access-log、commission 实际分账的测试用例）

---

## 2. Bug 1 修复设计 — Webhook Payload 加密

### 2.1 根因（已核实）

| 角色 | 文件:行 | 当前代码 | 期望 |
|---|---|---|---|
| ❌ Bug | `src/main/modules/candidate/handler.ts:111` | `payload_enc: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')` | `payload_enc: encrypt(encryptionKey, JSON.stringify(payload))` |
| ❌ Bug | `src/main/modules/commission/handler.ts:108` | 同上 | 同上 |
| ✅ 正常 | `src/main/modules/employer/handler.ts:187, 260` | `const payloadEnc = encrypt(ctx.encryptionKey, JSON.stringify(payload))` | （无需改） |
| ✅ Worker | `src/main/modules/webhook/worker.ts:46` | `decrypt(encryptionKey, rec.payload_enc)` | （无需改） |

**`aes-gcm.ts:24` 强制要求 `v1:` 前缀**，base64 明文没有前缀 → decrypt 抛错 → dead_letter。

### 2.2 改动详情

#### 文件 1: `src/main/modules/candidate/handler.ts`

**Step A**：扩展函数签名接收 `encryptionKey`
```typescript
// Before:
export function createCandidateHandler(db: DB) {

// After:
export function createCandidateHandler(db: DB, encryptionKey: Buffer) {
```

**Step B**：在文件顶部加 import
```typescript
import { encrypt } from '../crypto/aes-gcm.js';
```

**Step C**：修复 line 111
```typescript
// Before:
payload_enc: Buffer.from(JSON.stringify(approvePayload), 'utf8').toString('base64'),

// After:
payload_enc: encrypt(encryptionKey, JSON.stringify(approvePayload)),
```

#### 文件 2: `src/main/modules/commission/handler.ts`

**Step A**：检查函数签名是否已接收 `encryptionKey`
- 如果未接收 → 扩展签名（与 candidate 相同模式）
- 如果已接收 → 直接进入 Step B

**Step B**：在文件顶部加 import（如果还没有）
```typescript
import { encrypt } from '../crypto/aes-gcm.js';
```

**Step C**：修复 line 108
```typescript
// Before:
const payload_enc = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

// After:
const payload_enc = encrypt(encryptionKey, JSON.stringify(payload));
```

#### 文件 3: `src/main/routes/candidate.ts`

**修复 line 14**：把 `encryptionKey` 传给 handler
```typescript
// Before:
const handler = createCandidateHandler(db);

// After:
const handler = createCandidateHandler(db, encryptionKey);
```

> **验证**：line 12 已声明 `createCandidateRouter(db: DB, encryptionKey: Buffer)`，`encryptionKey` 在作用域内可用。

#### 文件 4（按需）: `src/main/routes/commission.ts`

如果 `createCommissionHandler` 没接收 `encryptionKey` → 改 `createCommissionRouter(db)` 为 `createCommissionRouter(db, encryptionKey)`，并向下传递。

### 2.3 行为对照表（修复后）

| 事件 | 入队 payload_enc | Worker 解密 | 投递 |
|---|---|---|---|
| `notify_unlock_request` | `v1:...` (encrypt) | ✅ | ✅ |
| `deliver_contact` | `v1:...` (encrypt) | ✅ | ✅ |
| `notify_unlock_approved` (修后) | `v1:...` (encrypt) | ✅ | ✅ |
| `placement_created` (修后) | `v1:...` (encrypt) | ✅ | ✅ |

### 2.4 测试

#### 单元测试（新增 `tests/unit/webhook-encryption-fix.spec.ts`）

| 测试 | 验证 |
|---|---|
| `createCandidateHandler` 调用后，写入 `webhook_delivery_queue` 的 `payload_enc` 以 `v1:` 开头 | 用 `:memory:` db，调用 `approveUnlock`，断言 `rec.payload_enc.startsWith('v1:')` |
| `createCommissionHandler` 调用后，写入 `webhook_delivery_queue` 的 `payload_enc` 以 `v1:` 开头 | 同样断言 |
| Worker 拿到新格式 `v1:...` payload 能成功 decrypt | 调 `processBatch` 用真实 encryptionKey，断言 `delivered++` |
| Worker 解密结果 = 原始 JSON | decrypt 后 `JSON.parse` 字段与入队前一致 |

#### 集成测试（扩展 `tests/integration/webhook-delivery.test.ts`）

| 测试 | 验证 |
|---|---|
| `approve-unlock` 后，对应 `notify_unlock_approved` 入队，payload_enc 以 `v1:` 开头 | 走完整路由 |
| `placements` 创建后，对应 `placement_created` 入队，payload_enc 以 `v1:` 开头 | 走完整路由 |

### 2.5 错误处理

| 场景 | 行为 |
|---|---|
| `encryptionKey` 长度 ≠ 32 字节 | `encrypt()` 抛错 `Key must be 32 bytes` → handler catch → 返回 500（与现有 handler 一致） |
| 测试环境 `encryptionKey = Buffer.alloc(32)` | 不变，handler 调用方负责 |
| 历史 dead_letter 行（已存在 base64 数据） | 不主动清理；worker 仍会失败但不再新增。新事件正常投递 |

---

## 3. Bug 2 修复设计 — RateLimit Headers 始终返回

### 3.1 根因（已核实）

**`src/main/modules/rate-limit/middleware.ts:26-29`**：
```typescript
if (process.env.RATE_LIMIT_ENABLED === 'false' || req.headers['x-ratelimit-skip'] === '1') {
  next();
  return;
}
```

**`.env` 当前**：
```
RATE_LIMIT_ENABLED=false
```

**结果**：默认配置下，middleware 不调 `applyRateLimitHeaders()`，响应头里没有 `RateLimit-*`，违反 `skill.md §5.4` 承诺。

**`skill.md §5.4`** 原文：
> 每个受保护 endpoint 都带 IETF `RateLimit-*` headers

（无 env 限定）

### 3.2 修复策略（方案 B — 推荐）

**核心思想**：kill switch 仍生效（dev/test 不限流），但**始终返回 header**，标记为 `unlimited`。

**改动详情**：

#### 文件 1: `src/main/modules/rate-limit/middleware.ts`

**Step A**：把 kill switch 的 `next()` 改成"emit unlimited headers + next"

**Step B**：把 `RateLimit-Policy: warn` 也兼容 `unlimited`

修改后的相关代码段：
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
  // Use a sentinel: Limit=-1 means "unlimited".
  res.setHeader('RateLimit-Limit', '-1');
  res.setHeader('RateLimit-Remaining', '-1');
  res.setHeader('RateLimit-Reset', '0');
  res.setHeader('RateLimit-Policy', 'unlimited');
  if (skipHeader) res.setHeader('X-RateLimit-Skip', '1'); // preserve existing debug header
  next();
  return;
}
```

> **设计选择**：`Limit=-1` 是行业常见做法（GitHub API 在 `X-RateLimit-Limit` 用 0 / -1 表示无限）。`-1` 不会被误读为"已耗尽"（已有 0 的用法），且 agent 容易判断 `parseInt(...) === -1` → 跳过节奏控制。

#### 文件 2: `.env.example`（如果存在）+ `.env`

在 `RATE_LIMIT_ENABLED=false` 那行加注释：

```bash
# When false, RateLimit-* headers still emitted with Limit=-1 (unlimited) for §5.4 compliance.
# When true, sliding-window enforced and headers reflect real remaining/limit.
RATE_LIMIT_ENABLED=false
```

#### 文件 3: `docs/superpowers/skill.md` §5.4

加一个澄清脚注（不改变承诺，只是注明 kill switch 行为）：

```markdown
> 注：当 `RATE_LIMIT_ENABLED=false` 时，`RateLimit-Limit: -1` 表示当前无限流，agent 仍可按 §14.1 节奏正常工作。
```

### 3.3 行为对照表（修复后）

| 配置 | 响应头 |
|---|---|
| `RATE_LIMIT_ENABLED=true` | `RateLimit-Limit: 20,100,750` / `Remaining: 18,98,745` / `Reset: 1,45,2105`（与现状一致） |
| `RATE_LIMIT_ENABLED=false`（默认）| `RateLimit-Limit: -1` / `Remaining: -1` / `Reset: 0` / `RateLimit-Policy: unlimited` |
| `X-RateLimit-Skip: 1` | 同上 + `X-RateLimit-Skip: 1` |

### 3.4 测试

#### 单元测试（扩展 `tests/unit/rate-limit-headers.spec.ts` 或 `tests/unit/rate-limit-middleware.spec.ts`）

| 测试 | 验证 |
|---|---|
| `RATE_LIMIT_ENABLED=false` 时，`RateLimit-Limit=-1` 等 4 个 header 存在 | mock res，断言 `res.setHeader` 被调 |
| `RATE_LIMIT_ENABLED=true` 时仍走原逻辑 | 行为不变 |
| `X-RateLimit-Skip: 1` 单独触发 skip | skip header + 4 个 unlimited header |

#### 集成测试

| 测试 | 验证 |
|---|---|
| `GET /v1/users/{id}/status` 默认配置下响应包含 `RateLimit-Limit: -1` | supertest + 断言 |
| `GET /v1/users/{id}/status` `RATE_LIMIT_ENABLED=true` 下响应包含 3 窗口限制 | 同上 |

### 3.5 错误处理

| 场景 | 行为 |
|---|---|
| Agent 收到 `Limit: -1` 后误以为 0 quota | 这是 agent 实现的责任，文档 §5.4 注明 `-1 = unlimited` |
| `parseInt('-1') === -1` 误判为负数 | agent 应 `>= 0` 判断是否有限 |

---

## 4. 文件变更总览

### 4.1 修改

| 文件 | 改动 | 估算行数 |
|---|---|---|
| `src/main/modules/candidate/handler.ts` | 加 import + 改签名 + 修 line 111 | +3 -1 |
| `src/main/modules/commission/handler.ts` | 加 import + 改签名（如未接）+ 修 line 108 | +3 -1 |
| `src/main/routes/candidate.ts` | line 14 传 encryptionKey | +1 -1 |
| `src/main/routes/commission.ts` | line N 传 encryptionKey（如果 commission handler 改了） | +1 -1 |
| `src/main/modules/rate-limit/middleware.ts` | kill switch 分支 emit unlimited headers | +12 -2 |
| `.env` | 加注释说明 §5.4 行为 | +3 |
| `docs/superpowers/skill.md` §5.4 | 加脚注 | +3 |
| `tests/unit/webhook-encryption-fix.spec.ts` | 新测试 | +60 |
| `tests/integration/webhook-delivery.test.ts` | 扩展 2 个断言 | +20 |
| `tests/unit/rate-limit-headers.spec.ts` | 新测试 | +40 |
| `tests/integration/landing-v4.test.ts`（或新文件） | 加 RateLimit header 集成测试 | +15 |

### 4.2 不动

- `src/main/modules/crypto/aes-gcm.ts`（encrypt/decrypt 接口不变）
- `src/main/modules/webhook/worker.ts`（decrypt 调用不变）
- `src/main/modules/employer/handler.ts`（已正确加密）
- 数据库 schema（无新字段 / 无新表）
- `package.json`（无新依赖）

---

## 5. 数据流（修复后）

### Bug 1 修复

```
[雇主] POST /v1/employer/recommendations/{id}/express-interest
  ↓
[handler] payload → encrypt(key, JSON.stringify(payload)) → payload_enc = "v1:..."
  ↓
[DB]    INSERT INTO webhook_delivery_queue (payload_enc='v1:...')
  ↓
[Worker] decrypt(key, 'v1:...') → plaintext JSON → POST to agent → success
  ↓
[雇主 agent] 收到 notify_unlock_approved ✅
```

### Bug 2 修复

```
[Agent] GET /v1/users/{id}/status
  ↓
[middleware] RATE_LIMIT_ENABLED=false → emit RateLimit-Limit: -1, etc. → next()
  ↓
[handler] 200 OK + 4 unlimited RateLimit headers
  ↓
[Agent] 收到 headers → §14.1 节奏正常决策 ✅
```

---

## 6. 测试策略

### 6.1 单元测试（不依赖 Express）

- `webhook-encryption-fix.spec.ts`:
  - 用 `:memory:` db + mock encryptionKey
  - 调 `createCandidateHandler(db, key)` / `createCommissionHandler(db, key)`
  - 验证 webhook 入队时 payload_enc 以 `v1:` 开头
  - 调 worker `processBatch`，验证 `delivered = N`，`dead_letter = 0`

- `rate-limit-headers.spec.ts`:
  - mock req + res
  - 验证 kill switch 路径调 `setHeader('RateLimit-Limit', '-1')` 等

### 6.2 集成测试

- 复用 `createApp()` + `:memory:` db
- supertest 调用真实路由
- 验证响应头包含期望的 RateLimit headers
- 验证 webhook 入队后 worker 能解密

### 6.3 手工 smoke

```bash
# Bug 1 smoke
curl -X POST .../recommendations/{id}/approve-unlock
# 然后查 DB:
sqlite3 tmp/hunter.db "SELECT event_type, substr(payload_enc,1,5) FROM webhook_delivery_queue WHERE event_type IN ('notify_unlock_approved', 'placement_created')"
# 期望: 全是 'v1:xx'

# Bug 2 smoke
curl -D - .../v1/users/{id}/status -H "Authorization: Bearer ..."
# 期望响应头有 RateLimit-Limit: -1
```

---

## 7. 实现路径（4 个 phase）

### Phase 1 — Bug 1 修复
- T1.1: `candidate/handler.ts` 加 encrypt import + 改签名 + 修 line 111
- T1.2: `commission/handler.ts` 同样修复
- T1.3: `routes/candidate.ts` line 14 传 key
- T1.4: `routes/commission.ts` 同样（如需）
- T1.5: 单元测试 `webhook-encryption-fix.spec.ts`
- T1.6: 集成测试扩展

### Phase 2 — Bug 2 修复
- T2.1: `middleware.ts` kill switch emit unlimited headers
- T2.2: `.env` 加注释
- T2.3: `skill.md` §5.4 加脚注
- T2.4: 单元测试 `rate-limit-headers.spec.ts`
- T2.5: 集成测试扩展

### Phase 3 — 回归
- T3.1: `pnpm typecheck`
- T3.2: `pnpm test` 全量（确认 488+ 测试仍 pass）
- T3.3: 手动 smoke

### Phase 4 — 收尾
- T4.1: 重启 dev server
- T4.2: curl 实测
- T4.3: commit

---

## 8. 估算代码量

| 类别 | 行数 |
|---|---|
| Bug 1 代码改动 | ~10 |
| Bug 2 代码改动 | ~15 |
| 测试代码 | ~135 |
| 文档更新 | ~6 |
| **合计** | **~170** |

---

## 9. 风险点

| 风险 | 缓解 |
|---|---|
| commission handler 当前签名是否已接 encryptionKey | 先 read 文件确认；如未接，扩签名是 1 行改动 |
| 已存在的 dead_letter 行（带 base64 payload）不会自动清理 | 不动，worker 仍失败但不影响新事件；用户可手动清表 |
| 改 middleware 后其他端点测试可能依赖"无 RateLimit header" | v4 测试断言是 `expect(res.text).toContain('class="...")`，没断言 header；几乎零回归风险 |
| `-1` 作为 unlimited sentinel 业内不统一 | skill.md §5.4 脚注明示；GitHub API 用类似约定 |

---

## 10. 决策记录

| 决策 | 选择 | 备选 | 理由 |
|------|-----|------|------|
| Bug 1 修复方式 | 调用 `encrypt()` 复用现有工具 | (a) worker 兼容明文（向后兼容） / (b) 加 `is_encrypted` 字段 | 现有工具就是正确实现，无须引入兼容层 |
| Bug 2 修复方案 | B：kill switch 仍生效 + emit unlimited headers | A：保留文档默认 / C：默认改 true | B 既保留 dev 体验又满足 §5.4 承诺 |
| unlimited sentinel 值 | `-1` | `0` / `unlimited` 字符串 | `0` 易与"已耗尽"混淆；字符串需 agent 解析；`-1` 数字直观 |
| 测试策略 | 单元 + 集成双层 | 仅集成 | unit 跑得更快，定位更快 |
| 是否改 skill.md | 加脚注不改承诺 | 改承诺加 env 限定 | 承诺是产品对用户的契约，不应因 dev 配置而妥协 |

---

## 11. 未来工作（不在本次范围）

- Webhook 入队前在 `payload_enc` 上加 schema 校验（防止再次出现 base64 类型）
- `webhook_delivery_queue` 加 `payload_format_version` 字段（用于未来 v2 加密格式）
- Admin 端点暴露"重试 dead_letter"功能
- RateLimit headers 加 `RateLimit-Reset-After`（IETF draft 9+）
- `RATE_LIMIT_ENABLED=true` 时的 burst 测试（确保 429 仍正常返回）

---

## 12. 完成定义（Definition of Done）

- [ ] Bug 1: webhook_delivery_queue 中 `notify_unlock_approved` / `placement_created` 行的 `payload_enc` 以 `v1:` 开头
- [ ] Bug 1: worker 解密成功，`dead_letter` 表不再增长
- [ ] Bug 1: 单元测试 4 个 + 集成测试 2 个全 pass
- [ ] Bug 2: 默认配置下 `GET /v1/users/{id}/status` 响应包含 `RateLimit-Limit: -1`
- [ ] Bug 2: `RATE_LIMIT_ENABLED=true` 时 header 仍按三窗口返回（行为不变）
- [ ] Bug 2: skill.md §5.4 脚注已加
- [ ] `pnpm typecheck` 0 errors
- [ ] `pnpm test` 全量 pass（原 488 + 新增）
- [ ] 49 项"通过项"无回归