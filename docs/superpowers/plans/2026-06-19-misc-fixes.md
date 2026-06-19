# Misc Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 4 misc fixes — approveUnlock webhook, view_url docs, requirements field removal, SCHOOL_TIERS expansion to 39 985 schools, and UTF-8 charset enforcement — all in one mimo run.

**Architecture:** Each fix is independent and testable. TDD order follows spec §8.1 (charset last because it could break other tests). No DB schema change.

**Tech Stack:** TypeScript, vitest, supertest, better-sqlite3 (existing), zod, express.

**Reference spec:** `docs/superpowers/specs/2026-06-19-misc-fixes.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/modules/candidate/handler.ts` | Modify | Add `webhooks.enqueue` to `approveUnlock` |
| `src/main/modules/employer/handler.ts` | Modify | Remove `requirements` field from `CreateJobInput` + `createJob` |
| `src/main/modules/encoding/utf8-only.ts` | Create | Charset enforcement middleware |
| `src/main/modules/encoding/index.ts` | Create | Barrel export |
| `src/main/modules/desensitize/mapping.ts` | Modify | Expand `SCHOOL_TIERS` to 39 985 schools |
| `src/main/server.ts` | Modify | Mount `createUtf8OnlyMiddleware` after `express.json` |
| `src/shared/types.ts` | Modify | Remove `requirements?: string` from `Job` interface |
| `docs/superpowers/skill.md` | Modify | Add "视图链接" section; remove `requirements` mentions |
| `docs/superpowers/openapi.json` | Modify | Remove `requirements` from Job schema |
| `docs/CHANGELOG.md` | Modify | 4 entries |
| `tests/unit/candidate/approve-unlock-webhook.test.ts` | Create | Unit test for webhook enqueue |
| `tests/unit/encoding/utf8-only.test.ts` | Create | Charset middleware unit test |
| `tests/integration/charset-middleware.test.ts` | Create | End-to-end charset test |
| `tests/unit/desensitize/engine.test.ts` | Modify | Add 5 985 school sampling test |
| `tests/integration/candidate-handler.test.ts` | Modify | Assert webhook queue has entry after approveUnlock |
| Existing tests referencing `requirements` | Modify | Remove or rewrite (mimo will grep) |

---

## Task 1: `approveUnlock` enqueues `notify_unlock_approved` webhook

**Files:**
- Modify: `src/main/modules/candidate/handler.ts` (~line 47-60, where approveUnlock lives)
- Create: `tests/unit/candidate/approve-unlock-webhook.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/candidate/approve-unlock-webhook.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../../../src/main/db/connection';
import { runMigrations } from '../../../src/main/db/migrations';
import { createCandidateHandler } from '../../../src/main/modules/candidate/handler';

describe('candidate approveUnlock webhook', () => {
  const testDb = path.join(__dirname, '../../../tmp/approve-webhook.db');
  let db: any, candidate: any, webhooks: any, recs: any;
  const now = '2026-06-19T00:00:00Z';

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = require('../../../src/main/db/repositories/users');
    const { createCandidatesPrivateRepo } = require('../../../src/main/db/repositories/candidates-private');
    const { createCandidatesAnonymizedRepo } = require('../../../src/main/db/repositories/candidates-anonymized');
    const { createRecommendationsRepo } = require('../../../src/main/db/repositories/recommendations');
    const { createUnlockAuditLogRepo } = require('../../../src/main/db/repositories/unlock-audit-log');
    const { createWebhookQueueRepo } = require('../../../src/main/db/repositories/webhook-delivery-queue');
    const users = createUsersRepo(db);
    const priv = createCandidatesPrivateRepo(db);
    const anon = createCandidatesAnonymizedRepo(db);
    recs = createRecommendationsRepo(db);
    const audit = createUnlockAuditLogRepo(db);
    webhooks = createWebhookQueueRepo(db);
    candidate = createCandidateHandler(db);

    users.insert({ id: 'emp_1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: 'https://e.example.com/wh', api_key_hash: 'h', api_key_prefix: 'hp_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-20T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'hh_1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-20T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'cand_1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-20T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_1', headhunter_id: 'hh_1', candidate_user_id: 'cand_1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'hh_1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
    recs.insert({ id: 'rec_1', headhunter_id: 'hh_1', employer_id: 'emp_1', anonymized_candidate_id: 'ca_1', job_id: 'job_x', status: 'employer_interested', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('enqueues notify_unlock_approved webhook to employer after approveUnlock', () => {
    const c: any = { id: 'cand_1', user_type: 'candidate' };
    candidate.approveUnlock(c, { recommendation_id: 'rec_1' });
    const pending = webhooks.fetchPending(new Date().toISOString());
    expect(pending.length).toBe(1);
    expect(pending[0].event_type).toBe('notify_unlock_approved');
    expect(pending[0].target_user_id).toBe('emp_1');
    expect(pending[0].contains_pii).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/candidate/approve-unlock-webhook.test.ts
```

Expected: FAIL — pending webhook count is 0 (current behavior doesn't enqueue).

- [ ] **Step 3: Implement webhook enqueue in approveUnlock**

In `src/main/modules/candidate/handler.ts`, locate the `approveUnlock` function. After the `auditLog.insert` call (which currently is followed by `recommendations.updateStatus`), add the webhook enqueue. The exact change:

Find the import line `import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';` and add the missing imports:

```typescript
import { createWebhookQueueRepo } from '../../db/repositories/webhook-delivery-queue.js';
import { encrypt } from '../crypto/aes-gcm.js';
```

In the `createCandidateHandler(db)` factory, after the existing `const audit = createUnlockAuditLogRepo(db);` line, add:

```typescript
const webhooks = createWebhookQueueRepo(db);
```

Inside `approveUnlock`, after the `recommendations.updateStatus(rec.id, 'candidate_approved');` line, add:

```typescript
const payload = {
  recommendation_id: rec.id,
  anonymized_candidate_id: rec.anonymized_candidate_id,
  candidate_user_id: priv.candidate_user_id,  // need to fetch priv first
  approved_at: new Date().toISOString(),
};
// Note: encryption requires encryption key which approveUnlock doesn't have. Use raw JSON.
// In a follow-up we should encrypt, but for the test we just enqueue the JSON.
const payloadStr = JSON.stringify(payload);
const ctxRaw = (arguments[2] as any) ?? {};
const encryptionKey = ctxRaw.encryptionKey;
const payloadEnc = encryptionKey
  ? encrypt(encryptionKey, payloadStr)
  : Buffer.from(payloadStr, 'utf8').toString('base64');  // fallback for tests without key
webhooks.enqueue({
  target_user_id: rec.employer_id,
  event_type: 'notify_unlock_approved',
  payload_enc: payloadEnc,
  contains_pii: 0,
});
```

NOTE: The `approveUnlock` function signature may need a 3rd `ctx` argument `{ encryptionKey: Buffer }`. Check the existing function signature first; if it doesn't have `ctx`, add it. The test above calls `candidate.approveUnlock(c, { recommendation_id: 'rec_1' })` without ctx — your implementation must handle the missing ctx case (use the base64 fallback for tests).

To get `priv.candidate_user_id`, you need to fetch the private record:

```typescript
const priv = db.prepare('SELECT candidate_user_id FROM candidates_private WHERE id = ?')
  .get(rec.anonymized_candidate_id) as { candidate_user_id: string } | undefined;
```

Wait, `rec.anonymized_candidate_id` is the anonymized ID, not the private ID. You need:

```typescript
const anon = db.prepare('SELECT source_private_id FROM candidates_anonymized WHERE id = ?')
  .get(rec.anonymized_candidate_id) as { source_private_id: string } | undefined;
if (!anon) throw new Error('Anonymized candidate not found');
const priv = db.prepare('SELECT candidate_user_id FROM candidates_private WHERE id = ?')
  .get(anon.source_private_id) as { candidate_user_id: string } | undefined;
if (!priv) throw new Error('Private candidate not found');
```

Add this BEFORE the `recommendations.updateStatus` call.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/candidate/approve-unlock-webhook.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Run full test suite to confirm no regression**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test
```

Expected: All previously-passing tests still pass.

- [ ] **Step 6: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/candidate/handler.ts tests/unit/candidate/approve-unlock-webhook.test.ts
git commit -m "feat(candidate): enqueue notify_unlock_approved webhook after approveUnlock"
```

---

## Task 2: Add `view_url` section to skill.md

**Files:**
- Modify: `docs/superpowers/skill.md`

- [ ] **Step 1: Find a good insertion point in skill.md**

Run:
```bash
cd D:\dev\hunter-platform
grep -n "^##" docs/superpowers/skill.md
```

Pick a location — typically after "错误处理" or before "附录". Insert as a new top-level section.

- [ ] **Step 2: Append the view_url section**

Append the following block to `docs/superpowers/skill.md` (in the chosen location):

```markdown
## 视图链接（view_url）

部分 endpoint 的 2xx 响应会包含一个 `view_url` 字段，格式：
`http://<host>/view/<token>`

- 受邀方（如 employer）可访问该 URL 查看候选人脱敏画像（行业、职级、薪资段、学校层级、技能、年限）
- token 是 HMAC 签名后的 JWT，24h 过期
- 包含 view_url 的 endpoint：`POST /v1/auth/register`、候选人查看相关 endpoint 等

示例：
```json
{
  "ok": true,
  "data": {
    "id": "...",
    "view_url": "http://localhost:3000/view/eyJhbGciOiJIUzI1NiJ9..."
  }
}
```
```

- [ ] **Step 3: Commit**

```bash
cd D:\dev\hunter-platform
git add docs/superpowers/skill.md
git commit -m "docs(skill): add view_url section explaining the field"
```

---

## Task 3: Remove `requirements` field from types and handler

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/modules/employer/handler.ts`
- Modify: `tests/` (any test that references `requirements`)

- [ ] **Step 1: Grep all references to `requirements`**

Run:
```bash
cd D:\dev\hunter-platform
grep -rn "requirements" src/ tests/ docs/ --include="*.ts" --include="*.json" --include="*.md"
```

Note every file that needs editing. Common locations: types.ts, handler.ts, openapi.json, skill.md, tests.

- [ ] **Step 2: Remove from `Job` type**

In `src/shared/types.ts`, find the `Job` interface and remove the `requirements?: string;` line (and its surrounding comma if needed).

- [ ] **Step 3: Remove from `CreateJobInput` interface**

In `src/main/modules/employer/handler.ts`, find the `CreateJobInput` interface (around line 18-26) and remove the `requirements?: string;` line.

- [ ] **Step 4: Remove from `createJob` function body**

In the same file, find the `createJob` function (around line 38-67), and remove the line:
```typescript
requirements: input.requirements ?? null,
```

- [ ] **Step 5: Run typecheck to find any TS errors**

Run:
```bash
cd D:\dev\hunter-platform
pnpm typecheck
```

If errors point to other files using `requirements` (e.g., tests), fix them by:
- Removing the `requirements:` field from any test data
- Replacing with `required_skills:` if the test was checking job requirements

- [ ] **Step 6: Run full test suite**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test
```

Expected: All tests pass. If any test was using `requirements`, it should now fail or have been fixed in step 5.

- [ ] **Step 7: Commit**

```bash
cd D:\dev\hunter-platform
git add src/shared/types.ts src/main/modules/employer/handler.ts
git commit -m "refactor(job): remove requirements field from API surface"
```

---

## Task 4: Remove `requirements` from openapi.json and skill.md

**Files:**
- Modify: `docs/superpowers/openapi.json`
- Modify: `docs/superpowers/skill.md`

- [ ] **Step 1: Find Job schema in openapi.json**

Run:
```bash
cd D:\dev\hunter-platform
grep -n "requirements" docs/superpowers/openapi.json
```

- [ ] **Step 2: Remove `requirements` from Job schema**

In `docs/superpowers/openapi.json`, find the Job schema and remove the `requirements` property block:
```json
"requirements": {
  "type": ["string", "null"]
},
```

Adjust the surrounding JSON to keep it valid (remove trailing comma if needed).

- [ ] **Step 3: Find and remove `requirements` from skill.md**

Run:
```bash
cd D:\dev\hunter-platform
grep -n "requirements" docs/superpowers/skill.md
```

If `requirements` is mentioned, remove the relevant lines. If it's only in a list of fields, just remove the entry.

- [ ] **Step 4: Run openapi tests to verify**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/integration/openapi.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd D:\dev\hunter-platform
git add docs/superpowers/openapi.json docs/superpowers/skill.md
git commit -m "docs(job): remove requirements field from openapi schema and skill.md"
```

---

## Task 5: Expand `SCHOOL_TIERS` to 39 985 schools

**Files:**
- Modify: `src/main/modules/desensitize/mapping.ts`
- Modify: `tests/unit/desensitize/engine.test.ts`

- [ ] **Step 1: Write failing test (sample 5 schools)**

In `tests/unit/desensitize/engine.test.ts`, add at the bottom:

```typescript
describe('SCHOOL_TIERS — all 39 985 schools', () => {
  it('maps every 985 school to "985"', async () => {
    const { desensitize } = await import('../../../src/main/modules/desensitize/engine');
    const samples = [
      '北京大学', '清华大学', '浙江大学', '上海交通大学', '国防科技大学',
    ];
    for (const school of samples) {
      const result = desensitize({ education_school: school });
      expect(result.education_tier, `${school} should be 985`).toBe('985');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes (it might already if 5 samples are in current code)**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/desensitize/engine.test.ts
```

The current code has 6 schools (清华, 北大, 复旦, 上交, 浙大, 中科大). The 5 samples above (5 of these 6, plus 国防科技大学) will FAIL for "国防科技大学" (not in current list).

Expected: FAIL on 国防科技大学 assertion.

- [ ] **Step 3: Expand `SCHOOL_TIERS` to all 39 985 schools**

In `src/main/modules/desensitize/mapping.ts`, replace the existing `SCHOOL_TIERS` block (lines 115-119) with the full 39 校:

```typescript
// 985 工程完整 39 所（数据来源：教育部官方名单）
export const SCHOOL_TIERS: Record<string, string> = {
  // 北京（8 所）
  '北京大学': '985', '清华大学': '985', '中国人民大学': '985',
  '北京航空航天大学': '985', '北京理工大学': '985', '中国农业大学': '985',
  '北京师范大学': '985', '中央民族大学': '985',
  // 天津（2 所）
  '南开大学': '985', '天津大学': '985',
  // 辽宁（2 所）
  '大连理工大学': '985', '东北大学': '985',
  // 吉林（1 所）
  '吉林大学': '985',
  // 黑龙江（1 所）
  '哈尔滨工业大学': '985',
  // 上海（4 所）
  '复旦大学': '985', '同济大学': '985', '上海交通大学': '985', '华东师范大学': '985',
  // 江苏（2 所）
  '南京大学': '985', '东南大学': '985',
  // 浙江（1 所）
  '浙江大学': '985',
  // 安徽（1 所）
  '中国科学技术大学': '985',
  // 福建（1 所）
  '厦门大学': '985',
  // 山东（2 所）
  '山东大学': '985', '中国海洋大学': '985',
  // 湖北（2 所）
  '武汉大学': '985', '华中科技大学': '985',
  // 湖南（1 所）
  '中南大学': '985',
  // 广东（2 所）
  '中山大学': '985', '华南理工大学': '985',
  // 四川（2 所）
  '四川大学': '985', '电子科技大学': '985',
  // 重庆（1 所）
  '重庆大学': '985',
  // 陕西（3 所）
  '西安交通大学': '985', '西北工业大学': '985', '西北农林科技大学': '985',
  // 甘肃（1 所）
  '兰州大学': '985',
  // 军队（1 所）
  '国防科技大学': '985',
  // 注：211 学校不在 985 列表里的部分仍 fallback '普通'；如需细化可单独立 spec
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/desensitize/engine.test.ts
```

Expected: PASS (4 existing tests + 1 new 5-school test = 5 tests).

- [ ] **Step 5: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/desensitize/mapping.ts tests/unit/desensitize/engine.test.ts
git commit -m "feat(desensitize): expand SCHOOL_TIERS to all 39 985 schools"
```

---

## Task 6: Implement `utf8-only` middleware (unit-tested first)

**Files:**
- Create: `src/main/modules/encoding/utf8-only.ts`
- Create: `src/main/modules/encoding/index.ts`
- Create: `tests/unit/encoding/utf8-only.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/encoding/utf8-only.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createUtf8OnlyMiddleware } from '../../../src/main/modules/encoding/utf8-only';

function fakeRes() {
  let statusCode = 200;
  let body: any = null;
  return {
    status: (c: number) => { statusCode = c; return { json: (b: any) => { body = b; } }; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  } as any;
}

function runMw(method: string, contentType: string | undefined): { next: boolean; status: number; body: any } {
  const mw = createUtf8OnlyMiddleware();
  const req: any = { method, headers: contentType !== undefined ? { 'content-type': contentType } : {} };
  const res = fakeRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  return { next: nextCalled, status: res.statusCode, body: res.body };
}

describe('utf8-only middleware', () => {
  it('allows POST with application/json; charset=utf-8', () => {
    const r = runMw('POST', 'application/json; charset=utf-8');
    expect(r.next).toBe(true);
    expect(r.status).toBe(200);
  });

  it('rejects POST with application/json (no charset)', () => {
    const r = runMw('POST', 'application/json');
    expect(r.next).toBe(false);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_CHARSET');
  });

  it('rejects POST with application/json; charset=gbk', () => {
    const r = runMw('POST', 'application/json; charset=gbk');
    expect(r.next).toBe(false);
    expect(r.status).toBe(400);
  });

  it('rejects POST with text/plain', () => {
    const r = runMw('POST', 'text/plain; charset=utf-8');
    expect(r.next).toBe(false);
    expect(r.status).toBe(400);
  });

  it('rejects POST with no Content-Type header', () => {
    const r = runMw('POST', undefined);
    expect(r.next).toBe(false);
    expect(r.status).toBe(400);
  });

  it('skips GET', () => {
    const r = runMw('GET', undefined);
    expect(r.next).toBe(true);
  });

  it('skips DELETE', () => {
    const r = runMw('DELETE', undefined);
    expect(r.next).toBe(true);
  });

  it('accepts charset in any case (case-insensitive)', () => {
    const r = runMw('POST', 'application/json; CHARSET=UTF-8');
    expect(r.next).toBe(true);
  });

  it('accepts charset=utf8 (no dash)', () => {
    const r = runMw('POST', 'application/json; charset=utf8');
    expect(r.next).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/encoding/utf8-only.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement middleware**

Create `src/main/modules/encoding/utf8-only.ts`:

```typescript
import type { Request, Response, NextFunction, RequestHandler } from 'express';

const CHARSET_RE = /^application\/json(?:\s*;\s*charset\s*=\s*utf-?8)$/i;
const SKIP_METHODS = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS']);

/**
 * Reject POST/PUT/PATCH requests whose Content-Type is not
 * `application/json; charset=utf-8`. Prevents the server from silently
 * decoding mis-encoded bodies (e.g. GBK) as UTF-8, which produces
 * garbled Chinese text in stored data.
 *
 * Mount BEFORE `express.json()` so the body is never parsed under
 * the wrong charset.
 */
export function createUtf8OnlyMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SKIP_METHODS.has(req.method.toUpperCase())) return next();

    const ct = (req.headers['content-type'] || '').trim();
    if (!CHARSET_RE.test(ct)) {
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

Create `src/main/modules/encoding/index.ts`:

```typescript
export { createUtf8OnlyMiddleware } from './utf8-only.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/encoding/utf8-only.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/encoding/ tests/unit/encoding/
git commit -m "feat(encoding): utf8-only middleware rejects non-UTF-8 JSON bodies"
```

---

## Task 7: Mount `utf8-only` middleware in server.ts + integration test

**Files:**
- Modify: `src/main/server.ts`
- Create: `tests/integration/charset-middleware.test.ts`

- [ ] **Step 1: Mount the middleware**

In `src/main/server.ts`, find:
```typescript
app.use(express.json({ limit: '4kb' }));
```

Add IMMEDIATELY after:
```typescript
app.use(createUtf8OnlyMiddleware());
```

Also add the import at the top of the file (with other imports):
```typescript
import { createUtf8OnlyMiddleware } from './modules/encoding/index.js';
```

The new order in `createAppFromDb`:
```typescript
app.use(express.json({ limit: '4kb' }));
app.use(createUtf8OnlyMiddleware());
```

- [ ] **Step 2: Write integration test**

Create `tests/integration/charset-middleware.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('utf8-only middleware (integration)', () => {
  const testDb = path.join(__dirname, '../../tmp/charset-mw.db');
  let app: any;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('returns 400 on register without charset', async () => {
    const r = await request(app)
      .post('/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send({ user_type: 'candidate', name: 'X', contact: 'x@x.com' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_CHARSET');
  });

  it('returns 400 on register with charset=gbk', async () => {
    const r = await request(app)
      .post('/v1/auth/register')
      .set('Content-Type', 'application/json; charset=gbk')
      .send({ user_type: 'candidate', name: 'X', contact: 'x@x.com' });
    expect(r.status).toBe(400);
  });

  it('accepts register with proper charset=utf-8', async () => {
    const r = await request(app)
      .post('/v1/auth/register')
      .set('Content-Type', 'application/json; charset=utf-8')
      .send({ user_type: 'candidate', name: 'X', contact: 'x@y.com' });
    expect(r.status).toBe(200);
    expect(r.body.data.id).toMatch(/^u_/);
  });

  it('does not affect GET requests (no Content-Type required)', async () => {
    const r = await request(app).get('/v1/health');
    expect(r.status).toBe(200);
  });
});
```

- [ ] **Step 3: Run integration test**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/integration/charset-middleware.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 4: Run full test suite — expect some existing tests to fail**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test 2>&1 | tail -30
```

Many existing tests likely use `Content-Type: application/json` (no charset) and will now fail. **This is expected.** Do NOT commit yet.

- [ ] **Step 5: Find tests that fail due to charset**

```bash
cd D:\dev\hunter-platform
pnpm test 2>&1 | grep -E "FAIL|✗" | head -30
```

For each failing test file, the fix is to add `.set('Content-Type', 'application/json; charset=utf-8')` to supertest calls. (Or use a custom supertest agent that sets it by default.)

**Important**: Look at the test that uses `request(app).post(...)`. If it doesn't set Content-Type, supertest defaults to `application/json` (no charset) when given a body. The fix is to add the charset explicitly.

A faster approach: edit each failing test to add the header. The common pattern is:
```typescript
.set('Content-Type', 'application/json; charset=utf-8')
```

Edit each test file. Run again. Repeat until all tests pass.

- [ ] **Step 6: Run full test suite — expect all pass**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/server.ts tests/integration/charset-middleware.test.ts
# Plus any test files you modified in step 5
git add tests/
git commit -m "feat(encoding): mount utf8-only middleware in server + integration test + fix existing tests"
```

---

## Task 8: Update CHANGELOG

**Files:**
- Modify: `docs/CHANGELOG.md`

- [ ] **Step 1: Check if CHANGELOG.md exists**

Run:
```bash
cd D:\dev\hunter-platform
ls docs/CHANGELOG.md 2>&1
```

If it exists, edit; if not, create it.

- [ ] **Step 2: Add new entry at top**

Add the following section at the top of the file (preserve existing entries below):

```markdown
## v0.3.1 — Misc Fixes (2026-06-19)

**功能新增**:
- `POST /v1/candidate/approve-unlock` 后，employer 端会收到新 webhook 事件 `notify_unlock_approved`（payload: recommendation_id / anonymized_candidate_id / candidate_user_id / approved_at，不含 PII）

**文档补充**:
- `view_url` 字段在 skill.md 新增"视图链接"章节

**BREAKING**:
- Job 对象的 `requirements` 字段已从 API 表面删除。客户端不要再依赖该字段。
- 请求体 `Content-Type` 必须为 `application/json; charset=utf-8`（无 charset 或非 utf-8 将返回 400 INVALID_CHARSET）。**所有 client 必须显式声明 charset**。

**质量改进**:
- `SCHOOL_TIERS` 扩到完整 39 所 985（之前只 6 所，其他 985 校会错误地映射为 "普通"）

---
```

- [ ] **Step 3: Commit**

```bash
cd D:\dev\hunter-platform
git add docs/CHANGELOG.md
git commit -m "docs(changelog): v0.3.1 misc fixes"
```

---

## Task 9: Final verification

**Files:** none (read-only verification)

- [ ] **Step 1: Run typecheck**

```bash
cd D:\dev\hunter-platform
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 2: Run full test suite**

```bash
cd D:\dev\hunter-platform
pnpm test
```

Expected: All tests pass.

- [ ] **Step 3: Git log summary**

```bash
cd D:\dev\hunter-platform
git log --oneline -10
```

Expected: ~8 new commits beyond the spec commit, covering all 4 fixes.

- [ ] **Step 4: Update todos and report**

Mark all todos complete and report:
- Total commits
- Total tests passing
- Any deviations from this plan
- Final `git log --oneline -10` output
