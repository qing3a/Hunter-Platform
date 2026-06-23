# Required `current_company` on Candidate Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `POST /v1/headhunter/candidates` 强制要求 `current_company` 字段（不可空、不可空字符串），消除新上传候选人 `industry` 字段为 NULL 的问题。

**Architecture:** 单一改动点 — `src/main/routes/headhunter.ts:25` 把 `z.string().max(200).optional()` 改为 `z.string().min(1).max(200)`。zod schema 自动在路由入口拒绝无效输入并返回 400 INVALID_PARAMS。Handler/repo/engine/mapping 不动（上游兜底，下游自动安全）。MCP server 不改代码，只升级 README + capability description + 发 v0.1.3。

**Tech Stack:** zod（已用）, Express（已用）, vitest（已用）, better-sqlite3（已用）

**Spec:** [docs/superpowers/specs/2026-06-23-required-current-company-design.md](../specs/2026-06-23-required-current-company-design.md)

**参考实现：** [docs/superpowers/plans/2026-06-23-admin-action-history-endpoint-plan.md](2026-06-23-admin-action-history-endpoint-plan.md)（同批任务的 plan 格式参考）

---

## 现有代码上下文（开始 Task 1 前必读）

实施前应熟悉的文件：

- `src/main/routes/headhunter.ts` — 当前 schema 在 line 20-31；UploadCandidateInput 是 local schema（不是 import）；handler 调用在 line 55
- `src/main/modules/headhunter/handler.ts` — `UploadCandidateInput` interface（line 16+）；`current_company?: string | undefined` (line 21)
- `src/main/modules/desensitize/engine.ts:15` — industry 计算逻辑（不修改）
- `src/main/modules/desensitize/mapping.ts` — `lookupIndustry()` 已实现（不修改）
- `tests/integration/headhunter-*.test.ts` — 集成测试模式参考
- `src/main/capabilities/headhunter.ts` — capability description（MCP 给 agent 看的描述）

**不动文件**：
- `src/main/modules/desensitize/engine.ts`（上游已保证非空）
- `src/main/modules/desensitize/mapping.ts`
- `config/industry_map.json`
- `src/main/db/repositories/candidates-private.ts`
- 数据库 schema

---

## Task 1: 修改 `UploadSchema` 加 `current_company` 必填（5 个测试）

**Files:**
- Modify: `src/main/routes/headhunter.ts:25`
- Create: `tests/integration/headhunter-upload-current-company.test.ts`

### Step 1.1: 创建集成测试文件

Create `tests/integration/headhunter-upload-current-company.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('POST /v1/headhunter/candidates - current_company required', () => {
  const testDb = path.join(__dirname, '../../tmp/hp-cc-test.db');
  let app: any;
  let db: any;
  let headhunterApiKey: string;
  const HEADHUNTER_ID = 'hh_test_1';

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    // Seed headhunter with API key prefix + plain key for header
    headhunterApiKey = 'hp_live_test_headhunter_2026';
    db.prepare(`
      INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
        quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES (?, 'headhunter', 'Test HH', null, 'h_dummy', ?, 100, 0,
        datetime('now', '+1 day'), 50, 'active', '2026-06-17T00:00:00Z', '2026-06-17T00:00:00Z')
    `).run(HEADHUNTER_ID, headhunterApiKey);
  });

  afterAll(() => { if (db) db.close(); });

  const validInput = {
    candidate_user_id: 'cand_test_1',
    name: '张三',
    phone: '13800000000',
    email: 'zhang@test.com',
    current_company: '字节跳动',
    current_title: '高级工程师',
  };

  // ---- 400 cases ----
  it('400 when current_company field is missing', async () => {
    const { current_company, ...inputWithoutCompany } = validInput;
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterApiKey}`)
      .send(inputWithoutCompany);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
    expect(res.body.error.message).toMatch(/current_company.*required/i);
  });

  it('400 when current_company is empty string', async () => {
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterApiKey}`)
      .send({ ...validInput, current_company: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
  });

  // ---- 200 cases (industry != null) ----
  it('200 when current_company is known (字节跳动 → 互联网)', async () => {
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterApiKey}`)
      .send(validInput);
    expect(res.status).toBe(200);
    expect(res.body.data.preview.industry).toBe('互联网');
  });

  it('200 when current_company is unknown → fallback 其他', async () => {
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterApiKey}`)
      .send({ ...validInput, current_company: '某无人知晓的工作室' });
    expect(res.status).toBe(200);
    expect(res.body.data.preview.industry).toBe('其他');
  });

  it('200 when current_company matches keyword fallback (某科技公司 → 互联网)', async () => {
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterApiKey}`)
      .send({ ...validInput, current_company: '深圳某科技公司' });
    expect(res.status).toBe(200);
    expect(res.body.data.preview.industry).toBe('互联网');
  });
});
```

### Step 1.2: 跑测试，验证前 2 个失败（缺 current_company / 空串）

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/headhunter-upload-current-company.test.ts 2>&1 | tail -10`
Expected: 2 tests fail with "current_company" related error or similar (the 3 known-company tests should already pass since current schema accepts optional + lookupIndustry returns "其他" for unknowns).

Note: The exact failure pattern depends on how zod handles optional-vs-missing. If the API accepts missing current_company as undefined and produces industry=null, the first 2 tests may currently fail with a 200 response showing industry=null. The fix in Step 1.4 will make them pass.

### Step 1.3: 改 schema（1 行）

打开 `src/main/routes/headhunter.ts`，找到 line 25：

```typescript
  current_company: z.string().max(200).optional(),
```

改为：

```typescript
  current_company: z.string().min(1).max(200),
```

### Step 1.4: 跑测试，验证全部 5 个通过

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/headhunter-upload-current-company.test.ts 2>&1 | tail -10`
Expected: 5 passed

### Step 1.5: 跑 typecheck

Run: `cd D:\dev\hunter-platform && pnpm typecheck 2>&1 | tail -3`
Expected: no errors

### Step 1.6: Commit

```bash
cd D:\dev\hunter-platform
git add src/main/routes/headhunter.ts tests/integration/headhunter-upload-current-company.test.ts
git commit -m "feat(api): require current_company on headhunter upload (fix industry NULL)"
```

---

## Task 2: 更新 capability description（headhunter upload_candidate）

**Files:**
- Modify: `src/main/capabilities/headhunter.ts`

### Step 2.1: 找 capability description 当前文案

打开 `src/main/capabilities/headhunter.ts`，找到 `name: 'headhunter.upload_candidate'` 附近的 `description` 字段。

Expected: 当前描述可能是 `'Upload a candidate...'` 或类似文本（不需精确匹配，下面提供具体替换）。

### Step 2.2: 在 description 中加 "current_company required" 提示

找到 `description:` 那行（具体行号随当前代码而定），在末尾加：

```typescript
description: 'Upload a candidate to the platform. REQUIRED: current_company must be a non-empty string (1-200 chars).',
```

注意：
- 如果当前已有 description，则替换整行
- 如果 description 是多行（在 array/object 形式），确保只改这一项

### Step 2.3: 跑 typecheck + capability 相关测试

Run: `cd D:\dev\hunter-platform && pnpm typecheck 2>&1 | tail -3 && pnpm vitest run tests/unit/scripts/check-capabilities.test.ts 2>&1 | tail -5`
Expected: typecheck clean; capability test pass

### Step 2.4: Commit

```bash
cd D:\dev\hunter-platform
git add src/main/capabilities/headhunter.ts
git commit -m "feat(capabilities): mark current_company required in upload_candidate description"
```

---

## Task 3: 更新 `docs/superpowers/skill.md` 表格

**Files:**
- Modify: `docs/superpowers/skill.md`

### Step 3.1: 找 `current_company` 在表格中的行

Run: `cd D:\dev\hunter-platform && grep -n "current_company\|UploadCandidate" docs/superpowers/skill.md | head -5`

Expected output: 类似 `| current_company | 当前公司（最大 200 字符）|` 的行，附近还有 UploadCandidateRequest 表格。

### Step 3.2: 加 `**Required**` 标记

找到该行（具体行号取决于 grep 结果），把：

```markdown
| `current_company` | 当前公司（最大 200 字符） |
```

改为：

```markdown
| `current_company` | 当前公司（**Required**，1-200 字符，必填非空） |
```

### Step 3.3: Commit

```bash
cd D:\dev\hunter-platform
git add docs/superpowers/skill.md
git commit -m "docs(skill): mark current_company as required on candidate upload"
```

---

## Task 4: 更新 `docs/superpowers/openapi.json`

**Files:**
- Modify: `docs/superpowers/openapi.json`

### Step 4.1: 找 `UploadCandidateRequest` schema

Run: `cd D:\dev\hunter-platform && grep -n "UploadCandidateRequest\|current_company" docs/superpowers/openapi.json | head -10`

Expected: 找到 `UploadCandidateRequest` 块，里面有 `current_company` 字段定义。

### Step 4.2: 修改 schema

找到 `UploadCandidateRequest` 的 `properties` 块中：

```json
"current_company": { "type": "string", "maxLength": 200 },
```

改为：

```json
"current_company": { "type": "string", "minLength": 1, "maxLength": 200 },
```

如果 `required` 列表存在（这个 schema 应该已有 required 列表），在其中加 `"current_company"`。

如果 `required` 列表不存在，按 OpenAPI 3.0 规范加上：
```json
"required": ["candidate_user_id", "name", "phone", "email", "current_company"],
```

### Step 4.3: 验证 openapi:check 通过

Run: `cd D:\dev\hunter-platform && pnpm openapi:check 2>&1 | tail -5`
Expected: `✅ No dangling paths` 和 `Forward coverage: 0 routes scanned but not yet in openapi.json`

### Step 4.4: Commit

```bash
cd D:\dev\hunter-platform
git add docs/superpowers/openapi.json
git commit -m "docs(openapi): mark current_company required in UploadCandidateRequest"
```

---

## Task 5: 升级 MCP server 到 v0.1.3（README + CHANGELOG + package.json）

**Files:**
- Modify: `mcp-server/package.json`
- Modify: `mcp-server/README.md`
- Modify: `mcp-server/CHANGELOG.md`（如不存在则新建）

### Step 5.1: 升级 package.json 版本

打开 `mcp-server/package.json`，找到 `"version": "0.1.2"`，改为 `"version": "0.1.3"`。

### Step 5.2: 在 README.md 加 breaking change 章节

打开 `mcp-server/README.md`，在适当位置（如 "Configuration" 章节后）插入：

```markdown
## Breaking Changes

### v0.1.3 — `upload_candidate` requires `current_company`

Starting v0.1.3, the `upload_candidate` tool **requires** the `current_company` parameter.
The Hunter Platform API returns HTTP 400 with `INVALID_PARAMS` if `current_company` is missing, null, or empty string.

**Migration**: ensure your agent passes `current_company` when calling `upload_candidate`.

```typescript
// Before v0.1.3 (worked)
upload_candidate({ candidate_user_id, name, phone, email /* current_company optional */ });

// v0.1.3 (required)
upload_candidate({ candidate_user_id, name, phone, email, current_company: '字节跳动' });
```

### v0.1.2 and earlier
No breaking changes. Optional field.
```

### Step 5.3: 更新 CHANGELOG.md

如果 `mcp-server/CHANGELOG.md` 不存在，新建它。如果存在，顶部追加：

```markdown
# Changelog

## [0.1.3] - 2026-06-23

### Breaking Changes

- `upload_candidate` tool now **requires** `current_company` parameter. The Hunter Platform API returns 400 INVALID_PARAMS if missing or empty. Update your agent to always pass `current_company` when uploading candidates.

## [0.1.2] - 2026-06-21

(Previous release)
```

如果已有 v0.1.2 条目，保留它并在其前加 v0.1.3。

### Step 5.4: 跑 MCP server typecheck（如有）

Run: `cd D:\dev\hunter-platform/mcp-server && pnpm typecheck 2>&1 | tail -3 || echo "no MCP typecheck script"`
Expected: clean, or "no MCP typecheck script" (MCP server 可能没 typecheck 脚本，跳过即可)

### Step 5.5: 跑 MCP server build（如有）

Run: `cd D:\dev\hunter-platform/mcp-server && pnpm build 2>&1 | tail -5 || echo "no build script"`
Expected: clean build, or "no build script"

### Step 5.6: Commit

```bash
cd D:\dev\hunter-platform
git add mcp-server/package.json mcp-server/README.md mcp-server/CHANGELOG.md
git commit -m "chore(mcp): bump to v0.1.3 (upload_candidate requires current_company)"
```

---

## Task 6: 全量回归 + 上线前检查

### Step 6.1: 跑全套测试

Run: `cd D:\dev\hunter-platform && pnpm test 2>&1 | tail -5`
Expected: All pass (既有 800+ + 新 5 = 0 regression). 如有既有测试失败因为缺 current_company，需要补字段（这种情况下 grep "upload_candidate" in tests/ 找到失败测试加上字段）。

### Step 6.2: 跑 typecheck + openapi:check

Run: `cd D:\dev\hunter-platform && pnpm typecheck 2>&1 | tail -3 && pnpm openapi:check 2>&1 | tail -3`
Expected: both clean

### Step 6.3: 检查 git log

Run: `cd D:\dev\hunter-platform && git log --oneline -8`
Expected: 看到 5 个新 commit + spec + 之前的 merge：
```
a659673 spec: require current_company on candidate upload (fix industry NULL)
XXXXXX chore(mcp): bump to v0.1.3 (upload_candidate requires current_company)
XXXXXX docs(openapi): mark current_company required in UploadCandidateRequest
XXXXXX docs(skill): mark current_company as required on candidate upload
XXXXXX feat(capabilities): mark current_company required in upload_candidate description
XXXXXX feat(api): require current_company on headhunter upload (fix industry NULL)
```

---

## 验收清单（与 spec §10 对齐）

- [ ] `src/main/routes/headhunter.ts:25` 改为 `z.string().min(1).max(200)`
- [ ] 5 个新增测试全过
- [ ] `pnpm typecheck` 无错
- [ ] `pnpm test` 全套通过（既有 800+ + 新 5 = 0 regression）
- [ ] `pnpm openapi:check` 通过
- [ ] `docs/superpowers/skill.md` 表格加 Required 标记
- [ ] `docs/superpowers/openapi.json` schema 更新
- [ ] `src/main/capabilities/headhunter.ts` description 更新
- [ ] `mcp-server/package.json` version 0.1.2 → 0.1.3
- [ ] `mcp-server/README.md` 标注 breaking change
- [ ] `mcp-server/CHANGELOG.md` 加 v0.1.3 条目
- [ ] 5 个新 commit 全部就位

---

## 上线流程（spec §11）

按顺序：

1. 把所有新 commit 推送到 `origin/main`
2. SSH 到生产服务器 `qing3.top`
3. `cd /www/wwwroot/hunter-platform-api && git pull`
4. `pnpm build`（编译到 `out/`）
5. 重启 Node 服务（按现有 pm2 / systemd 流程）
6. nginx reload（如果路由有变；本任务不变 nginx 配置）
7. 远程验证：
   ```bash
   # 1) 缺 current_company → 400
   curl -X POST https://api.hunter-platform.com/v1/headhunter/candidates \
     -H "Authorization: Bearer $HP_API_KEY" \
     -d '{"candidate_user_id":"c1","name":"X","phone":"138...","email":"x@y"}'
   # Expected: {"ok":false,"error":{"code":"INVALID_PARAMS",...}}
   
   # 2) 正常调用 → 200, industry="互联网"
   curl -X POST https://api.hunter-platform.com/v1/headhunter/candidates \
     -H "Authorization: Bearer $HP_API_KEY" \
     -d '{"...","current_company":"字节跳动"}'
   # Expected: {"ok":true,"data":{"preview":{"industry":"互联网",...}}}
   ```
8. 发布 `@qing3a/hunter-platform-mcp@0.1.3` 到 GitHub Packages（按现有发布流程）
9. （可选）发 release note v1.x.y — "upload_candidate now requires current_company"

---

## 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|------|------|------|------------|
| 旧 MCP 版本调用被 400 拒绝 | 中 | 中 | README 标注 breaking change；推荐升级 v0.1.3 |
| 既有测试因为缺 current_company 失败 | 低 | 中 | Step 6.1 检测到时补字段 |
| Agent 传 "unknown" 等无意义值 | 低 | 低 | lookupIndustry fallback 到 "其他" — 仍可过滤 |

**回滚**：每个 Task 单独 commit；如需紧急回滚整组：

```bash
cd D:\dev\hunter-platform
git revert --no-commit <last-commit-of-this-feature>..<first-commit-of-this-feature>
git commit -m "revert: require current_company (rollback)"
```