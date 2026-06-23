# Required `current_company` on Candidate Upload — Design

> **For agentic workers:** 这是 design spec，配套 implementation plan 在 `docs/superpowers/plans/2026-06-23-required-current-company-plan.md`。
>
> 续接 Task #1 (action_history admin endpoint)，对应 PROJECT_MEMORY.md 第 3 节的 Task #2。
> **重要前提**：之前的 `2026-06-18-action-history-and-industry-map-design.md` 已经实现了 `lookupIndustry()` + `industry_map.json`（12 个 category + fallback_keywords），所以本 spec **不重复**行业映射的工作，只补"agent 不传 current_company"导致的 NULL 字段。

**Goal:** 让 `POST /v1/headhunter/candidates` 强制要求 `current_company` 字段（不可空、不可空字符串），使所有新上传的候选人都有 `industry` 分类（要么命中枚举，要么关键词 fallback，要么 fallback "其他"），消除 `industry IS NULL` 的新增。

**Architecture:** 单一改动点 — 把 `src/main/routes/headhunter.ts:25` 的 `current_company: z.string().max(200).optional()` 改为 `current_company: z.string().min(1).max(200)`。zod schema 自动在路由入口拒绝无效输入，返回 400 INVALID_PARAMS。Handler/repo/engine 不动（上游兜底，下游安全）。

**Tech Stack:** zod（已用）, Express（已用）, vitest（已用）

---

## 1. 背景与动机

### 1.1 现状

| 项 | 状态 |
|----|------|
| `config/industry_map.json` | ✅ 已存在，12 个 category，~150 家公司 |
| `lookupIndustry()` | ✅ 3 层 fallback（枚举 → 关键词 → "其他"） |
| `fallback_keywords` | ✅ 10 个行业的关键词匹配 |
| `POST /v1/headhunter/candidates` 的 schema | ❌ `current_company` 是 optional |
| 结果：agent 不传时 | ❌ `industry = null` 写入数据库 |

### 1.2 真实根因

`src/main/modules/desensitize/engine.ts:15` 的逻辑：

```typescript
industry: input.current_company ? (lookupIndustry(input.current_company) ?? '其他') : null,
```

只有 `input.current_company` 为空（undefined / null / ""）时才会 NULL。如果有值但 lookup 不到，会 fallback 到 `'其他'`。

也就是说，**NULL 不是 industry_map 覆盖不全**，而是 **agent 调用 API 时根本没传 `current_company` 字段**。

### 1.3 修复后效果

| 调用方行为 | 修复前 industry | 修复后 industry |
|-----------|----------------|----------------|
| 传 `current_company: "字节跳动"` | "互联网" | "互联网"（不变） |
| 传 `current_company: "未知公司"` | "其他" | "其他"（不变） |
| 传 `current_company: ""` | NULL ❌ | 400 INVALID_PARAMS ✅ |
| 不传 `current_company` 字段 | NULL ❌ | 400 INVALID_PARAMS ✅ |

**新策略**：API 层强制要求；agent 必须传。新上传的候选人不再有 NULL industry。

---

## 2. API 契约变更

### 2.1 改动

**Before** (`src/main/routes/headhunter.ts:25`)：
```typescript
current_company: z.string().max(200).optional(),
```

**After**：
```typescript
current_company: z.string().min(1).max(200),
```

### 2.2 错误响应

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_PARAMS",
    "message": "current_company is required and must be non-empty"
  }
}
```

HTTP 状态：400

触发条件：
- 字段不存在（缺 `current_company` key）
- 字段值为 `null`
- 字段值为空字符串 `""`
- 字段长度超过 200 字符（原有约束保留）

### 2.3 成功响应不变

API 接受 `current_company` 后，下游 desensitize 流程不变。`industry` 字段一定有值。

---

## 3. 文件改动清单

| 路径 | 类型 | 改动 |
|------|------|------|
| `src/main/routes/headhunter.ts` | 改 (1 行) | Line 25: schema 改为 `z.string().min(1).max(200)` |
| `tests/integration/headhunter-upload-candidate.test.ts` | 改 | 新增 5 个测试用例 |
| `docs/superpowers/skill.md` | 改 | `UploadCandidateRequest` 表格加 `**Required**` |
| `docs/superpowers/openapi.json` | 改 | schema 的 `current_company` 改为 required |
| `src/main/capabilities/headhunter.ts` | 改 (1 行) | tool description 加 "current_company required" |
| `mcp-server/README.md` | 改 | 标注 v0.1.3 行为变化 |

**未改动**（重要）：
- `src/main/modules/headhunter/handler.ts` — handler 不变（上游已拒绝）
- `src/main/modules/desensitize/engine.ts` — 不变（API 层已保证非空）
- `src/main/modules/desensitize/mapping.ts` — 不变（industry_map 已实现）
- `config/industry_map.json` — 不变
- `src/main/db/repositories/candidates-private.ts` — 不变
- 数据库 schema — 不变（不动 v013+）

---

## 4. 关键代码骨架

### 4.1 schema 改动（唯一 1 行）

```diff
 const UploadSchema = z.object({
   candidate_user_id: z.string().min(1),
   name: z.string().min(1).max(100),
   phone: z.string().min(1).max(50),
   email: z.string().email(),
-  current_company: z.string().max(200).optional(),
+  current_company: z.string().min(1).max(200),
   current_title: z.string().max(100).optional(),
   expected_salary: z.number().int().positive().optional(),
   years_experience: z.number().int().min(0).max(60).optional(),
   education_school: z.string().max(200).optional(),
   skills: z.array(z.string()).optional(),
 });
```

### 4.2 测试用例（5 个）

```typescript
describe('UploadCandidate - current_company required', () => {
  const validInput = {
    candidate_user_id: 'cand_test_1',
    name: '张三',
    phone: '13800000000',
    email: 'zhang@test.com',
    current_company: '字节跳动',
    current_title: '高级工程师',
  };

  it('400 when current_company field is missing', async () => {
    const { current_company, ...inputWithoutCompany } = validInput;
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', headhunterAuth)
      .send(inputWithoutCompany);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
    expect(res.body.error.message).toMatch(/current_company.*required/i);
  });

  it('400 when current_company is empty string', async () => {
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', headhunterAuth)
      .send({ ...validInput, current_company: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
  });

  it('200 when current_company is known (字节跳动)', async () => {
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', headhunterAuth)
      .send(validInput);
    expect(res.status).toBe(200);
    expect(res.body.data.preview.industry).toBe('互联网');
  });

  it('200 when current_company is unknown → fallback 其他', async () => {
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', headhunterAuth)
      .send({ ...validInput, current_company: '某无人知晓的工作室' });
    expect(res.status).toBe(200);
    expect(res.body.data.preview.industry).toBe('其他');
  });

  it('200 when current_company matches keyword fallback (某科技公司 → 互联网)', async () => {
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', headhunterAuth)
      .send({ ...validInput, current_company: '深圳某科技公司' });
    expect(res.status).toBe(200);
    expect(res.body.data.preview.industry).toBe('互联网');
  });
});
```

### 4.3 capability description 改动（1 行）

```diff
 // src/main/capabilities/headhunter.ts
 description: 'Upload a candidate to the platform. current_company is REQUIRED.',
```

### 4.4 skill.md 表格改动

```diff
 | `current_company` | 当前公司（**Required**，1-200 字符） |
```

### 4.5 openapi.json 改动

```diff
 "UploadCandidateRequest": {
   "type": "object",
   "required": ["candidate_user_id", "name", "phone", "email", "current_company"],  // 加 current_company
   "properties": {
     "candidate_user_id": { "type": "string" },
     "name": { "type": "string" },
     "phone": { "type": "string" },
     "email": { "type": "string" },
-    "current_company": { "type": "string", "maxLength": 200 },
+    "current_company": { "type": "string", "minLength": 1, "maxLength": 200 },
     ...
   }
 }
```

### 4.6 mcp-server README 改动

```markdown
## Breaking change in v0.1.3

`upload_candidate` tool now **requires** `current_company` parameter.
The Hunter Platform API returns 400 INVALID_PARAMS if missing or empty.

Migration: ensure your agent passes `current_company` when calling `upload_candidate`.
```

---

## 5. 测试策略

### 5.1 新增测试（5 个）

详细见 §4.2。位置：`tests/integration/headhunter-upload-candidate.test.ts`（如不存在，新建）。

### 5.2 既有测试

- `tests/integration/repos/candidates-private.test.ts` — 不变
- `tests/integration/headhunter-flow.test.ts` — 不变（如果有，需要补 current_company 字段）
- 既有 800+ 测试 — 0 regression 预期

### 5.3 验证清单

- [ ] 新增 5 个测试全过
- [ ] `pnpm typecheck` 无错
- [ ] `pnpm test` 全套通过
- [ ] `pnpm openapi:check` 通过
- [ ] 0 regression

---

## 6. 文档改动

### 6.1 `docs/superpowers/skill.md`

§X 表格中 `UploadCandidateRequest` 的 `current_company` 行加 `**Required**` 标记。

### 6.2 `docs/superpowers/openapi.json`

`UploadCandidateRequest` schema 更新（minLength + required 列表加字段）。

### 6.3 `mcp-server/README.md`

标注 v0.1.3 行为变化（breaking change）。

### 6.4 `mcp-server/CHANGELOG.md`

新增 v0.1.3 条目：
- BREAKING: `upload_candidate` requires `current_company` (was optional in ≤0.1.2)

---

## 7. MCP server 版本管理

### 7.1 版本号

| 版本 | 状态 | 说明 |
|------|------|------|
| v0.1.2 | 已发布 | 当前 |
| **v0.1.3** | 本任务发布 | 文档升级 + capability description 更新；代码无逻辑改动 |

### 7.2 为什么发新版本

虽然代码不变，但 README + tool description 是 MCP 客户端（agent）看到的"契约"。发版让用户能明确知道行为变化。

### 7.3 发布流程

1. 更新 `mcp-server/package.json` version: 0.1.2 → 0.1.3
2. 更新 `mcp-server/CHANGELOG.md`
3. 更新 `mcp-server/README.md`
4. 重新 build
5. `pnpm publish` 到 GitHub Packages

---

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 旧 MCP 版本不传 current_company 被 400 拒绝 | 中 | 中 | README 标注 breaking change；推荐升级到 v0.1.3 |
| Agent 强行传 "unknown" "N/A" 等 | 低 | 低 | fallback 到 "其他" — 仍可过滤 |
| 既有测试未传 current_company 也失败 | 低 | 中 | 测试用例补字段（如有需要） |
| 性能 | 0 | 0 | zod 校验在内存中 |

---

## 9. 不在范围内（YAGNI）

- ❌ **回填历史 NULL 数据** — 历史数据无法补救，保留即可；运维通过 SQL 监控新策略的覆盖率
- ❌ **改 desensitize/engine.ts** — API 层已兜底，下游 defensive 校验冗余
- ❌ **改 industry_map.json** — 已实现 12 category + fallback_keywords，覆盖率足够
- ❌ **MCP server 代码改动** — 透传足够；只升级 README + capability description
- ❌ **改数据库 schema** — 不需要迁移
- ❌ **加监控告警** — 暂时不需要
- ❌ **改其他端点** — `POST /v1/headhunter/candidates` 是唯一的上传入口

---

## 10. 验收清单

- [ ] `src/main/routes/headhunter.ts:25` 改为 `z.string().min(1).max(200)`
- [ ] 5 个新增测试全过
- [ ] `pnpm typecheck` 无错
- [ ] `pnpm test` 全套通过（既有 800+ + 新 5 = 0 regression）
- [ ] `pnpm openapi:check` 通过
- [ ] `docs/superpowers/skill.md` 表格加 Required 标记
- [ ] `docs/superpowers/openapi.json` schema 更新
- [ ] `src/main/capabilities/headhunter.ts` description 更新
- [ ] `mcp-server/README.md` 标注 breaking change
- [ ] `mcp-server/CHANGELOG.md` 加 v0.1.3 条目
- [ ] `@qing3a/hunter-platform-mcp@0.1.3` 发布到 GitHub Packages
- [ ] curl 验证：
  ```bash
  # 1) 缺 current_company → 400
  curl -X POST https://api.hunter-platform.com/v1/headhunter/candidates \
    -H "Authorization: Bearer $HP_API_KEY" \
    -d '{"candidate_user_id":"c1","name":"X","phone":"138...","email":"x@y"}'
  # Expected: {"ok":false,"error":{"code":"INVALID_PARAMS",...}}
  
  # 2) 正常调用 → 200, industry="互联网"
  curl -X POST https://api.hunter-platform.com/v1/headhunter/candidates \
    -H "Authorization: Bearer $HP_API_KEY" \
    -d '{...,"current_company":"字节跳动"}'
  # Expected: {"ok":true,"data":{"preview":{"industry":"互联网",...}}}
  ```

---

## 11. 上线检查清单

1. 代码合入 `main` 分支
2. CI 全过
3. 部署到生产（`pnpm build && pnpm start` + nginx reload）
4. 远程验证（见 §10 curl）
5. 发布 `@qing3a/hunter-platform-mcp@0.1.3`
6. （可选）发 release note v1.x.y — "upload_candidate now requires current_company"

---

## 12. 后续可考虑（v2，不在本任务）

- `current_title` 也设为必填（title_level 字段也有类似 NULL 问题）
- 候选人本人也可上传（`POST /v1/candidate/upload-self`）— 增加更多入口时同步处理
- 提供"上传前预检"API，让 agent 先验证 current_company 是否被识别
- 历史 NULL 数据统计 API（admin 后台看 industry 覆盖率 KPI）

---

## 参考

- [2026-06-18-action-history-and-industry-map-design.md](2026-06-18-action-history-and-industry-map-design.md) — industry_map + lookupIndustry 的实现（已完成）
- [2026-06-23-admin-action-history-endpoint-design.md](2026-06-23-admin-action-history-endpoint-design.md) — Task #1（同批任务）
- `src/main/modules/desensitize/engine.ts:15` — industry 字段计算逻辑
- `src/main/routes/headhunter.ts:25` — 本 spec 唯一改动点
- `docs/PROJECT_MEMORY.md` 第 3 节 — 当前活跃任务