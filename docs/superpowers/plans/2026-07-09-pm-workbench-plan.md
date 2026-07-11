> ⚠️ **ARCHIVED — DO NOT IMPLEMENT** (2026-07-11)
>
> Superseded by commit `c41167d` "cleanup: cut portal redundancy (~29876 lines)".
> The PM Workbench pages targeted by this plan (`app-web/src/pages/pm-portal/`)
> were removed in the cut. PM UI is owned by
> `C:\Users\Administrator\Desktop\ow-headhunter-sass` (prototype.html, 9948 lines).
>
> **Preserved for historical reference only.**
>
> ---

# PM Workbench Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 面向 PM (项目经理) 的 React SPA 工作台 (`/pm/*`),实现项目库、项目详情、岗位分解 (AI 启发式)、计划对比、招聘沙盒、候选人匹配 4 大建模能力。

**Architecture:**
- 前端: 扩展 admin-web,新增 `/pm/*` 路由组,9 个页面 (从 ow-recruit S1~S9 移植)
- 后端: **大量新增** — projects / plans / decompositions / sandbox / matches 5 个模块
- 认证: 复用现有 bearer token (用户类型 `pm` 或 `employer` 兼任 PM)
- 建模算法: 关键词启发式 (复用 candidate-portal Jaccard,扩展加权)

**Tech Stack:**
- 后端: TypeScript strict + Express + Zod + node:sqlite + bcryptjs
- 前端: React 18 + TypeScript + React Query + 现有 plain CSS
- 借鉴: `C:\Users\Administrator\Desktop\ow-recruit-saas\prototype.html` (PM 模式 S1~S9 屏)

**Spec:** `docs/superpowers/specs/2026-07-09-pm-workbench-design.md` (待创建)
**Portfolio:** `docs/superpowers/plans/2026-07-09-missing-uis-portfolio.md`

---

## 4 大建模能力

| 能力 | API | 前端 |
|------|-----|------|
| **岗位分解** (Position Decomposition) | `POST /v1/pm/projects/:id/decompose` (AI 启发式) | S2 项目详情 |
| **计划对比** (Plan Comparison) | `GET /v1/pm/projects/:id/plans` | S4 计划对比页 |
| **招聘沙盒** (Pipeline Sandbox) | `GET /v1/pm/positions/:id/sandbox` | S3 沙盒页 |
| **候选人匹配** (Candidate Matching) | `GET /v1/pm/positions/:id/matches` | S5/S6 详情/匹配页 |

## 优先级与任务

| P | 任务 | 工时 |
|---|------|------|
| P0.1 | v028 migration (6 新表) | 2h |
| P0.2 | Projects repository + handler | 4h |
| P0.3 | PM Login + Projects list (S8) | 3h |
| P1.4 | Project detail (S2) + Positions table | 5h |
| P1.5 | Position decomposition (AI 启发式) | 4h |
| P1.6 | Plans repository + handler + S4 对比页 | 5h |
| P1.7 | Sandbox (S3) — 5 阶段漏斗 | 4h |
| P2.8 | Matches (S6) + weighted scoring | 4h |
| P2.9 | Global snapshot (S1) + HR activity feed | 4h |
| P2.10 | Candidate detail (S5) + 雷达图 | 3h |
| P2.11 | Candidate library (S9) — 来自 ERP 镜像 | 3h |
| P2.12 | Create project modal + meta form | 2h |
| P2.13 | Notes ⭐ 私有标注 (PM 私有) | 2h |
| P2.14 | AI 分解 API 测试 + 端到端 | 3h |
| 后端总计 | | ~44h |
| 前端总计 | | ~6h |

**总规模**: 22 任务, ~50h (~6.5 工作日)

---

## File Structure

### 后端新增

```
src/main/db/migrations/v028_pm_workbench.sql        (5 新表 + 索引)
src/main/db/repositories/projects.ts
src/main/db/repositories/project-positions.ts
src/main/db/repositories/staffing-plans.ts
src/main/db/repositories/position-decompositions.ts
src/main/db/repositories/pipeline-candidates.ts
src/main/db/repositories/matches.ts
src/main/db/repositories/pm-notes.ts                 (PM 私有标注)
src/main/lib/ai-decompose.ts                         (关键词启发式)
src/main/lib/weighted-match.ts                       (扩展 Jaccard 加权)
src/main/modules/pm/projects.ts
src/main/modules/pm/positions.ts
src/main/modules/pm/plans.ts
src/main/modules/pm/decompose.ts
src/main/modules/pm/sandbox.ts
src/main/modules/pm/matches.ts
src/main/modules/pm/snapshot.ts
src/main/modules/pm/notes.ts
src/main/routes/pm.ts
src/main/schemas/pm.ts
src/main/capabilities/pm.ts
```

### 后端修改

```
src/main/db/migrations.ts                  (v028)
src/main/capabilities/index.ts             (注册 PM)
src/main/server.ts                         (挂载 /v1/pm)
```

### 前端新增

```
admin-web/src/api/pm.ts
admin-web/src/components/pm-portal/        (新目录)
  PMMobileLayout.tsx
  PMSidebar.tsx
  ProjectCard.tsx
  ProjectMetaModal.tsx
  AIRadarChart.tsx (复用 candidate-portal RadarChart + 增强)
  StaffingPlanCard.tsx
  WeightedScore.tsx
  CandidateNote.tsx (PM 私有)
  RequirePMAuth.tsx
admin-web/src/pages/pm-portal/             (9 屏)
  PMLoginPage.tsx
  ProjectsLibraryPage.tsx (S8)
  ProjectDetailPage.tsx (S2)
  PipelineSandboxPage.tsx (S3)
  PlanComparisonPage.tsx (S4)
  CandidateDetailPage.tsx (S5)
  CandidateMatchesPage.tsx (S6)
  GlobalSnapshotPage.tsx (S1)
  CandidateLibraryPage.tsx (S9)
admin-web/src/components/pm-portal/__tests__/
```

### 测试新增

```
tests/unit/lib/ai-decompose.test.ts
tests/unit/lib/weighted-match.test.ts
tests/integration/pm/projects.test.ts
tests/integration/pm/positions.test.ts
tests/integration/pm/plans.test.ts
tests/integration/pm/decompose.test.ts
tests/integration/pm/sandbox.test.ts
tests/integration/pm/matches.test.ts
tests/integration/pm/snapshot.test.ts
tests/integration/pm/notes.test.ts
tests/integration/pm/e2e.test.ts
```

---

## 数据模型

### 5 新表

```sql
-- v028: PM Workbench

CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  pm_user_id      TEXT NOT NULL,                -- PM owner
  name            TEXT NOT NULL,
  target          TEXT,                          -- 项目目标
  budget_total    INTEGER,                       -- 总预算 (元)
  start_at        INTEGER,
  end_at          INTEGER,
  current_team    TEXT,                          -- JSON: [{role, count, ...}]
  status          TEXT NOT NULL DEFAULT 'planning',  -- planning|active|paused|completed|cancelled
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (pm_user_id) REFERENCES users(id)
);
CREATE INDEX idx_projects_pm ON projects(pm_user_id, status);

CREATE TABLE project_positions (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  required_skills_json TEXT,                    -- ['vue', 'ts']
  title_level     TEXT,                          -- junior|mid|senior|staff
  industry        TEXT,
  salary_min      INTEGER,
  salary_max      INTEGER,
  status          TEXT NOT NULL DEFAULT 'open',  -- open|paused|filled
  headcount_planned INTEGER NOT NULL DEFAULT 1,
  headcount_filled INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_project_positions_project ON project_positions(project_id, status);

CREATE TABLE staffing_plans (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  name            TEXT NOT NULL,                 -- 'A 快速组建' / 'B 节约成本' / 'C 顶级配置'
  description     TEXT,
  total_headcount INTEGER NOT NULL,
  estimated_cost  INTEGER,                       -- 估算总成本
  positions_json  TEXT NOT NULL,                -- JSON: [{position_id, count, ...}]
  is_selected     INTEGER NOT NULL DEFAULT 0,    -- 0|1
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_staffing_plans_project ON staffing_plans(project_id, is_selected);

CREATE TABLE position_decompositions (
  id              TEXT PRIMARY KEY,
  source_text     TEXT NOT NULL,                 -- PM 输入的"项目目标"原文
  positions_json  TEXT NOT NULL,                 -- AI 启发式输出
  source          TEXT NOT NULL DEFAULT 'ai_heuristic',  -- ai_heuristic|manual
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE matches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id     TEXT NOT NULL,
  candidate_user_id TEXT NOT NULL,
  score           INTEGER NOT NULL,              -- 0-100
  reasons_json    TEXT,                          -- ['技能匹配 vue', '行业一致']
  gaps_json       TEXT,                          -- ['缺 k8s 经验']
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (position_id) REFERENCES project_positions(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_user_id) REFERENCES users(id),
  UNIQUE(position_id, candidate_user_id)
);
CREATE INDEX idx_matches_position ON matches(position_id, score DESC);

CREATE TABLE pm_notes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pm_user_id      TEXT NOT NULL,
  candidate_user_id TEXT NOT NULL,
  starred         INTEGER NOT NULL DEFAULT 0,     -- 0|1
  note_text       TEXT,
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (pm_user_id) REFERENCES users(id),
  FOREIGN KEY (candidate_user_id) REFERENCES users(id),
  UNIQUE(pm_user_id, candidate_user_id)
);
```

---

## Task 1: 数据库迁移 v028 (6 新表 + 索引)

**Files:**
- Create: `src/main/db/migrations/v028_pm_workbench.sql` (上述 SQL)
- Modify: `src/main/db/migrations.ts` (注册 version 21)

## Task 2: Projects Repository + Handler (TDD)

CRUD:
- `list(pmUserId, {status?, limit, offset})` → 含 position 计数
- `create(pmUserId, {name, target?, budget_total?, ...})` → 自动创建默认 5 阶段 staffing_plan 模板
- `detail(projectId, pmUserId)` → 含 positions / plans / 统计
- `update(projectId, pmUserId, fields)`
- `delete(projectId, pmUserId)` → CASCADE 删除 positions / plans

## Task 3: PM Login Page (复用 OTP)

复用 candidate-portal / hunter-portal 的 LoginPage,登录后跳转 `/pm/projects`。

## Task 4: Projects Library Page (S8)

UI:
- KPI 卡片: 项目数 / 活跃项目 / 已完成 / 总预算
- 搜索 + 状态过滤 + 视图切换 (table ↔ card)
- 项目卡片 / 表格行: 名称 / 目标 / 预算 / 计划 / 岗位 / HC / 匹配 / HR 进度
- "新建项目" 按钮 → 打开 ProjectMetaModal

## Task 5: Project Detail Page (S2) + Positions Table

UI:
- 项目 header (名称/目标/预算/时间/团队)
- 标签页: 概览 / 岗位 / 计划 / 匹配
- 岗位表: 标题 / 技能 / 职级 / 计划/已招 HC / 状态
- "智能拆岗位" 按钮 → 调用 AI decompose API

## Task 6: AI 启发式岗位分解 (decompose.ts)

**Files:**
- Create: `src/main/lib/ai-decompose.ts`
- Create: `src/main/modules/pm/decompose.ts`
- Test: `tests/unit/lib/ai-decompose.test.ts`
- Test: `tests/integration/pm/decompose.test.ts`

启发式算法 (基于关键词, 800ms 延迟模拟 AI):
```typescript
const POSITION_TEMPLATES = [
  { keywords: ['vue', 'react', 'frontend', '前端'], title: '高级前端工程师', skills: ['vue', 'typescript'], title_level: 'senior' },
  { keywords: ['node', 'java', '后端', 'backend'], title: '后端工程师', skills: ['node.js', 'sql'], title_level: 'senior' },
  { keywords: ['ios', 'swift'], title: 'iOS 工程师', skills: ['swift', 'ios'], title_level: 'mid' },
  { keywords: ['android'], title: 'Android 工程师', skills: ['kotlin', 'android'], title_level: 'mid' },
  { keywords: ['devops', 'k8s', 'docker'], title: 'DevOps 工程师', skills: ['kubernetes', 'docker'], title_level: 'senior' },
  { keywords: ['qa', '测试', 'test'], title: '测试工程师', skills: ['selenium', 'pytest'], title_level: 'mid' },
  { keywords: ['产品', 'product', 'pm'], title: '产品经理', skills: ['产品设计'], title_level: 'mid' },
  { keywords: ['设计', 'design', 'ui'], title: 'UI 设计师', skills: ['figma'], title_level: 'mid' },
  { keywords: ['算法', 'ai', 'ml', 'machine learning'], title: '算法工程师', skills: ['python', 'tensorflow'], title_level: 'senior' },
  { keywords: ['数据', 'data'], title: '数据工程师', skills: ['sql', 'spark'], title_level: 'senior' },
];

export async function decomposePositions(targetText: string): Promise<DecomposedPosition[]> {
  await sleep(800);  // 模拟 AI 延迟
  const lower = targetText.toLowerCase();
  const matched = new Set<string>();
  const result: DecomposedPosition[] = [];
  for (const tmpl of POSITION_TEMPLATES) {
    if (tmpl.keywords.some(k => lower.includes(k))) {
      if (!matched.has(tmpl.title)) {
        matched.add(tmpl.title);
        result.push({
          title: tmpl.title,
          skills: tmpl.skills,
          title_level: tmpl.title_level as any,
          headcount: 1,
          rationale: `匹配关键词: ${tmpl.keywords.filter(k => lower.includes(k)).join(', ')}`,
        });
      }
    }
  }
  if (result.length === 0) {
    result.push({ title: '全栈工程师', skills: ['javascript', 'sql'], title_level: 'mid', headcount: 1, rationale: '默认推荐' });
  }
  return result;
}
```

## Task 7: Plans Repository + Handler (TDD)

CRUD:
- `listByProject(projectId, pmUserId)` → 含 selected 标记
- `create(projectId, pmUserId, {name, total_headcount, estimated_cost, positions_json})`
- `update(planId, pmUserId, fields)`
- `setSelected(planId, pmUserId)` → 唯一性 (一个项目只有一个 selected)
- `delete(planId, pmUserId)`

## Task 8: Plan Comparison Page (S4)

UI:
- 3 计划横向并排对比
- 列: 总 HC / 估算成本 / 能力雷达 / 风险标签
- 选中计划高亮

## Task 9: Sandbox Page (S3) — 5 阶段漏斗

UI:
- 5 阶段漏斗 (复用 FunnelCard): 投递 → 简历过 → 面试 → offer → 到岗
- 每阶段: 候选人数 + 风险告警
- 点击阶段展开候选人列表

后端: `GET /v1/pm/positions/:id/sandbox` → 聚合该岗位所有推荐,按 pipeline_stage 分组。

## Task 10: Matches Handler + Weighted Match Library

**Files:**
- Create: `src/main/lib/weighted-match.ts` (扩展 candidate-portal/matching.ts)
- Create: `src/main/modules/pm/matches.ts`
- Test: `tests/unit/lib/weighted-match.test.ts`
- Test: `tests/integration/pm/matches.test.ts`

加权评分 (PM 场景特定):
```
score = Jaccard 技能 (40%)
     + 职级匹配 (15%)
     + 行业匹配 (15%)
     + 薪资匹配 (10%)
     + 教育背景 (10%)
     + 地理/远程 (10%)
```

返回 reasons (正向) + gaps (负向) 数组。

## Task 11: Candidate Matches Page (S6)

UI:
- 匹配列表 (按 score 降序)
- 卡片: 候选人脱敏 + 分数 + reasons + gaps
- 跳转到详情

## Task 12: Global Snapshot Page (S1) + HR Activity Feed

UI:
- 4 阶段漏斗: 项目 → 岗位 → 候选人 → 匹配
- HR Activity Feed: 跨模式实时流 (新申请/猎头认领/雇主表达兴趣)

后端: `GET /v1/pm/snapshot` → 聚合 PM 全部项目的统计 + 最近 24h 事件流。

## Task 13: Candidate Detail Page (S5) + 雷达图

UI:
- 基本信息 + 5 维能力雷达图 (复用 RadarChart)
- 匹配工作列表 (按 score 降序)
- PM 私有笔记 (⭐ + 文字)

## Task 14: Candidate Library Page (S9)

UI:
- 来自 ERP 镜像的只读视图 (所有 headhunter 推荐的候选人)
- 表格 / 卡片切换
- PM 私有 ⭐ + 📝 标注
- 关键词搜索

## Task 15: Create Project Modal + Meta Form

UI:
- 字段: 名称 / 目标 / 预算 / 开始 / 结束 / 团队
- 提交 → POST /v1/pm/projects

## Task 16: PM 私有 Notes (⭐ + 📝)

后端: `PUT /v1/pm/notes/:candidate_user_id` body `{starred, note_text}`
前端: ProfileCard + NoteModal 组件

## Task 17: 集成 + 路由挂载

修改 `admin-web/src/App.tsx`,注册 `/pm/*` 路由组 + `<RequirePMAuth>` 守卫。

## Task 18-22: 测试 + 文档 + 部署

按候选 portal plan 模式。

---

## Self-Review

- AI 启发式必须有理由 (rationale 字段) 不能黑盒
- 5 阶段漏斗数据来源: `recommendations.pipeline_stage`
- PM 私有数据 (notes / starred) 与公开数据 (matches) 严格分离
- 匹配 score 上限 100, 业务方解释 (reasons + gaps)

## Report

每任务报告 + 整体 completion 报告。
