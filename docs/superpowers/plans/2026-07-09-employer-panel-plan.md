> ⚠️ **ARCHIVED — DO NOT IMPLEMENT** (2026-07-11)
>
> Superseded by commit `c41167d` "cleanup: cut portal redundancy (~29876 lines)".
> The Employer Panel pages targeted by this plan
> (`app-web/src/pages/{employer-portal,pm-portal}/`) were removed in the cut.
> Per the Phase 4.5 decision "PM = employer", employer UI is owned by the PM
> side of `C:\Users\Administrator\Desktop\ow-headhunter-sass` (prototype.html).
>
> **Preserved for historical reference only.**
>
> ---

# Employer Recruitment Panel Implementation Plan (Phase 3b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 面向雇主 (Employer) 的 React SPA 招聘面板 (`/employer/*`),让雇主可以在浏览器中管理职位、浏览候选人、表达兴趣、查看成交。

**Architecture:**
- 前端: 扩展 admin-web,新增 `/employer/*` 路由组,5 个页面
- 后端: **几乎完全复用** 现有 `/v1/employer/*` 端点 (createJob / listMyJobs / browseTalent / expressInterest / claimJob / listPendingClaims)
- 新增: 少量 dashboard 聚合端点 + placement history
- 认证: 复用现有 bearer token (用户类型 `employer`)

**Tech Stack:**
- 后端: TypeScript strict + Express + Zod + node:sqlite
- 前端: React 18 + TypeScript + React Query
- 借鉴: ow-recruit-saas/prototype.html (雇主相关屏幕 + ow-recruit `employer-section.ts` 设计)

**Spec:** `docs/superpowers/specs/2026-07-09-employer-panel-design.md` (待创建)
**Portfolio:** `docs/superpowers/plans/2026-07-09-missing-uis-portfolio.md`

---

## 优先级与任务

| P | 任务 | 工时 |
|---|------|------|
| P0.1 | 现有 `/v1/employer/*` API 端点审计 (清单) | 0.5h |
| P0.2 | v029 migration (可选: employer_views 镜像) | 1h |
| P0.3 | Employer Dashboard handler + 数据聚合 | 3h |
| P0.4 | Employer Login + Dashboard 页面 | 3h |
| P1.5 | Jobs 管理页 (list + create + edit + pause) | 4h |
| P1.6 | Browse Talent 页 (筛选 + 雷达) | 4h |
| P1.7 | Placements 历史页 (成交) | 2h |
| P2.8 | Pending Claims 页 (待领取) | 2h |
| P2.9 | Settings + 公司信息 | 1.5h |
| P2.10 | 集成 + 路由 + E2E 测试 | 2h |

**总规模**: 12 任务, ~22h (~3 工作日)

---

## File Structure

### 后端新增 (最小化)

```
src/main/db/repositories/employer-dashboard.ts       (聚合查询)
src/main/modules/employer/dashboard.ts              (handler)
src/main/routes/employer-panel.ts                   (新路由,挂载 /v1/employer-panel/dashboard)
src/main/schemas/employer-panel.ts
```

### 后端修改 (极少)

```
src/main/server.ts                                  (挂载新路由)
```

### 前端新增

```
admin-web/src/api/employer.ts                       (类型化客户端,5 端点)
admin-web/src/components/employer-portal/           (新目录)
  EmployerMobileLayout.tsx
  EmployerSidebar.tsx
  JobPostForm.tsx                                   (复用 candidate-portal components)
  CandidatePreviewCard.tsx
  PlacementTimeline.tsx
  RequireEmployerAuth.tsx
admin-web/src/pages/employer-portal/                (5 屏)
  EmployerLoginPage.tsx
  EmployerDashboardPage.tsx
  JobsManagementPage.tsx
  BrowseTalentPage.tsx
  PlacementsPage.tsx
admin-web/src/components/employer-portal/__tests__/
```

### 测试新增

```
tests/integration/employer/dashboard.test.ts
tests/integration/employer/e2e.test.ts
admin-web/src/components/employer-portal/__tests__/JobPostForm.test.tsx
```

---

## 数据流概览

### 复用现有端点 (无需新代码)

```
POST   /v1/employer/jobs                创建工作
GET    /v1/employer/jobs                列出我的工作
GET    /v1/employer/jobs/:id            工作详情
POST   /v1/employer/jobs/:id/pause      暂停
POST   /v1/employer/jobs/:id/resume     恢复
POST   /v1/employer/jobs/:id/close      关闭
GET    /v1/employer/candidates          浏览脱敏候选人池
POST   /v1/employer/recommendations/:id/express-interest  表达兴趣
POST   /v1/employer/recommendations/:id/approve-unlock     批准解锁
POST   /v1/employer/recommendations/:id/reject-unlock     拒绝解锁
GET    /v1/employer/pending-claims      待领取工作
POST   /v1/employer/pending-claims/:id/claim              领取
POST   /v1/employer/pending-claims/:id/reject             拒绝
```

### 新增端点 (聚合, 仅 2-3 个)

```
GET /v1/employer-panel/dashboard
  → {
    active_jobs: 数量,
    open_positions: 数量,
    candidates_viewed_this_month: 数量,
    interested_count: 数量,
    unlocked_count: 数量,
    placements_count: 数量,
    spend_this_month: 金额
  }

GET /v1/employer-panel/placements
  → 列出我的所有成交 (从 placements 表)

GET /v1/employer-panel/candidates/:id
  → 雇主视角的候选人详情 (增强现有 GET)
```

---

## Task 1: 现有 `/v1/employer/*` API 端点审计

**Files:**
- Read: `src/main/routes/employer.ts`
- Read: `src/main/modules/employer/handler.ts`
- Read: `src/main/schemas/employer.ts`

输出文档 (`docs/employer-api-inventory.md`):
- 端点清单 (15+ 端点)
- 复用 vs 需新增的清单

**预期**: 95% 现有端点可复用, 只需 2-3 个聚合端点。

## Task 2: 可选 migration v029 (仅在需要时)

**Files:**
- Create: `src/main/db/migrations/v029_employer_dashboard_views.sql`

```sql
-- 仅在需要持久化 dashboard 视图时使用
CREATE TABLE employer_dashboard_views (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  employer_user_id TEXT NOT NULL,
  view_type       TEXT NOT NULL,           -- 'dashboard' | 'placement_detail'
  resource_id     TEXT,
  viewed_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (employer_user_id) REFERENCES users(id)
);
CREATE INDEX idx_employer_views_employer ON employer_dashboard_views(employer_user_id, viewed_at DESC);
```

(实际 MVP 可省略,直接每次实时聚合即可)

## Task 3: Employer Dashboard Handler

**Files:**
- Create: `src/main/db/repositories/employer-dashboard.ts`
- Create: `src/main/modules/employer/dashboard.ts`
- Create: `src/main/schemas/employer-panel.ts`
- Test: `tests/integration/employer/dashboard.test.ts`

聚合查询:
```sql
-- 1. active_jobs = 状态 = 'open' 的 jobs 数
SELECT COUNT(*) FROM jobs WHERE employer_id = ? AND status = 'open';

-- 2. open_positions = 上述 jobs 的总 headcount
SELECT SUM(headcount_planned) FROM jobs WHERE employer_id = ? AND status = 'open';

-- 3. candidates_viewed_this_month = 30 天内 unlock_audit_log
SELECT COUNT(*) FROM unlock_audit_log ual
JOIN recommendations r ON r.id = ual.recommendation_id
JOIN jobs j ON j.id = r.job_id
WHERE j.employer_id = ? AND ual.accessed_at > unixepoch() * 1000 - 30*24*3600*1000;

-- 4. interested_count / unlocked_count
SELECT 
  SUM(CASE WHEN status = 'employer_interested' THEN 1 ELSE 0 END) AS interested,
  SUM(CASE WHEN status = 'candidate_approved' THEN 1 ELSE 0 END) AS unlocked
FROM recommendations r
JOIN jobs j ON j.id = r.job_id
WHERE j.employer_id = ?;

-- 5. placements_count
SELECT COUNT(*) FROM placements p
JOIN jobs j ON j.id = p.job_id
WHERE j.employer_id = ?;

-- 6. spend_this_month
SELECT SUM(p.actual_fee) FROM placements p
JOIN jobs j ON j.id = p.job_id
WHERE j.employer_id = ? AND p.created_at > ...;
```

## Task 4: Employer Login Page (复用 OTP)

复用 candidate-portal / hunter-portal 的 LoginPage 模式,登录后跳转 `/employer/dashboard`。

## Task 5: Employer Dashboard Page

UI:
- 顶部 KPI 卡片 (7 卡片: 活跃工作 / 开放岗位 / 本月浏览 / 表达兴趣数 / 解锁数 / 成交数 / 本月花费)
- "待领取" 提示 (如果 pending-claims > 0)
- 最近活动 (timeline 列表)

## Task 6: Jobs Management Page (List + Create + Edit + Pause)

UI:
- 表格: 标题 / 状态 / HC / 表达兴趣 / 已成交 / 创建时间 / 操作
- "新建工作" 按钮 → 打开 JobPostForm
- 行内操作: 编辑 / 暂停 / 恢复 / 关闭

复用 `JobPostForm` 组件 (在 candidate-portal 没有,需新建, 大表单 7 字段)。

## Task 7: Browse Talent Page

UI:
- 过滤侧栏: 行业 / 职级 / 技能 / 薪资范围 / 教育背景
- 候选人卡片网格 (脱敏): 头像 / 标题 / 行业 / 职级 / 技能 / MatchScore
- 点击 → 跳转到候选人详情 modal (含雷达图 + 5 维评分 + 申请按钮)

复用 candidate-portal 的 `JobCard` + `MatchScore` 组件 + 调色板。

## Task 8: Placements Page

UI:
- 时间线列表: 候选人 / 工作 / 成交金额 / 佣金 / 日期
- 状态徽章 (pending_payment / paid / cancelled)
- 详情 modal

## Task 9: Pending Claims Page

UI:
- 待领取工作列表 (从 headhunter 创建的工作)
- "领取" / "拒绝" 按钮 (调用现有 API)
- 工作预览 (标题/技能/HC/猎头信息)

## Task 10: Settings Page

UI:
- 公司信息: 名称 / 行业 / 规模 / 联系人
- 通知偏好: 站内信（已放弃邮件通道，详见 in-site-notifications-design.md §1.2）
- API Key 显示 (供外部 Agent 集成)

## Task 11: 集成 + 路由挂载

修改 `admin-web/src/App.tsx`,注册 `/employer/*` 路由组 + `<RequireEmployerAuth>` 守卫。

## Task 12: E2E 测试 + 文档

**Files:**
- Create: `tests/integration/employer/e2e.test.ts`
- Update: `docs/CHANGELOG.md`

E2E 流程:
- 雇主登录 → 看 dashboard → 创建工作 → 浏览候选人 → 表达兴趣 → 批准解锁 → 看到 placement

---

## Self-Review

- 大量复用现有端点, 减少新代码
- 雇主 dashboard 数据准确 (commission 计算与现有 commission handler 一致)
- 候选人浏览尊重 PII 保护 (只显示脱敏字段)
- 移动端响应式 OK (卡片在 ≤768px 单列)

## Report

每任务 + 整体报告。

## 注意事项

- **PII 严格**: Employer 浏览候选人只能看到脱敏字段, 与 candidate-portal 一致
- **审计完整**: 所有雇主行为记入 action_history (通过 AUDITED_PREFIXES 触发)
- **不重复造轮子**: 候选人卡片 / 雷达 / 漏斗等组件从 candidate-portal 复用
