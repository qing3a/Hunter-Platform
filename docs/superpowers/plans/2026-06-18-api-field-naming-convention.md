# API Field Naming Convention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `POST /v1/auth/register` response to the codebase's prevailing Convention A: self-IDs use `id`, foreign keys use `xxx_id`, with `anonymized_id` as the single semantic exception.

**Architecture:** Single-field rename in one handler response. Update affected test assertions and the public API doc. No new dependencies, no schema changes, no URL param changes.

**Tech Stack:** TypeScript, vitest, supertest (existing).

---

## File Structure

| File | Action |
|------|--------|
| `src/main/modules/register/handler.ts` | Modify (1 line — rename response field) |
| `tests/integration/register-naming.test.ts` | Create (2 regression tests) |
| `tests/integration/register.test.ts` | Modify (replace `data.user_id` with `data.id` in assertions) |
| Any other test file referencing `data.user_id` | Modify |
| `docs/superpowers/skill.md` | Modify (update register response shape + new naming-convention section) |

No code under `src/main/modules/{auth,candidate,employer,headhunter,commission,cron,crypto,desensitize,headhunter,idempotency,metrics,quota,rate-limit,register,unlock,webhook,audit}/`, `src/main/db/`, `src/main/routes/`, or `src/shared/` needs changes.

---

## Task 1: Inventory all `data.user_id` references

**Files:** none (read-only investigation)

- [ ] **Step 1: Grep for all `data.user_id` / `body.data.user_id` references**

Run:
```bash
cd D:\dev\hunter-platform
grep -rn "data\.user_id\|body\.data\.user_id" tests/ src/ 2>&1
```

Expected output: a list of every file and line that references the soon-to-be-removed field. Save this list — each match must be updated in Task 4.

- [ ] **Step 2: Grep for the same in skill.md**

Run:
```bash
cd D:\dev\hunter-platform
grep -n "user_id" docs/superpowers/skill.md
```

Expected: a list of every `user_id` mention in the API doc.

- [ ] **Step 3: Report inventory**

Report: how many test files / source files / skill.md lines need to change. Use this list in Task 3 and Task 4.

---

## Task 2: Add failing regression test for the convention

**Files:**
- Create: `tests/integration/register-naming.test.ts`

- [ ] **Step 1: Write the failing regression test**

Create `tests/integration/register-naming.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

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

    expect(status.body.data.id).toBe(id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/integration/register-naming.test.ts 2>&1 | tail -15`
Expected: FAIL — `res.body.data.id` is `undefined` (current handler returns `user_id`).

- [ ] **Step 3: Skip commit until Task 3 produces passing test**

Do not commit yet — wait until after Task 3.

---

## Task 3: Rename response field in `register/handler.ts`

**Files:**
- Modify: `src/main/modules/register/handler.ts`

- [ ] **Step 1: Find the response shape**

Run:
```bash
cd D:\dev\hunter-platform
grep -n "user_id\|api_key" src/main/modules/register/handler.ts
```

Locate the line that returns the user object with `user_id`. (The exact line depends on the project's current code; adapt the edit below.)

- [ ] **Step 2: Apply the rename**

In `src/main/modules/register/handler.ts`, change the returned object's `user_id` field to `id`. Concretely, replace:

```typescript
res.json({ ok: true, data: { user_id: user.id, api_key, ... } });
```

(or however the response is constructed in this handler) with:

```typescript
res.json({ ok: true, data: { id: user.id, api_key, ... } });
```

Note: do NOT rename `api_key`, `quota_per_day`, `user_type`, etc. — only `user_id`.

- [ ] **Step 3: Run regression test to verify it passes**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/integration/register-naming.test.ts 2>&1 | tail -10`
Expected: PASS, 2 tests.

- [ ] **Step 4: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/register/handler.ts tests/integration/register-naming.test.ts
git commit -m "refactor(api): align register response to convention (data.user_id → data.id)

- POST /v1/auth/register now returns data.id for self-ID, matching Convention A
- Add regression test verifying both the absence of user_id and consistency with GET /v1/users/{id}/status"
```

---

## Task 4: Update existing test assertions

**Files:**
- Modify: all test files listed in Task 1's grep output

- [ ] **Step 1: For each file in the inventory, replace `body.data.user_id` with `body.data.id`**

For each match from Task 1's grep:
- Replace `.user_id` (preceded by `body.data` or `data`) with `.id`
- Do NOT change DB column references like `row.user_id` or `users.user_id` (those are SQL, not API)
- Do NOT change URL path references like `/v1/users/{user_id}` (those are path params)

A typical change looks like:

```typescript
// Before:
const userId = reg.body.data.user_id;
// After:
const userId = reg.body.data.id;
```

For each file:
1. Read it
2. Apply the rename
3. Verify the file still has consistent usage

- [ ] **Step 2: Run full test suite**

Run: `cd D:\dev\hunter-platform && pnpm test 2>&1 | tail -5`
Expected: 267 / 267 pass (265 existing + 2 new regression tests, minus any previously removed).

If failures occur, they likely mean a missed `data.user_id` — re-grep and fix.

- [ ] **Step 3: Re-grep to confirm no `data.user_id` references remain**

Run:
```bash
cd D:\dev\hunter-platform
grep -rn "data\.user_id\|body\.data\.user_id" tests/ src/ 2>&1 | head -5
```
Expected: empty output (no matches in `tests/` or `src/`).

Note: `grep` will still find `user_id` in DB queries (`db.prepare('... user_id ...').get(...)`) — that's correct, those are SQL columns.

- [ ] **Step 4: Commit**

```bash
cd D:\dev\hunter-platform
git add tests/
git commit -m "test: update assertions from data.user_id to data.id per API naming convention"
```

---

## Task 5: Update `skill.md` (API doc + new naming-convention section)

**Files:**
- Modify: `docs/superpowers/skill.md`

- [ ] **Step 1: Find the register endpoint section in skill.md**

Run:
```bash
cd D:\dev\hunter-platform
grep -n "POST.*auth/register\|user_id\|api_key" docs/superpowers/skill.md
```

Locate the section describing the `POST /v1/auth/register` endpoint and its response shape.

- [ ] **Step 2: Update the register response example**

In skill.md, find the code example showing the register response (likely in section 3 or 8 — "API endpoints" or "Integration examples"). Replace any reference to `user_id` in the response with `id`. Example change:

```diff
- // Register returns user_id, api_key, etc.
- console.log('user_id:', reg.data.user_id);
+ // Register returns id, api_key, etc.
+ console.log('id:', reg.data.id);
```

Apply this consistently throughout the doc — anywhere the register response is shown, use `id`.

- [ ] **Step 3: Add a "Field naming convention" section**

Insert a new section in skill.md (suggested placement: section 8 "客户端集成示例" before the integration examples, OR section 2 right after "认证"). Use this content:

```markdown
## 2.5 字段命名约定

API 响应中的字段命名遵循以下约定：

| 字段含义 | 字段名 | 示例 |
|---------|-------|------|
| 资源自身 ID | `id` | `data.id`（user / job / recommendation 的 self ID）|
| 外键 | `<resource_type>_id` | `headhunter_id`, `employer_id`, `job_id` |
| 多态外键 | `target_id` | history endpoint 操作的目标资源 |
| **例外** | `anonymized_id` | AnonymizedCandidate（脱敏候选人 ID，保留语义） |

历史变更：`POST /v1/auth/register` 响应从 `data.user_id` 重命名为 `data.id`（v1 breaking change）。`GET /v1/users/{id}/history` 响应的 `user_id` 保持 DB 列名风格。
```

(Adapt placement to match the doc's existing structure. The example above is the body content; the actual H2/H3 heading should match the surrounding headings.)

- [ ] **Step 4: Verify skill.md renders correctly**

Run:
```bash
cd D:\dev\hunter-platform
grep -c "^##" docs/superpowers/skill.md
```
Expected: section count goes from N to N+1 (one new "字段命名约定" section).

- [ ] **Step 5: Commit**

```bash
cd D:\dev\hunter-platform
git add docs/superpowers/skill.md
git commit -m "docs(skill): rename register response field (user_id → id) and document naming convention"
```

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run typecheck**

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: exit 0, 0 errors.

- [ ] **Step 2: Run full test suite**

Run: `cd D:\dev\hunter-platform && pnpm test 2>&1 | tail -5`
Expected: 267 / 267 (or close) pass, 0 fail.

- [ ] **Step 3: Final grep sanity check**

Run:
```bash
cd D:\dev\hunter-platform
grep -rn "data\.user_id\|body\.data\.user_id" tests/ src/ 2>&1 | grep -v "node_modules" | head -5
```
Expected: empty output.

- [ ] **Step 4: Report**

Final report:
- (a) git log --oneline -5 showing 3 new commits (handler + tests + skill.md)
- (b) full test count
- (c) confirmation that grep returns empty

---

## Self-Review

**Spec coverage:**

| Spec section | Plan task |
|--------------|-----------|
| §3.1 modify register handler | T3 |
| §3.2 new regression test | T2 → T3 |
| §3.1 modify tests | T4 |
| §3.3 not modifying anything else | T1 inventory + T4 grep |
| §6 testing strategy | T2, T4 |
| §8 implementation path | T1-T6 |

**Placeholder scan:** No TBD / TODO / "implement later". T4 Step 1 explicitly says "adapt per actual grep output" — intentional, not a placeholder.

**Type consistency:** The regression test uses `body.data.id` consistently in T2 and T3. T4's grep-and-replace instructions explicitly tell the engineer to look for `.user_id` after `.data`, avoiding the trap of changing DB-column references.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-api-field-naming-convention.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks
2. **Inline Execution** - execute tasks in this session with checkpoints for review

This is also small enough to do **manually in a single session** (~10 minutes).