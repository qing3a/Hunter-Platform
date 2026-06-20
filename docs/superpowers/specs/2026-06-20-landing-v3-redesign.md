# Landing Page v3 — Full Redesign

**状态**: Draft
**日期**: 2026-06-20
**作者**: brainstorming session
**前置**: [2026-06-18-landing-v2.md](./2026-06-18-landing-v2.md), [2026-06-18-marketplace-landing.md](./2026-06-18-marketplace-landing.md), [2026-06-18-render-layer-design.md](./2026-06-18-render-layer-design.md)
**参考站点**: Coze NeverLand (https://neverland.coze.com/)、Tencent SkillHub (https://skillhub.cloud.tencent.com/)、Boss直聘 (https://www.zhipin.com/)、猎聘 (https://www.liepin.com/)

---

## 1. 概述

### 1.1 一句话定义

把 `GET /` landing page 从"7 段式平铺"重构为"sticky nav + role 锚点 + Hero/AGENT GATE + 5 维 tab 化榜单 + 三角色分段 + Footer"的完整门户版式，参考 NeverLand / SkillHub / Boss / 猎聘 的成熟规划模式。

### 1.2 触发原因

v2（2026-06-18 landing-v2）已经实现了 Hero Stats、Top 3 Headhunters、Latest 5 Placements 三个 social proof 区块，视觉重做也已落地。但相比成熟的 API/Agent 平台首页（NeverLand）和招聘门户首页（Boss/猎聘），仍缺：
- 顶导 + 状态徽章
- AGENT GATE（一键复制 skill.md）
- 角色锚点（让 4 类访客快速跳转）
- 多维榜单（现在只有 1 维：Top 猎头）
- Footer（品牌签名 + 二级入口）
- 代码组织（现在 412 行单文件 landing.ts，后续难维护）

### 1.3 目标

1. 新增 sticky 顶导，含状态徽章（HEALTHY 99.9%）和「复制 skill.md」主 CTA
2. 新增 4 个 role 锚点条（雇主/猎头/候选人/Agent 开发者），点击平滑滚动
3. AGENT GATE 升级为可一键复制的入口卡片（核心转化路径）
4. 5 维 tab 化榜单：Top 猎头 / Top 雇主 / Top 行业 / Latest Placements / Hot Skills
5. 加 footer：skill.md / health / openapi 二级入口 + "Made with care for Agents" 签名
6. 代码组织：landing.ts 拆为 11 个 TS 模板子模块 + 1 个 CSS + 1 个 JS（landing/ 子目录），加上 6 个 partials + 1 个 lib helper；新增 3 个 SQL
7. 单页面整体重做，保持 SSR HTML 不变（无 SPA 框架依赖）

### 1.4 非目标

- 不做交互式筛选（候选人池按行业搜索、薪资筛选）
- 不做时序图（7 日 Unlocks 折线图）
- 不做国际化（en / zh-CN 切换）
- 不做暗色模式
- 不做用户身份/登录系统（保持 no-login 公开页）
- 不改后端 API（除新增 3 个 SQL 查询）

---

## 2. 视觉设计

### 2.1 整体布局（顶部到底部）

```
┌─ sticky nav ─────────────────────────────────────────────┐
│ [LOGO]  ● HEALTHY 99.9%   API  市场  关于   [📋 复制]   │
├─ role anchors ───────────────────────────────────────────┤
│ [🏢 雇主]  [🎯 猎头]  [🔒 候选人]  [🤖 Agent 开发者]    │
├─ hero + AGENT GATE ─────────────────────────────────────┤
│                                                          │
│             🔍 HUNTER PLATFORM                            │
│   猎头中介 API 平台 · 候选人隐私受保护 · 20% 平台抽佣     │
│                                                          │
│  ┌─ AGENT GATE ────────────────────────────────────┐    │
│  │ 🤖  把链接发给 AI Agent 即可对接                  │    │
│  │ GET /v1/skill.md        [📋 一键复制]            │    │
│  │ GET /v1/openapi.json    [查看 OpenAPI]            │    │
│  │ GET /v1/health          [查看状态]                │    │
│  └────────────────────────────────────────────────┘    │
├─ stats (4 metrics) ────────────────────────────────────┤
│ 🔓 今日解锁 X │ 🎯 今日成交 Y │ 👥 活跃候选人 Z │ ⚡99.9%│
├─ rankings (5 tabs) ─────────────────────────────────────┤
│ 🏆 多维榜单                                              │
│ [Top 猎头] [Top 雇主] [Top 行业] [成交] [Hot Skills]     │
│ (active tab 内容)                                        │
├─ employer section (id=for-employers) ───────────────────┤
│ 🏢 For Employers — 在招岗位: X                          │
│ · 公开候选人池（按行业分组, 每组前 3 张）                │
├─ headhunter section (id=for-headhunters) ──────────────┤
│ 🎯 For Headhunters — 今日可推荐: X 个开放岗位          │
│ · 最近 5 个开放岗位（job-card）                         │
├─ candidate section (id=for-candidates) ────────────────┤
│ 🔒 For Candidates — 当前活跃 X 位专业用户              │
│ · 4 步隐私保护时间线                                    │
├─ footer ────────────────────────────────────────────────┤
│ skill.md · /v1/health · /v1/openapi.json                │
│ Made with care for Agents · 数据更新于 X                │
└──────────────────────────────────────────────────────────┘
```

### 2.2 视觉细节

| 元素 | 效果 |
|------|------|
| **品牌色** | teal-500 (#14b8a6)，沿用 v2 调色板不变 |
| **sticky nav** | 顶部 fixed，半透明白底 + backdrop-filter blur，scroll 触发阴影 |
| **状态徽章** | `● HEALTHY 99.9%` 绿点脉冲；degraded 时橙色点；down 时红点（保留位） |
| **复制按钮** | hover 变深色；点击后 2 秒内显示 "✓ 已复制" |
| **role 锚点** | 圆角胶囊，点击 active 状态高亮（IntersectionObserver 联动） |
| **AGENT GATE** | 大卡片，左侧 emoji + 标题，右侧 3 行代码 + 按钮；teal 渐变背景 |
| **stats** | 沿用 v2 风格，countUp 动画从 0 滚动 |
| **rankings tabs** | 5 tab 水平排列，active tab 下划线 + 颜色变化；URL hash 同步 |
| **rankings 面板** | Top 3 用 ranking-row（奖牌 + 名字 + 数值）；Hot Skills 用 chip 列表 |
| **footer** | 灰底，链接横排，签名居中或右对齐 |

### 2.3 复用 v2 视觉

- 调色板：teal-500 主色 + amber-500 强调色（不变）
- 卡片样式：`.card`、`.sub-card`、`.candidate-card`、`.job-card`（不变）
- 时间线样式：`.timeline`、`.timeline-item`（不变）
- tag 样式：`.tag`、`.tag.skill`、`.tag.industry`（不变）
- countUp 动画：保留
- IntersectionObserver fade-in：保留，新增观察 role section

### 2.4 参考站映射

| Hunter 新版 | 参考源 | 借鉴点 |
|------------|-------|--------|
| sticky nav + HEALTHY 徽章 | Coze NeverLand | "WORLD ACTIVE" 状态徽章 |
| AGENT GATE 一键复制 | Coze NeverLand | AGENT GATE 区块 |
| 4 role 锚点 | 自主设计 | Boss/猎聘 "我要 X" 双 CTA 演化 |
| 5 维 tab 化榜单 | Coze NeverLand | 5 个 tab 多维排行榜 |
| Top 雇主 + 行业 + 技能 | Boss/猎聘 | 公司卡片 + 分类筛选 |
| Footer + "Made with care" | Coze NeverLand | 品牌签名 + 二级入口 |

---

## 3. 数据来源

### 3.1 复用现有数据（v2 已有）

保持 `gatherLandingData` 中现有所有字段不变：
- `openJobsCount`、`publicCandidatesCount`
- `industryGroups`（按行业分组的公开候选人）
- `recentJobs`（最近 5 个开放岗位）
- `activeEmployerCount`、`activeHeadhunterCount`
- `serverTime`、`uptimePercent`（99.9% 静态）
- `todayUnlocks`、`todayPlacements`、`totalCandidates`
- `topHeadhunters`（Top 3 猎头）
- `latestPlacements`（Latest 5 Placements）

### 3.2 新增 3 个 SQL

**SQL 1: Top 雇主（按推荐活动量）**
```sql
SELECT u.id, u.name, COUNT(r.id) AS rec_count
FROM users u
LEFT JOIN recommendations r ON r.employer_id = u.id
WHERE u.user_type = 'employer' AND u.status = 'active'
GROUP BY u.id
ORDER BY rec_count DESC, COALESCE(u.reputation, 0) DESC
LIMIT 3;
```

**SQL 2: Top 行业（按公开候选人数）**
```sql
SELECT industry, COUNT(*) AS cand_count
FROM candidates_anonymized
WHERE is_public_pool = 1 AND industry IS NOT NULL
GROUP BY industry
ORDER BY cand_count DESC
LIMIT 3;
```

**SQL 3: Hot Skills 原始数据（聚合在 JS 侧做，与项目现有 pattern 一致）**
```sql
SELECT required_skills_json FROM jobs WHERE status = 'open';
```
- 返回最近一批 `status='open'` 的 `required_skills_json`（项目现有 `recentJobs` 已经在做这件事）
- TS 侧 `safeParseSkills` 解析每个 JSON 数组，统计每个 skill 出现次数，取 Top 10
- **为什么不在 SQL 用 `json_each`？** 项目当前未启用 SQLite JSON1 扩展作为查询模式（`required_skills_json` 现有用法都是 `JSON.parse` 在 JS 侧聚合）。保持一致。

**SQL 4 (轻量): DB 探活**
```sql
SELECT 1;
```
用于设置 `healthStatus`，不返回数据。

### 3.3 新增 TS 类型

```typescript
// src/main/modules/view/gather-landing-data.ts

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

// LandingData 新增字段：
//   topEmployers: EmployerRanking[]
//   topIndustries: IndustryRanking[]
//   hotSkills: SkillCount[]
//   healthStatus: HealthStatus
```

---

## 4. 文件变更

### 4.1 新增

| 文件 | 用途 | 估算行数 |
|------|-----|---------|
| `src/main/modules/view/gather-landing-data.ts` | 从 `routes/landing.ts` 抽出数据查询 + 3 个新 SQL + 类型定义 | ~200 |
| `src/main/modules/view/templates/landing/index.ts` | `renderLanding` 入口（组合所有子模块） | ~50 |
| `src/main/modules/view/templates/landing/layout.ts` | page shell（`<!DOCTYPE>`、`<head>`、`<body>`、`<script>`） | ~30 |
| `src/main/modules/view/templates/landing/nav.ts` | sticky 顶导 + 状态徽章 | ~60 |
| `src/main/modules/view/templates/landing/role-anchors.ts` | 4 role 锚点条 | ~30 |
| `src/main/modules/view/templates/landing/hero.ts` | Hero 标题 + AGENT GATE 卡片 | ~80 |
| `src/main/modules/view/templates/landing/stats.ts` | 4 stats 面板（沿用 v2 renderHeroStats） | ~40 |
| `src/main/modules/view/templates/landing/rankings.ts` | 5 tab 化多维榜单 | ~120 |
| `src/main/modules/view/templates/landing/employer-section.ts` | For Employers 区块（沿用 v2 renderEmployersBody） | ~50 |
| `src/main/modules/view/templates/landing/headhunter-section.ts` | For Headhunters 区块 | ~50 |
| `src/main/modules/view/templates/landing/candidate-section.ts` | For Candidates 区块 | ~40 |
| `src/main/modules/view/templates/landing/footer.ts` | Footer（签名 + 二级入口） | ~30 |
| `src/main/modules/view/templates/landing/landing.css.ts` | 新 section 专属 CSS | ~200 |
| `src/main/modules/view/templates/landing/landing.script.ts` | 客户端 JS（复制、tab、滚动、高亮） | ~150 |
| `src/main/modules/view/templates/partials/job-card.ts` | 可复用 job 卡片 | ~40 |
| `src/main/modules/view/templates/partials/candidate-card.ts` | 可复用 candidate 卡片 | ~50 |
| `src/main/modules/view/templates/partials/ranking-row.ts` | 通用 ranking 行 | ~30 |
| `src/main/modules/view/templates/partials/skill-tag.ts` | skill 标签 | ~15 |
| `src/main/modules/view/templates/partials/status-badge.ts` | HEALTHY 徽章 | ~20 |
| `src/main/modules/view/templates/partials/section-card.ts` | 通用 section 卡片容器 | ~20 |
| `src/main/modules/view/templates/lib/html.ts` | `html` 标签模板 + `esc` 辅助函数 | ~30 |
| `tests/unit/gather-landing-data.spec.ts` | 单元测试：SQL fallback、health check | ~100 |
| `tests/unit/lib-html.spec.ts` | 单元测试：esc、html`` 嵌套 | ~50 |
| `tests/integration/landing-route.spec.ts` | 集成测试：200 + 关键文本 | ~80 |

### 4.2 修改

| 文件 | 改动 |
|------|------|
| `src/main/routes/landing.ts` | 缩减为 ~15 行薄壳：调 `gatherLandingData` + `renderLanding` |
| `src/main/modules/view/templates/landing.ts`（旧） | **删除**（内容已拆分到 `landing/` 子目录） |
| `src/main/modules/view/templates/shared-css.ts` | 不变（继续复用） |
| `src/main/server.ts` | 不变（路由注册方式不变） |

### 4.3 不动

- `src/main/server.ts`（路由注册不变）
- `src/main/modules/view/view-token-repo.ts`、`generate.ts`、`validate.ts`、`handler.ts`
- `src/main/modules/view/injector.ts`
- 所有业务模块（auth、employer、headhunter、candidate、admin、register 等）
- 数据库 schema（无新增表/字段）

---

## 5. 数据流

```
GET /
  ↓
routes/landing.ts (~15 行)
  ↓
gatherLandingData(db)   ← src/main/modules/view/gather-landing-data.ts
  ├─ 现有 10 个 SQL（openJobs / publicCandidates / industryGroups / recentJobs /
  │                users count / todayUnlocks / todayPlacements / totalCandidates /
  │                topHeadhunters / latestPlacements）
  ├─ NEW Top 雇主 SQL
  ├─ NEW Top 行业 SQL
  ├─ NEW Hot Skills SQL
  └─ NEW DB 探活 → healthStatus
  ↓
renderLanding(data)     ← src/main/modules/view/templates/landing/index.ts
  ├─ layout()           # <!DOCTYPE> + <head> + <body>
  ├─ nav(data)          # sticky 顶导 + 状态徽章
  ├─ roleAnchors()      # 4 role 锚点条
  ├─ hero(data)         # Hero + AGENT GATE
  ├─ stats(data)        # 4 stats 面板
  ├─ rankings(data)     # 5 tab 多维榜单
  ├─ employerSection(data)  # 公开候选人池
  ├─ headhunterSection(data)# 开放岗位列表
  ├─ candidateSection(data) # 4 步隐私时间线
  ├─ footer(data)       # Footer
  └─ inline CSS + JS    # landing.css.ts + landing.script.ts
  ↓
SSR HTML (text/html; charset=utf-8)
  ↓
200
```

---

## 6. 错误处理

| 场景 | 行为 |
|------|------|
| **整体 render 失败** | 500 + 简化版 fallback HTML（保留 nav + footer 风格），记日志含 `LandingData` 关键字段 |
| **单个新 SQL 失败** | 该字段 fallback 到 `[]` / `0` / `'degraded'`，其他字段照常渲染 |
| **DB 探活失败** | `healthStatus = 'degraded'`，status badge 显示橙色 "DEGRADED"，hover tooltip "数据库响应异常" |
| **候选人池为空** | 现有 fallback 文案保留："暂无公开候选人。查看 skill.md 了解如何注册 Agent" |
| **Hot Skills 为空** | 隐藏整个 Hot Skills tab 内容 + 文案 "暂无可统计的热门技能" |
| **XSS 防护** | 所有 user-controlled 字段（industry name、skill name、user name、job title、headhunter name）走 `esc()` 或 `html` 标签模板自动转义 |
| **SQL 注入** | 全部走 prepared statements（现有约定） |

---

## 7. 测试策略

### 7.1 单元测试

| 测试 | 覆盖 |
|------|------|
| `gather-landing-data.spec.ts` | 3 个新 SQL 正常返回；DB 抛错时各字段 fallback 到空值；DB 探活设置 healthStatus |
| `lib-html.spec.ts` | `esc()` 转义 `<` `>` `&` `"` `'` `null`；`html` 标签模板正确拼接、跳过 null/false、展开数组 |
| `partials/job-card.spec.ts` | job-card 渲染包含 title、salary、industry、skills |
| `partials/candidate-card.spec.ts` | candidate-card 渲染包含 title_level、years、salary、education、skills |

### 7.2 集成测试

| 测试 | 覆盖 |
|------|------|
| `GET / returns 200 + HTML` | 路由基本健康 |
| `GET / contains "Hunter Platform"` | Hero 渲染 |
| `GET / contains "AGENT GATE"` | AGENT GATE 区块渲染 |
| `GET / contains "复制"` | 复制按钮存在 |
| `GET / contains "HEALTHY"` | 状态徽章渲染 |
| `GET / contains "Top 猎头" + "Top 雇主" + "Top 行业" + "Hot Skills"` | 5 维榜单 tab 渲染 |
| `GET / renders with empty DB` | 不崩溃 |
| `GET / no PII leaked` | 不含 user_id / contact / email |
| `GET / render time < 200ms` | 性能基线 |
| `GET / fallback when DB error` | 200 + DEGRADED 徽章 |

### 7.3 视觉测试

- **不做**（后续可加 Playwright 截图对比）

---

## 8. 实现路径

### 8.1 任务分解（5 个 phase）

**Phase 1: 数据层**
- T1.1: 新建 `src/main/modules/view/gather-landing-data.ts`
- T1.2: 复制现有 `routes/landing.ts` 中的所有 SQL + 数据组装函数
- T1.3: 添加 3 个新 SQL（Top 雇主 / Top 行业 / Hot Skills）+ DB 探活
- T1.4: 添加新类型（EmployerRanking / IndustryRanking / SkillCount / HealthStatus）
- T1.5: 单元测试 `gather-landing-data.spec.ts`

**Phase 2: Helper 层**
- T2.1: 新建 `src/main/modules/view/templates/lib/html.ts`（`html` 标签模板 + `esc`）
- T2.2: 单元测试 `lib-html.spec.ts`
- T2.3: 新建 6 个 partials（job-card / candidate-card / ranking-row / skill-tag / status-badge / section-card）
- T2.4: 单元测试 partials

**Phase 3: 模板层**
- T3.0: **先删除**旧的 `src/main/modules/view/templates/landing.ts`（避免与新 `landing/` 目录冲突）
- T3.1: 新建 `landing/` 子目录的 13 个子文件（11 个 TS 模板 + 1 个 CSS + 1 个 JS）
- T3.2: layout.ts → nav.ts → role-anchors.ts → hero.ts → stats.ts → rankings.ts
- T3.3: employer-section.ts → headhunter-section.ts → candidate-section.ts → footer.ts
- T3.4: index.ts（renderLanding 组合入口）
- T3.5: landing.css.ts（新 section CSS）
- T3.6: landing.script.ts（复制按钮、tab 切换、smooth scroll、IntersectionObserver）

**Phase 4: 路由层**
- T4.1: 改写 `src/main/routes/landing.ts` 为薄壳（~15 行）
- T4.2: 集成测试 `landing-route.spec.ts`

**Phase 5: 收尾**
- T5.1: `pnpm typecheck` + `pnpm test` 全量
- T5.2: 手动 smoke（`curl localhost:3000/` 看渲染）
- T5.3: 删除 `landing.ts` 旧文件
- T5.4: 更新 README/docs（如有引用旧路径）
- T5.5: commit + push

### 8.2 估算代码量

- 模板代码：~700 行（11 个子模块 + 6 个 partials + lib + css + script）
- 测试代码：~250 行（unit + integration）
- 数据层：~200 行
- 路由层：~15 行
- **合计**：~1200 行（含 CSS、JS、测试）

### 8.3 风险点

| 风险 | 缓解 |
|------|------|
| 旧 `landing.ts` 删除前忘了改 import | 改完 routes/landing.ts 后做 typecheck |
| 11 个新文件的命名/路径不一致 | 严格按本 spec §4.1 表实施 |
| 复制按钮在 HTTP（非 HTTPS）环境失败 | 优雅降级为 "复制失败，请手动复制" |
| 移动端 sticky nav 占用太多屏幕 | 移动端折叠为汉堡菜单（MVP 不做，列入未来） |
| 5 维榜单数据量太少时显得空 | 隐藏空 tab，文案 "暂无数据" |

---

## 9. 决策记录

| 决策 | 选择 | 备选 | 理由 |
|------|-----|------|------|
| 改造范围 | **全面重做** | 轻量增强 / 中度重构 | 用户选定 2026-06-20 决策 |
| 首页叙事 | **Agent Platform 优先** | Marketplace / Privacy / 角色 Tab | 用户选定 |
| CTA 模型 | **主 CTA 是 API + role 锚点** | 单一主 CTA / 角色 Tab / 双 CTA | 用户选定 |
| 多维榜单 | **5 维·标准** | 3 维·极简 / 6 维·数据驱动 | 用户选定 |
| 代码组织 | **提取为可复用 helper** | 保持单文件 / EJS / lit-html | 用户选定 |
| 页面架构 | **垂直滚动 + sticky nav** | Tab 式骨架 / 混合 | 用户选定 |
| 状态徽章机制 | **DB 探活 + 静态 99.9%** | 调 /v1/health 接口 | 简单可靠，避免循环依赖 |
| 复制按钮 | **复制 URL 到剪贴板** | 复制完整 curl 命令 | URL 形式最易复用 |
| Tab URL 同步 | **支持 `#ranking=top-employers` 深链** | 不支持 | 提升 SEO 和分享性 |
| 候选人池交互 | **保持静态** | 加搜索 / 行业筛选 | 不在本次范围 |
| 国际化 | **不做** | en/zh-CN | 不在本次范围 |

---

## 10. 未来工作（不在本次范围）

- 移动端汉堡菜单 + 折叠 nav
- 候选人池搜索 / 行业筛选 / 薪资筛选
- 时序图（7 日 Unlocks / Placements 折线图）
- 国际化（en / zh-CN / ja）
- 暗色模式（基于 prefers-color-scheme）
- AGENT GATE 增强：除 skill.md 外还可复制 OpenAPI URL、curl 模板
- Hot Jobs carousel（自动轮播）
- 实时刷新（WebSocket / SSE）
- A/B 测试不同 Hero 文案
- "成为第一个 X" CTA（无数据时的引导）
- 用户身份自选：localStorage 记住"我通常是 X 角色"高亮对应锚点
