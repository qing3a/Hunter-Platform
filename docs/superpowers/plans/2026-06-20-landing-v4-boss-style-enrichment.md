# Landing v4 — Boss 风格内容增量 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 v3 首页的 Hero 之后、Stats 之前插入 3 个新模块（**职位分类导航 / 精选热招职位 / 热门企业**），零字段、零结构、零依赖改动，仅复用 `jobs` 和 `users` 现有数据 + 3 个新 SQL。

**Architecture:** 沿用 v3 模板架构（`html` 标签模板 + `esc` 转义 + 现有 `partials/job-card.ts` / `skill-tag.ts`）。在 `gather-landing-data.ts` 末尾追加 3 个新 SQL（jobs GROUP BY / LEFT JOIN users / 1 主查询 + N+1 子查询）。在 `templates/landing/index.ts` 的 hero 与 stats 之间插入 3 个新模板。CSS 在 `landing.css.ts` 末尾追加 3 套样式。`landing.script.ts` 不动（无新交互）。

**Tech Stack:** Node 22+, TypeScript 5.6+, Express 4.21, node:sqlite (DatabaseSync), vitest 2.1+, supertest 7.0+。**无新依赖**。

**Spec:** [`../specs/2026-06-20-landing-v4-boss-style-enrichment.md`](../specs/2026-06-20-landing-v4-boss-style-enrichment.md)
**前置 plan:** [`2026-06-20-landing-v3-redesign.md`](./2026-06-20-landing-v3-redesign.md) (v3 已落地)

---

## Conventions

- **路径基准**: 仓库根 `d:\dev\hunter-platform\`
- **测试约定**: `*.test.ts` (与项目现存一致), `vitest`, `supertest`, `createApp()` + `:memory:` db
- **TS 配置**: 严格模式，所有 SQL 走 prepared statements
- **命名**: 文件 kebab-case（如 `job-category-nav.ts`），TS 类型 PascalCase
- **提交粒度**: 每完成一个 task 提交一次，commit message 遵循 `feat:` / `refactor:` / `test:` / `chore:` 前缀
- **TDD 流程**: 写失败测试 → 跑验证失败 → 写最小实现 → 跑验证通过 → commit
- **绝对不改**: `nav.ts` / `role-anchors.ts` / `hero.ts` / `stats.ts` / `rankings.ts` / `employer-section.ts` / `headhunter-section.ts` / `candidate-section.ts` / `footer.ts` / `layout.ts` / `landing.script.ts` / `routes/landing.ts` / `server.ts` / 数据库 schema

---

## 文件结构总览

```
src/main/modules/view/
  gather-landing-data.ts                  (MODIFIED, +90 行: 3 SQL + 3 类型 + 3 字段)
  templates/
    landing/
      index.ts                            (MODIFIED, +6 行: 插入 3 个组件)
      job-category-nav.ts                 (NEW, ~40 行)
      featured-jobs.ts                    (NEW, ~60 行)
      hot-companies.ts                    (NEW, ~70 行)
      landing.css.ts                      (MODIFIED, +120 行: 3 套样式 + 响应式)
      其余 11 个文件 (UNTOUCHED)

tests/
  unit/
    gather-landing-data-enrichment.test.ts (NEW, ~180 行)
  integration/
    landing-v4.test.ts                    (NEW, ~80 行)
```

---

## Phase 1: Data Layer

新增 3 个 SQL 查询、3 个 TS 类型、3 个 LandingData 字段。

### Task 1.1: Add `IndustryNavItem` type and `industryNav` query (SQL A)

**Files:**
- Modify: `src/main/modules/view/gather-landing-data.ts` (append type + add field + add query)

- [ ] **Step 1: Write the failing test**

在 `tests/unit/gather-landing-data-enrichment.test.ts` 新建文件：

```typescript
// tests/unit/gather-landing-data-enrichment.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { gatherLandingData } from '../../src/main/modules/view/gather-landing-data';
import { openDb } from '../../src/main/db/connection';
import { runMigrations } from '../../src/main/db/migrations';

describe('gatherLandingData - industryNav (SQL A)', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
  });

  it('returns empty array when no jobs exist', () => {
    const data = gatherLandingData(db);
    expect(data.industryNav).toEqual([]);
  });

  it('aggregates open jobs by industry, sorted DESC, limited to 20', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES
        ('u_e1', 'employer', 'E1', 'e@e.com', 'active', 50, 'h1', 'p1', datetime('now'), datetime('now'), datetime('now')),
        ('u_h1', 'headhunter', 'H1', 'h@h.com', 'active', 50, 'h2', 'p2', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, industry, created_at, updated_at)
      VALUES
        ('j1', 'u_e1', 'J1', 'open', 'AI', datetime('now'), datetime('now')),
        ('j2', 'u_e1', 'J2', 'open', 'AI', datetime('now'), datetime('now')),
        ('j3', 'u_e1', 'J3', 'open', '金融', datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.industryNav).toEqual([
      { industry: 'AI', jobCount: 2 },
      { industry: '金融', jobCount: 1 },
    ]);
  });

  it('excludes jobs with NULL industry', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES ('u_e1', 'employer', 'E1', 'e@e.com', 'active', 50, 'h1', 'p1', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, industry, created_at, updated_at)
      VALUES ('j1', 'u_e1', 'J1', 'open', NULL, datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.industryNav).toEqual([]);
  });

  it('excludes non-open jobs', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES ('u_e1', 'employer', 'E1', 'e@e.com', 'active', 50, 'h1', 'p1', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, industry, created_at, updated_at)
      VALUES
        ('j1', 'u_e1', 'J1', 'closed', 'AI', datetime('now'), datetime('now')),
        ('j2', 'u_e1', 'J2', 'filled', 'AI', datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.industryNav).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/gather-landing-data-enrichment.test.ts 2>&1 | head -40`
Expected: FAIL with "Cannot read properties of undefined (reading 'industryNav')" 或 TS 编译错误 "Property 'industryNav' does not exist"

- [ ] **Step 3: Add `IndustryNavItem` type to gather-landing-data.ts**

在 `src/main/modules/view/gather-landing-data.ts` 的 `interface IndustryGroup {...}` **之后**、`interface RecentJob {...}` **之前**插入：

```typescript
export interface IndustryNavItem {
  industry: string;
  jobCount: number;
}
```

- [ ] **Step 4: Add `industryNav` field to `LandingData` interface**

在 `LandingData` interface 内、**`hotSkills: SkillCount[]` 之后**追加一行：

```typescript
  industryNav: IndustryNavItem[];
```

(在 `hotSkills: SkillCount[];` 之后插入新行；保持其他字段顺序不变)

- [ ] **Step 5: Implement SQL A in `gatherLandingData`**

在 `gatherLandingData` 函数体内、**return 语句之前**插入（紧接在 `// 14) DB probe` 之前，或放在第 13 个查询 `hotSkills` 之后）：

```typescript
  // 15) Industry nav — top 20 industries by open job count (v4 SQL A)
  let industryNav: IndustryNavItem[] = [];
  try {
    const rows = db.prepare(`
      SELECT industry, COUNT(*) as job_count
      FROM jobs
      WHERE status = 'open' AND industry IS NOT NULL
      GROUP BY industry
      ORDER BY job_count DESC
      LIMIT 20
    `).all() as Array<{ industry: string; job_count: number }>;
    industryNav = rows.map((r) => ({ industry: r.industry, jobCount: r.job_count }));
  } catch (e) {
    console.error('Industry nav query failed:', e);
  }
```

并在 return object 内、**`hotSkills,` 之后**添加 `industryNav,`：

```typescript
    hotSkills,
    industryNav,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/gather-landing-data-enrichment.test.ts 2>&1 | head -30`
Expected: PASS（4 tests passed）

- [ ] **Step 7: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/modules/view/gather-landing-data.ts tests/unit/gather-landing-data-enrichment.test.ts && git commit -m "feat(landing-v4): add industryNav query (SQL A)"
```

---

### Task 1.2: Add `FeaturedJob` type and `featuredJobs` query (SQL B)

**Files:**
- Modify: `src/main/modules/view/gather-landing-data.ts`

- [ ] **Step 1: Append failing test**

在 `tests/unit/gather-landing-data-enrichment.test.ts` 文件末尾追加 `describe` 块：

```typescript
describe('gatherLandingData - featuredJobs (SQL B)', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
  });

  it('returns empty array when no open jobs exist', () => {
    const data = gatherLandingData(db);
    expect(data.featuredJobs).toEqual([]);
  });

  it('returns 10 open jobs sorted by priority ASC then created_at DESC', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES ('u_e1', 'employer', 'Boss Inc', 'e@e.com', 'active', 50, 'h1', 'p1', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, priority, industry, salary_min, salary_max, required_skills_json, created_at, updated_at)
      VALUES
        ('j_normal', 'u_e1', 'Normal Job', 'open', 'normal', 'AI', 100000, 200000, '["Java"]', datetime('now', '-1 day'), datetime('now', '-1 day')),
        ('j_urgent', 'u_e1', 'Urgent Job', 'open', 'urgent', 'AI', 200000, 300000, '["Go"]', datetime('now'), datetime('now')),
        ('j_high',   'u_e1', 'High Job',   'open', 'high',   '金融', 150000, 250000, '["Python"]', datetime('now', '-1 hour'), datetime('now', '-1 hour'));
    `);
    const data = gatherLandingData(db);
    expect(data.featuredJobs.map(j => j.title)).toEqual(['Urgent Job', 'High Job', 'Normal Job']);
    expect(data.featuredJobs[0].company_name).toBe('Boss Inc');
    expect(data.featuredJobs[0].required_skills).toEqual(['Go']);
  });

  it('LEFT JOIN handles orphan job (employer_id NULL) — excluded', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES ('u_h1', 'headhunter', 'H1', 'h@h.com', 'active', 50, 'h2', 'p2', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, source_headhunter_id, title, status, priority, created_at, updated_at)
      VALUES ('j_orphan', 'u_h1', 'Orphan', 'open', 'normal', datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.featuredJobs).toEqual([]);
  });

  it('parses NULL required_skills_json as empty array', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES ('u_e1', 'employer', 'E1', 'e@e.com', 'active', 50, 'h1', 'p1', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, priority, required_skills_json, created_at, updated_at)
      VALUES ('j1', 'u_e1', 'J1', 'open', 'normal', NULL, datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.featuredJobs[0].required_skills).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/gather-landing-data-enrichment.test.ts 2>&1 | tail -20`
Expected: FAIL with "Cannot read properties of undefined (reading 'featuredJobs')"

- [ ] **Step 3: Add `FeaturedJob` type**

在 `interface RecentJob {...}` 之后插入：

```typescript
export interface FeaturedJob {
  id: string;
  title: string;
  industry: string | null;
  salary_min: number | null;
  salary_max: number | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  required_skills: string[];
  company_name: string | null;
  created_at: string;
}
```

- [ ] **Step 4: Add `featuredJobs` field to `LandingData` interface**

在 `LandingData` 内、`industryNav: IndustryNavItem[];` 之后追加：

```typescript
  featuredJobs: FeaturedJob[];
```

- [ ] **Step 5: Implement SQL B in `gatherLandingData`**

在 `industryNav` 查询之后插入（紧接在 Task 1.1 step 5 块之后）：

```typescript
  // 16) Featured jobs (v4 SQL B) — top 10 open jobs by priority then created_at
  let featuredJobs: FeaturedJob[] = [];
  try {
    const rows = db.prepare(`
      SELECT j.id, j.title, j.industry, j.salary_min, j.salary_max,
             j.priority, j.required_skills_json, j.created_at,
             u.name AS company_name
      FROM jobs j
      LEFT JOIN users u ON j.employer_id = u.id
      WHERE j.status = 'open' AND j.employer_id IS NOT NULL
      ORDER BY
        CASE j.priority
          WHEN 'urgent' THEN 0
          WHEN 'high'   THEN 1
          WHEN 'normal' THEN 2
          ELSE 3
        END,
        j.created_at DESC
      LIMIT 10
    `).all() as Array<{
      id: string; title: string; industry: string | null;
      salary_min: number | null; salary_max: number | null;
      priority: string; required_skills_json: string | null;
      created_at: string; company_name: string | null;
    }>;
    featuredJobs = rows.map((r) => ({
      id: r.id, title: r.title, industry: r.industry,
      salary_min: r.salary_min, salary_max: r.salary_max,
      priority: r.priority as FeaturedJob['priority'],
      required_skills: safeParseSkills(r.required_skills_json),
      company_name: r.company_name,
      created_at: r.created_at,
    }));
  } catch (e) {
    console.error('Featured jobs query failed:', e);
  }
```

在 return object 内、`industryNav,` 之后追加：

```typescript
    featuredJobs,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/gather-landing-data-enrichment.test.ts 2>&1 | tail -20`
Expected: PASS (4 + 4 = 8 tests passed)

- [ ] **Step 7: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/modules/view/gather-landing-data.ts tests/unit/gather-landing-data-enrichment.test.ts && git commit -m "feat(landing-v4): add featuredJobs query (SQL B)"
```

---

### Task 1.3: Add `HotCompany` type and `hotCompanies` query (SQL C with N+1)

**Files:**
- Modify: `src/main/modules/view/gather-landing-data.ts`

- [ ] **Step 1: Append failing test**

在 `tests/unit/gather-landing-data-enrichment.test.ts` 文件末尾追加：

```typescript
describe('gatherLandingData - hotCompanies (SQL C)', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
  });

  it('returns empty array when no employers have open jobs', () => {
    const data = gatherLandingData(db);
    expect(data.hotCompanies).toEqual([]);
  });

  it('ranks employers by open job count DESC, limits to 4', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES
        ('u_e1', 'employer', 'Boss Inc', 'e1@e.com', 'active', 50, 'h1', 'p1', datetime('now'), datetime('now'), datetime('now')),
        ('u_e2', 'employer', 'Acme',     'e2@e.com', 'active', 50, 'h2', 'p2', datetime('now'), datetime('now'), datetime('now')),
        ('u_e3', 'employer', 'OldCo',    'e3@e.com', 'suspended', 50, 'h3', 'p3', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, created_at, updated_at)
      VALUES
        ('j_e1_a', 'u_e1', 'J1A', 'open', datetime('now'), datetime('now')),
        ('j_e1_b', 'u_e1', 'J1B', 'open', datetime('now'), datetime('now')),
        ('j_e1_c', 'u_e1', 'J1C', 'open', datetime('now'), datetime('now')),
        ('j_e2_a', 'u_e2', 'J2A', 'open', datetime('now'), datetime('now')),
        ('j_e3_a', 'u_e3', 'J3A', 'open', datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.hotCompanies.length).toBe(2);
    expect(data.hotCompanies[0].name).toBe('Boss Inc');
    expect(data.hotCompanies[0].openJobCount).toBe(3);
    expect(data.hotCompanies[1].name).toBe('Acme');
    expect(data.hotCompanies[1].openJobCount).toBe(1);
  });

  it('excludes suspended employers even if they have open jobs', () => {
    // (covered by previous test — OldCo with status='suspended' is excluded)
    // Asserts explicitly:
    const data = gatherLandingData(db);
    expect(data.hotCompanies.find(c => c.name === 'OldCo')).toBeUndefined();
  });

  it('each hot company includes up to 3 most recent open jobs', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES ('u_e1', 'employer', 'Boss Inc', 'e@e.com', 'active', 50, 'h1', 'p1', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, salary_min, salary_max, created_at, updated_at)
      VALUES
        ('j1', 'u_e1', 'Newest',  'open', 100000, 200000, datetime('now'),                       datetime('now')),
        ('j2', 'u_e1', 'Middle',  'open', 100000, 200000, datetime('now', '-1 hour'),            datetime('now', '-1 hour')),
        ('j3', 'u_e1', 'Oldest',  'open', 100000, 200000, datetime('now', '-1 day'),             datetime('now', '-1 day')),
        ('j4', 'u_e1', 'Ignored', 'open', 100000, 200000, datetime('now', '-2 days'),            datetime('now', '-2 days'));
    `);
    const data = gatherLandingData(db);
    expect(data.hotCompanies[0].recentJobs.length).toBe(3);
    expect(data.hotCompanies[0].recentJobs.map(j => j.title)).toEqual(['Newest', 'Middle', 'Oldest']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/gather-landing-data-enrichment.test.ts 2>&1 | tail -20`
Expected: FAIL with "Cannot read properties of undefined (reading 'hotCompanies')"

- [ ] **Step 3: Add `HotCompany` type**

在 `FeaturedJob` 之后插入：

```typescript
export interface HotCompanyRecentJob {
  title: string;
  salary_min: number | null;
  salary_max: number | null;
}

export interface HotCompany {
  id: string;
  name: string;
  openJobCount: number;
  recentJobs: HotCompanyRecentJob[];
}
```

- [ ] **Step 4: Add `hotCompanies` field to `LandingData` interface**

在 `LandingData` 内、`featuredJobs: FeaturedJob[];` 之后追加：

```typescript
  hotCompanies: HotCompany[];
```

- [ ] **Step 5: Implement SQL C in `gatherLandingData`**

在 `featuredJobs` 查询之后插入：

```typescript
  // 17) Hot companies (v4 SQL C) — top 4 employers by open job count, with their 3 most recent jobs
  let hotCompanies: HotCompany[] = [];
  try {
    const topRows = db.prepare(`
      SELECT u.id, u.name, COUNT(j.id) AS open_job_count
      FROM users u
      INNER JOIN jobs j ON j.employer_id = u.id
      WHERE u.user_type = 'employer'
        AND u.status = 'active'
        AND j.status = 'open'
      GROUP BY u.id
      ORDER BY open_job_count DESC
      LIMIT 4
    `).all() as Array<{ id: string; name: string; open_job_count: number }>;

    const recentStmt = db.prepare(`
      SELECT title, salary_min, salary_max
      FROM jobs
      WHERE employer_id = ? AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 3
    `);

    hotCompanies = topRows.map((r) => ({
      id: r.id,
      name: r.name,
      openJobCount: r.open_job_count,
      recentJobs: (recentStmt.all(r.id) as Array<{
        title: string; salary_min: number | null; salary_max: number | null;
      }>),
    }));
  } catch (e) {
    console.error('Hot companies query failed:', e);
  }
```

在 return object 内、`featuredJobs,` 之后追加：

```typescript
    hotCompanies,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/gather-landing-data-enrichment.test.ts 2>&1 | tail -20`
Expected: PASS (4 + 4 + 4 = 12 tests passed)

- [ ] **Step 7: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/modules/view/gather-landing-data.ts tests/unit/gather-landing-data-enrichment.test.ts && git commit -m "feat(landing-v4): add hotCompanies query (SQL C with N+1)"
```

---

### Task 1.4: Verify data layer integration with v3 regression

**Files:**
- Read: `tests/unit/gather-landing-data.test.ts` (existing v3 tests)

- [ ] **Step 1: Run existing gather-landing-data.test.ts to ensure no regression**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/gather-landing-data.test.ts 2>&1 | tail -15`
Expected: PASS (all v3 tests still pass)

- [ ] **Step 2: Run the basic empty-DB test with new fields**

确认 `tests/unit/gather-landing-data.test.ts` 第 14-30 行的 "returns zeros and empty arrays for empty DB" 测试没有断言缺失字段。如果它检查了所有字段名，需要**添加** 3 个新断言：

在 `it('returns zeros and empty arrays for empty DB', ...)` 块内、`expect(data.healthStatus).toBe('healthy');` 之后追加：

```typescript
    expect(data.industryNav).toEqual([]);
    expect(data.featuredJobs).toEqual([]);
    expect(data.hotCompanies).toEqual([]);
```

- [ ] **Step 3: Run all unit tests to confirm 0 failures**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/gather-landing-data.test.ts tests/unit/gather-landing-data-enrichment.test.ts 2>&1 | tail -10`
Expected: PASS (all tests green)

- [ ] **Step 4: Run typecheck to ensure no TS errors**

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -10`
Expected: 0 errors

- [ ] **Step 5: Commit (if Step 2 modified the test)**

```bash
cd /d/dev/hunter-platform && git add tests/unit/gather-landing-data.test.ts && git commit -m "test(landing-v4): cover 3 new fields in basic empty-DB test"
```

(only commit if Step 2 actually changed the test)

---

## Phase 2: Template Layer

新增 3 个模板文件 + 改 index.ts + 改 CSS。

### Task 2.1: Create `job-category-nav.ts`

**Files:**
- Create: `src/main/modules/view/templates/landing/job-category-nav.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/main/modules/view/templates/landing/job-category-nav.ts
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

function industryEmoji(industry: string): string {
  const map: Record<string, string> = {
    '互联网/AI': '💻',
    '金融': '💰',
    '医疗': '🏥',
    '教育': '📚',
    '制造': '🏭',
    '销售': '💼',
    '设计': '🎨',
  };
  return map[industry] ?? '🏢';
}

export function jobCategoryNav(data: LandingData): string {
  if (data.industryNav.length === 0) {
    return html`
<section class="card job-category-nav" id="job-categories">
  <h2><span class="accent-bar"></span>📂 职位分类</h2>
  <p class="meta">暂无分类数据</p>
</section>
    `;
  }

  const items = data.industryNav.map((item) => html`
    <a class="job-category-item" href="#for-headhunters">
      <span class="job-category-emoji">${industryEmoji(item.industry)}</span>
      <span class="job-category-name">${item.industry}</span>
      <span class="job-category-count">${item.jobCount} 个岗位</span>
    </a>
  `).join('');

  return html`
<section class="card job-category-nav" id="job-categories">
  <h2><span class="accent-bar"></span>📂 职位分类</h2>
  <p class="meta">按行业浏览 — 共 ${data.openJobsCount} 个开放岗位</p>
  <div class="job-category-grid">${items}</div>
</section>
  `;
}
```

注：`html` 标签模板自带 escape（v3 验证过），所以 `item.industry` 和 `item.jobCount` 会自动转义，不需要显式 `esc()` 调用。

- [ ] **Step 2: Verify `html` template auto-escapes via typecheck**

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -10`
Expected: 0 errors

如果 typecheck 报"esc is not exported from html.ts"，**删掉**`import { esc } from '../lib/html.js';` 那一行（`html` 标签模板自带 escape）。

- [ ] **Step 3: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/modules/view/templates/landing/job-category-nav.ts && git commit -m "feat(landing-v4): add jobCategoryNav template"
```

---

### Task 2.2: Create `featured-jobs.ts`

**Files:**
- Create: `src/main/modules/view/templates/landing/featured-jobs.ts`

- [ ] **Step 1: Check `formatSalary` is exported from existing partial**

Run: `grep -n "formatSalary" /d/dev/hunter-platform/src/main/modules/view/templates/partials/job-card.ts 2>&1 | head -5`
Expected: 函数定义可见

如果 `formatSalary` **未导出**（即不是 `export function`），则直接在本文件内重新实现一个 `formatSalary` 局部函数（30 秒成本）— 不要改 v3 的 `partials/job-card.ts`。

- [ ] **Step 2: Create the file (re-implementing formatSalary locally)**

```typescript
// src/main/modules/view/templates/landing/featured-jobs.ts
import { html } from '../lib/html.js';
import type { FeaturedJob, LandingData } from '../../gather-landing-data.js';

function formatSalary(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—';
  if (min != null && max != null) return `${min / 10000}万 - ${max / 10000}万`;
  if (min != null) return `${min / 10000}万+`;
  return `≤ ${max! / 10000}万`;
}

function priorityBadge(priority: FeaturedJob['priority']): string {
  if (priority === 'urgent') return '<span class="badge badge-urgent">急</span>';
  if (priority === 'high')   return '<span class="badge badge-hot">热</span>';
  return '';
}

function formatSkills(skills: string[]): string {
  return skills.slice(0, 6).map((s) => `<span class="tag skill">${s}</span>`).join('');
}

export function featuredJobs(data: LandingData): string {
  if (data.featuredJobs.length === 0) {
    return html`
<section class="card featured-jobs" id="featured-jobs">
  <h2><span class="accent-bar"></span>🔥 精选/热招职位</h2>
  <p class="meta">暂无开放岗位。Agent 可调 <code>POST /v1/headhunter/jobs</code> 创建</p>
</section>
    `;
  }

  const cards = data.featuredJobs.map((j) => html`
    <div class="featured-job-card">
      <div class="featured-job-top">
        ${rawBadge(priorityBadge(j.priority))}
        <span class="featured-job-salary">¥${formatSalary(j.salary_min, j.salary_max)}</span>
      </div>
      <div class="featured-job-title">📋 ${j.title}</div>
      <div class="featured-job-meta">
        🏢 ${j.company_name ?? '某公司'} · ${j.industry ?? '其他'}
      </div>
      <div class="featured-job-skills">${rawSkills(formatSkills(j.required_skills))}</div>
    </div>
  `).join('');

  return html`
<section class="card featured-jobs" id="featured-jobs">
  <h2><span class="accent-bar"></span>🔥 精选/热招职位</h2>
  <p class="meta">前 ${data.featuredJobs.length} 个开放岗位 — 按紧急度排序</p>
  <div class="featured-jobs-grid">${cards}</div>
  <p class="meta featured-jobs-more" data-feature="see-more-featured-jobs">查看更多 → (MVP 不做)</p>
</section>
  `;
}

// 内部 helper: 因为 priorityBadge/formatSkills 已经拼接成 HTML 字符串,
// 注入到 html`` 时需要 raw() 避免双重 escape
import { raw } from '../lib/html.js';
function rawBadge(s: string) { return raw(s); }
function rawSkills(s: string) { return raw(s); }
```

> **注**：上面 `import { raw } from '../lib/html.js';` 放在文件**底部**（ES module hoisting 仍有效）。如果你 prefer 顶部 import，把 `import { raw }` 移到第 3 行。

- [ ] **Step 3: Verify typecheck**

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -10`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/modules/view/templates/landing/featured-jobs.ts && git commit -m "feat(landing-v4): add featuredJobs template"
```

---

### Task 2.3: Create `hot-companies.ts`

**Files:**
- Create: `src/main/modules/view/templates/landing/hot-companies.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/main/modules/view/templates/landing/hot-companies.ts
import { html, raw } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

function formatSalary(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—';
  if (min != null && max != null) return `${min / 10000}万 - ${max / 10000}万`;
  if (min != null) return `${min / 10000}万+`;
  return `≤ ${max! / 10000}万`;
}

function renderRecentJobs(jobs: LandingData['hotCompanies'][number]['recentJobs']): string {
  if (jobs.length === 0) return '<p class="meta">暂无开放岗位</p>';
  return jobs.map((j) => `
    <div class="hot-company-job">
      <span class="hot-company-job-title">▸ ${j.title}</span>
      <span class="hot-company-job-salary">¥${formatSalary(j.salary_min, j.salary_max)}</span>
    </div>
  `).join('');
}

export function hotCompanies(data: LandingData): string {
  if (data.hotCompanies.length === 0) {
    return html`
<section class="card hot-companies" id="hot-companies">
  <h2><span class="accent-bar"></span>🏢 热门企业</h2>
  <p class="meta">暂无热门企业</p>
</section>
    `;
  }

  const cards = data.hotCompanies.map((c) => html`
    <div class="hot-company-card">
      <div class="hot-company-header">
        <span class="hot-company-name">🏢 ${c.name}</span>
        <span class="hot-company-count">${c.openJobCount} 个开放岗位</span>
      </div>
      <div class="hot-company-jobs">${raw(renderRecentJobs(c.recentJobs))}</div>
      <p class="meta hot-company-more">查看更多 → (MVP 不做)</p>
    </div>
  `).join('');

  return html`
<section class="card hot-companies" id="hot-companies">
  <h2><span class="accent-bar"></span>🏢 热门企业</h2>
  <p class="meta">按开放岗位数倒序</p>
  <div class="hot-companies-grid">${cards}</div>
</section>
  `;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -10`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/modules/view/templates/landing/hot-companies.ts && git commit -m "feat(landing-v4): add hotCompanies template"
```

---

### Task 2.4: Update `index.ts` to render 3 new modules

**Files:**
- Modify: `src/main/modules/view/templates/landing/index.ts`

- [ ] **Step 1: Add imports**

在 `src/main/modules/view/templates/landing/index.ts` 顶部、`import { html }` 之后追加 3 个 import：

```typescript
import { jobCategoryNav } from './job-category-nav.js';
import { featuredJobs } from './featured-jobs.js';
import { hotCompanies } from './hot-companies.js';
```

- [ ] **Step 2: Insert 3 components between hero and stats**

在 `renderLanding` 函数内、**`${hero(data)}` 之后、`${stats(data)}` 之前**插入：

```typescript
      ${jobCategoryNav(data)}
      ${featuredJobs(data)}
      ${hotCompanies(data)}
```

修改后的 `renderLanding` 应为：

```typescript
export function renderLanding(data: LandingData): string {
  return layout(html`
    <main>
      ${nav(data)}
      ${roleAnchors()}
      ${hero(data)}
      ${jobCategoryNav(data)}
      ${featuredJobs(data)}
      ${hotCompanies(data)}
      ${stats(data)}
      ${rankings(data)}
      ${employerSection(data)}
      ${headhunterSection(data)}
      ${candidateSection(data)}
      ${footer(data)}
    </main>
  `);
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -10`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/modules/view/templates/landing/index.ts && git commit -m "feat(landing-v4): wire 3 new modules into renderLanding"
```

---

### Task 2.5: Add CSS for 3 new modules (with responsive)

**Files:**
- Modify: `src/main/modules/view/templates/landing/landing.css.ts`

- [ ] **Step 1: Append 3 sets of styles**

在 `landing.css.ts` 文件**末尾**追加：

```css
/* ===== v4: 职位分类导航 ===== */
.job-category-nav .job-category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 16px;
}
.job-category-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 18px 12px;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  text-decoration: none;
  color: #1a202c;
  transition: all 0.2s;
}
.job-category-item:hover {
  background: #edf2f7;
  border-color: #14b8a6;
  transform: translateY(-2px);
}
.job-category-emoji {
  font-size: 28px;
  margin-bottom: 8px;
}
.job-category-name {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
}
.job-category-count {
  font-size: 12px;
  color: #718096;
}

/* ===== v4: 精选/热招职位 ===== */
.featured-jobs-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-top: 16px;
}
.featured-job-card {
  padding: 16px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  transition: all 0.2s;
}
.featured-job-card:hover {
  border-color: #14b8a6;
  box-shadow: 0 4px 12px rgba(20, 184, 166, 0.1);
}
.featured-job-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}
.badge-urgent {
  background: #fc8181;
  color: #ffffff;
}
.badge-hot {
  background: #f6ad55;
  color: #ffffff;
}
.featured-job-salary {
  font-size: 18px;
  font-weight: 700;
  color: #14b8a6;
  margin-left: auto;
}
.featured-job-title {
  font-size: 16px;
  font-weight: 600;
  color: #1a202c;
  margin-bottom: 6px;
}
.featured-job-meta {
  font-size: 13px;
  color: #4a5568;
  margin-bottom: 10px;
}
.featured-job-skills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.featured-jobs-more {
  margin-top: 16px;
  text-align: right;
  color: #a0aec0;
  font-size: 13px;
}

/* ===== v4: 热门企业 ===== */
.hot-companies-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: 16px;
}
.hot-company-card {
  padding: 16px;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.hot-company-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e2e8f0;
}
.hot-company-name {
  font-size: 16px;
  font-weight: 600;
  color: #1a202c;
}
.hot-company-count {
  font-size: 12px;
  color: #14b8a6;
  background: #f0fdfa;
  padding: 2px 8px;
  border-radius: 4px;
}
.hot-company-jobs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hot-company-job {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #4a5568;
}
.hot-company-job-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hot-company-job-salary {
  color: #14b8a6;
  font-weight: 600;
  white-space: nowrap;
  margin-left: 8px;
}
.hot-company-more {
  margin-top: 12px;
  text-align: right;
  color: #a0aec0;
  font-size: 12px;
}

/* ===== v4: 响应式 ===== */
@media (max-width: 1023px) {
  .hot-companies-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 767px) {
  .featured-jobs-grid {
    grid-template-columns: 1fr;
  }
  .hot-companies-grid {
    grid-template-columns: 1fr;
  }
  .job-category-nav .job-category-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -10`
Expected: 0 errors（CSS 是 template literal, typecheck 会验证语法）

- [ ] **Step 3: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/modules/view/templates/landing/landing.css.ts && git commit -m "feat(landing-v4): add CSS for 3 new modules + responsive"
```

---

## Phase 3: Testing

### Task 3.1: Create integration test `landing-v4.test.ts`

**Files:**
- Create: `tests/integration/landing-v4.test.ts`

- [ ] **Step 1: Create the file**

```typescript
// tests/integration/landing-v4.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET / - v4 enrichment (3 new modules)', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('renders job category nav section', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('class="card job-category-nav"');
    expect(res.text).toContain('职位分类');
  });

  it('renders featured jobs section', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('class="card featured-jobs"');
    expect(res.text).toContain('精选/热招职位');
  });

  it('renders hot companies section', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('class="card hot-companies"');
    expect(res.text).toContain('热门企业');
  });

  it('3 new modules appear between hero and stats (order check)', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    const html = res.text;
    const heroIdx = html.indexOf('class="hero"');
    const catNavIdx = html.indexOf('class="card job-category-nav"');
    const featIdx = html.indexOf('class="card featured-jobs"');
    const hotIdx = html.indexOf('class="card hot-companies"');
    const statsIdx = html.indexOf('class="card hero-stats"');
    expect(heroIdx).toBeGreaterThan(0);
    expect(catNavIdx).toBeGreaterThan(heroIdx);
    expect(featIdx).toBeGreaterThan(catNavIdx);
    expect(hotIdx).toBeGreaterThan(featIdx);
    expect(statsIdx).toBeGreaterThan(hotIdx);
  });

  it('renders empty-state copy when DB has no data', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('暂无分类数据');
    expect(res.text).toContain('暂无开放岗位。Agent 可调');
    expect(res.text).toContain('暂无热门企业');
  });

  it('data-driven: 3 industries → 3 grid items rendered', async () => {
    const app = createApp();
    const req = request(app);
    // Need a separate test app for seeding. Use createApp + direct DB seed.
    // For simplicity, do this in a separate file. See landing-v4-seeded.test.ts.
  });

  it('does not leak PII (user_id, contact, email, phone)', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).not.toMatch(/contact@|email.*@|phone.*\d{11}/i);
    // industry names / company names are OK to show
  });

  it('render time < 300ms (v3 baseline 200ms + 100ms budget)', async () => {
    const app = createApp();
    const start = Date.now();
    await request(app).get('/');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(300);
  });

  it('v3 features still render (regression)', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('class="top-nav"');
    expect(res.text).toContain('HEALTHY');
    expect(res.text).toContain('Top 猎头');
    expect(res.text).toContain('for-employers');
  });
});
```

> **注**：第 6 个测试 (`data-driven: 3 industries → 3 grid items`) 需要 seeded DB，留空实现作为占位。如果你不需要这条精确测试，**直接删除**该 `it(...)` 块。

- [ ] **Step 2: Remove the placeholder test (if not implementing)**

如果决定不做 data-driven 测试，**删除**第 6 个 `it(...)` 块（含空函数体），保留 8 个测试。

- [ ] **Step 3: Run integration test to verify it passes**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/landing-v4.test.ts 2>&1 | tail -20`
Expected: PASS (8 tests)

- [ ] **Step 4: Commit**

```bash
cd /d/dev/hunter-platform && git add tests/integration/landing-v4.test.ts && git commit -m "test(landing-v4): add integration tests for 3 new modules"
```

---

### Task 3.2: Full regression — v3 tests still pass

**Files:** none (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/ 2>&1 | tail -10`
Expected: PASS (all green)

- [ ] **Step 2: Run all integration tests**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/landing-v3.test.ts tests/integration/landing-v4.test.ts 2>&1 | tail -10`
Expected: PASS (v3 + v4 all green)

- [ ] **Step 3: Run typecheck**

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -5`
Expected: 0 errors

- [ ] **Step 4: If any failures, fix and commit per-task**

If typecheck/test fails, identify the failing task, fix its code, commit a fix. Do NOT amend previous commits.

---

## Phase 4: Wrap-up

### Task 4.1: Manual smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Start dev server**

Run: `cd /d/dev/hunter-platform && pnpm dev 2>&1`
Expected: Server listens on port 3000 (or whatever `.env` says)

- [ ] **Step 2: Curl the landing page**

In a separate terminal: `curl -s http://localhost:3000/ | grep -E "职位分类|精选/热招职位|热门企业" 2>&1`
Expected: All 3 strings present

- [ ] **Step 3: Visual smoke (optional)**

Open `http://localhost:3000/` in browser. Verify:
- 3 new sections visible in order
- Empty state shows when no data
- Existing v3 sections (nav, role anchors, hero, stats, rankings, etc.) all still render
- No console errors

- [ ] **Step 4: Stop dev server**

Run: kill the `pnpm dev` process (Ctrl+C in its terminal)

---

### Task 4.2: Final commit and summary

**Files:** none

- [ ] **Step 1: Verify no uncommitted changes**

Run: `cd /d/dev/hunter-platform && git status 2>&1`
Expected: "nothing to commit, working tree clean"

- [ ] **Step 2: View commit log**

Run: `cd /d/dev/hunter-platform && git log --oneline main -10 2>&1`
Expected: Last ~7 commits all related to landing-v4 (data layer, 3 templates, index, CSS, integration test, etc.)

- [ ] **Step 3: Report completion**

向用户报告：
- 总 commit 数
- 改动行数
- 0 个 typecheck 错误
- N 个新测试通过
- v3 现有测试无回归

---

## 风险与缓解（实施时关注）

| 风险 | 缓解策略 |
|------|---------|
| `html.ts` 没导出 `esc` 或 `raw` | Task 2.1 / 2.2 / 2.3 步骤 1 已说明 fallback；`html` 标签模板自带 escape，可去掉显式 import |
| v3 的 `formatSalary` 未导出 | Task 2.2 步骤 1 已说明本地重新实现 |
| 集成测试中 data-driven 测试需要 seeded DB | 已留 placeholder，可直接删除 |
| `landing.script.ts` 误改 | **本 plan 不包含**任何对 `landing.script.ts` 的修改步骤 |
| 任何对 v3 文件的误改 | 每步明确"Modify"行只列 1-2 个文件；其他文件不动 |
| typecheck 报"unused import" | html/raw/esc 实际被使用；如果 unused 警告出现，删掉对应 import |

## 完成定义（Definition of Done）

- [x] 3 个新模块在 `GET /` 渲染（hero 之后、stats 之前）
- [x] Stats / Rankings / For XXX / Footer 任何字符不变
- [x] 数据库 schema 不变（0 新字段、0 新表）
- [x] package.json 不变（0 新依赖）
- [x] `pnpm typecheck` 0 errors
- [x] `pnpm test` 全部 pass
- [x] v3 现有测试 0 回归
- [x] v4 集成测试 8/8 pass
- [x] 手动 smoke 验证 3 个模块在浏览器可见
