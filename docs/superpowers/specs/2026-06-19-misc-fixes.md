# Misc Fixes — Spec

**状态**: Draft
**日期**: 2026-06-19
**作者**: brainstorming session
**前置**: 限流重构 spec（`2026-06-19-rate-limit-redesign.md`）; 排查报告见对话历史

---

## 1. 概述

### 1.1 一句话定义

把 4 个独立修复点（其中 #1 含 2 个子项）合并到一个 spec/plan/mimo 周期内：

1. **`approveUnlock` 漏发 webhook** + **`view_url` 文档缺失**（2 子项）—— 真实 bug + 文档
2. **`requirements` 字段删除** —— API 设计清理
3. **`SCHOOL_TIERS` 扩到完整 39 所 985** —— 质量改进
4. **`charset=utf-8` 强制** —— 防御性编码

### 1.2 触发原因

排查其他测试时发现 5 个待修点，4 个真实/可改善。详见对话历史中"排查报告"。

### 1.3 目标

- `approveUnlock` 后 employer 端能收到 `notify_unlock_approved` 事件
- `view_url` 在 skill.md 中有明确说明
- `requirements` 字段从 API 表面彻底消失
- 39 所 985 学校全部能正确映射
- 中文 body 请求必须用 UTF-8，否则 400 拒绝

### 1.4 非目标

- 不删 DB 列（`jobs.requirements` 保留，避免老数据丢失；下线后单独 ALTER）
- 不动 211 学校（保持 fallback `普通`）
- 不改 webhook worker 实现
- 不改其他 348 个已通过的测试

---

## 2. 修复点总览

| # | 修复 | 严重度 | 改动文件数（估） |
|---|---|---|---|
| 1 | approveUnlock webhook + view_url 文档 | 高 | 4 |
| 2 | requirements 字段删除 | 中 | 4-6 |
| 3 | SCHOOL_TIERS 39 所 | 中 | 2 |
| 4 | charset 强制 | 中 | 2 |

---

## 3. Fix #1 — `approveUnlock` webhook + view_url 文档

### 3.1 approveUnlock webhook

**当前问题**：`src/main/modules/candidate/handler.ts` 的 `approveUnlock` 把状态改成 `candidate_approved` 但**不发 webhook**。Employer 端必须轮询才能知道 candidate 同意解锁。

**修复**：
- 在 `approveUnlock` 状态更新之后，`auditLog.insert` 之后，调用 `webhooks.enqueue({...})`
- 通过 `rec.employer_id` 拿到目标 user
- 事件名：`notify_unlock_approved`（与现有 `notify_unlock_request` 对称）
- 加密 payload（**不包含 PII**）：
  ```typescript
  {
    recommendation_id,
    anonymized_candidate_id,
    candidate_user_id,
    approved_at,
  }
  ```
- `contains_pii: 0`（与 `notify_unlock_request` 保持一致——通知类事件不携带 PII）

**事件名约定**：
| 事件 | 触发方 | 接收方 | 携带 PII |
|---|---|---|---|
| `notify_unlock_request` | employer.expressInterest | candidate | 否 |
| `notify_unlock_approved` | candidate.approveUnlock | **employer**（新）| 否 |
| `deliver_contact` | employer.unlockContact | employer | 是（包含姓名电话邮箱）|

### 3.2 view_url 文档

**当前问题**：`docs/superpowers/skill.md` 未列出 `view_url` 字段，但 `views-endpoint.ts` 和 `createViewUrlInjector` 中间件会在响应中注入。

**修复**：在 skill.md 新增一节"视图链接"：

```markdown
## 视图链接（view_url）

部分 endpoint 的 2xx 响应会包含一个 `view_url` 字段，格式：
`http://<host>/view/<token>`

- 受邀方（如 employer）可访问该 URL 查看候选人脱敏画像
- token 是 HMAC 签名后的 JWT，24h 过期
- 包含 view_url 的 endpoint：`POST /v1/auth/register`、`POST /v1/recommendations/...` 等
```

---

## 4. Fix #2 — `requirements` 字段删除

### 4.1 决定

**从 API 表面删除 `requirements` 字段**。两个独立字段语义重叠（一个自由文本、一个结构化数组），保留 `required_skills` 就够。

### 4.2 改动清单

1. **`src/shared/types.ts` `Job` 接口**：删除 `requirements?: string`
2. **`src/main/modules/employer/handler.ts` `CreateJobInput` 接口**：删除 `requirements?: string`
3. **`src/main/modules/employer/handler.ts` `createJob` 函数**：删除 `requirements: input.requirements ?? null`
4. **`docs/superpowers/openapi.json`**：删除 Job schema 的 `requirements` 字段
5. **`docs/superpowers/skill.md`**：如有 `requirements` 描述，删除
6. **测试**：grep 现有 `requirements` 引用，逐个评估

### 4.3 不改

- **DB schema**：保留 `jobs.requirements TEXT` 列（避免迁移失败 + 老数据保留）
- **Repository / SQL**：不动 `INSERT INTO jobs` 等 SQL（多余的字段会被忽略或保留）

### 4.4 兼容性

- 旧客户端如果发 `requirements`，**TypeScript 编译期就报错**（因为 `CreateJobInput` 已删字段）；运行时如果发，请求体里多余字段被忽略，不入 DB
- 旧响应如果有 `requirements: null`，客户端会发现字段消失（breaking change，CHANGELOG 标注）

---

## 5. Fix #3 — `SCHOOL_TIERS` 扩到完整 39 所 985

### 5.1 决定

**内嵌全部 39 所 985 学校**到 `mapping.ts`。不走 JSON（避免 `process.cwd()` 依赖）。

### 5.2 完整 39 所 985 列表

```
北京大学, 清华大学, 中国人民大学, 北京航空航天大学, 北京理工大学,
中国农业大学, 北京师范大学, 中央民族大学, 南开大学, 天津大学,
大连理工大学, 东北大学, 吉林大学, 哈尔滨工业大学, 复旦大学,
同济大学, 上海交通大学, 华东师范大学, 南京大学, 东南大学,
浙江大学, 中国科学技术大学, 厦门大学, 山东大学, 中国海洋大学,
武汉大学, 华中科技大学, 中南大学, 中山大学, 华南理工大学,
四川大学, 重庆大学, 电子科技大学, 西安交通大学, 西北工业大学,
西北农林科技大学, 长安大学, 兰州大学, 国防科技大学
```

### 5.3 改动

- `src/main/modules/desensitize/mapping.ts`：
  ```typescript
  export const SCHOOL_TIERS: Record<string, string> = {
    '北京大学': '985', '清华大学': '985', '中国人民大学': '985',
    // ... 完整 39 所
  };
  ```
- `tests/unit/desensitize/engine.test.ts`：加 1 个测试 case，断言 5 个抽样 985 校名都返回 `'985'`

### 5.4 211 学校

保持当前 fallback `普通`（不在 985 列表里的学校可能是 211、双非、海外等）。后续如果有强需求可单独立 spec。

---

## 6. Fix #4 — `charset=utf-8` 强制中间件

### 6.1 决定

新建中间件 `src/main/modules/encoding/utf8-only.ts`，对所有 `POST`/`PUT`/`PATCH` 请求检查 `Content-Type` 必须是 `application/json` 且 `charset=utf-8`，否则返回 400。

### 6.2 实现

```typescript
// src/main/modules/encoding/utf8-only.ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';

const CHARSET_RE = /^application\/json(?:\s*;\s*charset\s*=\s*utf-?8)$/i;

export function createUtf8OnlyMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'DELETE' || method === 'OPTIONS') {
      return next();
    }
    const ct = req.headers['content-type'] || '';
    if (!CHARSET_RE.test(ct.trim())) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_CHARSET',
          message: 'Content-Type must be application/json; charset=utf-8',
        },
      });
    }
    next();
  };
}
```

### 6.3 挂载点

在 `src/main/server.ts:39` 之后挂载（在 `express.json` 之前，避免按错误 charset 先解码）：

```typescript
app.use(express.json({ limit: '4kb' }));
app.use(createUtf8OnlyMiddleware());  // NEW
```

### 6.4 兼容性

- 已有客户端如果用 `Content-Type: application/json`（不带 charset）→ **会失败**（breaking change）
- 修复方法：客户端显式加 `; charset=utf-8`
- CHANGELOG 标注此 breaking change

### 6.5 不覆盖范围

- `GET /v1/...`：无 body，跳过检查
- 公开端点（`/v1/skill.md` 等）：无 POST/PUT
- `/v1/auth/register`：受影响——客户端需要更新

---

## 7. 测试策略

### 7.1 单元测试

- **`tests/unit/encoding/utf8-only.test.ts`**（新）：mock req/res，验证：
  - `Content-Type: application/json; charset=utf-8` → next
  - `application/json` 无 charset → 400
  - `application/json; charset=gbk` → 400
  - `text/plain` → 400
  - GET → 跳过

- **`tests/unit/candidate/handler.test.ts`**（新）：验证 approveUnlock 后调用 webhooks.enqueue 一次，参数正确

### 7.2 集成测试

- **`tests/integration/candidate-handler.test.ts`**：现有测试改：approveUnlock 之后断言 webhook queue 里有 1 条
- **`tests/integration/charset-middleware.test.ts`**（新）：通过 supertest 发不同 Content-Type，验证 400 行为

### 7.3 回归

- 跑完整 `pnpm test` 确认无其他测试因 charset 拒绝而失败
- 如果有大量测试 fail，**回滚 fix #4**（最不影响）

---

## 8. 迁移与发布

### 8.1 改动顺序

1. **Fix #1 webhook**：小、独立，先做
2. **Fix #2 requirements**：可能需要改测试
3. **Fix #3 SCHOOL_TIERS**：纯加数据
4. **Fix #4 charset**：**最后做**（最易破坏现有测试）

### 8.2 DB 迁移

**无**。所有改动都不动 schema。

### 8.3 客户端通知

CHANGELOG 标注：
- 新事件 `notify_unlock_approved`
- `view_url` 字段说明
- **BREAKING**: `requirements` 字段从响应删除
- **BREAKING**: 请求体 `Content-Type` 必须含 `charset=utf-8`

---

## 9. 风险

| 风险 | 缓解 |
|---|---|
| charset 中间件破坏现有测试 | 先做其他 3 个，最后做；如有大量 fail，回滚 |
| approveUnlock webhook 触发过多 | 已有限流（webhook queue 本身）+ employer 端可配置 webhook 开关 |
| `requirements` 删除后老客户端报错 | CHANGELOG 标注 + skill.md 旧版可访问 |
| SCHOOL_TIERS 39 所数据错（如漏校） | 单一来源（教育部名单），可对照 `985工程` 公开名单验证 |

---

## 10. 文件变更总览

### 10.1 新增
- `src/main/modules/encoding/utf8-only.ts`
- `tests/unit/encoding/utf8-only.test.ts`
- `tests/integration/charset-middleware.test.ts`
- `tests/unit/candidate/handler.test.ts`（如果不存在）

### 10.2 修改
- `src/main/modules/candidate/handler.ts`：加 `webhooks.enqueue`
- `src/main/modules/employer/handler.ts`：删 `requirements` 字段
- `src/main/modules/desensitize/mapping.ts`：扩 `SCHOOL_TIERS` 到 39 所
- `src/main/server.ts`：挂 `createUtf8OnlyMiddleware()`
- `src/shared/types.ts`：`Job` 删 `requirements`
- `docs/superpowers/openapi.json`：Job schema 删 `requirements`
- `docs/superpowers/skill.md`：加 view_url 章节 + 删 requirements 描述
- `tests/unit/desensitize/engine.test.ts`：加 985 抽样测试
- `tests/integration/candidate-handler.test.ts`：加 webhook queue 断言
- `docs/CHANGELOG.md`：4 个改动

### 10.3 不动
- `src/main/modules/employer/handler.ts` 的 SQL 插入 `requirements` 列（保留列）
- `src/main/modules/webhook/worker.ts`
- DB schema
