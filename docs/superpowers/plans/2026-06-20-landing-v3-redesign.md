# Landing Page v3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `GET /` landing page 从单文件重构为 11 个模板子模块 + 6 个 partials + 1 个 lib helper + 1 个数据层文件，新增 3 个 SQL 和 1 个 DB 探活，引入 sticky 顶导、role 锚点、可复制 AGENT GATE、5 维 tab 化榜单、Footer 五个新区块。

**Architecture:** 保留 SSR HTML（无 SPA 框架）。数据层 `gather-landing-data.ts` 用 node:sqlite 同步查询；模板层用 `html` 标签模板 + `esc` 转义组合输出；客户端 JS 仅做渐进增强（复制按钮、tab 切换、smooth scroll、IntersectionObserver 高亮）。整套保持单页面垂直滚动 + sticky 顶导。

**Tech Stack:** Node 22+, TypeScript 5.6+, Express 4.21, node:sqlite (DatabaseSync), vitest 2.1+, supertest 7.0+。无新依赖。

**Spec:** [`../specs/2026-06-20-landing-v3-redesign.md`](../specs/2026-06-20-landing-v3-redesign.md)

---

## Conventions

- **路径基准**: 仓库根 `d:\dev\hunter-platform\`
- **测试约定**: `*.test.ts` (与项目现存 `landing.test.ts` 一致), `vitest`, `supertest`
- **DB 探针**: `process.env.DATABASE_PATH = ':memory:'` 配合 `createApp()` 直接打路由
- **TS 配置**: 严格模式，prepared statements，转义走 `esc()` 或 `html` 标签模板
- **命名**: 文件 kebab-case（如 `gather-landing-data.ts`），TS 类型 PascalCase
- **提交粒度**: 每完成一个 task 提交一次，commit message 遵循 `feat:` / `refactor:` / `test:` / `chore:` 前缀

---

## 文件结构总览

```
src/main/modules/view/
  gather-landing-data.ts                  (NEW, ~200 行)
  templates/
    shared-css.ts                         (UNTOUCHED)
    landing.ts                            (DELETED in Task 3.0)
    landing/                              (NEW dir)
      index.ts                            (~50 行, 组合入口)
      layout.ts                           (~30 行, page shell)
      nav.ts                              (~60 行, sticky 顶导)
      role-anchors.ts                     (~30 行)
      hero.ts                             (~80 行, 含 AGENT GATE)
      stats.ts                            (~40 行)
      rankings.ts                         (~120 行, 5 tab)
      employer-section.ts                 (~50 行)
      headhunter-section.ts               (~50 行)
      candidate-section.ts                (~40 行)
      footer.ts                           (~30 行)
      landing.css.ts                      (~200 行)
      landing.script.ts                   (~150 行)
    partials/                             (NEW dir)
      section-card.ts                     (~20 行)
      status-badge.ts                     (~20 行)
      skill-tag.ts                        (~15 行)
      ranking-row.ts                      (~30 行)
      candidate-card.ts                   (~50 行)
      job-card.ts                         (~40 行)
    lib/                                  (NEW dir)
      html.ts                             (~30 行, esc + html``)
  view-token-repo.ts                      (UNTOUCHED)
  generate.ts / validate.ts / handler.ts  (UNTOUCHED)
  injector.ts                             (UNTOUCHED)

src/main/routes/landing.ts                (MODIFIED, 154 → ~15 行)

tests/
  unit/
    gather-landing-data.test.ts           (NEW, ~150 行)
    lib-html.test.ts                      (NEW, ~60 行)
  integration/
    landing-v3.test.ts                    (NEW, ~150 行, 扩展覆盖 v3 新增)
```

---

## Phase 1: Data Layer

把 `routes/landing.ts` 中的数据查询函数全部抽到 `modules/view/gather-landing-data.ts`，新增 3 个 SQL + 1 个 health 探活。

### Task 1.1: Create gather-landing-data.ts shell

**Files:**
- Create: `src/main/modules/view/gather-landing-data.ts`

- [ ] **Step 1: Create empty file with types**

```typescript
// src/main/modules/view/gather-landing-data.ts
import type { DB } from '../db/connection.js';

export interface CandidateCard {
  anonymized_id: string;
  industry: string | null;
  title_level: string | null;
  years_experience: number | null;
  salary_range: string | null;
  education_tier: string | null;
  skills: string[];
}

export interface IndustryGroup {
  industry: string;
  candidates: CandidateCard[];
}

export interface RecentJob {
  title: string;
  industry: string | null;
  salary_min: number | null;
  salary_max: number | null;
  required_skills: string[];
}

export interface HeadhunterRanking {
  rank: number;
  id: string;
  name: string;
  reputation: number;
}

export interface PlacementItem {
  title: string;
  industry: string | null;
  salaryText: string;
  headhunterName: string;
  at: string;
}

export interface EmployerRanking {
  id: string;
  name: string;
  recCount: number;
}

export interface IndustryRanking {
  industry: string;
  candCount: number;
}

export interface SkillCount {
  skill: string;
  count: number;
}

export type HealthStatus = 'healthy' | 'degraded' | 'down';

export interface LandingData {
  openJobsCount: number;
  publicCandidatesCount: number;
  industryGroups: IndustryGroup[];
  recentJobs: RecentJob[];
  activeEmployerCount: number;
  activeHeadhunterCount: number;
  serverTime: string;
  todayUnlocks: number;
  todayPlacements: number;
  totalCandidates: number;
  uptimePercent: number;
  topHeadhunters: HeadhunterRanking[];
  latestPlacements: PlacementItem[];
  topEmployers: EmployerRanking[];
  topIndustries: IndustryRanking[];
  hotSkills: SkillCount[];
  healthStatus: HealthStatus;
}

export function gatherLandingData(_db: DB): LandingData {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: PASS (no errors)

- [ ] **Step 3: Verify file exists**

Run: `dir d:\dev\hunter-platform\src\main\modules\view\gather-landing-data.ts`
Expected: file shown

- [ ] **Step 4: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/gather-landing-data.ts
git commit -m "feat(view): scaffold gather-landing-data.ts with LandingData types"
```

> 注：项目当前非 git repo。如未初始化，先 `git init` 在根目录。

---

### Task 1.2: Implement helper functions and 10 existing SQLs

**Files:**
- Modify: `src/main/modules/view/gather-landing-data.ts`
- Test: `tests/unit/gather-landing-data.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/gather-landing-data.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { gatherLandingData } from '../../src/main/modules/view/gather-landing-data';
import { openDb } from '../../src/main/db/connection';

describe('gatherLandingData - basic fields', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('returns zeros and empty arrays for empty DB', () => {
    const data = gatherLandingData(db);
    expect(data.openJobsCount).toBe(0);
    expect(data.publicCandidatesCount).toBe(0);
    expect(data.industryGroups).toEqual([]);
    expect(data.recentJobs).toEqual([]);
    expect(data.topHeadhunters).toEqual([]);
    expect(data.latestPlacements).toEqual([]);
    expect(data.todayUnlocks).toBe(0);
    expect(data.todayPlacements).toBe(0);
    expect(data.totalCandidates).toBe(0);
    expect(data.activeEmployerCount).toBe(0);
    expect(data.activeHeadhunterCount).toBe(0);
    expect(data.uptimePercent).toBe(99.9);
    expect(data.healthStatus).toBe('healthy');
    expect(data.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/gather-landing-data.test.ts`
Expected: FAIL with "not implemented"

- [ ] **Step 3: Implement helper functions and 10 SQLs**

Replace the contents of `src/main/modules/view/gather-landing-data.ts` with:

```typescript
// src/main/modules/view/gather-landing-data.ts
import type { DB } from '../db/connection.js';

export interface CandidateCard { /* ... types from Task 1.1 ... */ }
// (keep all the type definitions from Task 1.1, then add the implementation)

function safeParseSkills(json: string | null): string[] {
  if (!json) return [];
  try { return JSON.parse(json) as string[]; } catch { return []; }
}

function formatSalaryAnnual(salary: number | null): string {
  if (salary == null) return '—';
  const wan = salary / 10000;
  if (wan < 50) return `${wan}万`;
  return `${Math.floor(wan / 10) * 10}-${Math.ceil(wan / 10) * 10}万`;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function gatherLandingData(db: DB): LandingData {
  // 1) Open jobs count
  const openJobsCount = (db.prepare(
    `SELECT COUNT(*) as c FROM jobs WHERE status = 'open'`
  ).get() as { c: number }).c;

  // 2) Public candidates count
  const publicCandidatesCount = (db.prepare(
    `SELECT COUNT(*) as c FROM candidates_anonymized WHERE is_public_pool = 1`
  ).get() as { c: number }).c;

  // 3) Industry groups (top 5 per industry)
  const candRows = db.prepare(`
    SELECT id, industry, title_level, years_experience, salary_range, education_tier, skills_json
    FROM candidates_anonymized
    WHERE is_public_pool = 1 AND industry IS NOT NULL
    ORDER BY industry, created_at DESC
  `).all() as Array<{
    id: string; industry: string; title_level: string | null;
    years_experience: number | null; salary_range: string | null;
    education_tier: string | null; skills_json: string | null;
  }>;
  const byIndustry = new Map<string, CandidateCard[]>();
  for (const r of candRows) {
    if (!byIndustry.has(r.industry)) byIndustry.set(r.industry, []);
    const list = byIndustry.get(r.industry)!;
    if (list.length < 5) {
      list.push({
        anonymized_id: r.id, industry: r.industry,
        title_level: r.title_level, years_experience: r.years_experience,
        salary_range: r.salary_range, education_tier: r.education_tier,
        skills: safeParseSkills(r.skills_json),
      });
    }
  }
  const industryGroups: IndustryGroup[] = Array.from(byIndustry.entries())
    .map(([industry, candidates]) => ({ industry, candidates }))
    .sort((a, b) => b.candidates.length - a.candidates.length);

  // 4) Recent jobs (top 5)
  const jobRows = db.prepare(`
    SELECT title, industry, salary_min, salary_max, required_skills_json
    FROM jobs WHERE status = 'open'
    ORDER BY created_at DESC LIMIT 5
  `).all() as Array<{
    title: string; industry: string | null;
    salary_min: number | null; salary_max: number | null;
    required_skills_json: string | null;
  }>;
  const recentJobs: RecentJob[] = jobRows.map((r) => ({
    title: r.title, industry: r.industry,
    salary_min: r.salary_min, salary_max: r.salary_max,
    required_skills: safeParseSkills(r.required_skills_json),
  }));

  // 5) Active users by type
  const userRows = db.prepare(`
    SELECT user_type, COUNT(*) as c FROM users
    WHERE status = 'active' AND user_type IN ('headhunter', 'employer')
    GROUP BY user_type
  `).all() as Array<{ user_type: string; c: number }>;
  let activeEmployerCount = 0;
  let activeHeadhunterCount = 0;
  for (const r of userRows) {
    if (r.user_type === 'employer') activeEmployerCount = r.c;
    if (r.user_type === 'headhunter') activeHeadhunterCount = r.c;
  }

  // 6) Today unlocks
  const todayUnlocks = (db.prepare(
    `SELECT COUNT(*) as c FROM recommendations
     WHERE status = 'unlocked' AND updated_at >= datetime('now', 'start of day')`
  ).get() as { c: number }).c;

  // 7) Today placements
  const todayPlacements = (db.prepare(
    `SELECT COUNT(*) as c FROM placements
     WHERE updated_at >= datetime('now', 'start of day')`
  ).get() as { c: number }).c;

  // 8) Total candidates
  const totalCandidates = (db.prepare(
    `SELECT COUNT(*) as c FROM candidates_anonymized`
  ).get() as { c: number }).c;

  // 9) Top 3 headhunters
  const topHeadhunterRows = db.prepare(
    `SELECT id, name, reputation FROM users
     WHERE user_type = 'headhunter' AND status = 'active'
     ORDER BY reputation DESC LIMIT 3`
  ).all() as Array<{ id: string; name: string; reputation: number }>;
  const topHeadhunters: HeadhunterRanking[] = topHeadhunterRows.map((r, i) => ({
    rank: i + 1, id: r.id, name: r.name, reputation: r.reputation,
  }));

  // 10) Latest 5 placements
  const placementRows = db.prepare(`
    SELECT p.annual_salary, p.updated_at,
           j.title as job_title, j.industry as job_industry,
           h.name as headhunter_name
    FROM placements p
    LEFT JOIN jobs j ON p.job_id = j.id
    LEFT JOIN users h ON p.primary_headhunter_id = h.id
    WHERE p.status = 'placed'
    ORDER BY p.updated_at DESC LIMIT 5
  `).all() as Array<{
    annual_salary: number | null; updated_at: string;
    job_title: string | null; job_industry: string | null; headhunter_name: string | null;
  }>;
  const latestPlacements: PlacementItem[] = placementRows.map((r) => ({
    title: r.job_title ?? '(已删除岗位)', industry: r.job_industry,
    salaryText: formatSalaryAnnual(r.annual_salary),
    headhunterName: r.headhunter_name ?? '匿名猎头',
    at: relativeTime(r.updated_at),
  }));

  return {
    openJobsCount, publicCandidatesCount, industryGroups, recentJobs,
    activeEmployerCount, activeHeadhunterCount,
    serverTime: new Date().toISOString(),
    todayUnlocks, todayPlacements, totalCandidates,
    uptimePercent: 99.9, topHeadhunters, latestPlacements,
    topEmployers: [], topIndustries: [], hotSkills: [],
    healthStatus: 'healthy',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/gather-landing-data.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/gather-landing-data.ts tests/unit/gather-landing-data.test.ts
git commit -m "feat(view): implement 10 existing SQLs in gather-landing-data"
```

---

### Task 1.3: Add Top Employers SQL

**Files:**
- Modify: `src/main/modules/view/gather-landing-data.ts`
- Test: `tests/unit/gather-landing-data.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/gather-landing-data.test.ts`:

```typescript
describe('gatherLandingData - topEmployers', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('returns empty array when no employers exist', () => {
    const data = gatherLandingData(db);
    expect(data.topEmployers).toEqual([]);
  });

  it('ranks employers by recommendation count DESC', () => {
    // Setup: create 2 employers + recommendations
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, created_at, updated_at)
      VALUES
        ('u_e1', 'employer', 'Boss Inc', 'e1@e.com', 'active', 80, datetime('now'), datetime('now')),
        ('u_e2', 'employer', 'Acme', 'e2@e.com', 'active', 90, datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, created_at, updated_at)
      VALUES ('j1', 'u_e1', 'J1', 'open', datetime('now'), datetime('now'));
      INSERT INTO candidates_anonymized (id, anonymized_user_id, anonymized_name, is_public_pool, unlock_status, created_at, updated_at)
      VALUES ('c1', 'cu1', 'X', 0, 'locked', datetime('now'), datetime('now'));
      INSERT INTO recommendations (id, job_id, candidate_id, employer_id, status, created_at, updated_at)
      VALUES ('r1', 'j1', 'c1', 'u_e1', 'pending', datetime('now'), datetime('now')),
             ('r2', 'j1', 'c1', 'u_e2', 'pending', datetime('now'), datetime('now')),
             ('r3', 'j1', 'c1', 'u_e2', 'pending', datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.topEmployers).toEqual([
      { id: 'u_e2', name: 'Acme', recCount: 2 },
      { id: 'u_e1', name: 'Boss Inc', recCount: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/gather-landing-data.test.ts`
Expected: FAIL with empty array mismatch (because we still return `topEmployers: []`)

- [ ] **Step 3: Implement Top Employers query**

In `gather-landing-data.ts`, replace `topEmployers: []` with:

```typescript
// 11) Top 3 employers (with per-field fallback per spec §6)
let topEmployers: EmployerRanking[] = [];
try {
  const topEmployerRows = db.prepare(`
    SELECT u.id, u.name, COUNT(r.id) AS rec_count
    FROM users u
    LEFT JOIN recommendations r ON r.employer_id = u.id
    WHERE u.user_type = 'employer' AND u.status = 'active'
    GROUP BY u.id
    ORDER BY rec_count DESC, COALESCE(u.reputation, 0) DESC
    LIMIT 3
  `).all() as Array<{ id: string; name: string; rec_count: number }>;
  topEmployers = topEmployerRows.map((r) => ({
    id: r.id, name: r.name, recCount: r.rec_count,
  }));
} catch (e) {
  console.error('Top Employers query failed:', e);
}
```

And update the return object:
```typescript
return { /* ...other fields... */, topEmployers, /* ...other new fields... */ };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/gather-landing-data.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/gather-landing-data.ts tests/unit/gather-landing-data.test.ts
git commit -m "feat(view): add Top Employers ranking SQL"
```

---

### Task 1.4: Add Top Industries SQL

**Files:**
- Modify: `src/main/modules/view/gather-landing-data.ts`
- Test: `tests/unit/gather-landing-data.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/gather-landing-data.test.ts`:

```typescript
describe('gatherLandingData - topIndustries', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('returns empty array when no public candidates exist', () => {
    const data = gatherLandingData(db);
    expect(data.topIndustries).toEqual([]);
  });

  it('groups public candidates by industry, sorted DESC', () => {
    db.exec(`
      INSERT INTO candidates_anonymized (id, anonymized_user_id, anonymized_name, is_public_pool, industry, unlock_status, created_at, updated_at)
      VALUES
        ('c1', 'cu1', 'X', 1, '互联网', 'locked', datetime('now'), datetime('now')),
        ('c2', 'cu2', 'Y', 1, '互联网', 'locked', datetime('now'), datetime('now')),
        ('c3', 'cu3', 'Z', 1, '金融', 'locked', datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.topIndustries).toEqual([
      { industry: '互联网', candCount: 2 },
      { industry: '金融', candCount: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/gather-landing-data.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement Top Industries query**

In `gather-landing-data.ts`, replace `topIndustries: []` with:

```typescript
// 12) Top 3 industries (with per-field fallback per spec §6)
let topIndustries: IndustryRanking[] = [];
try {
  const topIndustryRows = db.prepare(`
    SELECT industry, COUNT(*) AS cand_count
    FROM candidates_anonymized
    WHERE is_public_pool = 1 AND industry IS NOT NULL
    GROUP BY industry
    ORDER BY cand_count DESC
    LIMIT 3
  `).all() as Array<{ industry: string; cand_count: number }>;
  topIndustries = topIndustryRows.map((r) => ({
    industry: r.industry, candCount: r.cand_count,
  }));
} catch (e) {
  console.error('Top Industries query failed:', e);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/gather-landing-data.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/gather-landing-data.ts tests/unit/gather-landing-data.test.ts
git commit -m "feat(view): add Top Industries ranking SQL"
```

---

### Task 1.5: Add Hot Skills aggregation

**Files:**
- Modify: `src/main/modules/view/gather-landing-data.ts`
- Test: `tests/unit/gather-landing-data.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/gather-landing-data.test.ts`:

```typescript
describe('gatherLandingData - hotSkills', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('returns empty array when no open jobs have skills', () => {
    const data = gatherLandingData(db);
    expect(data.hotSkills).toEqual([]);
  });

  it('aggregates skills from open jobs, top 10, sorted DESC', () => {
    db.exec(`
      INSERT INTO jobs (id, employer_id, title, status, required_skills_json, created_at, updated_at)
      VALUES
        ('j1', 'u_e1', 'J1', 'open', '["React", "TypeScript"]', datetime('now'), datetime('now')),
        ('j2', 'u_e1', 'J2', 'open', '["React", "Go"]', datetime('now'), datetime('now')),
        ('j3', 'u_e1', 'J3', 'open', '["TypeScript"]', datetime('now'), datetime('now')),
        ('j4', 'u_e1', 'J4', 'closed', '["Hidden"]', datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.hotSkills).toEqual([
      { skill: 'React', count: 2 },
      { skill: 'TypeScript', count: 2 },
      { skill: 'Go', count: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/gather-landing-data.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement Hot Skills aggregation**

In `gather-landing-data.ts`, replace `hotSkills: []` with:

```typescript
// 13) Hot Skills (JS-side aggregation, top 10, with per-field fallback per spec §6)
let hotSkills: SkillCount[] = [];
try {
  const skillJobRows = db.prepare(
    `SELECT required_skills_json FROM jobs WHERE status = 'open'`
  ).all() as Array<{ required_skills_json: string | null }>;
  const skillCounts = new Map<string, number>();
  for (const r of skillJobRows) {
    for (const s of safeParseSkills(r.required_skills_json)) {
      skillCounts.set(s, (skillCounts.get(s) ?? 0) + 1);
    }
  }
  hotSkills = Array.from(skillCounts.entries())
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
} catch (e) {
  console.error('Hot Skills aggregation failed:', e);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/gather-landing-data.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/gather-landing-data.ts tests/unit/gather-landing-data.test.ts
git commit -m "feat(view): add Hot Skills aggregation (JS-side)"
```

---

### Task 1.6: Add DB health check

**Files:**
- Modify: `src/main/modules/view/gather-landing-data.ts`
- Test: `tests/unit/gather-landing-data.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/gather-landing-data.test.ts`:

```typescript
describe('gatherLandingData - healthStatus', () => {
  it('returns healthy for working DB', () => {
    const db = openDb(':memory:');
    const data = gatherLandingData(db);
    expect(data.healthStatus).toBe('healthy');
  });

  it('returns degraded when DB throws on probe', () => {
    const db = openDb(':memory:');
    // Override prepare to fail on `SELECT 1`
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      if (sql.replace(/\s+/g, ' ').trim() === 'SELECT 1') {
        throw new Error('simulated DB failure');
      }
      return origPrepare(sql);
    };
    const data = gatherLandingData(db);
    expect(data.healthStatus).toBe('degraded');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/gather-landing-data.test.ts`
Expected: FAIL (second test fails because healthStatus stays 'healthy')

- [ ] **Step 3: Implement DB health check**

In `gather-landing-data.ts`, replace `healthStatus: 'healthy'` with:

```typescript
// 14) DB probe
let healthStatus: HealthStatus = 'healthy';
try {
  db.prepare('SELECT 1').get();
} catch {
  healthStatus = 'degraded';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/gather-landing-data.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/gather-landing-data.ts tests/unit/gather-landing-data.test.ts
git commit -m "feat(view): add DB health probe for healthStatus"
```

---

## Phase 2: Helper Layer

新增 `lib/html.ts`（esc + 标签模板）+ 6 个 partials。

### Task 2.1: Create lib/html.ts (esc + html``)

**Files:**
- Create: `src/main/modules/view/templates/lib/html.ts`
- Test: `tests/unit/lib-html.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/lib-html.test.ts
import { describe, it, expect } from 'vitest';
import { esc, html } from '../../src/main/modules/view/templates/lib/html';

describe('esc', () => {
  it('escapes HTML special characters', () => {
    expect(esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });
  it('escapes single quotes', () => {
    expect(esc("it's")).toBe('it&#39;s');
  });
  it('returns empty string for null', () => { expect(esc(null)).toBe(''); });
  it('returns empty string for undefined', () => { expect(esc(undefined)).toBe(''); });
  it('stringifies numbers', () => { expect(esc(42)).toBe('42'); });
  it('preserves safe characters', () => { expect(esc('hello world')).toBe('hello world'); });
});

describe('html tagged template', () => {
  it('concatenates strings and values', () => {
    const out = html`<p>${'hello'}</p>`;
    expect(out).toBe('<p>hello</p>');
  });
  it('escapes interpolated values', () => {
    const out = html`<p>${'<b>'}</p>`;
    expect(out).toBe('<p>&lt;b&gt;</p>');
  });
  it('skips null and false', () => {
    expect(html`a${null}b${false}c`).toBe('abc');
  });
  it('flattens arrays', () => {
    const items = ['<x>', '<y>'];
    expect(html`${items}`).toBe('&lt;x&gt;&lt;y&gt;');
  });
  it('preserves numbers as-is', () => {
    expect(html`count: ${42}`).toBe('count: 42');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/lib-html.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement lib/html.ts**

```typescript
// src/main/modules/view/templates/lib/html.ts

export function esc(s: unknown): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]!));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v == null || v === false) continue;
      if (Array.isArray(v)) {
        for (const item of v) out += (item == null || item === false) ? '' : esc(item);
      } else if (typeof v === 'object' && v && 'toString' in v && typeof (v as { toString(): string }).toString === 'function') {
        // Already-rendered HTML strings (from other html`` calls) pass through
        out += (v as { toString(): string }).toString();
      } else {
        out += esc(v);
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd d:\dev\hunter-platform && pnpm test tests/unit/lib-html.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/templates/lib/html.ts tests/unit/lib-html.test.ts
git commit -m "feat(view): add html tagged template + esc helper"
```

---

### Task 2.2: Create partials/section-card.ts

**Files:**
- Create: `src/main/modules/view/templates/partials/section-card.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/partials/section-card.ts
import { html } from '../lib/html.js';

export interface SectionCardOptions {
  id?: string;
  title: string;
  subtitle?: string;
  body: string;  // pre-rendered HTML
}

export function sectionCard(opts: SectionCardOptions): string {
  return html`
    <section class="card" ${opts.id ? html`id="${opts.id}"` : ''}>
      <h2><span class="accent-bar"></span>${opts.title}</h2>
      ${opts.subtitle ? html`<p class="meta">${opts.subtitle}</p>` : ''}
      ${opts.body}
    </section>
  `;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/templates/partials/section-card.ts
git commit -m "feat(view): add sectionCard partial"
```

---

### Task 2.3: Create partials/status-badge.ts

**Files:**
- Create: `src/main/modules/view/templates/partials/status-badge.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/partials/status-badge.ts
import { html } from '../lib/html.js';
import type { HealthStatus } from '../../gather-landing-data.js';

export function statusBadge(status: HealthStatus, uptimePercent: number): string {
  const colorMap: Record<HealthStatus, string> = {
    healthy: '#22c55e',
    degraded: '#f59e0b',
    down: '#ef4444',
  };
  const labelMap: Record<HealthStatus, string> = {
    healthy: 'HEALTHY',
    degraded: 'DEGRADED',
    down: 'DOWN',
  };
  return html`
    <span class="status-badge" data-status="${status}" title="服务状态: ${labelMap[status]}">
      <span class="status-dot" style="background:${colorMap[status]}"></span>
      ${labelMap[status]} ${uptimePercent}<span class="unit">%</span>
    </span>
  `;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/templates/partials/status-badge.ts
git commit -m "feat(view): add statusBadge partial"
```

---

### Task 2.4: Create partials/skill-tag.ts

**Files:**
- Create: `src/main/modules/view/templates/partials/skill-tag.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/partials/skill-tag.ts
import { html } from '../lib/html.js';

export function skillTag(skill: string): string {
  return html`<span class="tag skill">${skill}</span>`;
}

export function skillTags(skills: string[], limit = 6): string {
  return skills.slice(0, limit).map(skillTag).join('');
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/templates/partials/skill-tag.ts
git commit -m "feat(view): add skillTag + skillTags partials"
```

---

### Task 2.5: Create partials/ranking-row.ts

**Files:**
- Create: `src/main/modules/view/templates/partials/ranking-row.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/partials/ranking-row.ts
import { html } from '../lib/html.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export function rankingRow(rank: number, name: string, meta: string, score: number | string): string {
  const medal = rank >= 1 && rank <= 3 ? MEDALS[rank - 1] : `${rank}.`;
  return html`
    <div class="ranking-row">
      <div class="ranking-medal">${medal}</div>
      <div class="ranking-info">
        <div class="ranking-name">${name}</div>
        <div class="ranking-meta">${meta}</div>
      </div>
      <div class="ranking-rep">${score}</div>
    </div>
  `;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/templates/partials/ranking-row.ts
git commit -m "feat(view): add rankingRow partial"
```

---

### Task 2.6: Create partials/candidate-card.ts

**Files:**
- Create: `src/main/modules/view/templates/partials/candidate-card.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/partials/candidate-card.ts
import { html } from '../lib/html.js';
import { skillTags } from './skill-tag.js';
import type { CandidateCard } from '../../gather-landing-data.js';

export function candidateCard(c: CandidateCard): string {
  return html`
    <div class="candidate-card">
      <dl class="kv">
        <dt>职级</dt><dd>${c.title_level ?? '—'}</dd>
        <dt>工作年限</dt><dd>${c.years_experience ?? '—'} 年</dd>
        <dt>薪资范围</dt><dd>${c.salary_range ?? '—'}</dd>
        <dt>学历</dt><dd>${c.education_tier ?? '—'}</dd>
      </dl>
      <div class="tags">${skillTags(c.skills, 6)}</div>
    </div>
  `;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/templates/partials/candidate-card.ts
git commit -m "feat(view): add candidateCard partial"
```

---

### Task 2.7: Create partials/job-card.ts

**Files:**
- Create: `src/main/modules/view/templates/partials/job-card.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/partials/job-card.ts
import { html } from '../lib/html.js';
import { skillTags } from './skill-tag.js';
import type { RecentJob } from '../../gather-landing-data.js';

function formatSalary(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—';
  if (min != null && max != null) return `${min / 10000}万 - ${max / 10000}万`;
  if (min != null) return `${min / 10000}万+`;
  return `≤ ${max! / 10000}万`;
}

export function jobCard(j: RecentJob): string {
  return html`
    <div class="job-card">
      <div class="job-title">${j.title}</div>
      <div class="job-meta">
        <span class="industry-tag">${j.industry ?? '—'}</span>
        <span class="salary">¥${formatSalary(j.salary_min, j.salary_max)}</span>
      </div>
      <div class="tags">${skillTags(j.required_skills, 6)}</div>
    </div>
  `;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/templates/partials/job-card.ts
git commit -m "feat(view): add jobCard partial"
```

---

## Phase 3: Template Layer

13 个子文件，按依赖顺序创建。

### Task 3.0: Delete old landing.ts

**Files:**
- Delete: `src/main/modules/view/templates/landing.ts`

- [ ] **Step 1: Delete file**

Run: `cd d:\dev\hunter-platform && rm src/main/modules/view/templates/landing.ts`
（Windows: `del src\main\modules\view\templates\landing.ts`）

- [ ] **Step 2: Verify typecheck still passes**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: 报错 "Cannot find module" — 这是预期的，因为 routes/landing.ts 还在 import
**继续 Task 3.1 后会解决**

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add -u src/main/modules/view/templates/landing.ts
git commit -m "chore(view): remove old landing.ts (replaced by landing/ dir)"
```

---

### Task 3.1: Create landing/layout.ts

**Files:**
- Create: `src/main/modules/view/templates/landing/layout.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/landing/layout.ts
import { html } from '../lib/html.js';
import { SHARED_CSS } from '../shared-css.js';
import { LANDING_CSS } from './landing.css.js';
import { LANDING_SCRIPT } from './landing.script.js';

export function layout(body: string): string {
  return html`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hunter Platform · 猎头中介 API 平台</title>
  <style>${SHARED_CSS}</style>
  <style>${LANDING_CSS}</style>
</head>
<body>
  ${body}
  ${LANDING_SCRIPT}
</body>
</html>
  `;
}
```

- [ ] **Step 2: Verify typecheck (expected to fail until landing.css.ts and landing.script.ts exist)**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: FAIL with "Cannot find module './landing.css.js'"
**继续后续 tasks 后会解决**

- [ ] **Step 3: Defer commit to end of Phase 3 (with all template files)**

> 注：单文件 commit 不便，先累积到最后。

---

### Task 3.2: Create landing/nav.ts

**Files:**
- Create: `src/main/modules/view/templates/landing/nav.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/landing/nav.ts
import { html } from '../lib/html.js';
import { statusBadge } from '../partials/status-badge.js';
import type { LandingData } from '../../gather-landing-data.js';

export function nav(data: LandingData): string {
  return html`
<header class="top-nav">
  <div class="nav-inner">
    <a class="brand" href="/">
      <span class="brand-mark">🔍</span>
      <span class="brand-name">Hunter Platform</span>
    </a>
    <div class="nav-status">${statusBadge(data.healthStatus, data.uptimePercent)}</div>
    <nav class="nav-links">
      <a href="#for-employers">🏢 雇主</a>
      <a href="#for-headhunters">🎯 猎头</a>
      <a href="#for-candidates">🔒 候选人</a>
      <a href="#rankings">🏆 榜单</a>
      <a href="/v1/skill.md" target="_blank" rel="noopener">📖 API</a>
      <a href="/v1/openapi.json" target="_blank" rel="noopener">📋 OpenAPI</a>
      <a href="/v1/health" target="_blank" rel="noopener">🏥 Health</a>
    </nav>
    <button type="button" class="copy-btn js-copy-btn" data-copy="${'/v1/skill.md'}">
      📋 复制 skill.md
    </button>
  </div>
</header>
  `;
}
```

- [ ] **Step 2: Defer typecheck to end of Phase 3**

---

### Task 3.3: Create landing/role-anchors.ts

**Files:**
- Create: `src/main/modules/view/templates/landing/role-anchors.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/landing/role-anchors.ts
import { html } from '../lib/html.js';

export function roleAnchors(): string {
  return html`
<nav class="role-anchors" aria-label="快速跳转">
  <a class="role-anchor js-role-anchor" href="#for-employers" data-target="for-employers">
    <span class="role-emoji">🏢</span><span>雇主</span>
  </a>
  <a class="role-anchor js-role-anchor" href="#for-headhunters" data-target="for-headhunters">
    <span class="role-emoji">🎯</span><span>猎头</span>
  </a>
  <a class="role-anchor js-role-anchor" href="#for-candidates" data-target="for-candidates">
    <span class="role-emoji">🔒</span><span>候选人</span>
  </a>
  <a class="role-anchor js-role-anchor" href="#rankings" data-target="rankings">
    <span class="role-emoji">🤖</span><span>Agent 开发者</span>
  </a>
</nav>
  `;
}
```

- [ ] **Step 2: Defer typecheck**

---

### Task 3.4: Create landing/hero.ts (with AGENT GATE)

**Files:**
- Create: `src/main/modules/view/templates/landing/hero.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/landing/hero.ts
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

export function hero(data: LandingData): string {
  return html`
<section class="hero">
  <h1>🔍 Hunter Platform</h1>
  <p class="tagline">
    <strong>猎头中介 API 平台</strong> · 候选人隐私受保护 · 4 步解锁协议 · 20% 平台抽佣
  </p>

  <div class="agent-gate">
    <div class="agent-gate-header">
      <span class="agent-gate-emoji">🤖</span>
      <span class="agent-gate-title">把链接发给 AI Agent 即可对接</span>
    </div>
    <ul class="agent-gate-list">
      <li>
        <code>GET /v1/skill.md</code>
        <button type="button" class="copy-btn js-copy-btn" data-copy="/v1/skill.md">📋 一键复制</button>
      </li>
      <li>
        <code>GET /v1/openapi.json</code>
        <a class="link-btn" href="/v1/openapi.json" target="_blank" rel="noopener">查看 OpenAPI</a>
      </li>
      <li>
        <code>GET /v1/health</code>
        <a class="link-btn" href="/v1/health" target="_blank" rel="noopener">查看状态</a>
      </li>
    </ul>
  </div>
</section>
  `;
}
```

- [ ] **Step 2: Defer typecheck**

---

### Task 3.5: Create landing/stats.ts

**Files:**
- Create: `src/main/modules/view/templates/landing/stats.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/landing/stats.ts
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

export function stats(data: LandingData): string {
  return html`
<div class="card hero-stats">
  <div class="stats-grid">
    <div class="stat">
      <div class="stat-icon">🔓</div>
      <div class="stat-value" data-target="${data.todayUnlocks}">${data.todayUnlocks}</div>
      <div class="stat-label">今日解锁</div>
    </div>
    <div class="stat">
      <div class="stat-icon">🎯</div>
      <div class="stat-value" data-target="${data.todayPlacements}">${data.todayPlacements}</div>
      <div class="stat-label">今日 placements</div>
    </div>
    <div class="stat">
      <div class="stat-icon">👥</div>
      <div class="stat-value" data-target="${data.totalCandidates}">${data.totalCandidates}</div>
      <div class="stat-label">活跃候选人</div>
    </div>
    <div class="stat">
      <div class="stat-icon">⚡</div>
      <div class="stat-value">${data.uptimePercent}<span class="unit">%</span></div>
      <div class="stat-label">API uptime<span class="pulse-dot"></span></div>
    </div>
  </div>
</div>
  `;
}
```

- [ ] **Step 2: Defer typecheck**

---

### Task 3.6: Create landing/rankings.ts (5 tab)

**Files:**
- Create: `src/main/modules/view/templates/landing/rankings.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/landing/rankings.ts
import { html } from '../lib/html.js';
import { rankingRow } from '../partials/ranking-row.js';
import { skillTag } from '../partials/skill-tag.js';
import type { LandingData } from '../../gather-landing-data.js';

function renderTopHeadhunters(data: LandingData): string {
  if (data.topHeadhunters.length === 0) return '<p class="meta">暂无猎头数据</p>';
  return data.topHeadhunters.map((h) =>
    rankingRow(h.rank, h.name, `reputation ${h.reputation}`, h.reputation)
  ).join('');
}

function renderTopEmployers(data: LandingData): string {
  if (data.topEmployers.length === 0) return '<p class="meta">暂无雇主数据</p>';
  return data.topEmployers.map((e, i) =>
    rankingRow(i + 1, e.name, `${e.recCount} 个推荐`, e.recCount)
  ).join('');
}

function renderTopIndustries(data: LandingData): string {
  if (data.topIndustries.length === 0) return '<p class="meta">暂无行业数据</p>';
  return data.topIndustries.map((ind, i) =>
    rankingRow(i + 1, ind.industry, `${ind.candCount} 个候选人`, ind.candCount)
  ).join('');
}

function renderLatestPlacements(data: LandingData): string {
  if (data.latestPlacements.length === 0) return '<p class="meta">暂无最近 placement 记录</p>';
  return data.latestPlacements.map((p) => `
    <div class="placement-row">
      <div class="placement-title">${p.title} <span class="industry-tag">${p.industry ?? '其他'}</span></div>
      <div class="placement-meta">
        <span class="placement-salary">¥${p.salaryText}</span>
        <span class="placement-hh">by ${p.headhunterName}</span>
        <span class="placement-time">${p.at}</span>
      </div>
    </div>
  `).join('');
}

function renderHotSkills(data: LandingData): string {
  if (data.hotSkills.length === 0) return '<p class="meta">暂无可统计的热门技能</p>';
  return `<div class="tags tags-block">${data.hotSkills.map((s) => skillTag(`${s.skill} (${s.count})`)).join('')}</div>`;
}

export function rankings(data: LandingData): string {
  return html`
<section class="card rankings" id="rankings">
  <h2><span class="accent-bar"></span>🏆 多维榜单</h2>
  <div class="ranking-tabs" role="tablist">
    <button class="ranking-tab js-ranking-tab active" data-tab="hunters" role="tab">Top 猎头</button>
    <button class="ranking-tab js-ranking-tab" data-tab="employers" role="tab">Top 雇主</button>
    <button class="ranking-tab js-ranking-tab" data-tab="industries" role="tab">Top 行业</button>
    <button class="ranking-tab js-ranking-tab" data-tab="placements" role="tab">成交</button>
    <button class="ranking-tab js-ranking-tab" data-tab="skills" role="tab">Hot Skills</button>
  </div>
  <div class="ranking-panels">
    <div class="ranking-panel js-ranking-panel active" data-panel="hunters">${renderTopHeadhunters(data)}</div>
    <div class="ranking-panel js-ranking-panel" data-panel="employers" hidden>${renderTopEmployers(data)}</div>
    <div class="ranking-panel js-ranking-panel" data-panel="industries" hidden>${renderTopIndustries(data)}</div>
    <div class="ranking-panel js-ranking-panel" data-panel="placements" hidden>${renderLatestPlacements(data)}</div>
    <div class="ranking-panel js-ranking-panel" data-panel="skills" hidden>${renderHotSkills(data)}</div>
  </div>
</section>
  `;
}
```

- [ ] **Step 2: Defer typecheck**

---

### Task 3.7: Create landing/employer-section.ts

**Files:**
- Create: `src/main/modules/view/templates/landing/employer-section.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/landing/employer-section.ts
import { html } from '../lib/html.js';
import { candidateCard } from '../partials/candidate-card.js';
import type { LandingData } from '../../gather-landing-data.js';

function renderBody(data: LandingData): string {
  if (data.publicCandidatesCount === 0) {
    return '<p class="meta">暂无公开候选人。<a href="/v1/skill.md">查看 skill.md</a> 了解如何注册 Agent。</p>';
  }
  return data.industryGroups.map((g) => `
    <div class="sub-card">
      <h3>▌${g.industry || '其他'} (${g.candidates.length} 人)</h3>
      ${g.candidates.slice(0, 3).map(candidateCard).join('')}
    </div>
  `).join('');
}

export function employerSection(data: LandingData): string {
  return html`
<section class="card" id="for-employers">
  <h2>
    <span class="accent-bar"></span>🏢 For Employers — 在招岗位: ${data.openJobsCount}
  </h2>
  <p>浏览脱敏候选人池 → Agent 调 <code>GET /v1/employer/talent</code></p>
  ${renderBody(data)}
</section>
  `;
}
```

- [ ] **Step 2: Defer typecheck**

---

### Task 3.8: Create landing/headhunter-section.ts

**Files:**
- Create: `src/main/modules/view/templates/landing/headhunter-section.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/landing/headhunter-section.ts
import { html } from '../lib/html.js';
import { jobCard } from '../partials/job-card.js';
import type { LandingData } from '../../gather-landing-data.js';

function renderBody(data: LandingData): string {
  if (data.recentJobs.length === 0) return '<p>暂无开放岗位。</p>';
  return `
    <div class="sub-card">
      <h3>▌最近 ${data.recentJobs.length} 个开放岗位</h3>
      ${data.recentJobs.map(jobCard).join('')}
    </div>
  `;
}

export function headhunterSection(data: LandingData): string {
  return html`
<section class="card" id="for-headhunters">
  <h2>
    <span class="accent-bar"></span>🎯 For Headhunters — 今日可推荐: ${data.openJobsCount} 个开放岗位
  </h2>
  <p>上传候选人脱敏入库 → Agent 调 <code>POST /v1/headhunter/candidates</code></p>
  ${renderBody(data)}
</section>
  `;
}
```

- [ ] **Step 2: Defer typecheck**

---

### Task 3.9: Create landing/candidate-section.ts

**Files:**
- Create: `src/main/modules/view/templates/landing/candidate-section.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/landing/candidate-section.ts
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

export function candidateSection(data: LandingData): string {
  const activeProUsers = data.activeEmployerCount + data.activeHeadhunterCount;
  return html`
<section class="card" id="for-candidates">
  <h2>
    <span class="accent-bar"></span>🔒 For Candidates — 当前活跃 ${activeProUsers} 位专业用户
  </h2>
  <p>你的 PII 加密存储，只有你授权解锁后才能被对方看到</p>
  <div class="timeline">
    <div class="timeline-item done">
      <strong>1. 猎头上传时自动脱敏</strong> — industry / title_level / salary_range
    </div>
    <div class="timeline-item done">
      <strong>2. 雇主浏览只看到脱敏数据</strong> — 真实联系方式永远不可见
    </div>
    <div class="timeline-item done">
      <strong>3. 雇主表达兴趣时通知候选人</strong> — webhook 推送 + Agent 查询
    </div>
    <div class="timeline-item current">
      <strong>4. 候选人授权后才解锁联系方式</strong> — 你完全控制
    </div>
  </div>
</section>
  `;
}
```

- [ ] **Step 2: Defer typecheck**

---

### Task 3.10: Create landing/footer.ts

**Files:**
- Create: `src/main/modules/view/templates/landing/footer.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/landing/footer.ts
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

export function footer(data: LandingData): string {
  return html`
<footer class="site-footer">
  <div class="footer-links">
    <a href="/v1/skill.md" target="_blank" rel="noopener">📖 skill.md</a>
    <a href="/v1/openapi.json" target="_blank" rel="noopener">📋 OpenAPI</a>
    <a href="/v1/health" target="_blank" rel="noopener">🏥 Health</a>
    <a href="/metrics" target="_blank" rel="noopener">📊 Metrics</a>
  </div>
  <p class="footer-brand">Made with care for Agents 🤖</p>
  <p class="meta footer-time">数据更新于 ${data.serverTime} · 调用 <code>/v1/health</code> 查看实时状态</p>
</footer>
  `;
}
```

- [ ] **Step 2: Defer typecheck**

---

### Task 3.11: Create landing/landing.css.ts

**Files:**
- Create: `src/main/modules/view/templates/landing/landing.css.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/landing/landing.css.ts

export const LANDING_CSS = `
:root {
  --brand-primary: #14b8a6;
  --brand-light: #5eead4;
  --brand-dark: #0f766e;
  --accent-warm: #f59e0b;
  --text-primary: #0f172a;
  --text-muted: #64748b;
  --bg-page: #f8fafc;
  --bg-card: #ffffff;
  --border: #e2e8f0;
  --shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  --shadow-hover: 0 12px 28px rgba(15, 23, 42, 0.12);
  --nav-height: 64px;
}
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  margin: 0; padding: 0;
  background: linear-gradient(180deg, #ecfeff 0%, var(--bg-page) 60%);
  background-attachment: fixed;
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
}
main { max-width: 880px; margin: 0 auto; padding: 24px; }

/* Top nav */
.top-nav {
  position: sticky; top: 0; z-index: 100;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: saturate(180%) blur(8px);
  -webkit-backdrop-filter: saturate(180%) blur(8px);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}
.nav-inner {
  max-width: 880px; margin: 0 auto;
  display: flex; align-items: center; gap: 16px;
  padding: 12px 24px; min-height: var(--nav-height);
  flex-wrap: wrap;
}
.brand { display: flex; align-items: center; gap: 8px; text-decoration: none; color: var(--brand-dark); font-weight: 700; font-size: 18px; }
.brand-mark { font-size: 24px; }
.status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: white; border: 1px solid var(--border); border-radius: 20px; font-size: 13px; font-weight: 600; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; animation: pulse 1.5s ease-in-out infinite; }
.unit { font-size: 0.7em; opacity: 0.7; }
.nav-links { display: flex; gap: 12px; flex: 1; flex-wrap: wrap; }
.nav-links a { text-decoration: none; color: var(--text-muted); font-size: 13px; padding: 4px 8px; border-radius: 4px; transition: all 0.2s; }
.nav-links a:hover { color: var(--brand-dark); background: rgba(20, 184, 166, 0.08); }
.copy-btn {
  padding: 6px 14px; background: var(--brand-primary); color: white;
  border: none; border-radius: 6px; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.2s;
}
.copy-btn:hover { background: var(--brand-dark); transform: translateY(-1px); }
.copy-btn.copied { background: #22c55e; }

/* Role anchors */
.role-anchors {
  display: flex; gap: 12px; justify-content: center;
  padding: 20px 24px; background: white;
  border-bottom: 1px solid var(--border);
  position: sticky; top: var(--nav-height); z-index: 99;
}
.role-anchor {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 16px; background: var(--bg-page);
  border: 1px solid var(--border); border-radius: 20px;
  text-decoration: none; color: var(--text-primary);
  font-size: 14px; font-weight: 500;
  transition: all 0.2s;
}
.role-anchor:hover { background: var(--brand-light); color: var(--brand-dark); border-color: var(--brand-primary); transform: translateY(-1px); }
.role-anchor.active { background: var(--brand-primary); color: white; border-color: var(--brand-primary); }
.role-emoji { font-size: 18px; }

/* Hero */
.hero { text-align: center; padding: 48px 24px 32px; margin-bottom: 24px; animation: fadeInUp 0.6s ease-out; }
.hero h1 { font-size: 48px; margin: 0 0 12px; background: linear-gradient(135deg, var(--brand-dark), var(--brand-primary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.hero .tagline { font-size: 16px; color: var(--text-muted); margin: 0 0 24px; }

/* Agent Gate */
.agent-gate {
  max-width: 640px; margin: 0 auto;
  background: linear-gradient(135deg, #f0fdfa 0%, #ffffff 100%);
  border: 2px solid var(--brand-light);
  border-radius: 12px; padding: 20px 24px;
  text-align: left;
}
.agent-gate-header { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; color: var(--brand-dark); margin-bottom: 12px; }
.agent-gate-emoji { font-size: 24px; }
.agent-gate-list { list-style: none; padding: 0; margin: 0; }
.agent-gate-list li { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.agent-gate-list li:last-child { border-bottom: none; }
.agent-gate-list code { flex: 1; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 14px; color: var(--text-primary); }
.link-btn { padding: 4px 10px; background: white; border: 1px solid var(--brand-primary); color: var(--brand-dark); text-decoration: none; border-radius: 4px; font-size: 13px; }
.link-btn:hover { background: var(--brand-light); }

/* Cards */
.card { background: var(--bg-card); border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: var(--shadow); transition: all 0.3s; animation: fadeInUp 0.6s ease-out backwards; }
.card:hover { box-shadow: var(--shadow-hover); }
.card h2 { margin-top: 0; display: flex; align-items: center; gap: 12px; font-size: 20px; }
.card h3 { font-size: 16px; color: var(--brand-dark); margin: 16px 0 12px; }
.accent-bar { display: inline-block; width: 4px; height: 20px; background: var(--brand-primary); border-radius: 2px; }
.hero-stats { background: linear-gradient(135deg, #f0fdfa 0%, #ffffff 100%); border: 1px solid var(--brand-light); }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; text-align: center; }
.stat { padding: 16px; border-radius: 8px; transition: all 0.2s; }
.stat:hover { background: rgba(20, 184, 166, 0.06); transform: translateY(-2px); }
.stat-icon { font-size: 32px; margin-bottom: 8px; }
.stat-value { font-size: 36px; font-weight: 700; color: var(--brand-dark); margin-bottom: 4px; font-variant-numeric: tabular-nums; }
.stat-label { font-size: 13px; color: var(--text-muted); }
.pulse-dot { display: inline-block; width: 6px; height: 6px; background: #22c55e; border-radius: 50%; margin-left: 6px; vertical-align: middle; animation: pulse 1.5s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.3); } }

/* Rankings */
.ranking-tabs { display: flex; gap: 4px; border-bottom: 2px solid var(--border); margin-bottom: 16px; overflow-x: auto; }
.ranking-tab { background: none; border: none; padding: 10px 16px; font-size: 14px; color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.2s; white-space: nowrap; }
.ranking-tab:hover { color: var(--brand-dark); }
.ranking-tab.active { color: var(--brand-dark); border-bottom-color: var(--brand-primary); font-weight: 600; }
.ranking-panel[hidden] { display: none; }

/* Ranking rows */
.ranking-row { display: flex; align-items: center; gap: 16px; padding: 12px 16px; border-radius: 8px; margin: 8px 0; transition: all 0.2s; }
.ranking-row:hover { background: rgba(20, 184, 166, 0.06); transform: translateX(4px); }
.ranking-medal { font-size: 28px; min-width: 36px; text-align: center; }
.ranking-info { flex: 1; }
.ranking-name { font-weight: 600; font-size: 16px; }
.ranking-meta { font-size: 13px; color: var(--text-muted); }
.ranking-rep { font-size: 20px; font-weight: 700; color: var(--brand-dark); font-variant-numeric: tabular-nums; }

/* Placements */
.placement-row { padding: 12px 0; border-bottom: 1px solid var(--border); transition: all 0.2s; }
.placement-row:last-child { border-bottom: none; }
.placement-row:hover { background: rgba(20, 184, 166, 0.04); padding-left: 8px; }
.placement-title { font-weight: 600; margin-bottom: 4px; }
.industry-tag { display: inline-block; background: var(--brand-light); color: var(--brand-dark); padding: 2px 8px; border-radius: 10px; font-size: 12px; margin-left: 8px; }
.placement-meta { font-size: 13px; color: var(--text-muted); display: flex; gap: 16px; flex-wrap: wrap; }
.placement-salary { color: var(--accent-warm); font-weight: 600; }

/* Sub-cards */
.sub-card { background: var(--bg-page); border-radius: 8px; padding: 16px; margin: 12px 0; }
.candidate-card, .job-card { background: white; border-radius: 6px; padding: 12px 16px; margin: 8px 0; border: 1px solid var(--border); }
.kv { display: grid; grid-template-columns: 100px 1fr; gap: 4px 16px; margin: 8px 0; font-size: 14px; }
.kv dt { color: var(--text-muted); }
.kv dd { margin: 0; font-weight: 500; }
.tags { margin-top: 8px; }
.tags-block { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { display: inline-block; background: #f1f5f9; padding: 2px 10px; border-radius: 10px; font-size: 12px; margin: 2px; color: var(--text-muted); }
.tag.skill { background: #dbeafe; color: #1e40af; }

/* Timeline */
.timeline { padding-left: 24px; position: relative; margin-top: 16px; }
.timeline::before { content: ''; position: absolute; left: 6px; top: 8px; bottom: 8px; width: 2px; background: var(--brand-light); }
.timeline-item { position: relative; margin-bottom: 12px; font-size: 14px; }
.timeline-item::before { content: ''; position: absolute; left: -22px; top: 6px; width: 12px; height: 12px; border-radius: 50%; background: var(--brand-primary); border: 2px solid white; box-shadow: 0 0 0 1px var(--brand-light); }
.timeline-item.done::before { background: #22c55e; }
.timeline-item.current::before { background: var(--accent-warm); animation: pulse 1.5s ease-in-out infinite; }

/* Footer */
.site-footer { background: var(--bg-page); border-top: 1px solid var(--border); padding: 32px 24px; text-align: center; margin-top: 40px; }
.footer-links { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin-bottom: 16px; }
.footer-links a { text-decoration: none; color: var(--brand-dark); font-size: 14px; }
.footer-links a:hover { text-decoration: underline; }
.footer-brand { font-size: 14px; color: var(--text-muted); margin: 8px 0; }
.footer-time { font-size: 12px; }

.meta { color: var(--text-muted); font-size: 13px; }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

@media (max-width: 640px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .hero h1 { font-size: 36px; }
  .nav-links { gap: 8px; }
  .role-anchors { gap: 6px; padding: 12px; }
  .role-anchor { padding: 6px 10px; font-size: 13px; }
}
`.trim();
```

- [ ] **Step 2: Defer typecheck**

---

### Task 3.12: Create landing/landing.script.ts

**Files:**
- Create: `src/main/modules/view/templates/landing/landing.script.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/landing/landing.script.ts

export const LANDING_SCRIPT = `
<script>
(function() {
  // 1) Copy buttons: copy URL to clipboard
  document.querySelectorAll('.js-copy-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var path = btn.getAttribute('data-copy') || '/v1/skill.md';
      var url = window.location.origin + path;
      var original = btn.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() {
          btn.textContent = '✓ 已复制';
          btn.classList.add('copied');
          setTimeout(function() { btn.textContent = original; btn.classList.remove('copied'); }, 2000);
        }).catch(function() {
          btn.textContent = '复制失败，请手动复制';
          setTimeout(function() { btn.textContent = original; }, 2000);
        });
      } else {
        // Fallback: select-and-copy via textarea
        var ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); btn.textContent = '✓ 已复制'; }
        catch (e) { btn.textContent = '复制失败，请手动复制'; }
        document.body.removeChild(ta);
        setTimeout(function() { btn.textContent = original; }, 2000);
      }
    });
  });

  // 2) Ranking tabs
  function activateTab(tabName) {
    document.querySelectorAll('.js-ranking-tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
    });
    document.querySelectorAll('.js-ranking-panel').forEach(function(p) {
      var match = p.getAttribute('data-panel') === tabName;
      p.classList.toggle('active', match);
      if (match) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    });
    if (history.replaceState) {
      history.replaceState(null, '', '#ranking=' + tabName);
    }
  }
  document.querySelectorAll('.js-ranking-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      activateTab(tab.getAttribute('data-tab'));
    });
  });
  // Restore from URL hash on load
  if (location.hash && location.hash.indexOf('ranking=') === 1) {
    var tabName = location.hash.split('ranking=')[1];
    if (tabName) activateTab(tabName);
  }

  // 3) Role anchor smooth scroll
  document.querySelectorAll('.js-role-anchor').forEach(function(a) {
    a.addEventListener('click', function(e) {
      e.preventDefault();
      var targetId = a.getAttribute('data-target');
      var target = document.getElementById(targetId);
      if (target) {
        var navH = 64;
        var y = target.getBoundingClientRect().top + window.pageYOffset - navH - 8;
        window.scrollTo({ top: y, behavior: 'smooth' });
        if (history.pushState) history.pushState(null, '', '#' + targetId);
      }
    });
  });

  // 4) Sticky-nav section highlight
  if ('IntersectionObserver' in window) {
    var sections = ['for-employers', 'for-headhunters', 'for-candidates', 'rankings']
      .map(function(id) { return document.getElementById(id); })
      .filter(Boolean);
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          var id = entry.target.id;
          document.querySelectorAll('.js-role-anchor').forEach(function(a) {
            a.classList.toggle('active', a.getAttribute('data-target') === id);
          });
        }
      });
    }, { rootMargin: '-100px 0px -50% 0px' });
    sections.forEach(function(s) { observer.observe(s); });
  }

  // 5) CountUp animation (existing v2 feature)
  function countUp(el, target, duration) {
    var start = 0;
    var startTime = performance.now();
    function tick(now) {
      var elapsed = now - startTime;
      var progress = Math.min(elapsed / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(start + (target - start) * eased);
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = target;
    }
    requestAnimationFrame(tick);
  }
  document.querySelectorAll('.stat-value[data-target]').forEach(function(el) {
    var target = parseInt(el.getAttribute('data-target'), 10) || 0;
    if (target > 0) countUp(el, target, 1500);
  });
})();
</script>
<noscript><style>.card { animation: none !important; }</style></noscript>
`.trim();
```

- [ ] **Step 2: Defer typecheck**

---

### Task 3.13: Create landing/index.ts (组合入口)

**Files:**
- Create: `src/main/modules/view/templates/landing/index.ts`

- [ ] **Step 1: Create file**

```typescript
// src/main/modules/view/templates/landing/index.ts
import { html } from '../lib/html.js';
import { layout } from './layout.js';
import { nav } from './nav.js';
import { roleAnchors } from './role-anchors.js';
import { hero } from './hero.js';
import { stats } from './stats.js';
import { rankings } from './rankings.js';
import { employerSection } from './employer-section.js';
import { headhunterSection } from './headhunter-section.js';
import { candidateSection } from './candidate-section.js';
import { footer } from './footer.js';
import type { LandingData } from '../../gather-landing-data.js';

export function renderLanding(data: LandingData): string {
  return layout(html`
    <main>
      ${nav(data)}
      ${roleAnchors()}
      ${hero(data)}
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

- [ ] **Step 2: Verify typecheck passes**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: PASS (all 13 files now in place, imports resolve)

- [ ] **Step 3: Commit all Phase 3 files**

```bash
cd d:\dev\hunter-platform
git add src/main/modules/view/templates/landing/
git commit -m "feat(view): add landing/ subdirectory with 13 template files"
```

---

## Phase 4: Route Layer

### Task 4.1: Slim routes/landing.ts to thin shell

**Files:**
- Modify: `src/main/routes/landing.ts`

- [ ] **Step 1: Replace file contents**

```typescript
// src/main/routes/landing.ts
import { Router, type Request, type Response } from 'express';
import type { DB } from '../db/connection.js';
import { gatherLandingData } from '../modules/view/gather-landing-data.js';
import { renderLanding } from '../modules/view/templates/landing/index.js';

const FALLBACK_HTML = `<!DOCTYPE html><html lang="zh-CN"><body><main><h1>Hunter Platform</h1><p>暂不可用</p></main></body></html>`;

export function createLandingRouter(db: DB): Router {
  const router = Router();

  // GET / — public marketplace landing page (no auth, no quota)
  router.get('/', (_req: Request, res: Response) => {
    try {
      const data = gatherLandingData(db);
      const html = renderLanding(data);
      res.status(200).type('text/html; charset=utf-8').send(html);
    } catch (e) {
      console.error('Landing render failed:', e);
      res.status(500).type('text/html; charset=utf-8').send(FALLBACK_HTML);
    }
  });

  return router;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run existing landing test to ensure no regression**

Run: `cd d:\dev\hunter-platform && pnpm test tests/integration/landing.test.ts`
Expected: PASS (existing test should still pass with new render)

- [ ] **Step 4: Commit**

```bash
cd d:\dev\hunter-platform
git add src/main/routes/landing.ts
git commit -m "refactor(view): slim routes/landing.ts to thin shell"
```

---

## Phase 5: Tests & Wrap

### Task 5.1: Write integration test for v3 features

**Files:**
- Create: `tests/integration/landing-v3.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/integration/landing-v3.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET / - v3 features', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('renders sticky top nav', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('class="top-nav"');
    expect(res.text).toContain('Hunter Platform');
  });

  it('renders status badge with HEALTHY label', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('HEALTHY');
    expect(res.text).toContain('99.9');
  });

  it('renders 4 role anchors', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('for-employers');
    expect(res.text).toContain('for-headhunters');
    expect(res.text).toContain('for-candidates');
    expect(res.text).toContain('rankings');
  });

  it('renders AGENT GATE with copy button', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('class="agent-gate"');
    expect(res.text).toContain('/v1/skill.md');
    expect(res.text).toContain('js-copy-btn');
  });

  it('renders 5 ranking tabs', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('Top 猎头');
    expect(res.text).toContain('Top 雇主');
    expect(res.text).toContain('Top 行业');
    expect(res.text).toContain('成交');
    expect(res.text).toContain('Hot Skills');
  });

  it('renders footer with skill.md + openapi + health links', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('class="site-footer"');
    expect(res.text).toContain('Made with care for Agents');
  });

  it('does not leak PII (emails, user IDs)', async () => {
    const app = createApp();
    await request(app).post('/v1/auth/register').send({
      user_type: 'employer', name: 'PII Test', contact: 'leak@private.com',
    });
    const res = await request(app).get('/');
    expect(res.text).not.toContain('leak@private.com');
    expect(res.text).not.toMatch(/user_[a-f0-9]{12}/);
  });

  it('handles empty DB gracefully', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Hunter Platform');
  });
});
```

- [ ] **Step 2: Run new test**

Run: `cd d:\dev\hunter-platform && pnpm test tests/integration/landing-v3.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd d:\dev\hunter-platform
git add tests/integration/landing-v3.test.ts
git commit -m "test(view): add v3 integration tests for landing page"
```

---

### Task 5.2: Run full typecheck and test suite

**Files:** (none)

- [ ] **Step 1: Run typecheck**

Run: `cd d:\dev\hunter-platform && pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `cd d:\dev\hunter-platform && pnpm test`
Expected: PASS (all existing + new tests)

- [ ] **Step 3: Manual smoke test**

Run:
```bash
cd d:\dev\hunter-platform
pnpm dev &
sleep 5
curl -s http://localhost:3000/ | head -50
```

Expected:
- HTML response
- Contains "Hunter Platform", "AGENT GATE", "Top 猎头", "Made with care for Agents"

- [ ] **Step 4: Kill dev server**

Run: `taskkill /F /IM node.exe`（Windows）
或用 Ctrl+C 终止后台进程

---

### Task 5.3: Final cleanup

**Files:**
- Possibly delete: `src/main/modules/view/templates/landing.ts` (if not already deleted in Task 3.0)

- [ ] **Step 1: Verify old file is deleted**

Run: `dir d:\dev\hunter-platform\src\main\modules\view\templates\landing.ts`
Expected: "File Not Found"

- [ ] **Step 2: Verify final file structure**

Run: `dir d:\dev\hunter-platform\src\main\modules\view\templates\landing /S`
Expected: 13 files listed (index, layout, nav, role-anchors, hero, stats, rankings, employer-section, headhunter-section, candidate-section, footer, landing.css, landing.script)

- [ ] **Step 3: Verify all commits are in place**

Run: `cd d:\dev\hunter-platform && git log --oneline -20`
Expected: at least 13 commits, one per task (some tasks deferred commit to phase end)

- [ ] **Step 4: Final commit if any uncommitted changes**

```bash
cd d:\dev\hunter-platform
git status
# if any uncommitted, then:
git add -A
git commit -m "chore(view): landing v3 final cleanup"
```

---

## Self-Review (执行前核对清单)

执行者在每个 Phase 完成时，自查以下：

1. **Spec 覆盖**:
   - [ ] §1.3 目标 1 (sticky nav) → Task 3.2
   - [ ] §1.3 目标 2 (role 锚点) → Task 3.3
   - [ ] §1.3 目标 3 (AGENT GATE) → Task 3.4
   - [ ] §1.3 目标 4 (5 维榜单) → Task 3.6
   - [ ] §1.3 目标 5 (footer) → Task 3.10
   - [ ] §1.3 目标 6 (代码组织) → Phase 1-3 全部
   - [ ] §1.3 目标 7 (SSR HTML 不变) → Phase 4 路由层
   - [ ] §3.2 SQL 1 (Top 雇主) → Task 1.3
   - [ ] §3.2 SQL 2 (Top 行业) → Task 1.4
   - [ ] §3.2 SQL 3 (Hot Skills) → Task 1.5
   - [ ] §3.2 SQL 4 (DB 探活) → Task 1.6
   - [ ] §6 错误处理 (整体) → Task 4.1 薄壳 + 兜底
   - [ ] §7 测试 (unit + integration) → Phase 1 + 2 + 5.1

2. **占位符检查**: 全文搜索 `TBD` / `TODO` / `FIXME` / `???` → 0 匹配

3. **类型一致性**:
   - `LandingData` 在 Task 1.1 定义，在 Task 1.2-1.6 + Phase 3 各处引用，字段名一致
   - `EmployerRanking` / `IndustryRanking` / `SkillCount` / `HealthStatus` 在 Task 1.1 定义、1.3-1.6 实现、Phase 3 引用，名称一致
   - `formatSalary` 在 Task 2.7 (job-card.ts) 定义，Phase 3 employer-section 不重复定义

4. **回滚路径**:
   - 每个 task 都是独立 commit，`git revert <hash>` 可回滚
   - 关键节点（Phase 结束）有专门 commit，rollback 粒度可控
