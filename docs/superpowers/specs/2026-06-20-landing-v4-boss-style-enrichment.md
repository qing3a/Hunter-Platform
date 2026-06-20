# Landing v4 — Boss 风格内容增量

**状态**: Draft
**日期**: 2026-06-20
**作者**: brainstorming session
**前置**: [2026-06-20-landing-v3-redesign.md](./2026-06-20-landing-v3-redesign.md)（v3 已落地，2026-06-20 18:41 commit）
**触发**: v3 已完成主结构（sticky nav / Hero / Stats / Rankings / 3 角色 Section / Footer），用户对 Hero 之后的"机会密度"仍不满意，要求按 Boss 直聘的"职位分类 + 精选职位 + 热门企业"模式在 Hero 之后追加 3 个新区块

---

## 1. 概述

### 1.1 一句话定义

在 v3 首页的 **Hero 之后、Stats 之前** 插入 3 个新区块：**职位分类导航 / 精选热招职位 / 热门企业**。零结构改动，零数据库字段改动，仅复用 `jobs` 和 `users` 现有数据 + 3 个新 SQL。

### 1.2 触发原因

- v3 落地后首页结构已完整，但用户对"首页没有给三类用户（候选人/猎头/雇主）强烈的"这里有真东西"的感觉" 仍不满意
- 参考 Boss 直聘首页前 3 屏：职位分类导航 → 精选职位 → 热门企业 —— 都是"**用真实数据填满首屏**"的钩子
- v3 的 Hero 是"**平台介绍**"，Stats 是"**运营数据**"，Rankings 是"**平台榜单**" —— 都属于"平台的视角"
- 缺的是"**用户视角的数据**"：候选人在找什么工作？哪些公司在招人？

### 1.3 目标

1. **职位分类导航**：4-5 行 × 4-5 列的网格，每格 = 行业名 + 岗位数，**纯聚合数据**，不依赖新字段
2. **精选/热招职位**：10 张大卡，每张含 **标题 / 薪资 / 行业 / 优先级徽章 / 技能标签 / 公司名**（JOIN users 取公司名）
3. **热门企业**：3-4 张大卡，每张含 **公司名 / open jobs 总数 / 该公司的 3 个最新岗位**

### 1.4 非目标（重要！）

- ❌ **不**加任何数据库字段（用户已明确拒绝，理由："增加当前版本复杂性"）
- ❌ **不**改 Stats / Rankings / For XXX / Footer 任何一行
- ❌ **不**改 nav / role-anchors / hero 任何一行
- ❌ **不**改业务 API 任何一行
- ❌ **不**做搜索/筛选/排序交互（点 "互联网/AI" 不会跳到过滤结果页）
- ❌ **不**做"地点/经验/学历"显示（jobs 表里没有这些字段，**不补**）
- ❌ **不**做 Logo / 公司规模 / 融资状态（users 表里没有这些字段，**不补**）
- ❌ **不**改 view_url 注入逻辑（v3 已完整，本次不涉及）
- ❌ **不**做国际化 / 暗色模式 / 移动端汉堡菜单
- ❌ **不**做实时刷新

---

## 2. 视觉设计

### 2.1 插入位置（页面垂直流）

```
┌─ nav ─────────────────────────────┐  ← v3, 不动
├─ role-anchors ────────────────────┤  ← v3, 不动
├─ hero ────────────────────────────┤  ← v3, 不动
│
├─ 🆕 职位分类导航 (本 spec) ──────┤  ← 新增
├─ 🆕 精选/热招职位 (本 spec) ─────┤  ← 新增
├─ 🆕 热门企业 (本 spec) ─────────┤  ← 新增
│
├─ stats ───────────────────────────┤  ← v3, 不动
├─ rankings ────────────────────────┤  ← v3, 不动
├─ for-employers ───────────────────┤  ← v3, 不动
├─ for-headhunters ─────────────────┤  ← v3, 不动
├─ for-candidates ──────────────────┤  ← v3, 不动
└─ footer ──────────────────────────┘  ← v3, 不动
```

### 2.2 模块 1：职位分类导航

**布局**：
```
┌─ 4-5 行 × 4-5 列网格 (CSS Grid, 响应式自适应) ──────┐
│  🏢 互联网/AI    │  🏢 金融       │  🏢 医疗     │...│
│     3 个岗位      │    1 个岗位     │    2 个岗位   │   │
│  🏢 教育         │  🏢 制造       │  🏢 销售     │...│
│     5 个岗位      │    2 个岗位     │    4 个岗位   │   │
│  ...                                                  │
└────────────────────────────────────────────────────────┘
```

- **不分组**（不像 Boss 按"互联网/AI / 产品 / 销售"那种 5×N 的子分类 —— 因为 `jobs.industry` 只有一级）
- 每格：行业名 + 该行业的 open jobs 数
- 上限：20 个行业（按 open jobs 数倒序）
- 空态：`暂无分类数据`（当 openJobsCount = 0 时显示）

### 2.3 模块 2：精选/热招职位

**布局**：
```
┌─ 5 行 × 2 列 = 10 张卡片 ─────────────────────────┐
│  [急]            ¥15-25万                          │
│  📋 高级 Java 工程师                                │
│  🏢 杭州某科技公司 · 互联网/AI                       │
│  [Java] [Spring] [Redis] [Kafka] [MySQL] [+]       │
├────────────────────────────────────────────────────┤
│  ¥12-18万                                          │
│  📋 前端架构师                                      │
│  🏢 杭州某科技公司 · 互联网/AI                       │
│  [React] [Vue] [TypeScript] [Webpack] [+]         │
├────────────────────────────────────────────────────┤
│  ... (8 more)                                      │
└────────────────────────────────────────────────────┘
```

- **卡片字段**：
  - `priority` 徽章：`urgent` → 红色 "急"；`high` → 橙色 "热"；`normal` → 不显示
  - 薪资：`salary_min/10000 万 - salary_max/10000 万`（沿用 `formatSalary`）
  - 标题：`title`
  - 公司名：`users.name` (LEFT JOIN)
  - 行业：`industry`
  - 技能标签：`required_skills` (top 6，沿用 `skillTags` partial)
- **排序**：`priority` 升序（urgent → high → normal → low），同优先级内 `created_at` 降序
- **过滤**：`status='open' AND employer_id IS NOT NULL`（v3 的 `recentJobs` 也是这个过滤；猎头未认领的 job 不显示在公司列表里）
- **空态**：`暂无开放岗位。Agent 可调 POST /v1/headhunter/jobs 创建`
- **"查看更多"** 链接：MVP 不做（不跳到分页列表），但保留 DOM 钩子（`data-feature="see-more-featured-jobs"`，未来启用）

### 2.4 模块 3：热门企业

**布局**：
```
┌─ 0-4 张大卡（桌面 3 列 / 平板 2 列 / 移动 1 列）──┐
│  🏢 杭州某科技公司                                │
│     12 个开放岗位                                 │
│                                                  │
│     ▸ 高级 Java 工程师       ¥15-25万            │
│     ▸ 前端架构师             ¥20-30万            │
│     ▸ 产品经理               ¥12-18万            │
│     查看更多 → (MVP 不做)                        │
├──────────────────────────────────────────────────┤
│  ... (1-3 more)                                  │
└──────────────────────────────────────────────────┘
```

- **卡片字段**：
  - 公司名：`users.name`
  - open jobs 总数：聚合查询得到
  - 3 个最新岗位：每条 title + salary（最小数据）
- **排序**：open jobs 数倒序，取前 3-4 个
- **空态**：`暂无热门企业`
- **"查看更多 →"** 链接：MVP 不做（不跳到分页列表）

### 2.5 视觉风格（沿用 v3，不变）

- 主色：teal-500 (#14b8a6)
- 强调色：amber-500（用于"急"徽章）
- 字体、间距、圆角、阴影：沿用 v3 的 `.card` / `.sub-card` / `.job-card` 样式族
- 行业名 / 标题 / 公司名：走 `esc()` 防 XSS

### 2.6 响应式

- 桌面（≥ 1024px）：职位分类 5 列 / 精选职位 2 列 / 热门企业 3 列
- 平板（768-1023px）：职位分类 4 列 / 精选职位 2 列 / 热门企业 2 列
- 移动端（< 768px）：职位分类 2 列 / 精选职位 1 列 / 热门企业 1 列
- CSS Grid `repeat(auto-fill, minmax(180px, 1fr))` + media query

---

## 3. 数据来源

### 3.1 复用现有数据

- `jobs` 表：`id, employer_id, title, salary_min, salary_max, status, priority, industry, required_skills_json, created_at`（全部已存在）
- `users` 表：`id, name, user_type, status`（全部已存在，**`name` 已是公司名/雇主名**）

### 3.2 新增 3 个 SQL（全部在 `gather-landing-data.ts` 内）

**SQL A：行业聚合（用于"职位分类导航"）**
```sql
SELECT industry, COUNT(*) as job_count
FROM jobs
WHERE status = 'open' AND industry IS NOT NULL
GROUP BY industry
ORDER BY job_count DESC
LIMIT 20;
```

**SQL B：精选职位（用于"精选/热招职位"）**
```sql
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
LIMIT 10;
```

**SQL C：热门企业（用于"热门企业"卡片）**

主查询：取 open jobs 最多的前 4 个雇主
```sql
SELECT u.id, u.name, COUNT(j.id) AS open_job_count
FROM users u
INNER JOIN jobs j ON j.employer_id = u.id
WHERE u.user_type = 'employer'
  AND u.status = 'active'
  AND j.status = 'open'
GROUP BY u.id
ORDER BY open_job_count DESC
LIMIT 4;
```

子查询：对每个热门企业，取其 open jobs 中 created_at 最新的 3 条
```sql
SELECT j.title, j.salary_min, j.salary_max, j.employer_id
FROM jobs j
WHERE j.employer_id = ? AND j.status = 'open'
ORDER BY j.created_at DESC
LIMIT 3;
```

> **实现选择**：3.2 SQL C 的子查询可以用单条 SQL + `IN (subquery)` 一次拿全；MVP 选择**主查询一次 → N 次子查询（N≤4）**，原因是：
> - N 最多 4，每条 LIMIT 3，N+1 模式数据量 < 20 行
> - 避免复杂 SQL
> - 项目内已有 N+1 模式（v3 `industryGroups` 也是 N+1）
> - 性能不构成瓶颈

### 3.3 新增 TS 类型

```typescript
// src/main/modules/view/gather-landing-data.ts

export interface IndustryNavItem {
  industry: string;       // 行业名（已非空）
  jobCount: number;       // 该行业 open job 数
}

export interface FeaturedJob {
  id: string;
  title: string;
  industry: string | null;
  salary_min: number | null;
  salary_max: number | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  required_skills: string[];   // safeParseSkills 处理
  company_name: string | null;  // LEFT JOIN users.name, 可能为 NULL
  created_at: string;
}

export interface HotCompany {
  id: string;
  name: string;
  openJobCount: number;
  recentJobs: Array<{      // 该公司的最新 3 个 open job
    title: string;
    salary_min: number | null;
    salary_max: number | null;
  }>;
}

// LandingData 新增字段：
//   industryNav: IndustryNavItem[]   // SQL A
//   featuredJobs: FeaturedJob[]      // SQL B
//   hotCompanies: HotCompany[]       // SQL C
```

### 3.4 不动的数据接口

- `LandingData` 的所有现有字段保持原样
- `routes/landing.ts` 调 `gatherLandingData` 的方式不变
- 现有 14 个 SQL 不动

---

## 4. 文件变更

### 4.1 新增

| 文件 | 用途 | 估算行数 |
|------|-----|---------|
| `src/main/modules/view/templates/landing/job-category-nav.ts` | 渲染行业分类网格 | ~40 |
| `src/main/modules/view/templates/landing/featured-jobs.ts` | 渲染精选职位卡片墙 | ~60 |
| `src/main/modules/view/templates/landing/hot-companies.ts` | 渲染热门企业卡片 | ~70 |
| `tests/unit/gather-landing-data-enrichment.spec.ts` | 3 个新 SQL 的单测 | ~150 |
| `tests/integration/landing-v4.spec.ts` | 3 个新模块的 SSR 集成测试 | ~80 |

### 4.2 修改

| 文件 | 改动 | 估算行数 |
|------|-----|---------|
| `src/main/modules/view/gather-landing-data.ts` | 新增 3 个 SQL + 3 个类型 + 3 个字段 | +90 行 |
| `src/main/modules/view/templates/landing/index.ts` | 在 `hero` 和 `stats` 之间插入 3 个新组件 | +6 行 |
| `src/main/modules/view/templates/landing/landing.css.ts` | 新增 3 套样式（grid / 卡片 / 徽章） | +120 行 |
| `src/main/modules/view/templates/landing/landing.script.ts` | **无改动**（无新交互） | 0 行 |

### 4.3 不动

- `src/main/server.ts`（路由注册不变）
- `src/main/routes/landing.ts`（`gatherLandingData` 调用的参数和返回类型不变，只是返回值多 3 个字段）
- `src/main/modules/view/templates/landing/nav.ts` / `role-anchors.ts` / `hero.ts` / `stats.ts` / `rankings.ts` / `employer-section.ts` / `headhunter-section.ts` / `candidate-section.ts` / `footer.ts`（一字不改）
- 任何业务路由、view_url 注入、admin / auth / register
- 数据库 schema（无新表 / 无新字段 / 无新索引）
- 依赖（package.json 不动）
- tests 现有文件（v3 已写的测试不动）

---

## 5. 数据流

```
GET /
  ↓
routes/landing.ts (v3, 不变)
  ↓
gatherLandingData(db)   ← 本 spec 改动
  ├─ 现有 14 个 SQL（不变）
  ├─ 🆕 SQL A: 行业聚合 (job-category-nav)
  ├─ 🆕 SQL B: 精选职位 (featured-jobs)
  └─ 🆕 SQL C: 热门企业 + N+1 子查询 (hot-companies)
  ↓
renderLanding(data)     ← 本 spec 改动
  ├─ nav(data)            # v3, 不动
  ├─ roleAnchors()        # v3, 不动
  ├─ hero(data)           # v3, 不动
  ├─ 🆕 jobCategoryNav(data)  # 新增
  ├─ 🆕 featuredJobs(data)     # 新增
  ├─ 🆕 hotCompanies(data)     # 新增
  ├─ stats(data)          # v3, 不动
  ├─ rankings(data)       # v3, 不动
  ├─ employerSection(data)# v3, 不动
  ├─ headhunterSection(data)# v3, 不动
  ├─ candidateSection(data)# v3, 不动
  └─ footer(data)         # v3, 不动
  ↓
SSR HTML (text/html; charset=utf-8)
  ↓
200
```

---

## 6. 错误处理

| 场景 | 行为 |
|------|------|
| **整体 render 失败** | 500 + 简化版 fallback HTML（沿用 v3 `FALLBACK_HTML`），记日志 |
| **新 SQL A/B/C 任一失败** | 该字段 fallback 到 `[]`，其他字段照常渲染（沿用 v3 `topEmployers` 的 try/catch 模式） |
| **3 个新模块都返回空**（空 DB / 0 个 open jobs） | 每个模块显示各自的"空态"文案（见 §2.2/2.3/2.4），不崩溃 |
| **`company_name` 为 NULL**（LEFT JOIN 命中孤儿 job） | 卡片显示 `某公司`（v3 `latestPlacements` 已有同款 fallback） |
| **XSS 防护** | 所有 user-controlled 字段（industry / title / company_name / skill）走 `html` 标签模板自动转义 |
| **SQL 注入** | 全部走 prepared statements，沿用项目约定 |

---

## 7. 测试策略

### 7.1 单元测试 (`gather-landing-data-enrichment.spec.ts`)

| 测试 | 覆盖 |
|------|------|
| SQL A: 10 个 open jobs / 3 个 industry → 返回 3 条 industryNav | 行业聚合 |
| SQL A: openJobsCount=0 → industryNav=[] | 空态 |
| SQL A: 1 个 industry 的 industry=NULL → 不出现 | NULL 过滤 |
| SQL B: 10 个 open jobs (5 urgent/3 high/2 normal) → 返回 10 条，urgent 在前 | 排序 |
| SQL B: 1 个 job 的 employer_id=NULL → 不出现 | 过滤 |
| SQL B: 1 个 job 的 company_name=NULL → 该条 company_name=null | LEFT JOIN 行为 |
| SQL B: required_skills_json 是 JSON 数组 → 解析为 string[] | JSON 解析 |
| SQL B: required_skills_json 是 NULL → required_skills=[] | 空值 |
| SQL C: 5 个 employer 各自有不同数量的 open jobs → 返回 openJobCount 倒序前 4 | 排序 + 限制 |
| SQL C: hotCompanies 中每条的 recentJobs 长度 ≤ 3，按 created_at 倒序 | 子查询 |
| SQL C: 0 个 employer 有 open jobs → hotCompanies=[] | 空态 |
| DB 抛错时 3 个新字段 fallback 到 [] | 错误处理 |

### 7.2 集成测试 (`landing-v4.spec.ts`)

| 测试 | 覆盖 |
|------|------|
| `GET / contains "职位分类"` 或 "分类导航" | 模块 1 渲染 |
| `GET / contains "精选"` 或 "热招"` | 模块 2 渲染 |
| `GET / contains "热门企业"` | 模块 3 渲染 |
| `GET /` 模块 1 在 hero 之后、stats 之前 | 顺序 |
| `GET / with empty DB` 不崩溃 | 空态 |
| `GET / with 5 industries` 渲染 5 个 grid 项 | 数据驱动 |
| `GET / no PII leaked` | 不含 user_id / contact / email / phone |
| `GET / render time < 300ms` (v3 基线 200ms，+100ms 余量) | 性能 |
| `GET /` 不破坏 v3 的所有现有断言 | 回归 |

### 7.3 视觉测试

- **不做**（沿用 v3 决策）

---

## 8. 实现路径

### 8.1 任务分解（4 个 phase）

**Phase 1: 数据层 (1-2 小时)**
- T1.1: 在 `gather-landing-data.ts` 加 `IndustryNavItem` / `FeaturedJob` / `HotCompany` 类型
- T1.2: 实现 SQL A → `industryNav` 字段
- T1.3: 实现 SQL B → `featuredJobs` 字段
- T1.4: 实现 SQL C（含 N+1 子查询）→ `hotCompanies` 字段
- T1.5: 单元测试 `gather-landing-data-enrichment.spec.ts`

**Phase 2: 模板层 (2-3 小时)**
- T2.1: 新建 `job-category-nav.ts`
- T2.2: 新建 `featured-jobs.ts`
- T2.3: 新建 `hot-companies.ts`
- T2.4: 改 `index.ts` 插入 3 个新组件
- T2.5: 在 `landing.css.ts` 加新样式

**Phase 3: 测试层 (1 小时)**
- T3.1: 集成测试 `landing-v4.spec.ts`
- T3.2: `pnpm typecheck` + `pnpm test` 全量回归

**Phase 4: 收尾 (0.5 小时)**
- T4.1: 手动 smoke（`curl localhost:3000/` + 浏览器目视）
- T4.2: 验证 v3 现有断言全部通过（不破坏 v3）
- T4.3: commit + push

### 8.2 估算代码量

- 数据层：+90 行
- 模板层：+170 行（3 个新模块 + 6 行 index + 120 行 CSS）
- 测试：+230 行
- **合计**：~490 行

### 8.3 风险点

| 风险 | 缓解 |
|------|------|
| 3 个新 SQL 增加首页 render 时间 | v3 基线 200ms，本 spec 上限 300ms。SQL A 是单表 GROUP BY，SQL B 有索引 `idx_jobs_employer_status`，SQL C 主查询有 `idx_jobs_employer` |
| `company_name` 大量为 NULL | 显示 `某公司` fallback |
| N+1 子查询性能 | N≤4，每条 LIMIT 3，且 `idx_jobs_employer_status` 已存在 |
| 与 v3 视觉风格不一致 | 严格沿用 v3 的 `.card` / `.sub-card` / `.job-card` / `.tag` / `.industry-tag` |
| 修改 `gather-landing-data.ts` 破坏 v3 | 完整跑 v3 集成测试 + 字段加在末尾，typecheck 0 error |

---

## 9. 决策记录

| 决策 | 选择 | 备选 | 理由 |
|------|-----|------|------|
| 改造范围 | **3 个新模块增量** | 全页重做 / 局部小改 | 用户要求"丰富一下内容"、"现有模块都行"、"不加字段" |
| 数据缺口 | **接受简陋显示** | 加 jobs.location / scale / financing / logo | 用户明确拒绝"增加复杂性" |
| 排序 | **priority 升序 + created_at 降序** | created_at 倒序 / reputation 加权 | "热招"语义 = 急 + 新 |
| N+1 vs 单条 SQL | **N+1 (N≤4)** | 单条 `IN (subquery)` | 数据量小，N+1 与项目现有 pattern 一致 |
| 行业分组细化 | **不做**（industry 一级） | 借鉴 Boss 的 5×N 子分类 | jobs 表只有 industry 一级字段 |
| "查看更多"链接 | **MVP 不做** | 做完整分页 | 用户没要求，留 DOM 钩子 |
| 移动端布局 | **CSS Grid 响应式** | 单独 mobile CSS | Grid `auto-fill` 自适应足够 |
| 国际化 | **不做** | en/zh-CN | 不在本次范围 |
| view_url 注入 | **不动** | 给新模块也加 view_url | view_url 是 API 响应的，不在 landing 公开页 |

---

## 10. 未来工作（不在本次范围）

- jobs.location / experience_required / education_required 字段（用户拒绝）
- users (employer) scale / financing_status / logo_url 字段（用户拒绝）
- 职位分类二级细分（互联网/AI → Java / PHP / 前端）
- 精选职位搜索 / 行业筛选 / 薪资筛选
- 热门企业按行业筛选
- "查看更多"完整分页
- 实时刷新（WebSocket / SSE）
- 暗色模式 / 国际化
- 移动端汉堡菜单
- A/B 测试不同 Hero 文案 + 不同排序权重
- view_url 注入到 3 个新模块（让"热招职位卡片"也能被 AI 带 URL 分享）—— **这条值得下次评估**
