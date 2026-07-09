# Candidate Portal (C 端候选人门户) — Phase 1 设计规格

**项目**: hunter-platform
**阶段**: Phase 1 of 3 (Candidate → PM → Hunter)
**日期**: 2026-07-08
**作者**: ZCode brainstorming session
**状态**: Draft — 待用户审查

---

## 1. 背景与目标

### 1.1 业务背景

hunter-platform 当前是一个猎头中介市场 API + 着陆页 + React 后台的项目,核心流程是:
**猎头推荐 → 雇主表达兴趣 → 候选人批准解锁 → 解锁 PII**

这条流程由**猎头主动发起**,候选人是"被推荐"的角色,没有 C 端入口。候选人只能通过外部 Agent / 邮件链接进入,无法:
- 浏览所有开放工作
- 主动申请工作
- 查看自己被谁推荐
- 与猎头/雇主直接沟通
- 编辑自己的公开简历

### 1.2 目标

引入 **C 端候选人门户**,让候选人可以直接在 hunter 平台上:
1. 通过邮箱 + OTP 注册/登录
2. 浏览开放工作并查看与自己的匹配度
3. 主动申请工作 (经猎头认领后进入主流程)
4. 查看自己的申请进度
5. 接受/考虑/拒绝 offer
6. 与猎头/雇主沟通
7. 编辑公开简历 (技能/期望/可见性),查看简历审计日志

### 1.3 范围与非目标

**范围 (Phase 1)**:
- 8 个 C 端屏幕 (Login / Home / Browse / JobDetail / Applications / Offer / Messages / Profile)
- OTP 邮箱认证 (开发模式 console 输出)
- 候选人申请 → 猎头认领 → 原有 4 步解锁流程
- 候选人公开简历编辑 (PII 仍由猎头控制)
- 移动端响应式 + 暗色模式
- 候选人简历能力雷达图

**非目标 (Phase 1)**:
- 真实邮件发送 (开发模式 console only)
- 第三方 OAuth (微信/钉钉)
- 候选人推荐给其他候选人 (社交裂变)
- 候选人发布的"自我介绍视频"
- PM/Hunter 模式 (Phase 2/3)

---

## 2. 决策记录

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 阶段顺序 | PM → Hunter / Candidate → PM / 跳过 Hunter | **Candidate → PM → Hunter** | 用户决定。Candidate 是 C 端入口,产品价值面向最终用户。 |
| 借鉴方式 | 重写 / iframe / 静态化 | **React + TypeScript 重写** | 生产级,类型安全,与 hunter 现有 admin-web 一致。 |
| 路由架构 | 新增前缀 / 扩展 / 独立 SPA | **新增 `/v1/candidate-portal/*` 前缀** | 语义隔离,与现有 `/v1/candidate/*` 并行。 |
| 认证方式 | 邮箱+密码 / OTP / OAuth | **OTP 邮箱验证码** | C 端体验好,无需密码记忆。 |
| 邮件服务 | SMTP / 第三方 / console | **console 输出 (开发模式)** | MVP 阶段简化,后期接 SMTP/第三方。 |
| 申请流程 | 自荐→雇主 / 仅查看 / 猎头确认 | **候选人直接向猎头 (PM) 申请** | 猎头作为 PM 是中间角色,候选人的申请经猎头认领后才进入主流程。 |
| 数据所有权 | 候选人编辑全部 / 仅公开 / 仅查看 | **候选人只编辑公开部分** | 最小改变 hunter 数据模型,PII 仍由猎头控制。 |
| Phase 1 范围 | 8 屏 / 6 屏 / 4 屏 | **8 屏一次实现** | 用户决定,获取完整 C 端体验。 |

---

## 3. 架构总览

### 3.1 分层

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (admin-web React SPA, mobile-first)                │
│   /candidate/login  /home  /browse  /jobs/:id              │
│   /applications  /applications/:id  /offer                │
│   /messages  /profile                                     │
│   Shared: RadarChart, FunnelCard, MobileLayout, OtpInput   │
├─────────────────────────────────────────────────────────────┤
│ Backend (Express + TypeScript + Zod + node:sqlite)         │
│   /v1/candidate-portal/auth/otp/{request,verify}           │
│   /v1/candidate-portal/jobs/{recommended,browse,:id}       │
│   /v1/candidate-portal/applications (list/create/respond)  │
│   /v1/candidate-portal/messages (list/send)                │
│   /v1/candidate-portal/profile (get/put/audit)             │
│   /v1/headhunter/recommendations/{pending-pickup,pickup}   │
├─────────────────────────────────────────────────────────────┤
│ Modules: src/main/modules/candidate-portal/                │
│   handler.ts (路由分发) auth.ts jobs.ts applications.ts    │
│   messages.ts profile.ts                                   │
│   schemas/candidate-portal.ts                              │
│   db/repositories/candidate-portal.ts                       │
├─────────────────────────────────────────────────────────────┤
│ Persistence: node:sqlite + new migrations                  │
│   candidate_otp_codes, candidate_messages,                 │
│   candidate_applications                                  │
│   recommendations (+source_type, pickup_headhunter_id)     │
│   candidates_anonymized (+visibility, expectations_json)   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 模块职责

**`src/main/modules/candidate-portal/auth.ts`** — OTP 生成、验证、限流、token 签发

**`src/main/modules/candidate-portal/jobs.ts`** — 工作浏览、推荐匹配评分 (Jaccard)

**`src/main/modules/candidate-portal/applications.ts`** — 申请创建 (含事务)、状态转换、撤回

**`src/main/modules/candidate-portal/messages.ts`** — 候选人消息收发

**`src/main/modules/candidate-portal/profile.ts`** — 简历读取 (含 PII 只读副本)、公开字段更新、审计日志

**`src/main/modules/candidate-portal/handler.ts`** — 路由处理器工厂,组装上述模块

**`src/main/db/repositories/candidate-portal.ts`** — 候选人门户专用仓储

**`src/main/schemas/candidate-portal.ts`** — Zod 请求/响应 schemas

---

## 4. 数据模型变更

### 4.1 新增表

#### `candidate_otp_codes`

```sql
CREATE TABLE candidate_otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX idx_otp_email_active ON candidate_otp_codes(email, consumed_at, expires_at);
```

#### `candidate_messages`

```sql
CREATE TABLE candidate_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER,
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (application_id) REFERENCES candidate_applications(id)
);
CREATE INDEX idx_msg_to_user ON candidate_messages(to_user_id, read_at, created_at);
CREATE INDEX idx_msg_from_user ON candidate_messages(from_user_id, created_at);
```

#### `candidate_applications`

```sql
CREATE TABLE candidate_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id INTEGER NOT NULL UNIQUE,
  candidate_user_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL,
  pickup_headhunter_id INTEGER,
  candidate_note TEXT,
  withdrawn_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (recommendation_id) REFERENCES recommendations(id),
  FOREIGN KEY (candidate_user_id) REFERENCES users(id),
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (pickup_headhunter_id) REFERENCES users(id)
);
CREATE INDEX idx_app_candidate ON candidate_applications(candidate_user_id, created_at DESC);
CREATE INDEX idx_app_pickup ON candidate_applications(pickup_headhunter_id, created_at DESC);
```

### 4.2 修改表

#### `recommendations`

```sql
ALTER TABLE recommendations ADD COLUMN source_type TEXT NOT NULL DEFAULT 'headhunter';
  -- 'headhunter' | 'candidate_self_apply' | 'system'
ALTER TABLE recommendations ADD COLUMN pickup_headhunter_id INTEGER REFERENCES users(id);
ALTER TABLE recommendations ADD COLUMN candidate_note TEXT;
```

新增 status 值: `pending_pickup` (候选人申请后等待猎头认领)

#### `candidates_anonymized`

```sql
ALTER TABLE candidates_anonymized ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
  -- 'public' | 'invitation_only' | 'hidden'
ALTER TABLE candidates_anonymized ADD COLUMN expectations_json TEXT;
  -- {desired_roles: string[], expected_salary_min/max, open_to_remote, ...}
```

### 4.3 迁移文件

- `src/main/db/migrations/v025_candidate_portal.sql` — 3 张新表 + 2 张表 ALTER
- 现有 `MIGRATIONS` 数组追加 v025

### 4.4 新增 Capability

| capability_name | 说明 |
|----------------|------|
| `candidate_portal.auth.request_otp` | 候选人请求 OTP |
| `candidate_portal.auth.verify_otp` | 候选人验证 OTP |
| `candidate_portal.jobs.browse` | 浏览工作 |
| `candidate_portal.jobs.view` | 查看工作详情 |
| `candidate_portal.jobs.apply` | 申请工作 |
| `candidate_portal.applications.list` | 我的申请 |
| `candidate_portal.applications.respond` | 响应 (withdraw/consider/accept/decline) |
| `candidate_portal.messages.send` | 发消息 |
| `candidate_portal.messages.list` | 读消息 |
| `candidate_portal.profile.view` | 看简历 |
| `candidate_portal.profile.edit_public` | 编辑公开部分 |
| `candidate_portal.profile.view_audit` | 看简历审计 |
| `headhunter.recommendations.list_pending_pickup` | 猎头看待认领列表 |
| `headhunter.recommendations.pickup` | 猎头认领 |

---

## 5. API 端点

所有端点前缀 `/v1/candidate-portal/*`,除 OTP 请求外都需 `Authorization: Bearer hp_live_...`。

### 5.1 认证 (2 个端点)

| 方法 | 路径 | body | 响应 |
|------|------|------|------|
| POST | `/auth/otp/request` | `{email}` | `{ok: true, expires_in: 300}` (开发模式额外返回 `dev_code`) |
| POST | `/auth/otp/verify` | `{email, code}` | `{ok: true, api_key: "hp_live_...", user_id, profile_complete}` |

**限流**:
- `/auth/otp/request`:
  - 每 IP 60s 5 次 (短期防刷) + 1 小时 20 次 (长期防滥用)
  - 每邮箱 60s 1 次
- OTP 6 位数字, bcrypt hash 存储, 5 分钟过期, 最多 5 次尝试

**错误码**: `OTP_NOT_FOUND`, `OTP_EXPIRED`, `OTP_INVALID`, `OTP_TOO_MANY_ATTEMPTS`, `RATE_LIMITED_*`

### 5.2 工作 (3 个端点)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/jobs/recommended` | 推荐 top 20 (基于候选人 skills + expectations_json vs 工作 skills_json/industry/title_level 的 Jaccard 评分) |
| GET | `/jobs/browse?cursor=&limit=20&industry=&title_level=&keyword=` | 全部开放工作,分页 + 过滤 |
| GET | `/jobs/:id` | 工作详情 + 匹配度评分 + 雷达数据 |

**Jaccard 评分公式**:
```
score = |candidate_skills ∩ job_skills| / |candidate_skills ∪ job_skills| × 100
+ bonus if title_level_match (5)
+ bonus if salary_in_range (3)
+ bonus if industry_match (2)
```

### 5.3 申请 (3 个端点)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/jobs/:id/apply` | body `{note?: string}` → 创建 `recommendations` (status='pending_pickup', source_type='candidate_self_apply') + `candidate_applications` |
| GET | `/applications?cursor=&limit=` | 我的所有申请 |
| GET | `/applications/:id` | 单个申请详情 |
| POST | `/applications/:id/respond` | body `{action: 'withdraw' \| 'consider_offer' \| 'accept_offer' \| 'decline_offer'}` |

**错误码**: `JOB_NOT_FOUND`, `JOB_NOT_OPEN`, `ALREADY_APPLIED`, `APPLICATION_NOT_FOUND`, `APPLICATION_NOT_OWNED`, `APPLICATION_INVALID_STATE`

### 5.4 消息 (2 个端点)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/messages?cursor=&limit=&unread_only=&box=inbox\|sent` | 收件箱或发件箱 |
| POST | `/messages` | body `{application_id?: number, to_user_id: number, content: string}` |

### 5.5 Profile (3 个端点)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/profile` | 候选人可见简历 (公开字段 + PII 只读副本) |
| PUT | `/profile` | body `{skills?: string[], expectations_json?: {...}, visibility?: 'public'\|'invitation_only'\|'hidden'}` |
| GET | `/profile/audit-log?cursor=&limit=` | 谁查看了我的简历 |

### 5.6 猎头侧补充 (2 个端点,挂在 `/v1/headhunter/*`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/headhunter/recommendations/pending-pickup?cursor=&limit=` | 待认领列表 |
| POST | `/headhunter/recommendations/:id/pickup` | 认领 → status 转 `pending` |

### 5.7 错误处理

所有错误用现有 `respond()` + Zod `strict: true` 模式。统一错误信封:

```typescript
{
  ok: false,
  error: {
    code: 'APPLICATION_NOT_OWNED',
    message: '您无权操作此申请',
    details?: Record<string, unknown>
  }
}
```

---

## 6. 前端页面与组件

### 6.1 路由表 (admin-web/src/pages/candidate-portal/)

| 路径 | 页面 | 描述 |
|------|------|------|
| `/candidate/login` | `LoginPage.tsx` | 邮箱输入 → OTP 输入 → 完成 |
| `/candidate` | redirect → `/candidate/home` | — |
| `/candidate/home` | `HomePage.tsx` | 推荐工作卡片 (默认落地) |
| `/candidate/browse` | `BrowsePage.tsx` | 全部开放工作 |
| `/candidate/jobs/:id` | `JobDetailPage.tsx` | 工作详情 + 雷达图 + 申请按钮 |
| `/candidate/applications` | `ApplicationsPage.tsx` | 我的申请列表 |
| `/candidate/applications/:id` | `ApplicationDetailPage.tsx` | 单个申请详情 + 时间线 + 消息 |
| `/candidate/offer` | `OfferPage.tsx` | 收到的 offer 列表 |
| `/candidate/messages` | `MessagesPage.tsx` | 消息收/发 tab |
| `/candidate/profile` | `ProfilePage.tsx` | 简历查看/编辑 + 审计日志 tab |

### 6.2 共享组件 (admin-web/src/components/candidate-portal/)

| 组件 | 用途 |
|------|------|
| `MobileLayout.tsx` | 顶部栏 + 底部 tab bar (≤768px) |
| `RadarChart.tsx` | 5 维能力雷达图 (SVG) |
| `JobCard.tsx` | 工作卡片 (标题/公司/地点/薪资/技能/匹配分) |
| `MatchScore.tsx` | 匹配度分数徽章 (0-100, 颜色渐变) |
| `FunnelCard.tsx` | 5 阶段子漏斗 |
| `MessageBubble.tsx` | 消息气泡 |
| `OtpInput.tsx` | 6 位 OTP 输入框 (auto-focus, paste) |
| `EmptyState.tsx` | 空状态 |

### 6.3 视觉设计令牌 (admin-web/src/styles/tokens.css)

提取 ow-recruit 的 CSS variables:

```css
:root {
  --c-project: #2563eb; --b-project: #eff6ff;
  --c-position: #16a34a; --b-position: #f0fdf4;
  --c-candidate: #d97706; --b-candidate: #fffbeb;
  --c-match: #9333ea; --b-match: #faf5ff;
  --c-hunter: #10b981; --b-hunter: rgba(16,185,129,0.1);
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-6: 24px; --sp-8: 32px;
  --shadow-1: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-2: 0 2px 4px rgba(0,0,0,0.08);
  --shadow-3: 0 4px 8px rgba(0,0,0,0.12);
  --shadow-4: 0 8px 16px rgba(0,0,0,0.16);
  --font-sans: 'Inter', 'Noto Sans SC', -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
[data-theme="dark"] {
  --bg: #0a0a0a; --surface: #171717; --text: #fafafa;
}
```

### 6.4 响应式断点

- `≤768px`: 移动布局 (单列 + 底部 tab bar)
- `769-1024px`: 平板 (2 列)
- `≥1025px`: 桌面 (3 列 + 侧边栏)

### 6.5 状态管理

- React Query (新增依赖) 处理 API 缓存/重试/乐观更新
- 用户会话存 localStorage (`hp_candidate_session`)
- 路由守卫: `RequireAuth` HOC 检查 token, 无 token 重定向 `/candidate/login`

---

## 7. 认证流程 (OTP)

```
[候选人打开 /candidate/login]
        ↓ 输入邮箱
POST /v1/candidate-portal/auth/otp/request
  ├─ 限流检查 (IP 60s, 邮箱 60s)
  ├─ 生成 6 位随机数字 (crypto.randomInt)
  ├─ bcrypt.hash(code, cost=4) → 存 candidate_otp_codes
  ├─ console.log(`[DEV ONLY] OTP for ${email}: ${code}`) (开发模式)
  └─ respond { ok: true, expires_in: 300 }

[候选人收到验证码 (开发: 控制台)]
        ↓ 输入 6 位 OTP
POST /v1/candidate-portal/auth/otp/verify
  ├─ 查 candidate_otp_codes WHERE email=? AND consumed_at IS NULL AND expires_at > now
  ├─ if not found → OTP_EXPIRED
  ├─ bcrypt.compare(input, code_hash)
  ├─ if !match → attempts++, if attempts ≥ 5 → OTP_TOO_MANY_ATTEMPTS
  ├─ if match:
  │    ├─ 查 users WHERE email=? AND user_type='candidate'
  │    │    ├─ not found → 自动创建用户 (user_type=candidate, status=active)
  │    │    └─ found → 复用
  │    ├─ 生成 api_key (hp_live_<24B>)
  │    ├─ bcrypt.hash + UPDATE users SET api_key_hash, api_key_prefix
  │    ├─ UPDATE candidate_otp_codes SET consumed_at=now
  │    └─ respond { ok: true, api_key, user_id, profile_complete }
  └─ 前端存 localStorage 'hp_candidate_session' = JSON({api_key, user_id})
```

**安全考虑**:
- OTP 5 分钟过期, 最多 5 次尝试
- 限流: 每邮箱 60s 1 次, 每 IP 60s 5 次
- 自动注册时: 邮箱需符合 RFC 5322 简化版
- 当前 session 无 refresh token, 过期需重新 OTP 登录 (MVP 简化)

---

## 8. 申请流程 (候选人申请 → 猎头认领)

```
[候选人在 /candidate/jobs/:id 点 "立即申请"]
        ↓ 可选填写附言
POST /v1/candidate-portal/jobs/:id/apply { note?: string }
  ├─ 校验: jobs.status='open'
  ├─ 校验: 不存在重复 (同候选人 + 同工作 无 pending/pending_pickup 推荐)
  ├─ BEGIN TRANSACTION
  ├─ INSERT INTO recommendations (..., source_type='candidate_self_apply',
  │      candidate_note=note, status='pending_pickup', created_at=now)
  ├─ INSERT INTO candidate_applications (recommendation_id, candidate_user_id, job_id, candidate_note)
  ├─ COMMIT
  ├─ notify: 通知所有猎头 "新候选人待认领"
  └─ respond { ok: true, application_id }

[猎头在后台 /admin/recommendations?filter=pending_pickup]
GET /v1/headhunter/recommendations/pending-pickup

[猎头点 "认领"]
POST /v1/headhunter/recommendations/:id/pickup
  ├─ 校验: status='pending_pickup' AND pickup_headhunter_id IS NULL
  ├─ UPDATE recommendations SET pickup_headhunter_id=current_hunter_id, status='pending'
  ├─ UPDATE candidate_applications SET pickup_headhunter_id=current_hunter_id
  ├─ notify: 通知候选人 "您的申请已被 XXX 猎头认领"
  └─ respond { ok: true }

[进入原有 4 步流程]
  pending → employer_express_interest → candidate_approve_unlock → unlocked
```

**失败模式**:
- 候选人撤回: `POST /v1/candidate-portal/applications/:id/respond {action:'withdraw'}` (仅 pending_pickup/pending 状态允许)
- 雇主拒绝后候选人收到通知, 无需操作
- 候选人超时未响应: 走现有 `rejected_timeout` 终态

---

## 9. 测试策略

### 9.1 后端 (Vitest)

- **单元测试**: `tests/unit/candidate-portal/`
  - OTP 生成/验证
  - 限流
  - Jaccard 评分
  - 申请状态机
- **集成测试**: `tests/integration/candidate-portal/`
  - 每个端点 supertest 测试
  - 状态转换测试
  - 并发安全测试 (100 并发申请同一工作)
  - 审计测试 (action_history 写入)
  - PII 安全测试 (PUT /profile 携带额外字段被 Zod 拒绝)

### 9.2 前端 (Vitest + Testing Library)

- **组件测试**: `admin-web/src/pages/candidate-portal/__tests__/`
  - RadarChart、FunnelCard、MobileLayout、OtpInput
- **流程测试**: OTP 登录 → 浏览 → 申请 → 查看列表 → 撤回
- **响应式测试**: 视口变化 (375px / 768px / 1280px) 下的布局快照
- **暗色模式测试**: token 切换正确

### 9.3 性能基准

- `GET /jobs/recommended` p95 < 200ms (缓存后)
- `POST /jobs/:id/apply` p95 < 150ms
- 移动端 Lighthouse 性能 ≥ 80

---

## 10. 迁移与部署

### 10.1 数据库迁移

- 新增 `src/main/db/migrations/v025_candidate_portal.sql`
- 现有 `MIGRATIONS` 数组追加 v025
- 迁移验证: 在 staging 跑全量测试 + 模拟回滚

### 10.2 配置

- 新增环境变量 (可选):
  - `OTP_CONSOLE_ONLY=true|false` (默认 true for MVP)
  - `OTP_LENGTH=6` (默认 6)
  - `OTP_TTL_SECONDS=300` (默认 300)
  - `OTP_MAX_ATTEMPTS=5` (默认 5)

### 10.3 部署

- 后端: 与现有 API 同步部署 (无需新进程)
- 前端: `admin-web` 重新构建, 静态资源由 Express 静态服务
- 文档: 更新 `docs/CHANGELOG.md` v3.0.0 (候选门户上线)

### 10.4 灰度策略

- Phase 1.1 上线: 仅邀请 10 个种子候选人 (运营手动发邮件)
- Phase 1.2 (1 周后): 开放注册
- Phase 1.3 (2 周后): 移动端推广

### 10.5 风险与缓解

| 风险 | 缓解 |
|------|------|
| OTP 邮件发送延迟/失败 | 开发模式 console + 后期接 SMTP |
| 候选人滥用注册 (垃圾账号) | 限流 + 邮箱验证 + 后续接入 reCAPTCHA |
| 大量候选人申请导致 SQLite 性能问题 | 申请量 < 1000/天无影响, 后续评估 |
| 与现有 4 步流程冲突 | 状态机扩展, 严格状态转换测试 |
| 移动端性能 | Lighthouse 监控 + 图片懒加载 + 代码分割 |

---

## 11. 后续阶段预览

### Phase 2: PM 模式 (ow-recruit 借鉴)

- 项目库 + 项目详情 + 岗位分解 (AI 启发式) + 计划对比 + 招聘沙盒 + 候选人匹配
- 数据模型: projects, plans, position_decompositions, matches
- 复用 candidate-portal 的简历数据 + hunter 现有 candidates_anonymized

### Phase 3: Hunter 模式 (ow-recruit 借鉴)

- 工作台 + 候选人列表 + 看板 + 候选人详情 + 对比 + 任务
- 复用 candidate-portal 的工作 + Phase 2 的项目 + hunter 现有 candidates
- 新增"待认领"页面集成 Phase 1 的待认领列表

---

## 12. 验收标准

- [ ] 候选人可通过邮箱 + OTP 完成注册/登录
- [ ] 候选人可浏览所有开放工作并按行业/职级/关键词过滤
- [ ] 候选人可查看与自己的匹配度评分 (雷达图 + 分数)
- [ ] 候选人可申请工作,附言可选
- [ ] 猎头可在后台看到"待认领"列表并认领
- [ ] 候选人收到认领通知,可在"我的申请"看到进度
- [ ] 候选人可与猎头/雇主消息沟通
- [ ] 候选人可接受/考虑/拒绝 offer
- [ ] 候选人可编辑公开简历字段 (技能/期望/可见性)
- [ ] 候选人可查看简历审计日志
- [ ] 移动端 (≤768px) 布局正确,Lighthouse ≥ 80
- [ ] 暗色模式可用
- [ ] OTP 限流 + 5 次尝试 + 5 分钟过期 验证
- [ ] PUT /profile 不允许编辑 PII 验证
- [ ] 后端测试覆盖 ≥ 80%,前端测试覆盖 ≥ 60%
- [ ] 数据迁移在 staging 跑通, 无回滚问题

---

**变更日志**:
- 2026-07-08: 初始版本, brainstorming session 输出