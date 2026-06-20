# Talent 响应 view_url 注入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `GET /v1/employer/talent` 响应中的每个 `AnonymizedCandidate` 元素都自动带上 `view_url`，让 employer agent 无需额外调用就能预览脱敏画像。

**Architecture:** 扩展现有 `view_url` 注入器（`src/main/modules/view/injector.ts`）支持 **array 响应**——目前它在第 47-51 行**主动跳过**数组（理由是 `JSON.stringify` 会丢数组上的具名属性，但不会丢数组元素的属性）。新方案：检测 `data` 是数组时，按 `data[*].<field>` 语法逐元素注入 `view_url`。

**Tech Stack:** Express 4.21, supertest, vitest, TypeScript strict + `exactOptionalPropertyTypes`。

---

## 背景

**当前行为**（来自外部 test 报告 #11）：
- `GET /v1/employer/talent` 返回 `{ ok: true, data: AnonymizedCandidate[] }`
- 每个元素**没有** `view_url` 字段
- Employer agent 必须先拿 anonymized_id，再调 `POST /v1/views/candidate/:id` 才能拿到 view_url（多一跳）

**实现细节**：
- `src/main/modules/employer/handler.ts:126-134` 已经在 `.map()` 中**实际**返回了 `anonymized_id`，但 `AnonymizedCandidate` 类型（第 59-66 行）没声明这个字段——类型是过时的
- 注入器 `src/main/modules/view/injector.ts:47` 写的是 `!Array.isArray(b.data)`，所以数组响应被跳过
- 路由映射在 `src/main/modules/view/route-view-map.ts`

**实施风险**：
- 改注入器可能影响其他 array 响应（`/v1/users/{id}/history` 是 array，但当前没映射，应该无影响）
- 改类型可能 typecheck 失败（如果有代码 strict 依赖 AnonymizedCandidate 不含 `anonymized_id`）

---

## 文件结构变更

```
src/main/modules/view/
├── route-view-map.ts           # 修改：添加 talent 路由 + 新语法
└── injector.ts                 # 修改：支持 data[*].x 语法 + array 遍历

src/shared/types.ts             # 修改：AnonymizedCandidate 加 anonymized_id 字段

docs/superpowers/
└── skill.md                    # 修改：§15.2 注明 view_url 在每个元素中

tests/integration/
└── employer-talent-view-url.test.ts  # 新建：TDD 失败优先
```

---

## Task 1: 写失败的集成测试

**Files:**
- Create: `tests/integration/employer-talent-view-url.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

const testDb = path.join(__dirname, '../../tmp/talent-view-url.db');
let app: any;

describe('GET /v1/employer/talent — view_url injection (Bug #11)', () => {
  let hhKey: string;
  let empKey: string;
  let candId: string;
  let publishedAnonId: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();

    // Setup: headhunter, candidate, employer
    const hh = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H', contact: 'h@x.com' });
    hhKey = hh.body.data.api_key;
    const cand = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'C', contact: 'c@x.com' });
    candId = cand.body.data.id;
    const emp = await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'E', contact: 'e@x.com' });
    empKey = emp.body.data.api_key;
  });

  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  beforeEach(async () => {
    // Wipe and re-seed: one published candidate per test
    const db = (app as any)._db;
    // No need to use _db; just re-seed via API
    // Delete the previous upload (if any) and re-publish
    const res = await request(app).get('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hhKey}`);
    // Best-effort: just upload + publish
    const upload = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hhKey}`)
      .send({
        candidate_user_id: candId,
        name: '测试', phone: '13800138000', email: 't@x.com',
        current_company: '字节跳动', current_title: 'P6 高级',
        expected_salary: 600000, years_experience: 8,
        education_school: '清华大学', skills: ['React'],
      });
    publishedAnonId = upload.body.data.anonymized_id;
    await request(app).post(`/v1/headhunter/candidates/${publishedAnonId}/publish-to-pool`)
      .set('Authorization', `Bearer ${hhKey}`);
  });

  it('each AnonymizedCandidate element includes view_url', async () => {
    const res = await request(app).get('/v1/employer/talent')
      .set('Authorization', `Bearer ${empKey}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const c of res.body.data) {
      expect(c.view_url).toBeDefined();
      expect(typeof c.view_url).toBe('string');
      expect(c.view_url).toMatch(/^http:\/\/localhost:3000\/view\//);
    }
  });

  it('view_url contains the candidate anonymized_id', async () => {
    const res = await request(app).get('/v1/employer/talent')
      .set('Authorization', `Bearer ${empKey}`);
    const c = res.body.data.find((x: any) => x.anonymized_id === publishedAnonId);
    expect(c).toBeDefined();
    expect(c.view_url).toContain(encodeURIComponent(publishedAnonId));
  });

  it('view_url is single-use (second access returns 410)', async () => {
    const res = await request(app).get('/v1/employer/talent')
      .set('Authorization', `Bearer ${empKey}`);
    const c = res.body.data[0];
    const first = await request(app).get(c.view_url.replace('http://localhost:3000', ''));
    expect([200, 410]).toContain(first.status); // 200 first time, 410 after
    const second = await request(app).get(c.view_url.replace('http://localhost:3000', ''));
    expect(second.status).toBe(410);
  });
});
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/employer-talent-view-url.test.ts`
Expected: FAIL — `expected c.view_url to be defined` (injector currently skips arrays)

- [ ] **Step 3: Commit 测试**

```bash
git add tests/integration/employer-talent-view-url.test.ts
git commit -m "test(talent): add failing tests for view_url injection (Bug #11)"
```

---

## Task 2: 更新 AnonymizedCandidate 类型

**Files:**
- Modify: `src/shared/types.ts:59-66`

- [ ] **Step 1: 加 anonymized_id 字段**

打开 `src/shared/types.ts`，找到 `interface AnonymizedCandidate { ... }`，改为：

```typescript
export interface AnonymizedCandidate {
  anonymized_id: string;
  industry: string | null;
  title_level: string | null;
  years_experience: number | null;
  salary_range: string | null;
  education_tier: string | null;
  skills: string[];
}
```

- [ ] **Step 2: 跑 typecheck**

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: 0 errors. (The actual handler at employer/handler.ts:127 already returns `anonymized_id`, so this only fixes the type signature.)

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "types: add anonymized_id to AnonymizedCandidate (was returned at runtime, missing from type)"
```

---

## Task 3: 添加 talent 路由到 ROUTE_VIEW_MAP

**Files:**
- Modify: `src/main/modules/view/route-view-map.ts:9-23`

- [ ] **Step 1: 加新条目**

打开 `src/main/modules/view/route-view-map.ts`，在 `// Read endpoints that produce user-scoped views` 之后，添加：

```typescript
  // Array response: each element gets its own view_url
  'GET /v1/employer/talent':              { type: 'candidate', idFrom: 'data[*].anonymized_id' },
```

- [ ] **Step 2: 跑 typecheck**

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: 0 errors. (`idFrom` 字段是 `string`，不需要类型扩展。)

- [ ] **Step 3: Commit**

```bash
git add src/main/modules/view/route-view-map.ts
git commit -m "feat(view): add /v1/employer/talent to ROUTE_VIEW_MAP"
```

---

## Task 4: 修改 injector 支持 array 响应

**Files:**
- Modify: `src/main/modules/view/injector.ts:42-79`

- [ ] **Step 1: 替换 res.json wrapper**

打开 `src/main/modules/view/injector.ts`，把整段 `res.json = (body: unknown) => { ... }`（第 42-79 行）替换为：

```typescript
    res.json = (body: unknown) => {
      try {
        // Only inject on 2xx (also accept 3xx redirects)
        if (res.statusCode >= 200 && res.statusCode < 400 && body && typeof body === 'object') {
          const b = body as { data?: unknown };
          if (b.data) {
            // CASE 1: object response — inject one view_url
            if (typeof b.data === 'object' && !Array.isArray(b.data)) {
              const mapping = findMapping(reqMethod, reqPath);
              if (mapping) {
                const viewId = lookup(b.data, mapping.idFrom) as string | undefined;
                const authedReq = req as RequestWithUser;
                if (viewId && authedReq.user) {
                  const userId = authedReq.user.id;
                  const { url } = generateViewUrl(repo, baseUrl, userId, mapping.type as ViewType, viewId);
                  (b.data as Record<string, unknown>).view_url = url;
                }
              }
            }
            // CASE 2: array response — inject view_url per element
            // (Was previously skipped: the comment cited JSON.stringify dropping named
            // properties on arrays. But we inject on ELEMENTS, not on the array itself,
            // so each element keeps its view_url.)
            else if (Array.isArray(b.data)) {
              const mapping = findMapping(reqMethod, reqPath);
              if (mapping && mapping.idFrom.startsWith('data[*].')) {
                const fieldName = mapping.idFrom.slice('data[*].'.length);
                const authedReq = req as RequestWithUser;
                if (authedReq.user) {
                  const userId = authedReq.user.id;
                  for (const item of b.data) {
                    if (item && typeof item === 'object') {
                      const viewId = (item as Record<string, unknown>)[fieldName] as string | undefined;
                      if (viewId) {
                        const { url } = generateViewUrl(repo, baseUrl, userId, mapping.type as ViewType, viewId);
                        (item as Record<string, unknown>).view_url = url;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } catch {
        // Never break the response on injection failure
      }
      return originalJson(body);
    };
```

- [ ] **Step 2: 加辅助函数 `findMapping`**

在 `matchRoute` 函数下面、`createViewUrlInjector` 上面，添加：

```typescript
function findMapping(method: string, routePath: string): ViewMapping | undefined {
  for (const [pattern, m] of Object.entries(ROUTE_VIEW_MAP)) {
    if (matchRoute(method, routePath, pattern)) {
      return m;
    }
  }
  return undefined;
}
```

- [ ] **Step 3: 跑 typecheck**

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 4: 跑 #11 测试，验证 TDD green**

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/employer-talent-view-url.test.ts`
Expected: 3/3 pass

- [ ] **Step 5: 跑现有 view_url 注入测试，确保不回归**

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/view-url-injection.test.ts tests/integration/views-endpoint.test.ts tests/integration/views-recommendation-endpoint.test.ts`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add src/main/modules/view/injector.ts
git commit -m "feat(view): inject view_url per element in array responses

Extends the view_url injector to support responses where data is an
array (previously skipped due to JSON.stringify concerns). The injector
now matches routes whose idFrom starts with 'data[*].' and applies
view_url to each element.

First consumer: GET /v1/employer/talent. Each AnonymizedCandidate now
ships with a single-use view_url, removing one round-trip from the
employer browse -> preview -> recommend workflow.

Array element injection is safe: elements are plain objects, JSON.stringify
preserves their named properties (the original skip comment was about
named props ON the array itself, not on its elements)."
```

---

## Task 5: 更新 skill.md §15.2

**Files:**
- Modify: `docs/superpowers/skill.md` (§15.2 employer browseTalent 详解)

- [ ] **Step 1: 加 view_url 说明**

打开 `docs/superpowers/skill.md`，找到 `### 15.2 响应字段` 章节，在字段表下方加：

```markdown
> 💡 **每个元素自动带 `view_url`**：数组中每个 `AnonymizedCandidate` 元素都会注入一个单次有效的 `view_url`，agent 可直接访问预览脱敏画像，无需再调 `POST /v1/views/candidate/{id}`。
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/skill.md
git commit -m "docs(skill): document view_url per element in talent response (§15.2)"
```

---

## Task 6: 全量回归

- [ ] **Step 1: typecheck**

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: 0 errors

- [ ] **Step 2: 跑全量相关测试**

```bash
cd D:\dev\hunter-platform && pnpm vitest run \
  tests/integration/employer-talent-view-url.test.ts \
  tests/integration/view-url-injection.test.ts \
  tests/integration/views-endpoint.test.ts \
  tests/integration/views-recommendation-endpoint.test.ts \
  tests/integration/employer-talent-filter.test.ts \
  tests/integration/state-change-view-injection.test.ts
```
Expected: 全绿

- [ ] **Step 3: 跑 commission 测试（确保 #4 webhook 不回归）**

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/commission-handler.test.ts`
Expected: 9/9 pass

- [ ] **Step 4: live smoke**

```bash
cd D:\dev\hunter-platform && pnpm dev
# 等 3 秒
curl -s http://localhost:3000/v1/employer/talent \
  -H "Authorization: Bearer ${EMPLOYER_KEY}" | head -c 500
```
Expected: 响应中每个元素都有 `view_url` 字段

---

## 验证清单（完成时确认）

- [ ] `tests/integration/employer-talent-view-url.test.ts` 3/3 通过
- [ ] `pnpm typecheck` 0 错
- [ ] 现有 view_url 注入测试 0 回归
- [ ] commission 测试（#4）仍 9/9
- [ ] `src/main/modules/view/injector.ts` 支持 `data[*].x` 语法
- [ ] `src/main/modules/view/route-view-map.ts` 包含 talent 路由
- [ ] `AnonymizedCandidate` 类型含 `anonymized_id`
- [ ] skill.md §15.2 注明 view_url per element
- [ ] live smoke: 实际 `curl /v1/employer/talent` 返回的元素都带 view_url

---

## 风险与回滚

**风险**：
- 修改 injector 可能影响其他 array 端点（/v1/users/{id}/history、/v1/headhunter/candidates、/v1/employer/placements 等）。但这些端点**当前不在 ROUTE_VIEW_MAP 中**（已 grep 验证），所以不会触发新代码路径。
- 改 AnonymizedCandidate 类型可能让某些地方因 `exactOptionalPropertyTypes` 失败（已 typecheck 验证通过）。

**回滚**：每个 task 单独 commit，按需 `git revert`。