# API Field Naming Convention

**状态**: Draft
**日期**: 2026-06-18
**作者**: brainstorming session
**前置文档**: [2026-06-17-hunter-platform-design.md](./2026-06-17-hunter-platform-design.md)

---

## 1. 概述

### 1.1 一句话定义

把 Hunter Platform API 响应里的资源自我 ID 字段统一为 `id`，外键保持 `xxx_id`，AnonymizedCandidate 保留 `anonymized_id`。`POST /v1/auth/register` 响应从 `user_id` 改为 `id`（唯一 breaking change）。

### 1.2 触发原因

调试 render layer 时发现 3 类命名风格在同一 codebase 混用：

| 风格 | 示例 | 出现位置 |
|------|------|---------|
| 裸 `id` | `data.id` | `POST /v1/headhunter/recommendations`, `POST /v1/employer/jobs`, `GET /v1/users/{id}/status` |
| 带前缀 `xxx_id` | `data.user_id`, `data.anonymized_id` | `POST /v1/auth/register`, `POST /v1/headhunter/candidates` |
| 外键 `xxx_id` | `data.headhunter_id`, `data.job_id` | Recommendation/Job 对象内部字段 |

render layer 的 view_url 注入逻辑依赖响应字段名匹配 `route-view-map.ts` 的配置。混用风格导致：
- 调试时需要反复确认每个 endpoint 返回什么字段名
- 客户端代码要为不同 endpoint 写不同的字段访问逻辑
- 新 endpoint 设计时没有明确约定

### 1.3 目标

1. 资源自我 ID 字段统一为 `id`（唯一一个例外：`anonymized_id`）
2. 现有已对齐的 endpoint（Recommendation / Job / status）保持不动
3. 不对齐的 endpoint（auth/register）改成对齐
4. 把约定写进 `docs/superpowers/skill.md` 作为 API 设计规则

### 1.4 非目标

- 不统一 DB 列名（`user_id` 列保持）
- 不改 URL path 参数（`/v1/users/{id}` 路径参数约定独立）
- 不做 backward-compat 双字段（项目 WIP，硬破即可）
- 不改 `/v1/users/{id}/history` 的 `user_id` 字段（按 brainstorm 决定保留 DB 列名风格）
- 不引入类型层强制（TypeScript 类型辅助开销不值得 1 个字段）

---

## 2. 命名约定

### 2.1 规则

| 字段含义 | 字段名 | 示例 |
|---------|-------|------|
| 资源自身 ID | `id` | `data.id`（user / job / recommendation 的 self ID） |
| 外键 | `<resource_type>_id` | `headhunter_id`, `employer_id`, `job_id`, `anonymized_candidate_id` |
| 多态外键 | `<context>_id` | `target_id`（history endpoint 操作的目标资源） |
| **例外** | `anonymized_id` | AnonymizedCandidate（脱敏候选人 ID） |

### 2.2 AnonymizedCandidate 为什么是例外

`anonymized_id` 携带语义信息：它**显式表达**"这是脱敏后的 ID，不是真实 user_id"。客户端拿到 `anonymized_id` 就知道：
- 这不是 user record 的 ID
- 不能直接拿去当 `user_id` 调其它 endpoint
- 需要通过解锁流程才能拿到真实联系方式

如果改成裸 `id`，客户端可能误以为是 user_id（因为 User 类型的 ID 字段就叫 `id`），造成类型混淆。

### 2.3 history endpoint 的 `user_id` 为什么保留

`GET /v1/users/{id}/history` 返回的是 `action_history` 表的原始行。每行有：
- `user_id` —— 谁做了这个 action（DB 列名）
- `target_type` + `target_id` —— 操作的目标资源（多态 FK）

`user_id` 在这里表达的是"事件的执行者"，不是资源自身 ID（事件本身就是这行）。改成 `id` 会和 DB 自增主键 `id` 冲突（action_history 表的主键是数字 id，不是字符串）。

保持 DB 列名 `user_id` + 多态 `target_id` 反而最清晰。

---

## 3. 文件级变更

### 3.1 修改

| 文件 | 改动 |
|------|------|
| `src/main/modules/register/handler.ts` | 响应对象 `{ user_id, ... }` → `{ id, ... }` |
| `docs/superpowers/skill.md` | API 文档同步；新增"字段命名约定"章节 |
| 集成测试文件（grep 找）| 所有 `body.data.user_id` 断言改 `body.data.id` |

### 3.2 新增

| 文件 | 内容 |
|------|------|
| `tests/integration/register-naming.test.ts` | Regression test：注册后 `data.id` 存在、是字符串、与后续 `GET /v1/users/{id}/status` 返回的 `data.id` 一致 |

### 3.3 不动

- `src/main/db/migrations/*.sql`（DB 列名）
- `src/main/db/repositories/*.ts`（DB 类型 → 内部分发）
- `src/shared/types.ts`（类型已对齐 Convention A）
- URL 路径参数（`/v1/users/{id}` 保持）
- 内部 `headhunter_id` / `employer_id` 等外键字段

---

## 4. 数据流（无变化）

纯字段重命名，不涉及业务流程改动：

```
1. Agent → POST /v1/auth/register (Bearer 不需要)
       ↓
2. handler → 写 users 表，返回 { id, api_key, quota_per_day, user_type }
       ↑ （之前是 user_id，现在是 id）
       ↓
3. Agent 收到 JSON: { data: { id: "user_xxx", api_key: "hp_live_xxx", ... } }
       ↓
4. Agent 用 id（不是 user_id）做后续调用：
   GET /v1/users/{id}/status
   POST /v1/headhunter/candidates  (candidate_user_id 在 body 里，body 字段不变)
```

---

## 5. 错误处理（无变化）

纯字段重命名不影响任何错误处理逻辑。

---

## 6. 测试策略

### 6.1 修改现有测试

**搜索所有引用**：
```bash
grep -rn "data\.user_id\|body\.data\.user_id" tests/
```

每个匹配都要改成 `data.id`。

### 6.2 新增 regression test

```typescript
// tests/integration/register-naming.test.ts

describe('POST /v1/auth/register — field naming convention', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('returns data.id (not data.user_id) for self-ID convention', async () => {
    const app = createApp();
    const res = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'Convention Test', contact: 'conv@c.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toMatch(/^user_/);
    expect(res.body.data.user_id).toBeUndefined();
  });

  it('data.id matches the id returned by GET /v1/users/{id}/status', async () => {
    const app = createApp();
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'Conv Test', contact: 'ct@c.com' });
    const { id, api_key } = reg.body.data;

    const status = await request(app).get(`/v1/users/${id}/status`)
      .set('Authorization', `Bearer ${api_key}`);

    expect(status.body.data.id).toBe(id); // same identifier used both ways
  });
});
```

### 6.3 验证

```bash
pnpm typecheck
pnpm test
# 期望：所有测试仍通过（修改断言 + 新增 regression test 后 = 267 passed）
grep -rn "data\.user_id\|body\.data\.user_id" tests/
# 期望：无匹配
```

---

## 7. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|-----|------|------|
| 漏改某处 `data.user_id` 引用 | 中 | 编译/测试报错 | 全测试套件 + grep 双重验证 |
| 第三方已经按 `user_id` 写代码 | 低 | 集成失败 | 项目 WIP 无生产消费者；README 注明 breaking change |
| 测试文件命名混乱 | 低 | 维护性 | 新文件命名为 `register-naming.test.ts` 反映意图 |

---

## 8. 实现路径

1. **T1**：grep 找所有 `data.user_id` 引用（tests/ 和 src/）
2. **T2**：改 `src/main/modules/register/handler.ts` 响应字段
3. **T3**：加 regression test `tests/integration/register-naming.test.ts`
4. **T4**：跑 typecheck + 全测试（期望 267/267）
5. **T5**：更新 `docs/superpowers/skill.md`：register endpoint 响应字段 + 新增"字段命名约定"章节
6. **T6**：单 commit：`refactor(api): align register response to convention (data.user_id → data.id)`

预计改动 ~30 行（handler 1 行 + 测试 5-10 行 + skill.md 15-20 行）。

---

## 9. 决策记录

| 决策 | 选择 | 备选 | 理由 |
|------|-----|------|------|
| 自我 ID 字段名 | **`id`** | `xxx_id` 统一前缀 | 行业标准（Stripe / GitHub），Recommendation 已经是这种风格 |
| AnonymizedCandidate | **保留 `anonymized_id`** | 改成 `id` | 语义价值：明示"脱敏版"，避免与 User.id 混淆 |
| history endpoint `user_id` | **保留 DB 列名** | 改成 `id` / `actor_id` | DB 主键是数字 `id`，改成 `id` 会冲突；改成 `actor_id` 也是 breaking |
| 向后兼容 | **硬破** | 双字段过渡 | 项目 WIP 无生产消费者 |
| 实现方案 | **直接重命名** | 类型层辅助 / 响应适配器 | 改动只有 1 个字段，类型层开销不值得 |
| URL path 参数 | **不变** | 改路径参数 | 路径参数约定独立于响应字段 |

---

## 10. 未来工作（Out of Scope）

- 统一所有外键字段命名（已经是 `<resource>_id` 风格，无需改动）
- 类型层 `SelfId<T>` 辅助（项目长大后再加）
- v2 API 版本（如果未来需要 backward compat）
- DB schema 字段名（DB 列名约定独立）