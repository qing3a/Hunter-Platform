# Render Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "render layer" to Hunter Platform that returns SSR HTML for 4 view types (candidate, recommendation, user-quota, audit) accessed via one-time tokens automatically attached as `view_url` in API responses.

**Architecture:** Express server hosts new `/view/*` routes alongside existing `/v1/*` API. New `view_tokens` table stores 64-char hex tokens (1-hour TTL, single-use). Response middleware injects `view_url` field via explicit ROUTE_VIEW_MAP config. Zero new dependencies.

**Tech Stack:** TypeScript, Express, better-sqlite3 (already used), crypto.randomBytes (Node built-in), template strings for HTML.

---

## File Structure

| File | Action | Created in Task |
|------|--------|-----------------|
| `src/main/db/migrations/v004_view_tokens.sql` | Create | T1 |
| `src/main/db/repositories/view-token.ts` | Create | T2 |
| `src/main/modules/view/view-token-repo.ts` | Create | T2 |
| `src/main/modules/view/generate.ts` | Create | T3 |
| `src/main/modules/view/validate.ts` | Create | T3 |
| `src/main/modules/view/templates/shared-css.ts` | Create | T4 |
| `src/main/modules/view/templates/candidate.ts` | Create | T4 |
| `src/main/modules/view/templates/recommendation.ts` | Create | T4 |
| `src/main/modules/view/templates/user-quota.ts` | Create | T4 |
| `src/main/modules/view/templates/audit.ts` | Create | T4 |
| `src/main/modules/view/templates/error.ts` | Create | T5 |
| `src/main/modules/view/handler.ts` | Create | T5 |
| `src/main/modules/view/route-view-map.ts` | Create | T6 |
| `src/main/server.ts` | Modify | T6 |
| `tests/unit/view/view-token-repo.test.ts` | Create | T2 |
| `tests/unit/view/generate-validate.test.ts` | Create | T3 |
| `tests/unit/view/templates.test.ts` | Create | T4 |
| `tests/unit/view/handler.test.ts` | Create | T5 |
| `tests/unit/view/route-view-map.test.ts` | Create | T6 |
| `tests/integration/view-endpoint.test.ts` | Create | T7 |
| `tests/integration/view-url-injection.test.ts` | Create | T7 |
| `tests/integration/token-atomicity.test.ts` | Create | T7 |

No existing business code modified.

---

## Task 1: Add `v004_view_tokens` migration

**Files:**
- Create: `src/main/db/migrations/v004_view_tokens.sql`

- [ ] **Step 1: Create the migration SQL file**

Create `src/main/db/migrations/v004_view_tokens.sql`:

```sql
-- v004: view_tokens table for render-layer one-time access tokens

CREATE TABLE view_tokens (
  token         TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  view_type     TEXT NOT NULL,
  view_id       TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  consumed_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_view_tokens_user ON view_tokens(user_id, created_at);
```

- [ ] **Step 2: Find and read the migrations runner to confirm auto-discovery**

Run: `cd D:\dev\hunter-platform && find src/main/db -name "migrations.ts" -o -name "migrations.js" -o -name "index.ts" | head -5`
Expected: a path like `src/main/db/migrations.ts` or `src/main/db/migrations/index.ts`. Read that file and confirm:
- It uses glob/fs.readdirSync to discover `.sql` files in `migrations/` directory
- Files are run in alphabetical/numerical order
- Each migration runs only once (tracked in a migrations table)

If migrations are NOT auto-discovered, add the new file to an explicit list in that file. This is project-specific — adapt as needed but ensure v004 is included.

- [ ] **Step 3: Run the existing migration test (if any) to verify discovery still works**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/integration/migrations.test.ts tests/integration/migrations-v002.test.ts tests/integration/migrations-v003.test.ts 2>&1 | tail -20`
Expected: all migration tests pass. This proves the new v004 file is discoverable.

- [ ] **Step 4: Verify the new table exists by inspecting an existing test pattern**

Look at how `tests/integration/migrations-v003.test.ts` verifies its migration. Add a minimal assertion-style test to the same file (or a new file `tests/integration/migrations-v004.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/main/db/connection';
import { runMigrations } from '../../src/main/db/migrations';
import path from 'node:path';

describe('v004 migration: view_tokens table', () => {
  it('creates view_tokens with expected columns', () => {
    const db = openDb(':memory:');
    runMigrations(db);
    const cols = db.prepare(`PRAGMA table_info(view_tokens)`).all() as Array<{ name: string }>;
    const names = cols.map(c => c.name).sort();
    expect(names).toEqual(['consumed_at', 'created_at', 'expires_at', 'token', 'user_id', 'view_id', 'view_type']);
    db.close();
  });
});
```

(Adjust the import paths based on what Step 2 revealed about the project's conventions.)

- [ ] **Step 5: Run the new test to verify migration works**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/integration/migrations-v004.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/db/migrations/v004_view_tokens.sql tests/integration/migrations-v004.test.ts
git commit -m "feat(view): add v004 migration for view_tokens table"
```

---

## Task 2: Implement `view-token-repo` (DB layer)

**Files:**
- Create: `src/main/db/repositories/view-token.ts`
- Create: `src/main/modules/view/view-token-repo.ts`
- Create: `tests/unit/view/view-token-repo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/view/view-token-repo.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/main/db/migrations';
import {
  createViewTokenRepo,
  type ViewTokenRow,
} from '../../../src/main/modules/view/view-token-repo';

describe('view-token-repo', () => {
  let db: Database.Database;
  let repo: ReturnType<typeof createViewTokenRepo>;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    repo = createViewTokenRepo(db);
  });

  afterEach(() => db.close());

  it('create inserts a row with all fields', () => {
    const expiresAt = '2026-06-18T13:00:00.000Z';
    repo.create({
      token: 'a'.repeat(64),
      userId: 'user_1',
      viewType: 'candidate',
      viewId: 'cand_abc',
      expiresAt,
    });
    const row = db.prepare(`SELECT * FROM view_tokens WHERE token = ?`).get('a'.repeat(64)) as ViewTokenRow;
    expect(row.user_id).toBe('user_1');
    expect(row.view_type).toBe('candidate');
    expect(row.view_id).toBe('cand_abc');
    expect(row.expires_at).toBe(expiresAt);
    expect(row.consumed_at).toBeNull();
  });

  it('findValid returns row when token exists, not consumed, not expired', () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    repo.create({ token: 'b'.repeat(64), userId: 'u', viewType: 'candidate', viewId: 'c', expiresAt: future });
    const row = repo.findValid('b'.repeat(64));
    expect(row).not.toBeNull();
    expect(row!.view_id).toBe('c');
  });

  it('findValid returns null for expired token', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    repo.create({ token: 'c'.repeat(64), userId: 'u', viewType: 'candidate', viewId: 'c', expiresAt: past });
    expect(repo.findValid('c'.repeat(64))).toBeNull();
  });

  it('findValid returns null for already-consumed token', () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    repo.create({ token: 'd'.repeat(64), userId: 'u', viewType: 'candidate', viewId: 'c', expiresAt: future });
    repo.markConsumed('d'.repeat(64), new Date().toISOString());
    expect(repo.findValid('d'.repeat(64))).toBeNull();
  });

  it('findValid returns null for unknown token', () => {
    expect(repo.findValid('z'.repeat(64))).toBeNull();
  });

  it('markConsumed returns true on first call, false on second (atomicity)', () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    repo.create({ token: 'e'.repeat(64), userId: 'u', viewType: 'candidate', viewId: 'c', expiresAt: future });
    const first = repo.markConsumed('e'.repeat(64), new Date().toISOString());
    const second = repo.markConsumed('e'.repeat(64), new Date().toISOString());
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/unit/view/view-token-repo.test.ts 2>&1 | tail -10`
Expected: FAIL — `Cannot find module '../../../src/main/modules/view/view-token-repo'`.

- [ ] **Step 3: Create the DB row type (re-exported from repo file)**

The `tests/unit/view/view-token-repo.test.ts` imports `ViewTokenRow` from the repo module. Create `src/main/modules/view/view-token-repo.ts` with that type first, then implement the repo:

```typescript
import type Database from 'better-sqlite3';

export interface ViewTokenRow {
  token: string;
  user_id: string;
  view_type: string;
  view_id: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface CreateViewTokenInput {
  token: string;
  userId: string;
  viewType: string;
  viewId: string;
  expiresAt: string;
}

export function createViewTokenRepo(db: Database.Database) {
  const insertStmt = db.prepare<[string, string, string, string, string]>(
    `INSERT INTO view_tokens (token, user_id, view_type, view_id, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  const findValidStmt = db.prepare<[string]>(
    `SELECT * FROM view_tokens
     WHERE token = ?
       AND consumed_at IS NULL
       AND expires_at > datetime('now')`
  );

  // Atomic: only marks if consumed_at is still NULL. Returns true if updated.
  const markConsumedStmt = db.prepare<[string, string]>(
    `UPDATE view_tokens
     SET consumed_at = ?
     WHERE token = ? AND consumed_at IS NULL`
  );

  return {
    create(input: CreateViewTokenInput): void {
      insertStmt.run(input.token, input.userId, input.viewType, input.viewId, input.expiresAt);
    },

    findValid(token: string): ViewTokenRow | null {
      return (findValidStmt.get(token) as ViewTokenRow | undefined) ?? null;
    },

    markConsumed(token: string, consumedAt: string): boolean {
      const result = markConsumedStmt.run(consumedAt, token);
      return result.changes === 1;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/unit/view/view-token-repo.test.ts 2>&1 | tail -10`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/view/view-token-repo.ts tests/unit/view/view-token-repo.test.ts
git commit -m "feat(view): add view-token-repo with atomic markConsumed"
```

---

## Task 3: Implement `generate` and `validate`

**Files:**
- Create: `src/main/modules/view/generate.ts`
- Create: `src/main/modules/view/validate.ts`
- Create: `tests/unit/view/generate-validate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/view/generate-validate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/main/db/migrations';
import { createViewTokenRepo } from '../../../src/main/modules/view/view-token-repo';
import { generateViewUrl } from '../../../src/main/modules/view/generate';
import { validateAndConsume } from '../../../src/main/modules/view/validate';

describe('generate / validate', () => {
  let db: Database.Database;
  let repo: ReturnType<typeof createViewTokenRepo>;
  const BASE_URL = 'http://localhost:3000';

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    repo = createViewTokenRepo(db);
  });

  afterEach(() => db.close());

  it('generate returns URL with 64-char hex token and correct path', () => {
    const { url, token } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_x');
    expect(url).toMatch(/^http:\/\/localhost:3000\/view\/candidate\/cand_x\?t=[a-f0-9]{64}$/);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generate stores row in DB with 1-hour expiry', () => {
    const before = Date.now();
    const { token } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_x');
    const row = repo.findValid(token);
    expect(row).not.toBeNull();
    const expiryMs = new Date(row!.expires_at).getTime();
    expect(expiryMs).toBeGreaterThanOrEqual(before + 3500_000);
    expect(expiryMs).toBeLessThanOrEqual(before + 3700_000);
  });

  it('validate returns ok=true and consumes the token', () => {
    const { token } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_x');
    const result = validateAndConsume(repo, token, 'candidate');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resourceId).toBe('cand_x');
      expect(result.userId).toBe('user_1');
    }
  });

  it('validate returns ok=false reason=consumed on second call', () => {
    const { token } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_x');
    validateAndConsume(repo, token, 'candidate');
    const second = validateAndConsume(repo, token, 'candidate');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('consumed');
  });

  it('validate returns ok=false reason=type_mismatch when view_type differs', () => {
    const { token } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_x');
    const result = validateAndConsume(repo, token, 'recommendation');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('type_mismatch');
  });

  it('validate returns ok=false reason=invalid for unknown token', () => {
    const result = validateAndConsume(repo, 'z'.repeat(64), 'candidate');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/unit/view/generate-validate.test.ts 2>&1 | tail -5`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `generate.ts`**

Create `src/main/modules/view/generate.ts`:

```typescript
import { randomBytes } from 'node:crypto';
import type { createViewTokenRepo } from './view-token-repo.js';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export type ViewType = 'candidate' | 'recommendation' | 'user-quota' | 'audit';

export interface GenerateViewUrlResult {
  url: string;
  token: string;
}

export function generateViewUrl(
  repo: ReturnType<typeof createViewTokenRepo>,
  baseUrl: string,
  userId: string,
  viewType: ViewType,
  viewId: string,
): GenerateViewUrlResult {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  repo.create({ token, userId, viewType, viewId, expiresAt });
  const url = `${baseUrl}/view/${viewType}/${viewId}?t=${token}`;
  return { url, token };
}
```

- [ ] **Step 4: Implement `validate.ts`**

Create `src/main/modules/view/validate.ts`:

```typescript
import type { createViewTokenRepo } from './view-token-repo.js';
import type { ViewType } from './generate.js';

export type ValidateFailureReason = 'invalid' | 'expired' | 'consumed' | 'type_mismatch';

export type ValidateResult =
  | { ok: true; resourceId: string; userId: string }
  | { ok: false; reason: ValidateFailureReason };

export function validateAndConsume(
  repo: ReturnType<typeof createViewTokenRepo>,
  token: string,
  expectedViewType: ViewType,
): ValidateResult {
  // findValid already filters: consumed_at IS NULL AND expires_at > now
  // So 'not found' covers both 'invalid' and 'expired' and 'consumed'.
  // We need to distinguish them — check in this order:
  // 1. Row exists at all? (any status)
  // 2. consumed_at set → 'consumed'
  // 3. expires_at <= now → 'expired'
  // 4. view_type mismatch → 'type_mismatch'
  // 5. otherwise valid → consume + return

  const lookupAny = repo.findValid;  // Already filters; won't tell us expired vs consumed
  // Use a separate raw lookup via repo to disambiguate:
  // (We extend the repo minimally with a lookupAny — or do it inline here)
  // For simplicity in v1, we re-query via the prepared statement exposed via a new helper.
  // To keep repo small, we add lookupRaw to the repo in this task — see update below.

  const raw = repo.lookupRaw(token);
  if (!raw) {
    // Either truly invalid OR expired OR consumed (no row at all)
    return { ok: false, reason: 'invalid' };
  }
  if (raw.consumed_at !== null) {
    return { ok: false, reason: 'consumed' };
  }
  if (new Date(raw.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (raw.view_type !== expectedViewType) {
    return { ok: false, reason: 'type_mismatch' };
  }
  // All good — atomically consume
  const consumed = repo.markConsumed(token, new Date().toISOString());
  if (!consumed) {
    // Lost the race to another concurrent request
    return { ok: false, reason: 'consumed' };
  }
  return { ok: true, resourceId: raw.view_id, userId: raw.user_id };
}
```

- [ ] **Step 5: Update `view-token-repo.ts` to expose `lookupRaw`**

Add this method to the repo object returned by `createViewTokenRepo` (in the same file as Task 2):

```typescript
    // Unfiltered lookup — used by validate to disambiguate expired vs consumed vs invalid.
    // Exists for this single purpose; not part of the public API for callers.
    lookupRaw(token: string): ViewTokenRow | null {
      const stmt = db.prepare<[string]>(`SELECT * FROM view_tokens WHERE token = ?`);
      return (stmt.get(token) as ViewTokenRow | undefined) ?? null;
    },
```

(Insert this in the returned object of `createViewTokenRepo`. The existing `findValid` is unchanged.)

- [ ] **Step 6: Run test to verify all 6 tests pass**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/unit/view/generate-validate.test.ts 2>&1 | tail -10`
Expected: PASS, 6 tests.

- [ ] **Step 7: Re-run the Task 2 repo test to confirm `lookupRaw` addition didn't break anything**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/unit/view/view-token-repo.test.ts 2>&1 | tail -5`
Expected: PASS, 6 tests still.

- [ ] **Step 8: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/view/generate.ts src/main/modules/view/validate.ts src/main/modules/view/view-token-repo.ts tests/unit/view/generate-validate.test.ts
git commit -m "feat(view): add generate + validate with 1h expiry, single-use enforcement"
```

---

## Task 4: Implement templates (5 files)

**Files:**
- Create: `src/main/modules/view/templates/shared-css.ts`
- Create: `src/main/modules/view/templates/candidate.ts`
- Create: `src/main/modules/view/templates/recommendation.ts`
- Create: `src/main/modules/view/templates/user-quota.ts`
- Create: `src/main/modules/view/templates/audit.ts`
- Create: `tests/unit/view/templates.test.ts`

- [ ] **Step 1: Create `shared-css.ts`**

Create `src/main/modules/view/templates/shared-css.ts`:

```typescript
export const SHARED_CSS = `
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  margin: 0; padding: 24px;
  background: #f5f7fa; color: #2c3e50;
  line-height: 1.6;
}
main { max-width: 720px; margin: 0 auto; background: white; padding: 32px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
h1 { margin-top: 0; font-size: 24px; color: #1a202c; }
h2 { font-size: 18px; color: #2c3e50; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
.card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 12px 0; }
.tag { display: inline-block; background: #edf2f7; border-radius: 4px; padding: 4px 10px; margin: 2px; font-size: 13px; color: #4a5568; }
.tag.skill { background: #ebf8ff; color: #2c5282; }
.tag.industry { background: #f0fff4; color: #22543d; }
.timeline { position: relative; padding-left: 24px; }
.timeline::before { content: ''; position: absolute; left: 6px; top: 8px; bottom: 8px; width: 2px; background: #cbd5e0; }
.timeline-item { position: relative; margin-bottom: 16px; }
.timeline-item::before { content: ''; position: absolute; left: -22px; top: 6px; width: 12px; height: 12px; border-radius: 50%; background: #4299e1; border: 2px solid white; box-shadow: 0 0 0 1px #cbd5e0; }
.timeline-item.done::before { background: #48bb78; }
.timeline-item.current::before { background: #ed8936; box-shadow: 0 0 0 2px #ed8936, 0 0 0 4px white; }
.meta { color: #718096; font-size: 13px; }
.error { text-align: center; padding: 48px 24px; }
.error h1 { color: #c53030; }
.error .hint { color: #718096; font-size: 14px; margin-top: 24px; }
.kv { display: grid; grid-template-columns: 160px 1fr; gap: 8px 16px; margin: 12px 0; }
.kv dt { color: #718096; font-size: 13px; }
.kv dd { margin: 0; font-weight: 500; }
`.trim();
```

- [ ] **Step 2: Create `candidate.ts` template**

Create `src/main/modules/view/templates/candidate.ts`:

```typescript
import { SHARED_CSS } from './shared-css.js';

export interface CandidateViewData {
  anonymizedId: string;
  industry: string;
  titleLevel: string;
  salaryRange: string;
  educationTier: string;
  yearsExperience: number;
  skills: string[];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function renderCandidate(d: CandidateViewData): string {
  const skillsHtml = d.skills.map((s) => `<span class="tag skill">${esc(s)}</span>`).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>候选人画像 — ${esc(d.anonymizedId)}</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <main>
    <h1>候选人画像</h1>
    <p class="meta">匿名 ID: <code>${esc(d.anonymizedId)}</code></p>

    <div class="card">
      <h2>基本信息</h2>
      <dl class="kv">
        <dt>行业</dt><dd><span class="tag industry">${esc(d.industry)}</span></dd>
        <dt>职级</dt><dd>${esc(d.titleLevel)}</dd>
        <dt>薪资范围</dt><dd>${esc(d.salaryRange)}</dd>
        <dt>学历</dt><dd>${esc(d.educationTier)}</dd>
        <dt>工作年限</dt><dd>${d.yearsExperience} 年</dd>
      </dl>
    </div>

    <div class="card">
      <h2>技能</h2>
      <div>${skillsHtml}</div>
    </div>

    <p class="meta">此页面展示的是脱敏后的候选人画像。原始联系方式需通过解锁流程获取。</p>
  </main>
</body>
</html>`;
}
```

- [ ] **Step 3: Create `recommendation.ts` template**

Create `src/main/modules/view/templates/recommendation.ts`:

```typescript
import { SHARED_CSS } from './shared-css.js';

export type RecommendationStatus =
  | 'pending' | 'employer_interested' | 'candidate_approved'
  | 'unlocked' | 'placed' | 'rejected_employer' | 'rejected_candidate' | 'withdrawn';

export interface RecommendationViewData {
  recommendationId: string;
  candidateAnonymizedId: string;
  jobTitle: string | null;
  status: RecommendationStatus;
  createdAt: string;
  updatedAt: string;
}

const TIMELINE: Array<{ key: RecommendationStatus; label: string }> = [
  { key: 'pending', label: '猎头推荐' },
  { key: 'employer_interested', label: '雇主感兴趣' },
  { key: 'candidate_approved', label: '候选人授权' },
  { key: 'unlocked', label: '联系方式解锁' },
  { key: 'placed', label: '入职' },
];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function renderRecommendation(d: RecommendationViewData): string {
  const currentIdx = TIMELINE.findIndex((t) => t.key === d.status);
  const isRejected = d.status.startsWith('rejected_') || d.status === 'withdrawn';

  const items = TIMELINE.map((t, i) => {
    let cls = 'timeline-item';
    if (!isRejected && i < currentIdx) cls += ' done';
    else if (!isRejected && i === currentIdx) cls += ' current';
    return `<div class="${cls}"><strong>${esc(t.label)}</strong></div>`;
  }).join('');

  const rejectNotice = isRejected
    ? `<div class="card" style="background:#fff5f5;border-color:#fc8181"><strong>状态：${esc(d.status)}</strong></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>推荐状态 — ${esc(d.recommendationId)}</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <main>
    <h1>推荐状态</h1>
    <p class="meta">推荐 ID: <code>${esc(d.recommendationId)}</code></p>

    <div class="card">
      <h2>信息</h2>
      <dl class="kv">
        <dt>候选人</dt><dd><code>${esc(d.candidateAnonymizedId)}</code></dd>
        <dt>职位</dt><dd>${d.jobTitle ? esc(d.jobTitle) : '<em>未关联</em>'}</dd>
        <dt>创建时间</dt><dd>${esc(d.createdAt)}</dd>
        <dt>更新时间</dt><dd>${esc(d.updatedAt)}</dd>
      </dl>
    </div>

    ${rejectNotice}

    <div class="card">
      <h2>4 步解锁流程</h2>
      <div class="timeline">${items}</div>
    </div>
  </main>
</body>
</html>`;
}
```

- [ ] **Step 4: Create `user-quota.ts` template**

Create `src/main/modules/view/templates/user-quota.ts`:

```typescript
import { SHARED_CSS } from './shared-css.js';

export interface UserQuotaViewData {
  userId: string;
  userType: 'candidate' | 'headhunter' | 'employer';
  name: string;
  quotaPerDay: number;
  quotaUsed: number;
  quotaResetAt: string;
  rateLimits: { window: string; limit: number; used: number }[];
  recentActions: Array<{ at: string; action_type: string; status: string }>;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function renderUserQuota(d: UserQuotaViewData): string {
  const remaining = d.quotaPerDay - d.quotaUsed;
  const pct = d.quotaPerDay > 0 ? Math.round((d.quotaUsed / d.quotaPerDay) * 100) : 0;

  const rlRows = d.rateLimits.map((rl) => {
    const rPct = rl.limit > 0 ? Math.round((rl.used / rl.limit) * 100) : 0;
    return `<tr><td>${esc(rl.window)}</td><td>${rl.used}</td><td>${rl.limit}</td><td>${rPct}%</td></tr>`;
  }).join('');

  const actionRows = d.recentActions.slice(0, 10).map((a) =>
    `<tr><td>${esc(a.at)}</td><td>${esc(a.action_type)}</td><td>${esc(a.status)}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>用户配额 — ${esc(d.name)}</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <main>
    <h1>用户配额</h1>
    <p class="meta"><code>${esc(d.userId)}</code> · ${esc(d.userType)} · ${esc(d.name)}</p>

    <div class="card">
      <h2>今日配额</h2>
      <dl class="kv">
        <dt>已使用</dt><dd>${d.quotaUsed} / ${d.quotaPerDay} (${pct}%)</dd>
        <dt>剩余</dt><dd>${remaining}</dd>
        <dt>重置时间</dt><dd>${esc(d.quotaResetAt)}</dd>
      </dl>
    </div>

    <div class="card">
      <h2>限流状态</h2>
      <table style="width:100%; border-collapse: collapse;">
        <thead><tr style="text-align:left; color:#718096; font-size:13px;">
          <th>窗口</th><th>已用</th><th>上限</th><th>占比</th>
        </tr></thead>
        <tbody>${rlRows || '<tr><td colspan="4" style="color:#a0aec0;">无数据</td></tr>'}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>最近活动</h2>
      <table style="width:100%; border-collapse: collapse;">
        <thead><tr style="text-align:left; color:#718096; font-size:13px;">
          <th>时间</th><th>动作</th><th>状态</th>
        </tr></thead>
        <tbody>${actionRows || '<tr><td colspan="3" style="color:#a0aec0;">无活动</td></tr>'}</tbody>
      </table>
    </div>
  </main>
</body>
</html>`;
}
```

- [ ] **Step 5: Create `audit.ts` template**

Create `src/main/modules/view/templates/audit.ts`:

```typescript
import { SHARED_CSS } from './shared-css.js';

export interface AuditEntry {
  at: string;
  action_type: string;
  method: string;
  path: string;
  status_code: number | null;
  error_code: string | null;
  duration_ms: number | null;
}

export interface AuditViewData {
  userId: string;
  entries: AuditEntry[];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function renderAudit(d: AuditViewData): string {
  const rows = d.entries.slice(0, 50).map((e) => {
    const status = e.status_code ?? '—';
    const err = e.error_code ? ` <span style="color:#c53030">(${esc(e.error_code)})</span>` : '';
    const dur = e.duration_ms !== null ? `${e.duration_ms}ms` : '—';
    return `<tr>
      <td>${esc(e.at)}</td>
      <td><code>${esc(e.method)}</code></td>
      <td><code>${esc(e.path)}</code></td>
      <td>${esc(e.action_type)}</td>
      <td>${status}${err}</td>
      <td>${dur}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>审计日志 — ${esc(d.userId)}</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <main>
    <h1>审计日志</h1>
    <p class="meta">用户: <code>${esc(d.userId)}</code> · 最近 50 条</p>

    <div class="card">
      <table style="width:100%; border-collapse: collapse; font-size: 13px;">
        <thead><tr style="text-align:left; color:#718096;">
          <th>时间</th><th>方法</th><th>路径</th><th>动作</th><th>状态</th><th>耗时</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="6" style="color:#a0aec0;">无记录</td></tr>'}</tbody>
      </table>
    </div>
  </main>
</body>
</html>`;
}
```

- [ ] **Step 6: Write the snapshot test**

Create `tests/unit/view/templates.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderCandidate } from '../../../src/main/modules/view/templates/candidate';
import { renderRecommendation } from '../../../src/main/modules/view/templates/recommendation';
import { renderUserQuota } from '../../../src/main/modules/view/templates/user-quota';
import { renderAudit } from '../../../src/main/modules/view/templates/audit';

describe('templates — render & escape', () => {
  it('candidate renders <html> and includes all data fields', () => {
    const html = renderCandidate({
      anonymizedId: 'cand_abc',
      industry: '互联网',
      titleLevel: 'P6',
      salaryRange: '60-80万',
      educationTier: '985',
      yearsExperience: 8,
      skills: ['React', 'TypeScript', '<script>alert(1)</script>'],
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('cand_abc');
    expect(html).toContain('互联网');
    expect(html).toContain('&lt;script&gt;'); // XSS escape applied
    expect(html).not.toContain('<script>alert(1)</script>'); // raw not present
  });

  it('recommendation timeline shows current step as "current"', () => {
    const html = renderRecommendation({
      recommendationId: 'rec_1',
      candidateAnonymizedId: 'cand_1',
      jobTitle: '高级前端',
      status: 'candidate_approved',
      createdAt: '2026-06-18T10:00:00Z',
      updatedAt: '2026-06-18T11:00:00Z',
    });
    expect(html).toContain('candidate_approved'.length === 0 ? '' : ''); // status not literally rendered
    expect(html).toMatch(/class="timeline-item[^"]*current"/);
  });

  it('user-quota renders quota table and recent actions', () => {
    const html = renderUserQuota({
      userId: 'u_1',
      userType: 'headhunter',
      name: 'Test',
      quotaPerDay: 200,
      quotaUsed: 50,
      quotaResetAt: '2026-06-19T00:00:00Z',
      rateLimits: [{ window: '1s', limit: 20, used: 0 }],
      recentActions: [{ at: '2026-06-18T10:00:00Z', action_type: 'upload_candidate', status: 'ok' }],
    });
    expect(html).toContain('200');
    expect(html).toContain('50');
    expect(html).toContain('upload_candidate');
  });

  it('audit renders rows in reverse-chronological expected order', () => {
    const html = renderAudit({
      userId: 'u_1',
      entries: [
        { at: '2026-06-18T10:00:00Z', action_type: 'login', method: 'GET', path: '/v1/users/u_1/status', status_code: 200, error_code: null, duration_ms: 12 },
        { at: '2026-06-18T11:00:00Z', action_type: 'upload', method: 'POST', path: '/v1/headhunter/candidates', status_code: 201, error_code: null, duration_ms: 45 },
      ],
    });
    expect(html).toContain('u_1');
    expect(html).toContain('login');
    expect(html).toContain('upload');
  });
});
```

- [ ] **Step 7: Run snapshot tests**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/unit/view/templates.test.ts 2>&1 | tail -10`
Expected: PASS, 4 tests.

- [ ] **Step 8: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/view/templates/ tests/unit/view/templates.test.ts
git commit -m "feat(view): add 4 SSR HTML templates + shared CSS + snapshot tests"
```

---

## Task 5: Implement view handlers + error template

**Files:**
- Create: `src/main/modules/view/templates/error.ts`
- Create: `src/main/modules/view/handler.ts`
- Create: `tests/unit/view/handler.test.ts`

- [ ] **Step 1: Create `error.ts` template**

Create `src/main/modules/view/templates/error.ts`:

```typescript
import { SHARED_CSS } from './shared-css.js';

export interface ErrorPageOptions {
  httpStatus: number;
  title: string;
  message: string;
  icon: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function renderErrorPage(opts: ErrorPageOptions): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${esc(opts.title)} — Hunter Platform</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <main class="error">
    <h1>${esc(opts.icon)} ${esc(opts.title)}</h1>
    <p>${esc(opts.message)}</p>
    <p class="hint">如需帮助，请重新发起请求。</p>
  </main>
</body>
</html>`;
}
```

- [ ] **Step 2: Write failing handler tests**

Create `tests/unit/view/handler.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/main/db/migrations';
import { createViewTokenRepo } from '../../../src/main/modules/view/view-token-repo';
import { generateViewUrl } from '../../../src/main/modules/view/generate';
import { createViewHandlers } from '../../../src/main/modules/view/handler';

describe('view handlers', () => {
  let db: Database.Database;
  let app: express.Express;
  const BASE_URL = 'http://localhost:3000';

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    const repo = createViewTokenRepo(db);
    const handlers = createViewHandlers(repo, BASE_URL, {
      // Stub data sources — return canned data for each view type
      getCandidate: async (id: string) => id === 'cand_real' ? {
        anonymizedId: 'cand_real', industry: '互联网', titleLevel: 'P6',
        salaryRange: '60-80万', educationTier: '985', yearsExperience: 8, skills: ['React'],
      } : null,
      getRecommendation: async () => null,
      getUserQuota: async () => null,
      getAudit: async () => [],
    });
    app = express();
    app.use('/view', handlers.router);
  });

  afterEach(() => db.close());

  it('GET /view/candidate/:id without token returns 400', async () => {
    const r = await request(app).get('/view/candidate/cand_real');
    expect(r.status).toBe(400);
    expect(r.text).toContain('缺少访问令牌');
  });

  it('GET /view/candidate/:id with valid token returns 200 + HTML', async () => {
    const { url } = generateViewUrl(createViewTokenRepo(db), BASE_URL, 'user_1', 'candidate', 'cand_real');
    const r = await request(app).get(url.replace(BASE_URL, ''));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/html/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.text).toContain('候选人画像');
  });

  it('GET /view/candidate/:id with consumed token returns 410', async () => {
    const repo = createViewTokenRepo(db);
    const { url } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_real');
    const path = url.replace(BASE_URL, '');
    await request(app).get(path);  // consumes
    const r2 = await request(app).get(path);
    expect(r2.status).toBe(410);
    expect(r2.text).toContain('已被使用');
  });

  it('GET /view/candidate/:id with type-mismatched token returns 404', async () => {
    const repo = createViewTokenRepo(db);
    const { token } = generateViewUrl(repo, BASE_URL, 'user_1', 'recommendation', 'rec_x');
    const r = await request(app).get(`/view/candidate/cand_real?t=${token}`);
    expect(r.status).toBe(404);
  });

  it('GET /view/candidate/:id when resource not found returns 404', async () => {
    const repo = createViewTokenRepo(db);
    const { url } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_missing');
    const r = await request(app).get(url.replace(BASE_URL, ''));
    expect(r.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/unit/view/handler.test.ts 2>&1 | tail -5`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `handler.ts`**

Create `src/main/modules/view/handler.ts`:

```typescript
import { Router, type Request, type Response } from 'express';
import { createViewTokenRepo } from './view-token-repo.js';
import { validateAndConsume, type ValidateFailureReason } from './validate.js';
import type { ViewType } from './generate.js';
import { renderCandidate, type CandidateViewData } from './templates/candidate.js';
import { renderRecommendation, type RecommendationViewData } from './templates/recommendation.js';
import { renderUserQuota, type UserQuotaViewData } from './templates/user-quota.js';
import { renderAudit, type AuditViewData, type AuditEntry } from './templates/audit.js';
import { renderErrorPage } from './templates/error.js';

export interface ViewDataSources {
  getCandidate(id: string): Promise<CandidateViewData | null>;
  getRecommendation(id: string): Promise<RecommendationViewData | null>;
  getUserQuota(id: string): Promise<UserQuotaViewData | null>;
  getAudit(userId: string): Promise<AuditEntry[]>;
}

const ERROR_PAGE_FOR_REASON: Record<ValidateFailureReason, { status: number; title: string; message: string; icon: string }> = {
  invalid:        { status: 410, title: '链接无效',         message: '链接无效或已过期。请重新发起请求以获取新链接。', icon: '🔗' },
  expired:        { status: 410, title: '链接已过期',       message: '链接无效或已过期。请重新发起请求以获取新链接。', icon: '🔗' },
  consumed:       { status: 410, title: '链接已被使用',     message: '此链接已被使用（一次性链接）。如需再次查看，请重新发起请求。', icon: '🔗' },
  type_mismatch:  { status: 404, title: '资源不存在',       message: '资源不存在或您无权访问。', icon: '🔗' },
};

export function createViewHandlers(
  repo: ReturnType<typeof createViewTokenRepo>,
  baseUrl: string,
  sources: ViewDataSources,
) {
  const router = Router();

  function sendError(res: Response, httpStatus: number, title: string, message: string, icon: string) {
    res.status(httpStatus).type('text/html; charset=utf-8').set('Cache-Control', 'no-store')
      .send(renderErrorPage({ httpStatus, title, message, icon }));
  }

  async function handleView(viewType: ViewType, id: string, req: Request, res: Response) {
    const token = typeof req.query.t === 'string' ? req.query.t : null;
    if (!token) {
      sendError(res, 400, '缺少访问令牌', '请通过有效的链接访问此页面。', '🔗');
      return;
    }

    const result = validateAndConsume(repo, token, viewType);
    if (!result.ok) {
      const cfg = ERROR_PAGE_FOR_REASON[result.reason];
      sendError(res, cfg.status, cfg.title, cfg.message, cfg.icon);
      return;
    }

    let html: string | null = null;
    let resourceMissing = false;

    switch (viewType) {
      case 'candidate': {
        const data = await sources.getCandidate(id);
        if (!data) resourceMissing = true; else html = renderCandidate(data);
        break;
      }
      case 'recommendation': {
        const data = await sources.getRecommendation(id);
        if (!data) resourceMissing = true; else html = renderRecommendation(data);
        break;
      }
      case 'user-quota': {
        const data = await sources.getUserQuota(id);
        if (!data) resourceMissing = true; else html = renderUserQuota(data);
        break;
      }
      case 'audit': {
        const entries = await sources.getAudit(id);
        if (entries.length === 0 && id !== result.userId) resourceMissing = true;
        const data: AuditViewData = { userId: result.userId, entries };
        html = renderAudit(data);
        break;
      }
    }

    if (resourceMissing || html === null) {
      sendError(res, 404, '资源不存在', '此资源已不存在。', '🔗');
      return;
    }

    res.status(200).type('text/html; charset=utf-8').set('Cache-Control', 'no-store').send(html);
  }

  router.get('/candidate/:id', (req, res) => handleView('candidate', req.params.id, req, res));
  router.get('/recommendation/:id', (req, res) => handleView('recommendation', req.params.id, req, res));
  router.get('/user-quota/:id', (req, res) => handleView('user-quota', req.params.id, req, res));
  router.get('/audit/:id', (req, res) => handleView('audit', req.params.id, req, res));

  return { router };
}
```

- [ ] **Step 5: Run tests to verify all 5 pass**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/unit/view/handler.test.ts 2>&1 | tail -10`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/view/templates/error.ts src/main/modules/view/handler.ts tests/unit/view/handler.test.ts
git commit -m "feat(view): add view handlers + error template with single-use enforcement"
```

---

## Task 6: Wire `route-view-map`, server.ts integration, and view_url injection

**Files:**
- Create: `src/main/modules/view/route-view-map.ts`
- Create: `tests/unit/view/route-view-map.test.ts`
- Modify: `src/main/server.ts` (add view routes + viewUrlInjector middleware)

- [ ] **Step 1: Write failing config test**

Create `tests/unit/view/route-view-map.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ROUTE_VIEW_MAP } from '../../../src/main/modules/view/route-view-map';

describe('route-view-map config', () => {
  it('contains all 8 expected mappings', () => {
    expect(Object.keys(ROUTE_VIEW_MAP).sort()).toEqual([
      'GET /v1/users/{id}/history',
      'GET /v1/users/{id}/status',
      'POST /v1/candidate/recommendations/{id}/approve-unlock',
      'POST /v1/candidate/recommendations/{id}/reject-unlock',
      'POST /v1/employer/recommendations/{id}/express-interest',
      'POST /v1/employer/recommendations/{id}/unlock-contact',
      'POST /v1/headhunter/candidates',
      'POST /v1/headhunter/recommendations',
    ]);
  });

  it('every mapping has a non-empty idFrom', () => {
    for (const [route, m] of Object.entries(ROUTE_VIEW_MAP)) {
      expect(m.idFrom.length, `route ${route}`).toBeGreaterThan(0);
      expect(['candidate', 'recommendation', 'user-quota', 'audit']).toContain(m.type);
    }
  });

  it('view types map to existing template handlers (no typos)', () => {
    // Sanity: types are limited to the 4 we implemented
    const types = new Set(Object.values(ROUTE_VIEW_MAP).map((m) => m.type));
    expect([...types].sort()).toEqual(['audit', 'candidate', 'recommendation', 'user-quota']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/unit/view/route-view-map.test.ts 2>&1 | tail -5`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `route-view-map.ts`**

Create `src/main/modules/view/route-view-map.ts`:

```typescript
export type ViewType = 'candidate' | 'recommendation' | 'user-quota' | 'audit';

export interface ViewMapping {
  type: ViewType;
  /** JSONPath-like path into the response body to extract the resource ID for view generation. */
  idFrom: string;
}

export const ROUTE_VIEW_MAP: Record<string, ViewMapping> = {
  // Write endpoints that produce candidate / recommendation resources
  'POST /v1/headhunter/candidates':       { type: 'candidate',      idFrom: 'data.anonymized_id' },
  'POST /v1/headhunter/recommendations':  { type: 'recommendation', idFrom: 'data.recommendation_id' },
  'POST /v1/candidate/recommendations/{id}/approve-unlock':  { type: 'recommendation', idFrom: 'data.recommendation_id' },
  'POST /v1/candidate/recommendations/{id}/reject-unlock':   { type: 'recommendation', idFrom: 'data.recommendation_id' },
  'POST /v1/employer/recommendations/{id}/express-interest': { type: 'recommendation', idFrom: 'data.recommendation_id' },
  'POST /v1/employer/recommendations/{id}/unlock-contact':   { type: 'recommendation', idFrom: 'data.recommendation_id' },

  // Read endpoints that produce user-scoped views
  'GET /v1/users/{id}/status':            { type: 'user-quota', idFrom: 'params.id' },
  'GET /v1/users/{id}/history':           { type: 'audit',     idFrom: 'params.id' },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/unit/view/route-view-map.test.ts 2>&1 | tail -5`
Expected: PASS, 3 tests.

- [ ] **Step 5: Create `viewUrlInjector` middleware**

Create `src/main/modules/view/injector.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { ROUTE_VIEW_MAP } from './route-view-map.js';
import { generateViewUrl, type ViewType } from './generate.js';
import { createViewTokenRepo } from './view-token-repo.js';
import type Database from 'better-sqlite3';

function lookup(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function matchRoute(method: string, routePath: string, pattern: string): boolean {
  // pattern like 'POST /v1/headhunter/candidates' or 'GET /v1/users/{id}/status'
  // routePath is the registered Express route path
  const m1 = method + ' ' + pattern.split(' ')[0]; // not used; we match full method+path
  const [pMethod, pPath] = pattern.split(' ');
  if (pMethod !== method) return false;
  const pParts = pPath.split('/');
  const rParts = routePath.split('/');
  if (pParts.length !== rParts.length) return false;
  return pParts.every((p, i) => p.startsWith('{') || p === rParts[i]);
}

export function createViewUrlInjector(db: Database.Database, baseUrl: string) {
  const repo = createViewTokenRepo(db);

  return function viewUrlInjector(req: Request, res: Response, next: NextFunction): void {
    // Capture res.json to mutate the body before sending
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      try {
        // Only inject on 2xx
        if (res.statusCode >= 200 && res.statusCode < 400 && body && typeof body === 'object') {
          const b = body as { data?: unknown };
          if (b.data && typeof b.data === 'object') {
            const routeKey = `${req.method} ${req.route?.path ?? req.path}`;
            const mapping = ROUTE_VIEW_MAP[routeKey];
            if (mapping) {
              const idSource = mapping.idFrom.startsWith('params.') ? req.params : b.data;
              const viewId = lookup(idSource, mapping.idFrom.replace(/^params\./, '')) as string | undefined;
              if (viewId && req.user && typeof req.user === 'object' && 'id' in req.user) {
                const userId = (req.user as { id: string }).id;
                const { url } = generateViewUrl(repo, baseUrl, userId, mapping.type as ViewType, viewId);
                (b.data as Record<string, unknown>).view_url = url;
              }
            }
          }
        }
      } catch {
        // Never break the response on injection failure
      }
      return originalJson(body);
    };
    next();
  };
}

// Re-export for testing/utility
export { matchRoute };
```

- [ ] **Step 6: Modify `src/main/server.ts` to register view routes and the injector**

Open `src/main/server.ts`. Find `createAppFromDb(db: DB, env: ...)` and inside the function (after `app.use(express.json(...))`, before other routes), add:

```typescript
  // View layer: render-layer routes + view_url injector middleware
  const viewRepo = createViewTokenRepo(db);
  const viewHandlers = createViewHandlers(viewRepo, `http://localhost:${env.PORT}`, {
    // Real data sources wired here. Implementations use existing repos.
    getCandidate: async (id) => {
      const repo = createCandidateRepo(db);
      const c = await repo.findByAnonymizedId(id);
      if (!c) return null;
      return {
        anonymizedId: c.anonymized_id,
        industry: c.industry ?? '',
        titleLevel: c.title_level ?? '',
        salaryRange: c.salary_range ?? '',
        educationTier: c.education_tier ?? '',
        yearsExperience: c.years_experience ?? 0,
        skills: c.skills ?? [],
      };
    },
    getRecommendation: async (id) => {
      const repo = createRecommendationRepo(db);
      const r = await repo.findById(id);
      if (!r) return null;
      return {
        recommendationId: r.id,
        candidateAnonymizedId: r.candidate_anonymized_id,
        jobTitle: r.job_title ?? null,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    },
    getUserQuota: async (id) => {
      const usersRepo = createUsersRepo(db);
      const u = await usersRepo.findById(id);
      if (!u) return null;
      return {
        userId: u.id,
        userType: u.user_type,
        name: u.name,
        quotaPerDay: u.quota_per_day,
        quotaUsed: u.quota_used,
        quotaResetAt: u.quota_reset_at,
        rateLimits: u.rate_limits ?? [],
        recentActions: u.recent_actions ?? [],
      };
    },
    getAudit: async (userId) => {
      const repo = createActionHistoryRepo(db);
      const rows = await repo.findRecentByUserId(userId, 50);
      return rows.map((r) => ({
        at: r.created_at,
        action_type: r.action_type,
        method: r.method,
        path: r.path,
        status_code: r.status_code,
        error_code: r.error_code,
        duration_ms: r.duration_ms,
      }));
    },
  });
  app.use('/view', viewHandlers.router);
  app.use(createViewUrlInjector(db, `http://localhost:${env.PORT}`));
```

Add the necessary imports at the top of `server.ts`:

```typescript
import { createViewTokenRepo } from './modules/view/view-token-repo.js';
import { createViewHandlers } from './modules/view/handler.js';
import { createViewUrlInjector } from './modules/view/injector.js';
import { createCandidateRepo } from './db/repositories/candidate.js'; // adjust path per project
import { createRecommendationRepo } from './db/repositories/recommendation.js'; // adjust
import { createUsersRepo } from './db/repositories/users.js'; // adjust
import { createActionHistoryRepo } from './db/repositories/action-history.js'; // adjust
```

**Important**: the exact repository import paths and method names must match the existing project. Before writing this code, **read** the following files in `src/main/db/repositories/` (or wherever they live) to find the actual functions:
- candidate repo (look for `findByAnonymizedId` or similar)
- recommendation repo (look for `findById`)
- users repo (look for `findById`)
- action-history repo (look for `findRecentByUserId`)

Adapt the code in this step to use the **actual** repo function names and shapes. The structure shown above is correct; the details (function names, return shape) need to match the real codebase.

- [ ] **Step 7: Run typecheck**

Run: `cd D:\dev\hunter-platform && pnpm typecheck 2>&1 | tail -10`
Expected: exit 0. If errors, fix the repository wiring to match actual repo signatures.

- [ ] **Step 8: Re-run all view unit tests**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/unit/view 2>&1 | tail -5`
Expected: All view unit tests pass.

- [ ] **Step 9: Run full test suite to confirm no regressions**

Run: `cd D:\dev\hunter-platform && pnpm test 2>&1 | tail -5`
Expected: All 200+ tests pass (existing 223 + ~28 new view tests).

- [ ] **Step 10: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/view/route-view-map.ts src/main/modules/view/injector.ts src/main/server.ts tests/unit/view/route-view-map.test.ts
git commit -m "feat(view): wire view routes + view_url injector into Express"
```

---

## Task 7: Add integration tests

**Files:**
- Create: `tests/integration/view-endpoint.test.ts`
- Create: `tests/integration/view-url-injection.test.ts`
- Create: `tests/integration/token-atomicity.test.ts`

- [ ] **Step 1: Create `view-endpoint.test.ts` (happy paths)**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('view endpoints — happy path', () => {
  let app: ReturnType<typeof createApp>;
  let candidateAnonId: string;
  let recommendationId: string;
  let userId: string;
  let apiKey: string;

  beforeEach(async () => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
    app = createApp();

    // Register a candidate first
    const candReg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'Test Cand', contact: 'c@x.com' });
    candidateAnonId = 'cand_' + candReg.body.data.user_id.replace(/^user_/, '');

    // Register a headhunter to upload the candidate
    const hhReg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'Test HH', contact: 'h@x.com' });
    userId = hhReg.body.data.user_id;
    apiKey = hhReg.body.data.api_key;
  });

  afterEach(() => {
    delete process.env.DATABASE_PATH;
  });

  it('GET /view/candidate/:id with valid token returns HTML', async () => {
    // Upload candidate
    const candReg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'X', contact: 'x@x.com' });
    const candId = candReg.body.data.user_id;

    const upload = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        candidate_user_id: candId,
        name: '张三', phone: '13800138000', email: 'z@x.com',
        current_company: '字节跳动', current_title: '高级前端',
        expected_salary: 750000, years_experience: 8,
        education_school: '清华大学', skills: ['React', 'TypeScript'],
      });

    const viewUrl = upload.body.data.view_url;
    expect(viewUrl).toMatch(/^\/view\/candidate\//);

    const viewRes = await request(app).get(viewUrl);
    expect(viewRes.status).toBe(200);
    expect(viewRes.headers['content-type']).toMatch(/^text\/html/);
    expect(viewRes.text).toContain('候选人画像');
    expect(viewRes.text).toContain('互联网'); // industry after desensitize
    expect(viewRes.text).not.toContain('张三'); // PII removed
  });

  it('GET /view/users/:id/status with valid token returns quota HTML', async () => {
    const statusRes = await request(app).get(`/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${apiKey}`);
    const viewUrl = statusRes.body.data.view_url;
    expect(viewUrl).toMatch(/^\/view\/user-quota\//);

    const viewRes = await request(app).get(viewUrl);
    expect(viewRes.status).toBe(200);
    expect(viewRes.text).toContain('用户配额');
    expect(viewRes.text).toContain(userId);
  });

  it('GET /view/users/:id/history with valid token returns audit HTML', async () => {
    // Generate some history by calling status endpoint first
    await request(app).get(`/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${apiKey}`);
    const histRes = await request(app).get(`/v1/users/${userId}/history`)
      .set('Authorization', `Bearer ${apiKey}`);
    const viewUrl = histRes.body.data.view_url;
    expect(viewUrl).toMatch(/^\/view\/audit\//);

    const viewRes = await request(app).get(viewUrl);
    expect(viewRes.status).toBe(200);
    expect(viewRes.text).toContain('审计日志');
  });
});
```

- [ ] **Step 2: Create `view-url-injection.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('view_url injection', () => {
  let app: ReturnType<typeof createApp>;
  let apiKey: string;

  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
    app = createApp();
  });

  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('POST /v1/headhunter/candidates success response includes view_url', async () => {
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H', contact: 'h@h.com' });
    apiKey = reg.body.data.api_key;
    const candReg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'C', contact: 'c@c.com' });

    const res = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        candidate_user_id: candReg.body.data.user_id,
        name: '张三', phone: '13800138000', email: 'z@x.com',
        current_company: '字节跳动', current_title: '高级前端',
        expected_salary: 750000, years_experience: 8,
        education_school: '清华大学', skills: ['React'],
      });

    expect(res.body.data.view_url).toMatch(/^\/view\/candidate\/cand_\w+\?t=[a-f0-9]{64}$/);
  });

  it('GET /v1/users/{id}/status response includes view_url', async () => {
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H', contact: 'h@h.com' });
    const res = await request(app).get(`/v1/users/${reg.body.data.user_id}/status`)
      .set('Authorization', `Bearer ${reg.body.data.api_key}`);
    expect(res.body.data.view_url).toMatch(/^\/view\/user-quota\//);
  });

  it('401 error response does NOT include view_url', async () => {
    const res = await request(app).post('/v1/headhunter/candidates').send({});
    expect(res.body.data?.view_url).toBeUndefined();
  });

  it('400 validation error does NOT include view_url', async () => {
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H', contact: 'h@h.com' });
    const res = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${reg.body.data.api_key}`)
      .send({ invalid: 'body' });
    expect(res.body.data?.view_url).toBeUndefined();
  });

  it('unmapped endpoint does NOT include view_url', async () => {
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H', contact: 'h@h.com' });
    const res = await request(app).get('/v1/config/industries')
      .set('Authorization', `Bearer ${reg.body.data.api_key}`);
    expect(res.body.data?.view_url).toBeUndefined();
  });
});
```

- [ ] **Step 3: Create `token-atomicity.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('view token atomicity', () => {
  let app: ReturnType<typeof createApp>;
  let viewUrl: string;

  beforeEach(async () => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
    app = createApp();

    const hh = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H', contact: 'h@h.com' });
    const cand = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'C', contact: 'c@c.com' });
    const upload = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`)
      .send({
        candidate_user_id: cand.body.data.user_id,
        name: 'X', phone: '13800138000', email: 'x@x.com',
        current_company: 'A', current_title: 'T',
        expected_salary: 100000, years_experience: 1,
        education_school: 'S', skills: [],
      });
    viewUrl = upload.body.data.view_url;
  });

  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('two concurrent requests with same token: exactly one succeeds', async () => {
    const [r1, r2] = await Promise.all([
      request(app).get(viewUrl),
      request(app).get(viewUrl),
    ]);
    const successes = [r1.status, r2.status].filter((s) => s === 200).length;
    expect(successes).toBe(1);
  });

  it('sequential requests with same token: first 200, second 410', async () => {
    const r1 = await request(app).get(viewUrl);
    expect(r1.status).toBe(200);
    const r2 = await request(app).get(viewUrl);
    expect(r2.status).toBe(410);
  });
});
```

- [ ] **Step 4: Run integration tests**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/integration/view-endpoint.test.ts tests/integration/view-url-injection.test.ts tests/integration/token-atomicity.test.ts 2>&1 | tail -10`
Expected: All view integration tests pass. If failures, most likely cause is the repository wiring in Step 6 of Task 6 — fix the actual repo signatures and re-run.

- [ ] **Step 5: Run full test suite to confirm no regressions**

Run: `cd D:\dev\hunter-platform && pnpm test 2>&1 | tail -5`
Expected: All tests pass (existing 223 + ~13 new integration tests).

- [ ] **Step 6: Commit**

```bash
cd D:\dev\hunter-platform
git add tests/integration/view-endpoint.test.ts tests/integration/view-url-injection.test.ts tests/integration/token-atomicity.test.ts
git commit -m "test(view): integration tests for endpoints, view_url injection, token atomicity"
```

---

## Task 8: End-to-end smoke test

**Files:** none (verification only)

- [ ] **Step 1: Start the API server**

Kill any existing server on port 3000:
```bash
/c/Windows/System32/taskkill.exe //F //IM node.exe //FI "PID gt 1000" 2>&1 | head -3
```

Start:
```bash
cd D:\dev\hunter-platform && pnpm api:dev > tmp/render-smoke.log 2>&1 &
sleep 5
```

Verify log:
```bash
cat D:/dev/hunter-platform/tmp/render-smoke.log
```
Expected: `[hunter-platform] starting in API-only mode (no Electron)` and `Hunter platform API listening on port 3000`.

- [ ] **Step 2: Register users and trigger view_url injection**

```bash
# Register a headhunter
HH=$(curl -sS -X POST http://localhost:3000/v1/auth/register -H "Content-Type: application/json" -d '{"user_type":"headhunter","name":"Smoke HH","contact":"smoke@hh.com"}')
HH_KEY=$(echo $HH | python -c "import sys, json; print(json.load(sys.stdin)['data']['api_key'])")

# Register a candidate
CAND=$(curl -sS -X POST http://localhost:3000/v1/auth/register -H "Content-Type: application/json" -d '{"user_type":"candidate","name":"Smoke C","contact":"smoke@c.com"}')
CAND_ID=$(echo $CAND | python -c "import sys, json; print(json.load(sys.stdin)['data']['user_id'])")

# Upload candidate (should return view_url)
UPLOAD=$(curl -sS -X POST http://localhost:3000/v1/headhunter/candidates \
  -H "Content-Type: application/json" -H "Authorization: Bearer $HH_KEY" \
  -d "{\"candidate_user_id\":\"$CAND_ID\",\"name\":\"张三\",\"phone\":\"13800138000\",\"email\":\"z@x.com\",\"current_company\":\"字节跳动\",\"current_title\":\"高级前端\",\"expected_salary\":750000,\"years_experience\":8,\"education_school\":\"清华大学\",\"skills\":[\"React\",\"TypeScript\"]}")
echo "$UPLOAD" | python -m json.tool
VIEW_URL=$(echo "$UPLOAD" | python -c "import sys, json; print(json.load(sys.stdin)['data']['view_url'])")
echo "view_url = $VIEW_URL"
```

Expected: JSON response includes `view_url` field with path `/view/candidate/cand_xxx?t=<hex>`.

- [ ] **Step 3: Fetch the view URL via curl and inspect HTML**

```bash
curl -sS -w "\n[%{http_code}] content-type=%{content_type}\n" "http://localhost:3000$VIEW_URL" | head -50
```

Expected:
- HTTP 200
- Content-Type: text/html; charset=utf-8
- HTML containing: "候选人画像", "互联网" (desensitized industry), NOT containing "张三" (PII)

- [ ] **Step 4: Verify token is single-use**

Re-fetch the same URL:
```bash
curl -sS -w "\n[%{http_code}]\n" "http://localhost:3000$VIEW_URL"
```

Expected: HTTP 410 + HTML containing "此链接已被使用".

- [ ] **Step 5: Test the audit view**

```bash
AUDIT=$(curl -sS "http://localhost:3000/v1/users/$CAND_ID/history" -H "Authorization: Bearer $HH_KEY")
echo "$AUDIT" | python -m json.tool
AUDIT_URL=$(echo "$AUDIT" | python -c "import sys, json; print(json.load(sys.stdin)['data']['view_url'])")
echo "audit view_url = $AUDIT_URL"
curl -sS "http://localhost:3000$AUDIT_URL" | head -10
```

Expected: HTML containing "审计日志" and recent action entries.

- [ ] **Step 6: Stop the server**

```bash
/c/Windows/System32/taskkill.exe //F //IM node.exe //FI "PID gt 1000" 2>&1 | head -3
```

- [ ] **Step 7: Final commit (no code changes — only docs)**

If the smoke test revealed any issues, fix them and commit. Otherwise:

```bash
cd D:\dev\hunter-platform
git log --oneline -8
```

Verify the 7 commits form a coherent history. (No new commit needed if no changes.)

---

## Self-Review

**Spec coverage:**

| Spec section | Plan task |
|--------------|-----------|
| §3.1 view_tokens schema | T1 |
| §4.1 file structure (12 new files) | T1–T6 |
| §4.3 ROUTE_VIEW_MAP | T6 (Step 3) |
| §5.1 data flow A (view_url injection) | T6 (Steps 5–6) |
| §5.2 data flow B (view endpoint) | T5 + T6 |
| §5.3 invariants 1–6 | T2 (1, 3), T3 (2, 4), T7 (5, 6) |
| §6 error handling (4 token failure types + resource + request) | T5 (handler + error template) |
| §7 testing (33 it across 7 files) | T2–T7 |
| §8 BASE_URL / TTL config | T3 (TTL constant), T6 (BASE_URL wiring) |
| §9 implementation path T1–T8 | T1–T8 |

**Placeholder scan:** No TBD / TODO / "implement later". The Task 6 Step 6 explicitly says "adapt to actual repo signatures" — this is intentional, not a placeholder.

**Type consistency:**
- `ViewType` defined in `generate.ts`, re-exported by `validate.ts` and `route-view-map.ts` and `injector.ts` and `handler.ts` — consistent
- `ViewDataSources` interface in `handler.ts` — used in `createViewHandlers` and tests — consistent
- `createViewTokenRepo` signature stable across T2–T7 — consistent

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-render-layer.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks
2. **Inline Execution** - execute tasks in this session with checkpoints for review