# Marketplace Landing Page — Spec

**状态**: Draft
**日期**: 2026-06-18
**作者**: brainstorming session
**前置**: [2026-06-17-hunter-platform-design.md](./2026-06-17-hunter-platform-design.md)

---

## 1. 概述

### 1.1 一句话定义

新增 **`GET /` (root) 营销 landing page**：用**真实数据库数据**展示平台价值，按三种角色（candidate/headhunter/employer）分块，每个角色有自己的 value prop + 真实数据样本 + CTA。目标：访问者看完想立即注册成 Agent 调用 API。

### 1.2 触发原因

原 `GET /dashboard` 是给**运维**看的聚合数字。用户实际想要的是**给访客看的市场橱窗**——展示"这里有人/有岗/有价值"。

### 1.3 目标

1. `GET /` 返回 SSR HTML，**公开**（无 auth）
2. 4 大板块：Hero、For Employer、For Headhunter、For Candidate
3. 用**真实 DB 数据**（候选人、行业、岗位）证明平台真有价值
4. **CTA 链接**指向具体的 API 演示（如 `/v1/skill.md`、`/v1/openapi.json`）

### 1.4 非目标

- 不是 ops 监控（那个保留为 `/v1/health`）
- 不是用户个人 dashboard
- 不做交互式筛选（v1 是静态浏览页）
- 不做营销文案 A/B 测试

---

## 2. 视觉设计（HTML 结构）

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│         🔍 Hunter Platform                                          │
│         猎头中介 API 平台                                           │
│         候选人隐私受保护 · 4 步解锁协议 · 20% 平台抽佣                  │
│                                                                  │
│         [📖 Read skill.md]  [📋 OpenAPI]  [🏥 Health]           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

┌─ For Employers ──────────────────────────────────────────────┐
│ 在招岗位: X                                                     │
│ 看脱敏候选人池 → 用 Agent 调 GET /v1/employer/talent              │
│  候选人不需注册，只需要雇主 Agent 调用 API 即可浏览                      │
│                                                              │
│ ▌互联网 (X人)                                                  │
│   P6 · 8年 · 60-80万 · 985 · React/TypeScript/Go               │
│   P6 · 5年 · 40-60万 · 普通 · Python/Django/AWS               │
│   ... (top 5 per industry)                                     │
│                                                              │
│ ▌金融 (Y人)                                                    │
│   ...                                                          │
└──────────────────────────────────────────────────────────────┘

┌─ For Headhunters ────────────────────────────────────────────┐
│ 今日可推荐的开放岗位: Z                                       │
│ 上传候选人脱敏入库 → Agent 调 POST /v1/headhunter/candidates    │
│  每次成功 placement 拿 20% 佣金                                │
│                                                              │
│ ▌最近 5 个开放岗位                                              │
│   高级前端工程师 · 互联网 · 60-80万 · [React, TypeScript]        │
│   Backend Engineer · 金融 · 80-120万 · [Go, PostgreSQL]         │
│   ...                                                          │
└──────────────────────────────────────────────────────────────┘

┌─ For Candidates ────────────────────────────────────────────┐
│ 当前活跃雇主 + 猎头: N                                        │
│ 你的 PII 加密存储，只有你授权解锁后才能被对方看到                       │
│  候选人 Agent 调用 POST /v1/candidate/opportunities 查看匹配机会       │
│                                                              │
│ ▌隐私保护 4 步                                                │
│  1. 猎头上传时自动脱敏（industry / title_level / salary_range）   │
│  2. 雇主浏览只看到脱敏数据                                       │
│  3. 雇主表达兴趣时通知候选人                                     │
│  4. 候选人授权后才解锁联系方式                                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 数据来源

### 3.1 For Employers section

```sql
-- Total candidates in public pool (used for header "在招岗位" — actually wrong, this is candidates)
-- Wait, re-reading: 在招岗位 = open jobs count, not candidates
```

**Header**: "在招岗位: X" — count of jobs with status='open'

```sql
SELECT COUNT(*) FROM jobs WHERE status = 'open';
```

**Industry breakdown**（top 5 candidates per industry）:

```sql
-- Top 5 candidates per industry in public pool
SELECT industry, anonymized_id, title_level, years_experience, salary_range, education_tier, skills_json
FROM candidates_anonymized
WHERE is_public_pool = 1
  AND industry IS NOT NULL
ORDER BY industry, created_at DESC;
```

In JS: group by industry, slice top 5 per group.

### 3.2 For Headhunters section

**Header**: "今日可推荐的开放岗位: Z" — count of open jobs

```sql
SELECT COUNT(*) FROM jobs WHERE status = 'open';
```

**Recent 5 open jobs**:

```sql
SELECT title, industry, salary_min, salary_max, required_skills_json
FROM jobs
WHERE status = 'open'
ORDER BY created_at DESC
LIMIT 5;
```

### 3.3 For Candidates section

**Header**: "当前活跃雇主 + 猎头: N" — sum of active headhunter + employer users

```sql
SELECT user_type, COUNT(*) as count
FROM users
WHERE status = 'active' AND user_type IN ('headhunter', 'employer')
GROUP BY user_type;
```

### 3.4 复用现有 CSS

`src/main/modules/view/templates/shared-css.ts` 提供 `.card`, `.kv`, `.tag`, `.timeline` 等。

---

## 4. 文件变更

### 4.1 新增

| 文件 | 用途 |
|------|------|
| `src/main/modules/view/templates/landing.ts` | landing page 渲染函数（4 个 section + hero）|
| `tests/integration/landing.test.ts` | 4-6 个集成测试 |

### 4.2 修改

| 文件 | 改动 |
|------|------|
| `src/main/routes/admin.ts` | 把 `/dashboard` 路由**替换**为 `/`（landing page）；保留 dashboard.ts 模板但**不再注册**（或彻底删除）|
| 或 | 加新 `/` 路由到 `admin.ts`，保留 dashboard 单独 |

**建议**：彻底删除 `dashboard.ts` 模板 + `/dashboard` 路由，因为用户明确说 dashboard 不是想要的。`admin.ts` 改成 `landing.ts` 路由负责 `/`。

### 4.3 删除

| 文件 | 删除原因 |
|------|---------|
| `src/main/modules/view/templates/dashboard.ts` | 用户不要 ops dashboard |
| `src/main/routes/admin.ts`（整个文件） | 替换为 landing.ts |
| `tests/integration/dashboard.test.ts` | 不再相关 |

---

## 5. 数据流

```
GET / (公开)
  ↓
gatherLandingData(db)
  ├─ SELECT COUNT(*) FROM jobs WHERE status='open'           → open_jobs_count
  ├─ SELECT industry, ... FROM candidates_anonymized ...    → grouped by industry, top 5 each
  ├─ SELECT title, ... FROM jobs WHERE status='open' ...      → recent 5 jobs
  └─ SELECT user_type, COUNT(*) FROM users ...              → active employer/headhunter counts
  ↓
renderLanding(data)
  ↓
SSR HTML → 200 text/html
```

---

## 6. 错误处理

| 场景 | 行为 |
|------|------|
| DB 查询失败 | 显示 fallback 数字（"X+ 候选人"），不暴露内部错误 |
| 无候选人 | "暂无公开候选人" + CTA: "成为第一个上传候选人的猎头" |
| 无开放岗位 | "暂无开放岗位" + CTA: "成为第一个发布岗位的雇主" |
| 不渲染 emoji 时 | emoji fallback 为文字 |

---

## 7. 测试策略

| 测试 | 内容 |
|------|------|
| `GET /` returns 200 + HTML | 基础 |
| HTML contains hero text + 3 role sections | 结构 |
| HTML shows actual open job count | 数据从 DB 来 |
| HTML shows actual candidate count | 数据从 DB 来 |
| HTML does NOT include any user_id / contact / email | 无 PII |
| HTML does NOT include raw anonymized_id in main list | 隐私：除非用户主动点 detail，不直接显示 ID |
| HTML renders with empty DB (no jobs, no candidates) | 优雅降级 |

总计 ~7 个 it。

---

## 8. 实现路径

1. **T1**: 删除 `dashboard.ts` + `admin.ts` + `dashboard.test.ts`（git rm）
2. **T2**: 创建 `landing.ts` 模板 + 新 admin router（只挂 `/`）+ 7 个测试
3. **T3**: typecheck + 全测试 + smoke + commit + push

预计代码 ~300 行（template + router + tests）。

---

## 9. 决策记录

| 决策 | 选择 | 备选 |
|------|-----|------|
| URL | `GET /`（root） | `/landing` 或 `/marketplace` |
| 路由文件 | 复用 `routes/admin.ts` | 新建 `routes/landing.ts` |
| 数据隐私 | 候选人卡片只显示 industry/title/salary，**不显示 anonymized_id** | 显示 ID 但加上"点开看"按钮 |
| 候选人分组 | 按 industry | 按 title_level / salary_range |
| 删除 dashboard | ✅ 整体替换 | 保留 dashboard + 加 landing |

---

## 10. 未来工作

- 加交互筛选（按 industry/title_level）
- 加 "看更多候选人" 链接（需要分页）
- 加 realtime 在线用户数
- 加 referral 链接（每个 Agent 分享带来的注册）