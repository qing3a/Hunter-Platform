# Hunter Platform — v2 Self-Upload + Pitch Design

> **For agentic workers:** 这是 design spec，配套 implementation plan 在 `docs/superpowers/plans/2026-06-23-v2-self-upload-and-pitch-plan.md`。

**Goal:** 补 v1.0.2 之后的 5 个真实用户缺口：候选人无法 self-upload、猎头无法批量导入、推荐报告缺失、候选人求职意图无信号、候选人无法导出原始简历。

**Architecture:** 在现有 API-first / Agent-mediated 架构上**加 capability、不加 UI**——保留 spec §1.4 的"不做简历编辑器、不做 PDF 解析"原则。新增 4 个 capability + 1 个 schema 字段，所有改动走单一 migration v014。

**Tech Stack:** Node `crypto.randomUUID()`（已用）、`node:sqlite`（已用）、vitest + supertest（已用）、zod（已用）。无新依赖。

---

## 1. 背景与动机

### 1.1 五个真实缺口

| 缺口 | 现状 | 用户痛点 |
|---|---|---|
| **候选人无法 self-upload** | spec §4.4.2 强制"候选人先注册，再由猎头代为上传"；候选人注册只需要 `name + contact` | 候选人主动求职的第一步"写简历"在平台无落点 |
| **猎头无法批量导入** | `POST /v1/headhunter/candidates` 每次 1 条、5 quota；批量场景（导入邮箱历史简历）需循环 100 次 | 猎头第一天的存量资产无法接入 |
| **推荐报告缺失** | `recommendations` 表无 `pitch_md` 字段；雇主 `view_url` 只见裸字段 | 猎头行业的真实交付物是"submission"（销售话术），平台只有结构化字段 |
| **求职意图无信号** | `candidates_anonymized` 无 `intent_status` | "开放机会" vs "不找工作"无法区分，猎头/雇主骚扰所有上传过简历的人 |
| **候选人无法导出** | `GET /v1/candidate/export-my-data` 已存在，但导出格式是 `{user, candidates_private, ...}` 包络结构，不是单份简历 | 候选人想"带走我的简历"无法做到 |

### 1.2 设计原则

- **API-first**：4 个新 capability + 1 个字段，全部 HTTP 接口；不在平台内做 UI
- **不破坏现有流程**：所有 v1 端点继续工作，`recommendations` 加字段走 schema 兼容（nullable）
- **PII 不变**：候选人 self-upload 与猎头代传共用同一份 `desensitize()` + 同一套 AES-256-GCM 加密
- **Agent 友好**：每个新 capability 都同步到 `capabilities/*.ts` + `docs/superpowers/skill.md`

### 1.3 非目标

- ❌ 平台内置简历编辑器（保持 API-first，让用户 Agent 做）
- ❌ 平台做 PDF/Word 解析（让用户 Agent 解析后再调 API）
- ❌ 平台做候选人评分 / 简历质量评估
- ❌ 平台做实时聊天 / IM
- ❌ 多层 referrer 链（仍是单跳 + 30% 分账）

---

## 2. 架构总览

### 2.1 新增 capability 清单（共 4 个）

| Capability | 路径 | 角色 | 配额 |
|---|---|---|---|
| `candidate.upload_resume` | `POST /v1/candidate/resumes` | candidate | 5 |
| `candidate.set_intent` | `POST /v1/candidate/resumes/:id/intent` | candidate | 0 |
| `candidate.export_resume` | `GET /v1/candidate/resumes/:id/export` | candidate | 0 |
| `headhunter.bulk_import_candidates` | `POST /v1/headhunter/candidates/bulk` | headhunter | 1/条（批量计费） |

### 2.2 新增 schema 字段（1 个）

| 表 | 字段 | 类型 | 说明 |
|---|---|---|---|
| `candidates_anonymized` | `intent_status` | TEXT NOT NULL DEFAULT 'open_to_opportunities' CHECK (intent_status IN ('actively_looking', 'open_to_opportunities', 'not_looking', 'hidden')) | 候选人求职意图，候选人本人可改 |
| `candidates_anonymized` | `intent_updated_at` | TEXT | 上次更新时间 |
| `recommendations` | `pitch_md` | TEXT | 猎头推荐报告（建议 ≥ 50 字） |
| `recommendations` | `attachments_json` | TEXT | 候选附件链接（作品集 PDF 等） |

### 2.3 模块边界

| 模块 | 职责 | 依赖 |
|---|---|---|
| `candidate.upload_resume` handler | 候选人自传简历 | auth, desensitize, crypto, audit |
| `candidate.set_intent` handler | 候选人设置意图 | auth, candidates_anonymized.repo |
| `candidate.export_resume` handler | 候选人导出单份简历 | auth, crypto |
| `headhunter.bulk_import_candidates` handler | 猎头批量导入（事务 + 部分成功） | auth, desensitize, crypto |
| `recommendation.update_pitch` handler | 猎头更新推荐报告（pending 状态可改） | auth, recommendations.repo |

### 2.4 复用现有模式

- `headhunter.uploadCandidate` (handler.ts:49-131) 的 7 步管线**直接复用**——self-upload 只是去掉"校验 candidate_user_id 引用"
- `desensitize()` engine 是纯函数，无需改动
- `candidates_private` + `candidates_anonymized` 双写 + 事务模式直接复用
- `Buffer.from(plaintext)` → `encrypt()` → `zeroMemory()` PII 清零模式直接复用
- `quota.tryConsume(user.id, QUOTA_COSTS.xxx)` 配额扣减直接复用
- `__audit` 字段 + `res.locals.ah*` action_history 模式直接复用

---

## 3. 数据模型

### 3.1 Migration v014

```sql
-- ============================================================================
-- Migration v014: candidate self-upload + pitch + intent_status
-- ============================================================================

-- (1) candidates_anonymized 加 intent_status
ALTER TABLE candidates_anonymized ADD COLUMN intent_status TEXT NOT NULL DEFAULT 'open_to_opportunities';
ALTER TABLE candidates_anonymized ADD COLUMN intent_updated_at TEXT;
-- 注意: SQLite ALTER TABLE ADD COLUMN 不支持 CHECK constraint 嵌入,改用单独 index 触发

-- Backfill: 现有行 default 已生效 (open_to_opportunities)
UPDATE candidates_anonymized SET intent_updated_at = created_at WHERE intent_updated_at IS NULL;

-- (2) recommendations 加 pitch + attachments
ALTER TABLE recommendations ADD COLUMN pitch_md TEXT;
ALTER TABLE recommendations ADD COLUMN attachments_json TEXT;
-- pitch_md 建议 ≥ 50 字 (handler 层 enforce, DB 层只 nullable)

-- (3) candidates_private 加 self-upload 标记 (用于审计)
ALTER TABLE candidates_private ADD COLUMN source TEXT NOT NULL DEFAULT 'headhunter';
-- source ∈ ('headhunter', 'self') — self-upload 时填 'self'

-- 索引
CREATE INDEX idx_candidates_anon_intent ON candidates_anonymized(intent_status, created_at DESC);
```

**幂等性**：使用 `CREATE INDEX IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` 二次运行会失败（这是 SQLite 限制，runner 需捕获）。迁移 runner 已在 `db/migrations/` 中以版本号去重，重复执行不会发生。

### 3.2 字段语义

**`intent_status` 四态**：

| 取值 | 含义 | 默认对猎头/雇主可见？ |
|---|---|---|
| `actively_looking` | 主动求职，最近 30 天更新过简历 | ✅ 默认可见 |
| `open_to_opportunities` | 开放机会（v1 默认） | ✅ 默认可见 |
| `not_looking` | 暂不跳槽 | ✅ 默认可见（透明） |
| `hidden` | 暂停曝光 | ❌ browse_talent 自动过滤 |

**`source` 二态**（candidates_private）：

| 取值 | 含义 |
|---|---|
| `headhunter` | 猎头代传（v1 默认） |
| `self` | 候选人 self-upload |

### 3.3 pitch_md 长度限制

- handler 层强制 `pitch_md.length >= 50 && pitch_md.length <= 5000`
- 0 长度允许（向后兼容 v1），但 >= 50 时算"完整推荐"
- `attachments_json` 是 JSON array，每个元素 `{ label: string, url: string, mime: string }`，最多 5 个

---

## 4. API 设计

### 4.1 POST /v1/candidate/resumes (新增)

**前置条件**：`Authorization: Bearer <candidate_api_key>`，user.user_type === 'candidate'

**Request**：
```json
{
  "name": "张三",
  "phone": "13800138000",
  "email": "zhang@example.com",
  "current_company": "字节跳动",
  "current_title": "高级前端工程师",
  "expected_salary": 750000,
  "years_experience": 8,
  "education_school": "清华大学",
  "skills": ["React", "TypeScript"]
}
```

**Response 200**：
```json
{
  "ok": true,
  "data": {
    "anonymized_id": "ca_34f4d206c98",
    "preview": {
      "industry": "互联网",
      "title_level": "P6",
      "years_experience": 8,
      "salary_range": "60-80万",
      "education_tier": "985",
      "skills": ["React", "TypeScript"]
    },
    "intent_status": "open_to_opportunities"
  }
}
```

**关键差异** vs `POST /v1/headhunter/candidates`：
- ❌ 不需要 `candidate_user_id` 字段（候选人就是自己）
- ✅ `candidates_private.source = 'self'`
- ✅ `candidates_private.headhunter_id = 'self'`（特殊值；不指向真实 user）
- ✅ 配额从候选人 quota 扣（5），不是猎头 quota

**副作用**：
- `quota_used += 5`
- `candidates_private` + `candidates_anonymized` 双写
- `action_history` 写入 `candidate.upload_resume`
- 默认 `intent_status = 'open_to_opportunities'`

### 4.2 POST /v1/candidate/resumes/:id/intent (新增)

**前置条件**：候选人本人 + `:id` 必须属于该候选人

**Request**：
```json
{ "intent_status": "actively_looking" }
```

**Response 200**：
```json
{
  "ok": true,
  "data": {
    "anonymized_id": "ca_xxx",
    "intent_status": "actively_looking",
    "intent_updated_at": "2026-06-23T10:00:00.000Z"
  }
}
```

**校验**：intent_status 必须在四态枚举内

### 4.3 GET /v1/candidate/resumes/:id/export (新增)

**前置条件**：候选人本人 + `:id` 必须属于该候选人

**Response 200**：
```json
{
  "ok": true,
  "data": {
    "anonymized_id": "ca_xxx",
    "format": "hunter-platform-resume/v1",
    "exported_at": "2026-06-23T10:00:00.000Z",
    "private": {
      "name": "张三",
      "phone": "13800138000",
      "email": "zhang@example.com",
      "current_company": "字节跳动",
      "current_title": "高级前端工程师",
      "expected_salary": 750000,
      "years_experience": 8,
      "education_school": "清华大学",
      "skills": ["React", "TypeScript"]
    },
    "anonymized": {
      "industry": "互联网",
      "title_level": "P6",
      "salary_range": "60-80万",
      "education_tier": "985",
      "intent_status": "actively_looking"
    },
    "source": "self",
    "created_at": "2026-06-15T08:30:00.000Z"
  }
}
```

**安全**：
- 仅候选人本人可调（handler 内 `privRecord.candidate_user_id === user.id` 校验）
- 仅返回**自己**的简历（即使其他人推荐过同一个候选人，导出权仍属于候选人本人）
- 包含解密 PII 明文——这是候选人自己导出，**符合 GDPR data portability**

### 4.4 POST /v1/headhunter/candidates/bulk (新增)

**前置条件**：`Authorization: Bearer <headhunter_api_key>`

**Request**：
```json
{
  "candidates": [
    { "candidate_user_id": "user_aaa", "name": "...", "phone": "...", "email": "...", "current_company": "..." },
    { "candidate_user_id": "user_bbb", "name": "...", "phone": "...", "email": "...", "current_company": "..." }
  ]
}
```

**Response 200（部分成功也返回 200，details 体现）**：
```json
{
  "ok": true,
  "data": {
    "imported_count": 47,
    "failed_count": 3,
    "imported": [
      { "candidate_user_id": "user_aaa", "anonymized_id": "ca_xxx" },
      ...
    ],
    "failed": [
      { "candidate_user_id": "user_ccc", "error_code": "INVALID_PARAMS", "message": "Invalid email" }
    ]
  }
}
```

**关键设计**：
- **部分成功语义**：单条失败不影响其他条
- **事务策略**：每条独立 INSERT（不是单事务）；失败时整体响应仍 200
- **配额**：每条 1 quota（v1 single upload 是 5；批量场景下减半给折扣），不足时按 N 条扣减后立即停止
- **上限**：单次最多 50 条（防滥用；body 64kb 限制也自然约束）
- **Idempotency-Key**：客户端可传 UUIDv4，同 key 24h 内同 body 返回首次响应

### 4.5 POST /v1/headhunter/recommendations/:id/pitch (新增)

**前置条件**：猎头本人 + recommendation.status === 'pending'

**Request**：
```json
{
  "pitch_md": "张三在字节跳动 8 年 React 经验,主导过抖音创作者后台重构...",
  "attachments": [
    { "label": "作品集", "url": "https://...", "mime": "application/pdf" }
  ]
}
```

**Response 200**：
```json
{
  "ok": true,
  "data": {
    "recommendation_id": "rec_xxx",
    "pitch_md": "张三在字节跳动...",
    "attachments_count": 1
  }
}
```

**校验**：
- `pitch_md` 0-5000 字；>=50 字推荐（< 50 字允许但记录 warning）
- `attachments` 最多 5 个

### 4.6 POST /v1/headhunter/recommendations (扩展)

在现有 `recommendCandidate` 基础上，**新增强制字段 `pitch_md`**（向后兼容：可选）。

```json
{
  "anonymized_candidate_id": "ca_xxx",
  "job_id": "job_xxx",
  "pitch_md": "...",          // 新增,可选,0-5000 字
  "attachments": [...],         // 新增,可选,最多 5 个
  "commission_split": {...},    // 已有
  "referrer_headhunter_id": ... // 已有
}
```

---

## 5. 关键流程

### 5.1 候选人 self-upload 流程

```
1. auth (verify candidate api_key, status=active)
2. rate limit check
3. quota.tryConsume(candidate.id, 5)
4. PII 加密 (AES-256-GCM):
     name_buf = Buffer.from(input.name, 'utf8')
     phone_buf = Buffer.from(input.phone, 'utf8')
     email_buf = Buffer.from(input.email, 'utf8')
5. desensitize(input.{current_company, current_title, expected_salary, ...})
6. db.exec('BEGIN')
7.   priv.insert({source: 'self', headhunter_id: 'self', candidate_user_id: user.id, ...})
8.   anon.insert({intent_status: 'open_to_opportunities', intent_updated_at: now, ...})
9. db.exec('COMMIT')
10. zeroMemory(name_buf / phone_buf / email_buf)  // finally
11. res.locals.ah* = {target_type: 'candidate', target_id: anonId}
12. respond with {anonymized_id, preview, intent_status}
```

**vs 猎头上传差异**：
- 步骤 1-3 完全相同
- 步骤 5-9 完全相同
- 步骤 10-12 完全相同
- **唯一差异**：`headhunter_id = 'self'`、`source = 'self'`、quota 扣的是候选人

→ 实现策略：**抽取 `coreInsertCandidate()` 公共函数**，让两个 handler 共享

### 5.2 猎头 bulk import 流程

```
1. auth (verify headhunter)
2. rate limit
3. 解析 body (zod),检查 candidates.length in [1, 50]
4. quota.tryConsume(headhunter.id, candidates.length * 1)
   不足则: 整个请求 429 INSUFFICIENT_QUOTA
5. for each candidate in candidates:
     try:
       coreInsertCandidate(input, headhunter.id)  // 共享函数
       imported.push(...)
     catch (e):
       failed.push({...error_code, message})
       // 继续处理下一条
6. respond {imported_count, failed_count, imported, failed}
```

**为什么不是单事务**：批量 50 条里 1 条失败重试 50 条成本太高；让客户端决定是否重试 failed 项。

### 5.3 intent_status 过滤流程

```
雇主 GET /v1/employer/talent?industry=互联网
   ↓
browseTalent handler 加 WHERE 子句:
   intent_status != 'hidden'  -- 默认隐藏 hidden
   -- (不主动过滤 not_looking, 因为这是"透明信号")
```

候选人在 `hidden` 状态下，不出现在任何 `browse_talent` 响应里，但**已发出的推荐不受影响**（已在 pipeline 中的 rec 不回滚）。

### 5.4 pitch_md 在 view_url 的展示

`src/main/modules/view/templates/recommendation.ts` 加一段：

```typescript
const pitchSection = d.pitchMd ? `
  <div class="card">
    <h2>猎头推荐报告</h2>
    <div class="pitch">${renderMarkdown(d.pitchMd)}</div>
    ${d.attachments.length > 0 ? `
      <h3>附件</h3>
      <ul class="attachments">
        ${d.attachments.map(a => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.label)}</a> <span class="meta">${esc(a.mime)}</span></li>`).join('')}
      </ul>
    ` : ''}
  </div>
` : '';
```

`renderMarkdown()` 是最小 markdown → HTML 实现（标题、列表、加粗、链接、代码块）；不引入 marked 库（避免新依赖）。

---

## 6. 与现有 spec 的关系

| 现有 spec | v2 影响 |
|---|---|
| `2026-06-17-hunter-platform-design.md` §4.4.2 | **废弃** "候选人先注册 → 猎头代传"为唯一流程；self-upload 成为并列路径 |
| `2026-06-17-hunter-platform-design.md` §4.3.2 | 雇主侧新增隐式过滤（`intent_status != 'hidden'`） |
| `2026-06-17-hunter-platform-design.md` §3.1 schema | 新增 3 列：`candidates_anonymized.intent_status` / `intent_updated_at` / `candidates_private.source` / `recommendations.pitch_md` / `recommendations.attachments_json` |
| `2026-06-18-reposition-to-api-first-design.md` | 不变（仍 API-first） |
| `2026-06-18-action-history-and-industry-map-design.md` §2.2 路由表 | 新增 4 条 action_type 映射（`candidate.upload_resume` / `candidate.set_intent` / `candidate.export_resume` / `headhunter.bulk_import_candidates`） |

---

## 7. 测试策略

### 7.1 单元测试（6 个）

| 测试 | 文件 | 验证点 |
|---|---|---|
| `coreInsertCandidate()` self-source | `tests/unit/core-insert-candidate.test.ts` | source='self', headhunter_id='self' |
| `coreInsertCandidate()` headhunter-source | `tests/unit/core-insert-candidate.test.ts` | source='headhunter', headhunter_id=user.id |
| PII encryption | `tests/unit/core-insert-candidate.test.ts` | name_enc 不是明文,decrypt 可还原 |
| intent_status enum | `tests/unit/candidate-intent.test.ts` | 4 态枚举,非法值抛错 |
| pitch_md length | `tests/unit/recommendation-pitch.test.ts` | 0-5000 字,>5000 抛 INVALID_PARAMS |
| markdown renderer | `tests/unit/lib-md-render.test.ts` | 标题/列表/链接 XSS-safe |

### 7.2 集成测试（10 个）

| 测试 | 文件 |
|---|---|
| `POST /v1/candidate/resumes` happy path | `tests/integration/candidate-upload-resume.test.ts` |
| `POST /v1/candidate/resumes` self-id 唯一性（同一候选人只能 1 份 self-upload） | 同上 |
| `POST /v1/candidate/resumes/:id/intent` 4 态切换 | `tests/integration/candidate-set-intent.test.ts` |
| `GET /v1/candidate/resumes/:id/export` 含明文 PII | `tests/integration/candidate-export-resume.test.ts` |
| `GET /v1/candidate/resumes/:id/export` 越权返回 403 | 同上 |
| `POST /v1/headhunter/candidates/bulk` 50 条 happy path | `tests/integration/headhunter-bulk-import.test.ts` |
| `POST /v1/headhunter/candidates/bulk` 部分失败 (47 success / 3 fail) | 同上 |
| `POST /v1/headhunter/candidates/bulk` quota 不足提前终止 | 同上 |
| `POST /v1/headhunter/recommendations/:id/pitch` 更新 pitch | `tests/integration/recommendation-pitch.test.ts` |
| `GET /v1/view/rec/{id}?t=...` 渲染 pitch_md | `tests/integration/view-recommendation-pitch.test.ts` |

### 7.3 安全测试（4 个）

| 测试 | 文件 |
|---|---|
| A 候选人导出 B 候选人的简历 → 403 | `tests/integration/candidate-export-resume.test.ts` |
| 候选人无法调用 headhunter/upload_candidate | `tests/integration/upload-candidate.test.ts`（扩展） |
| 隐藏 intent 的候选人不出现在 browse_talent | `tests/integration/employer-talent-filter.test.ts`（扩展） |
| pitch_md XSS 注入 → esc() 转义 | `tests/integration/view-recommendation-pitch.test.ts` |

### 7.4 验收清单

- [ ] 所有 5 个新 capability 在 `GET /v1/capabilities` 中可见
- [ ] `pnpm typecheck` 0 error
- [ ] `pnpm test` 全绿（177 现有 + 20 新增 = 197 tests）
- [ ] 0 PII 泄漏：grep `name\|phone\|email` 在所有响应 body 中,确保 preview/export 范围正确
- [ ] 集成测试覆盖 4 步解锁流程（v1 不回归）
- [ ] `docs/superpowers/skill.md` §"快速开始" 含 self-upload 示例
- [ ] `examples/hunter-client.ts` 加新方法 `uploadResume()`

---

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 候选人 self-upload 后猎头再上传同一人 → 双份简历 | 高 | 中 | `candidates_private.candidate_user_id + source` UNIQUE INDEX（v015 follow-up） |
| pitch_md 超大导致 view_url 页面卡 | 中 | 低 | 长度限制 5000 字 + 渲染时 escape |
| Bulk import 触发 SQLite 写锁 | 低 | 中 | 每条独立事务；监控 webhooks queue_pending_count 同步指标 |
| Self-upload 候选人后无猎头主动发现 | 高 | 中 | `intent_status = 'actively_looking'` 在 `browse_talent` 加标记徽章（"⭐ 主动求职"） |
| 候选人 export 含 PII 明文 → 浏览器缓存泄漏 | 低 | 中 | 加 `Cache-Control: no-store, private` 响应头 |
| Markdown renderer XSS | 中 | 高 | 用纯白名单实现（不引 marked），所有用户输入 esc() 后插入 |
| self.upload + headhunter.upload 重复扣 quota | 低 | 中 | `coreInsertCandidate()` 不扣 quota,handler 层显式 tryConsume |

---

## 9. 未来工作（Out of Scope）

- 简历编辑历史（候选人改 5 次，留 5 个 version_id）— v015
- 候选人评分（基于 `intent_updated_at` + `years_experience` 的可信度评分）— v015
- 多层 referrer 链 — v2.1
- 平台内置简历编辑器 — 明确不做（用户 Agent 负责）
- PDF/Word 解析 — 明确不做（用户 Agent 负责）

---

## 10. 决策记录

| 选项 | 选择 | 理由 |
|---|---|---|
| 候选人 self-upload vs 仅猎头代传 | **self-upload** | 用户反馈"第一步是写简历"；spec §1.4 不限制 self-upload |
| intent_status 4 态 vs 2 态 | **4 态** | "主动/开放/暂不/隐藏"是行业标准分类（LinkedIn 同款）；2 态不够细 |
| `headhunter_id='self'` vs NULL | **'self'** | DB NOT NULL 约束；查询简单 (`WHERE headhunter_id = 'self'` vs `WHERE headhunter_id IS NULL`) |
| pitch_md 强制 vs 可选 | **可选(>=50 字推荐)** | 向后兼容 v1；>=50 字是 soft enforcement（warning 而非拒绝） |
| Bulk import 单事务 vs 部分成功 | **部分成功** | 50 条全失败 vs 47 成功 3 失败，后者对客户端更有用 |
| Markdown 渲染自实现 vs 引 marked | **自实现** | 避免新依赖；pitch 只需子集（标题/列表/链接/加粗）；白名单实现更安全 |
| Bulk import 配额 1/条 vs 5/条 | **1/条** | 批量是折扣场景；v1 single 5 quota 已经偏贵 |
| self-upload 复用 headhunter.uploadCandidate vs 抽 coreInsert | **抽 coreInsert** | 减少重复,确保 PII 处理一致性 |