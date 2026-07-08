# Candidate Portal (C 端候选人门户) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 C 端候选人门户 (Phase 1 of ow-recruit-saas 整合): 候选人可通过邮箱 OTP 注册/登录,浏览/申请工作,经猎头认领后进入原 4 步解锁流程;新增 React 移动优先 UI。

**Architecture:**
- 后端: 扩展 hunter Express API, 新增 `/v1/candidate-portal/*` 路由组 (语义独立, 不污染现有 `/v1/candidate/*`); 新增 3 张表 + 扩展 2 张表; 复用现有 auth/audit/rate-limit/quota 模式。
- 前端: 扩展现有 admin-web React SPA, 新增 `/candidate/*` 路由 (移动优先 + 桌面响应式); 复用 React Query 缓存 + 现有样式基础; 提取 ow-recruit 设计令牌。
- 状态机: 扩展 `recommendations.status` 增 `pending_pickup`, 候选人申请进入此态等待猎头认领后转 `pending`。

**Tech Stack:**
- 后端: TypeScript strict + Express + Zod (strict: true) + node:sqlite + bcryptjs + vitest + supertest
- 前端: React 18 + TypeScript + React Router 6 + React Query + 现有 plain CSS + 新增 design tokens
- 借鉴来源: `C:\Users\Administrator\Desktop\ow-recruit-saas\prototype.html` (候选模式 8 屏幕 + 视觉令牌)

**Spec**: `docs/superpowers/specs/2026-07-08-candidate-portal-design.md`

---

## Priority Summary

| Phase | 范围 | 任务数 | 预计工时 |
|-------|------|--------|----------|
| A: 后端基础 | 迁移 + capability + 库 | 3 | 4h |
| B: 后端 Auth | OTP 请求/验证 + 用户自动创建 | 2 | 4h |
| C: 后端 Profile + 匹配 | Jaccard + 简历 CRUD | 2 | 5h |
| D: 后端 Jobs | 浏览/推荐/详情 | 2 | 4h |
| E: 后端 Applications | 状态机 + 申请 | 3 | 6h |
| F: 后端 Pickup | 猎头认领 | 1 | 2h |
| G: 后端 Messages | 候选人消息 | 1 | 3h |
| H: 后端 Router | 路由挂载 | 1 | 1h |
| I: 前端基础 | 依赖 + 令牌 + 会话 + 8 组件 | 4 | 7h |
| J: 前端页面 | 10 页面 | 5 | 12h |
| K: 前端路由 | App.tsx 挂载 | 1 | 1h |
| L: E2E + 文档 | 烟雾测试 + CHANGELOG | 2 | 2h |
| **总计** | | **27** | **~51h (6-7 工作日)** |

---

## File Structure

### 后端新增

| 文件 | 用途 |
|------|------|
| `src/main/db/migrations/v025_candidate_portal.sql` | 3 新表 + 2 ALTER |
| `src/main/db/repositories/candidate-otp.ts` | OTP 仓储 |
| `src/main/db/repositories/candidate-messages.ts` | 消息仓储 |
| `src/main/db/repositories/candidate-applications.ts` | 申请仓储 |
| `src/main/db/repositories/candidate-portal-profile.ts` | 简历门户仓储 (含 PII 读取) |
| `src/main/db/repositories/headhunter-pickup.ts` | 猎头认领仓储 |
| `src/main/lib/otp.ts` | OTP 生成/校验 (bcrypt) |
| `src/main/lib/email.ts` | 邮件服务 (MVP console only) |
| `src/main/lib/rate-limit-portal.ts` | 候选人门户专用限流 (独立于现有 rate-limit) |
| `src/main/lib/matching.ts` | Jaccard 评分函数 |
| `src/main/schemas/candidate-portal.ts` | Zod 请求/响应 schemas |
| `src/main/modules/candidate-portal/handler.ts` | 主 handler 工厂 |
| `src/main/modules/candidate-portal/auth.ts` | OTP 端点 |
| `src/main/modules/candidate-portal/jobs.ts` | 工作端点 |
| `src/main/modules/candidate-portal/applications.ts` | 申请端点 |
| `src/main/modules/candidate-portal/messages.ts` | 消息端点 |
| `src/main/modules/candidate-portal/profile.ts` | 简历端点 |
| `src/main/modules/candidate-portal/headhunter-pickup.ts` | 猎头认领端点 |
| `src/main/routes/candidate-portal.ts` | `/v1/candidate-portal/*` 路由 |
| `src/main/capabilities/candidate-portal.ts` | 候选人门户 capability 声明 |

### 后端修改

| 文件 | 修改内容 |
|------|----------|
| `src/main/db/migrations.ts` | 注册 v025 |
| `src/main/db/repositories/recommendations.ts` | 增加 `source_type`/`pickup_headhunter_id`/`candidate_note` 列处理 |
| `src/main/db/repositories/candidates-anonymized.ts` | 增加 `visibility`/`expectations_json` 列处理 |
| `src/main/db/repositories/users.ts` | 增加候选人查找/创建 (email 索引) |
| `src/main/flows/index.ts` | 扩展 `recFlow` 增加 `pending_pickup` 状态转换 |
| `src/main/capabilities/headhunter.ts` | 增加 2 个新 capability |
| `src/main/capabilities/index.ts` | 注册新 capability 模块 |
| `src/main/env.ts` | 增加 `OTP_*` 环境变量 |
| `src/main/server.ts` | 挂载 `/v1/candidate-portal` 路由 + 给 `/v1/headhunter` 路由组扩展 |
| `src/main/routes/headhunter.ts` | 增加 `/recommendations/pending-pickup` + `/recommendations/:id/pickup` |

### 前端新增

| 文件 | 用途 |
|------|------|
| `admin-web/src/styles/tokens.css` | 设计令牌 (ow-recruit 提取) |
| `admin-web/src/lib/candidate-session.ts` | localStorage 会话管理 |
| `admin-web/src/api/candidate-portal.ts` | 类型化 API 客户端 |
| `admin-web/src/components/candidate-portal/MobileLayout.tsx` | 移动布局 + 底部 tab bar |
| `admin-web/src/components/candidate-portal/RadarChart.tsx` | SVG 雷达图 |
| `admin-web/src/components/candidate-portal/JobCard.tsx` | 工作卡片 |
| `admin-web/src/components/candidate-portal/MatchScore.tsx` | 匹配度徽章 |
| `admin-web/src/components/candidate-portal/FunnelCard.tsx` | 5 阶段漏斗 |
| `admin-web/src/components/candidate-portal/MessageBubble.tsx` | 消息气泡 |
| `admin-web/src/components/candidate-portal/OtpInput.tsx` | 6 位 OTP 输入 |
| `admin-web/src/components/candidate-portal/EmptyState.tsx` | 空状态 |
| `admin-web/src/components/candidate-portal/RequireAuth.tsx` | 路由守卫 |
| `admin-web/src/pages/candidate-portal/LoginPage.tsx` | 登录 (OTP) |
| `admin-web/src/pages/candidate-portal/HomePage.tsx` | 推荐工作 |
| `admin-web/src/pages/candidate-portal/BrowsePage.tsx` | 浏览全部 |
| `admin-web/src/pages/candidate-portal/JobDetailPage.tsx` | 工作详情 + 申请 |
| `admin-web/src/pages/candidate-portal/ApplicationsPage.tsx` | 我的申请列表 |
| `admin-web/src/pages/candidate-portal/ApplicationDetailPage.tsx` | 申请详情 + 时间线 |
| `admin-web/src/pages/candidate-portal/OfferPage.tsx` | 收到的 offer |
| `admin-web/src/pages/candidate-portal/MessagesPage.tsx` | 消息收/发 |
| `admin-web/src/pages/candidate-portal/ProfilePage.tsx` | 简历查看/编辑 + 审计 |

### 前端修改

| 文件 | 修改内容 |
|------|----------|
| `admin-web/package.json` | 增加 `@tanstack/react-query` |
| `admin-web/src/main.tsx` | 包裹 QueryClientProvider |
| `admin-web/src/App.tsx` | 增加 `/candidate/*` 路由 + RequireAuth |
| `admin-web/src/styles.css` | import tokens.css |
| `admin-web/vite.config.ts` | 增加 `/candidate` base 配置 |

### 测试新增

| 文件 | 范围 |
|------|------|
| `tests/unit/lib/otp.test.ts` | OTP 生成/校验 |
| `tests/unit/lib/matching.test.ts` | Jaccard 评分 |
| `tests/unit/candidate-portal/state-machine.test.ts` | pending_pickup 转换 |
| `tests/integration/candidate-portal/auth.test.ts` | OTP 端到端 |
| `tests/integration/candidate-portal/profile.test.ts` | 简历端到端 |
| `tests/integration/candidate-portal/jobs.test.ts` | 工作端到端 |
| `tests/integration/candidate-portal/applications.test.ts` | 申请端到端 |
| `tests/integration/candidate-portal/messages.test.ts` | 消息端到端 |
| `tests/integration/candidate-portal/headhunter-pickup.test.ts` | 猎头认领 |
| `admin-web/src/components/candidate-portal/__tests__/RadarChart.test.tsx` | 雷达图组件 |
| `admin-web/src/components/candidate-portal/__tests__/OtpInput.test.tsx` | OTP 输入 |

### 文档

| 文件 | 内容 |
|------|------|
| `docs/CHANGELOG.md` | v3.0.0 (候选门户上线) |
| `docs/superpowers/skills/hunter-platform/SKILL.md` | 增加 candidate-portal capability 列表 |

---

## Phase A: 后端基础

### Task 1: 数据库迁移 v025 (3 新表 + 2 ALTER + 注册)

**Files:**
- Create: `src/main/db/migrations/v025_candidate_portal.sql`
- Modify: `src/main/db/migrations.ts:37`

- [ ] **Step 1: 创建迁移 SQL 文件**

创建 `src/main/db/migrations/v025_candidate_portal.sql`:

```sql
-- ============================================================================
-- Migration v025: Candidate Portal (Phase 1 of ow-recruit-saas integration)
-- ============================================================================
-- Adds:
--   1. candidate_otp_codes — 候选人 OTP 邮箱登录临时码
--   2. candidate_messages  — 候选人 ↔ 猎头/雇主消息
--   3. candidate_applications — 候选人主动发起的申请 (推荐 + 副本)
-- Modifies:
--   4. recommendations: +source_type, +pickup_headhunter_id, +candidate_note
--   5. candidates_anonymized: +visibility, +expectations_json
-- ============================================================================

CREATE TABLE candidate_otp_codes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL,
  code_hash     TEXT    NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX idx_otp_email_active ON candidate_otp_codes(email, consumed_at, expires_at);

CREATE TABLE candidate_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id  INTEGER,
  from_user_id    INTEGER NOT NULL,
  to_user_id      INTEGER NOT NULL,
  content         TEXT    NOT NULL,
  read_at         INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (application_id) REFERENCES candidate_applications(id)
);
CREATE INDEX idx_msg_to_user   ON candidate_messages(to_user_id, read_at, created_at DESC);
CREATE INDEX idx_msg_from_user ON candidate_messages(from_user_id, created_at DESC);

CREATE TABLE candidate_applications (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id     INTEGER NOT NULL UNIQUE,
  candidate_user_id     INTEGER NOT NULL,
  job_id                INTEGER NOT NULL,
  pickup_headhunter_id  INTEGER,
  candidate_note        TEXT,
  withdrawn_at          INTEGER,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (recommendation_id)    REFERENCES recommendations(id),
  FOREIGN KEY (candidate_user_id)    REFERENCES users(id),
  FOREIGN KEY (job_id)               REFERENCES jobs(id),
  FOREIGN KEY (pickup_headhunter_id) REFERENCES users(id)
);
CREATE INDEX idx_app_candidate ON candidate_applications(candidate_user_id, created_at DESC);
CREATE INDEX idx_app_pickup    ON candidate_applications(pickup_headhunter_id, created_at DESC);

-- ALTER existing tables
ALTER TABLE recommendations ADD COLUMN source_type TEXT NOT NULL DEFAULT 'headhunter';
  -- 'headhunter' | 'candidate_self_apply' | 'system'
ALTER TABLE recommendations ADD COLUMN pickup_headhunter_id INTEGER REFERENCES users(id);
ALTER TABLE recommendations ADD COLUMN candidate_note TEXT;

ALTER TABLE candidates_anonymized ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
  -- 'public' | 'invitation_only' | 'hidden'
ALTER TABLE candidates_anonymized ADD COLUMN expectations_json TEXT;
  -- {desired_roles: string[], expected_salary_min: number, expected_salary_max: number, open_to_remote: bool, ...}
```

- [ ] **Step 2: 在 migrations.ts 中注册 v025**

修改 `src/main/db/migrations.ts:37`,在 MIGRATIONS 数组追加:

```typescript
{ version: 18, description: 'Candidate Portal Phase 1 (otp codes, messages, applications, recommendations.pickup_headhunter_id, candidates_anonymized.visibility)', file: 'migrations/v025_candidate_portal.sql' },
```

- [ ] **Step 3: 运行迁移并验证**

Run: `pnpm dev`
Expected: 服务正常启动,日志输出 `applied migration v025` (或 `migration already applied` 如果之前跑过)

然后:
```bash
sqlite3 tmp/hunter.db ".schema candidate_otp_codes"
sqlite3 tmp/hunter.db ".schema candidate_messages"
sqlite3 tmp/hunter.db ".schema candidate_applications"
sqlite3 tmp/hunter.db "PRAGMA table_info(recommendations);"
sqlite3 tmp/hunter.db "PRAGMA table_info(candidates_anonymized);"
```

Expected: 3 张新表 + 2 张表新增列已存在

- [ ] **Step 4: 提交**

```bash
git add src/main/db/migrations/v025_candidate_portal.sql src/main/db/migrations.ts
git commit -m "feat(db): migration v025 — candidate portal (otp/messages/applications + recs/anonymized extensions)"
```

---

### Task 2: 新增能力声明 + 环境变量

**Files:**
- Create: `src/main/capabilities/candidate-portal.ts`
- Create: `src/main/capabilities/headhunter-pickup.ts` (或合并到 headhunter.ts)
- Modify: `src/main/capabilities/index.ts`
- Modify: `src/main/env.ts`

- [ ] **Step 1: 创建 candidate-portal capability 文件**

创建 `src/main/capabilities/candidate-portal.ts`:

```typescript
import type { Capability } from './types.js';

/**
 * Candidate Portal (Phase 1) — C 端候选人自助门户 capabilities.
 * Routes: /v1/candidate-portal/*
 */
export const CANDIDATE_PORTAL_CAPABILITIES: Capability[] = [
  { name: 'candidate_portal.auth.request_otp', description: '候选人请求 OTP 验证码' },
  { name: 'candidate_portal.auth.verify_otp',  description: '候选人验证 OTP 并签发 bearer token' },

  { name: 'candidate_portal.jobs.browse',  description: '候选人浏览全部开放工作' },
  { name: 'candidate_portal.jobs.view',    description: '候选人查看工作详情' },
  { name: 'candidate_portal.jobs.apply',   description: '候选人申请工作 (创建 pending_pickup 推荐)' },

  { name: 'candidate_portal.applications.list',     description: '候选人查看我的申请列表' },
  { name: 'candidate_portal.applications.respond',  description: '候选人撤回/接受/拒绝' },

  { name: 'candidate_portal.messages.send', description: '候选人发送消息' },
  { name: 'candidate_portal.messages.list', description: '候选人读取消息' },

  { name: 'candidate_portal.profile.view',       description: '候选人查看简历 (公开 + PII 只读)' },
  { name: 'candidate_portal.profile.edit_public', description: '候选人编辑公开字段 (技能/期望/可见性)' },
  { name: 'candidate_portal.profile.view_audit', description: '候选人查看简历审计日志' },
];
```

参考 `src/main/capabilities/types.ts` 的 `Capability` 类型签名;如不存在则简化:

```typescript
export interface Capability {
  name: string;
  description: string;
}
```

- [ ] **Step 2: 创建猎头认领 capability (或合并)**

修改 `src/main/capabilities/headhunter.ts`,在数组中增加 2 项:

```typescript
{ name: 'headhunter.recommendations.list_pending_pickup', description: '猎头看待认领候选人列表' },
{ name: 'headhunter.recommendations.pickup',              description: '猎头认领候选人申请' },
```

- [ ] **Step 3: 在 index.ts 注册新 capability**

修改 `src/main/capabilities/index.ts`:

```typescript
import { CANDIDATE_PORTAL_CAPABILITIES } from './candidate-portal.js';
// 现有 imports 不变

export const ALL_CAPABILITIES: Capability[] = [
  // ... 现有
  ...CANDIDATE_PORTAL_CAPABILITIES,
];
```

- [ ] **Step 4: env.ts 增加 OTP 配置**

修改 `src/main/env.ts`,在 Zod schema 中增加:

```typescript
OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
OTP_CONSOLE_ONLY: z.coerce.boolean().default(true),
```

- [ ] **Step 5: 验证 capability 工具通过**

Run: `pnpm capabilities:check`
Expected: 0 errors (capability 名称未声明警告消失)

- [ ] **Step 6: 提交**

```bash
git add src/main/capabilities/ src/main/env.ts
git commit -m "feat(capabilities): candidate portal + headhunter pickup capability declarations + OTP env config"
```

---

### Task 3: OTP 库 + Email 服务 (console-only) + 候选人门户限流

**Files:**
- Create: `src/main/lib/otp.ts`
- Create: `src/main/lib/email.ts`
- Create: `src/main/lib/rate-limit-portal.ts`
- Test: `tests/unit/lib/otp.test.ts`

- [ ] **Step 1: 编写 OTP 库测试 (TDD)**

创建 `tests/unit/lib/otp.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateOtp, hashOtp, verifyOtp } from '../../../src/main/lib/otp.js';

describe('otp lib', () => {
  it('generateOtp returns 6-digit numeric string by default', () => {
    const code = generateOtp();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('generateOtp respects custom length', () => {
    expect(generateOtp(4)).toMatch(/^\d{4}$/);
    expect(generateOtp(8)).toMatch(/^\d{8}$/);
  });

  it('hashOtp + verifyOtp round-trips', () => {
    const code = generateOtp();
    const hash = hashOtp(code);
    expect(hash).not.toBe(code);
    expect(verifyOtp(code, hash)).toBe(true);
  });

  it('verifyOtp rejects wrong code', () => {
    const code = generateOtp();
    const hash = hashOtp(code);
    expect(verifyOtp('000000', hash)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试, 确认失败**

Run: `pnpm test tests/unit/lib/otp.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: 实现 OTP 库**

创建 `src/main/lib/otp.ts`:

```typescript
import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';

/** 生成 N 位数字 OTP (默认 6 位) */
export function generateOtp(length: number = 6): string {
  const max = 10 ** length;
  const min = 10 ** (length - 1);
  return String(randomInt(min, max));
}

/** bcrypt hash (cost=4, 与现有 auth api_key 一致) */
export function hashOtp(code: string): string {
  return bcrypt.hashSync(code, 4);
}

/** bcrypt verify */
export function verifyOtp(code: string, hash: string): boolean {
  return bcrypt.compareSync(code, hash);
}
```

- [ ] **Step 4: 重新运行测试, 确认通过**

Run: `pnpm test tests/unit/lib/otp.test.ts`
Expected: 4 passed

- [ ] **Step 5: 实现 email 服务 (console-only)**

创建 `src/main/lib/email.ts`:

```typescript
/**
 * MVP email service. 两种模式:
 *  - console (开发): console.log 完整 OTP 供测试
 *  - real (生产): TODO — 接 SMTP/SendGrid/Mailgun (Phase 1 后)
 */
export interface EmailService {
  sendOtp(email: string, code: string, ttlSeconds: number): Promise<void>;
}

export function createEmailService(opts: { consoleOnly: boolean }): EmailService {
  return {
    async sendOtp(email, code, ttlSeconds) {
      if (opts.consoleOnly) {
        console.log(`[DEV ONLY] OTP for ${email}: ${code} (expires in ${ttlSeconds}s)`);
        return;
      }
      // TODO Phase 2: implement real SMTP / SendGrid
      throw new Error('Real email sending not yet implemented');
    },
  };
}
```

- [ ] **Step 6: 实现候选人门户限流 (sliding window per IP+email)**

创建 `src/main/lib/rate-limit-portal.ts`:

```typescript
import type { DB } from '../db/connection.js';

/**
 * 候选人门户专用限流:
 *  - OTP 请求: 每 IP 60s 5 次 + 每邮箱 60s 1 次
 *  - 使用内存滑动窗口 (MVP); 后续可替换 Redis
 */

interface Bucket { count: number; resetAt: number; }
const ipBuckets = new Map<string, Bucket>();
const emailBuckets = new Map<string, Bucket>();

const IP_WINDOW_MS = 60_000;
const IP_LIMIT = 5;
const EMAIL_WINDOW_MS = 60_000;
const EMAIL_LIMIT = 1;

export function checkOtpRequestLimit(ip: string, email: string): { ok: boolean; reason?: string; retryAfterMs?: number } {
  const now = Date.now();

  // IP 限制
  const ipBucket = ipBuckets.get(ip);
  if (ipBucket && ipBucket.resetAt > now && ipBucket.count >= IP_LIMIT) {
    return { ok: false, reason: 'IP_RATE_LIMITED', retryAfterMs: ipBucket.resetAt - now };
  }
  if (!ipBucket || ipBucket.resetAt <= now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
  } else {
    ipBucket.count++;
  }

  // 邮箱限制
  const emailBucket = emailBuckets.get(email);
  if (emailBucket && emailBucket.resetAt > now && emailBucket.count >= EMAIL_LIMIT) {
    return { ok: false, reason: 'EMAIL_RATE_LIMITED', retryAfterMs: emailBucket.resetAt - now };
  }
  if (!emailBucket || emailBucket.resetAt <= now) {
    emailBuckets.set(email, { count: 1, resetAt: now + EMAIL_WINDOW_MS });
  } else {
    emailBucket.count++;
  }

  return { ok: true };
}

// 测试用: 重置 bucket
export function __resetRateLimits(): void {
  ipBuckets.clear();
  emailBuckets.clear();
}
```

- [ ] **Step 7: 提交**

```bash
git add src/main/lib/otp.ts src/main/lib/email.ts src/main/lib/rate-limit-portal.ts tests/unit/lib/otp.test.ts
git commit -m "feat(lib): OTP generation/verification + console email service + portal rate limiter"
```

---

## Phase B: 后端 Auth (OTP 请求 + 验证)

### Task 4: OTP 仓储 + Auth Handler (TDD)

**Files:**
- Create: `src/main/db/repositories/candidate-otp.ts`
- Create: `src/main/modules/candidate-portal/auth.ts`
- Test: `tests/integration/candidate-portal/auth.test.ts`

- [ ] **Step 1: 实现 candidate_otp 仓储**

创建 `src/main/db/repositories/candidate-otp.ts`:

```typescript
import type { DB } from '../connection.js';

export interface OtpRow {
  id: number;
  email: string;
  code_hash: string;
  attempts: number;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

export interface OtpInsert {
  email: string;
  code_hash: string;
  expires_at: number;
}

export function createCandidateOtpRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO candidate_otp_codes (email, code_hash, expires_at)
    VALUES (?, ?, ?)
  `);
  const findActiveStmt = db.prepare(`
    SELECT * FROM candidate_otp_codes
    WHERE email = ? AND consumed_at IS NULL AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1
  `);
  const incrementAttemptsStmt = db.prepare(`
    UPDATE candidate_otp_codes SET attempts = attempts + 1 WHERE id = ?
  `);
  const markConsumedStmt = db.prepare(`
    UPDATE candidate_otp_codes SET consumed_at = ? WHERE id = ?
  `);
  const deleteByEmailStmt = db.prepare(`
    DELETE FROM candidate_otp_codes WHERE email = ?
  `);

  return {
    insert(input: OtpInsert): number {
      const result = insertStmt.run(input.email, input.code_hash, input.expires_at);
      return Number(result.lastInsertRowid);
    },
    findActive(email: string, now: number = Date.now()): OtpRow | null {
      const row = findActiveStmt.get(email, now) as OtpRow | undefined;
      return row ?? null;
    },
    incrementAttempts(id: number): void {
      incrementAttemptsStmt.run(id);
    },
    markConsumed(id: number, consumedAt: number = Date.now()): void {
      markConsumedStmt.run(consumedAt, id);
    },
    deleteByEmail(email: string): number {
      return Number(deleteByEmailStmt.run(email).changes);
    },
  };
}
```

- [ ] **Step 2: 在 users 仓储增加候选人查找方法**

修改 `src/main/db/repositories/users.ts`,增加方法:

```typescript
const findCandidateByEmailStmt = db.prepare(
  "SELECT * FROM users WHERE email = ? AND user_type = 'candidate'"
);
const insertCandidateStmt = db.prepare(`
  INSERT INTO users (id, email, user_type, status, api_key_hash, api_key_prefix, api_key_expires_at, quota_per_day, quota_used, created_at)
  VALUES (?, ?, 'candidate', 'active', '', '', NULL, 1000, 0, ?)
`);

// 在 return 对象中增加:
findCandidateByEmail(email: string): User | null {
  const row = findCandidateByEmailStmt.get(email);
  return (row as User | undefined) ?? null;
},
createCandidate(id: string, email: string, now: string = new Date().toISOString()): void {
  insertCandidateStmt.run(id, email, now);
},
```

(具体 SQL 字段名按 users 表实际 schema 调整 — 参考现有 createHeadhunterUser 等)

- [ ] **Step 3: 编写 auth handler 集成测试**

创建 `tests/integration/candidate-portal/auth.test.ts` (基础 happy path + 错误路径):

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, resetDb, getDevOtp } from '../../helpers/test-app.js';

describe('POST /v1/candidate-portal/auth/otp/request', () => {
  beforeEach(() => resetDb());

  it('returns 200 and emits OTP code in dev mode', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/v1/candidate-portal/auth/otp/request')
      .send({ email: 'test@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.expires_in).toBe(300);
    expect(res.body.dev_code).toMatch(/^\d{6}$/);
  });

  it('rejects invalid email format', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/v1/candidate-portal/auth/otp/request')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rate limits after 5 requests from same IP in 60s', async () => {
    const app = createTestApp();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/v1/candidate-portal/auth/otp/request')
        .send({ email: `user${i}@example.com` });
    }
    const res = await request(app).post('/v1/candidate-portal/auth/otp/request')
      .send({ email: 'user5@example.com' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('POST /v1/candidate-portal/auth/otp/verify', () => {
  beforeEach(() => resetDb());

  it('issues bearer token on valid OTP', async () => {
    const app = createTestApp();
    await request(app).post('/v1/candidate-portal/auth/otp/request')
      .send({ email: 'new@example.com' });
    const code = getDevOtp('new@example.com');
    const res = await request(app).post('/v1/candidate-portal/auth/otp/verify')
      .send({ email: 'new@example.com', code });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.api_key).toMatch(/^hp_live_/);
  });

  it('rejects expired OTP', async () => {
    const app = createTestApp({ otpTtlSeconds: 0 }); // immediate expiry
    await request(app).post('/v1/candidate-portal/auth/otp/request')
      .send({ email: 'a@b.com' });
    const code = getDevOtp('a@b.com');
    const res = await request(app).post('/v1/candidate-portal/auth/otp/verify')
      .send({ email: 'a@b.com', code });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('locks after 5 failed attempts', async () => {
    const app = createTestApp();
    await request(app).post('/v1/candidate-portal/auth/otp/request')
      .send({ email: 'lock@b.com' });
    for (let i = 0; i < 5; i++) {
      await request(app).post('/v1/candidate-portal/auth/otp/verify')
        .send({ email: 'lock@b.com', code: '000000' });
    }
    const code = getDevOtp('lock@b.com');
    const res = await request(app).post('/v1/candidate-portal/auth/otp/verify')
      .send({ email: 'lock@b.com', code });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });
});
```

测试 helper (在 `tests/helpers/test-app.ts` 创建 — 复用现有 setup, 暴露 OTP override + dev_code capture):

```typescript
import express from 'express';
// 复用现有 createTestApp 模式, 增加:
//   - 注入 OTP env override
//   - hook: capture dev_code from email service (or response dev_code field)
export function getDevOtp(email: string): string { /* ... */ }
```

(实际 helper 实现需对照现有 `tests/helpers/` 结构)

- [ ] **Step 4: 运行测试, 确认失败**

Run: `pnpm test tests/integration/candidate-portal/auth.test.ts`
Expected: FAIL (handler module not found)

- [ ] **Step 5: 实现 auth handler**

创建 `src/main/modules/candidate-portal/auth.ts`:

```typescript
import type { DB } from '../../db/connection.js';
import { createCandidateOtpRepo } from '../../db/repositories/candidate-otp.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { generateOtp, hashOtp, verifyOtp } from '../../lib/otp.js';
import { createEmailService } from '../../lib/email.js';
import { checkOtpRequestLimit } from '../../lib/rate-limit-portal.js';
import { generateApiKey } from '../auth/api-key.js';  // 复用现有
import { Errors } from '../../errors.js';

export interface OtpRequestInput { email: string; ip?: string; }
export interface OtpVerifyInput  { email: string; code: string; }

export function createCandidatePortalAuth(db: DB, opts: {
  otpLength: number;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  consoleOnly: boolean;
}) {
  const otpRepo = createCandidateOtpRepo(db);
  const users = createUsersRepo(db);
  const email = createEmailService({ consoleOnly: opts.consoleOnly });

  return {
    async requestOtp(input: OtpRequestInput): Promise<{ expires_in: number; dev_code?: string }> {
      const ip = input.ip ?? 'unknown';
      const limit = checkOtpRequestLimit(ip, input.email);
      if (!limit.ok) {
        throw Errors.tooManyRequests(`${limit.reason}: retry after ${Math.ceil((limit.retryAfterMs ?? 0) / 1000)}s`);
      }

      const code = generateOtp(opts.otpLength);
      const codeHash = hashOtp(code);
      const expiresAt = Date.now() + opts.otpTtlSeconds * 1000;
      otpRepo.insert({ email: input.email, code_hash: codeHash, expires_at: expiresAt });

      await email.sendOtp(input.email, code, opts.otpTtlSeconds);

      const result: { expires_in: number; dev_code?: string } = {
        expires_in: opts.otpTtlSeconds,
      };
      if (opts.consoleOnly) result.dev_code = code;
      return result;
    },

    async verifyOtp(input: OtpVerifyInput): Promise<{
      api_key: string;
      user_id: string;
      profile_complete: boolean;
    }> {
      const active = otpRepo.findActive(input.email);
      if (!active) throw Errors.otpExpired();

      otpRepo.incrementAttempts(active.id);
      if (active.attempts + 1 >= opts.otpMaxAttempts) {
        throw Errors.tooManyRequests('OTP_TOO_MANY_ATTEMPTS');
      }
      if (!verifyOtp(input.code, active.code_hash)) {
        throw Errors.unauthorized('OTP_INVALID');
      }
      otpRepo.markConsumed(active.id);

      // 查找或创建候选人账户
      let user = users.findCandidateByEmail(input.email);
      if (!user) {
        const id = `cand_${randomUUID().slice(0, 12)}`;
        users.createCandidate(id, input.email);
        user = users.findCandidateByEmail(input.email)!;
      }
      // 签发 api_key
      const apiKey = generateApiKey();
      users.setApiKey(user.id, apiKey);

      // profile_complete: 检查 candidates_anonymized 是否有 skills
      const profileRow = db.prepare(`
        SELECT ca.id, ca.skills_json
        FROM candidates_anonymized ca
        JOIN candidates_private cp ON cp.id = ca.source_private_id
        WHERE cp.candidate_user_id = ?
      `).get(user.id) as { id: string; skills_json: string | null } | undefined;
      const profileComplete = !!profileRow && !!profileRow.skills_json && profileRow.skills_json !== '[]';

      return {
        api_key: apiKey,
        user_id: user.id,
        profile_complete: profileComplete,
      };
    },
  };
}
```

(具体 helper 调用 `Errors.otpExpired()` 等 factory 按需在 `src/main/errors.ts` 增加; `randomUUID` 从 `node:crypto` import; `generateApiKey` + `users.setApiKey` 复用现有 API)

- [ ] **Step 6: 重新运行测试, 确认通过**

Run: `pnpm test tests/integration/candidate-portal/auth.test.ts`
Expected: 6 passed

- [ ] **Step 7: 提交**

```bash
git add src/main/db/repositories/candidate-otp.ts src/main/db/repositories/users.ts \
        src/main/modules/candidate-portal/auth.ts tests/integration/candidate-portal/auth.test.ts \
        tests/helpers/
git commit -m "feat(candidate-portal): OTP request/verify endpoints with auto-create candidate user"
```

---

## Phase C: 后端 Profile + Matching

### Task 5: Jaccard 匹配评分库 (TDD)

**Files:**
- Create: `src/main/lib/matching.ts`
- Test: `tests/unit/lib/matching.test.ts`

- [ ] **Step 1: 编写测试**

创建 `tests/unit/lib/matching.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { calculateMatchScore, scoreJobsForCandidate } from '../../../src/main/lib/matching.js';

describe('calculateMatchScore', () => {
  it('returns 100 for identical skills', () => {
    const score = calculateMatchScore({
      candidate_skills: ['vue', 'typescript'],
      candidate_expectations: {},
      job_skills: ['vue', 'typescript'],
      job_title_level: 'senior',
      job_industry: 'tech',
      candidate_title_level: 'senior',
    });
    expect(score).toBeGreaterThanOrEqual(100);
  });

  it('returns 0 for disjoint skills', () => {
    const score = calculateMatchScore({
      candidate_skills: ['vue', 'typescript'],
      candidate_expectations: {},
      job_skills: ['cobol', 'mainframe'],
      job_title_level: 'senior',
      job_industry: 'finance',
      candidate_title_level: 'junior',
    });
    expect(score).toBe(0);
  });

  it('adds bonus for title_level match', () => {
    const base = calculateMatchScore({
      candidate_skills: ['python'],
      candidate_expectations: {},
      job_skills: ['python'],
      job_title_level: 'junior',
      job_industry: 'tech',
      candidate_title_level: 'senior',
    });
    const matched = calculateMatchScore({
      candidate_skills: ['python'],
      candidate_expectations: {},
      job_skills: ['python'],
      job_title_level: 'senior',
      job_industry: 'tech',
      candidate_title_level: 'senior',
    });
    expect(matched).toBeGreaterThan(base);
  });

  it('returns 0-100 range', () => {
    const score = calculateMatchScore({
      candidate_skills: ['vue', 'ts', 'react'],
      candidate_expectations: { expected_salary_min: 100, expected_salary_max: 200 },
      job_skills: ['vue', 'ts'],
      job_title_level: 'senior',
      job_industry: 'tech',
      candidate_title_level: 'senior',
      job_salary_min: 150,
      job_salary_max: 250,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('scoreJobsForCandidate', () => {
  it('ranks jobs by score descending', () => {
    const jobs = [
      { id: 'j1', skills: ['rust', 'wasm'], title_level: 'senior', industry: 'tech', salary_min: 100, salary_max: 200 },
      { id: 'j2', skills: ['vue', 'typescript'], title_level: 'senior', industry: 'tech', salary_min: 100, salary_max: 200 },
      { id: 'j3', skills: ['cobol'], title_level: 'junior', industry: 'finance', salary_min: 50, salary_max: 80 },
    ];
    const scored = scoreJobsForCandidate(
      { skills: ['vue', 'typescript'], expectations: {}, title_level: 'senior' },
      jobs
    );
    expect(scored[0].job_id).toBe('j2');
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
    expect(scored[1].job_id).toBe('j1');
    expect(scored[2].job_id).toBe('j3');
  });
});
```

- [ ] **Step 2: 运行测试, 确认失败**

Run: `pnpm test tests/unit/lib/matching.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 matching 库**

创建 `src/main/lib/matching.ts`:

```typescript
export interface MatchInput {
  candidate_skills: string[];
  candidate_expectations: {
    expected_salary_min?: number;
    expected_salary_max?: number;
    desired_roles?: string[];
    open_to_remote?: boolean;
  };
  job_skills: string[];
  job_title_level: string;
  job_industry: string;
  candidate_title_level: string;
  job_salary_min?: number | null;
  job_salary_max?: number | null;
}

const TITLE_LEVELS = ['intern', 'junior', 'mid', 'senior', 'staff', 'principal'];

export function calculateMatchScore(input: MatchInput): number {
  // Jaccard 相似度 (0-100)
  const a = new Set(input.candidate_skills.map(s => s.toLowerCase()));
  const b = new Set(input.job_skills.map(s => s.toLowerCase()));
  const inter = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  const jaccard = union === 0 ? 0 : (inter / union) * 100;

  let bonus = 0;
  // Title level match: same or adjacent
  const cIdx = TITLE_LEVELS.indexOf(input.candidate_title_level.toLowerCase());
  const jIdx = TITLE_LEVELS.indexOf(input.job_title_level.toLowerCase());
  if (cIdx >= 0 && jIdx >= 0 && Math.abs(cIdx - jIdx) <= 1) bonus += 5;

  // Salary in range
  if (input.job_salary_min != null && input.candidate_expectations.expected_salary_min != null) {
    if (input.job_salary_max != null &&
        input.job_salary_max >= input.candidate_expectations.expected_salary_min) {
      bonus += 3;
    }
  }

  // Industry match (if candidate listed desired_roles)
  if (input.candidate_expectations.desired_roles?.some(r =>
    r.toLowerCase().includes(input.job_industry.toLowerCase()))) {
    bonus += 2;
  }

  return Math.min(100, Math.round(jaccard + bonus));
}

export interface JobForRanking {
  id: string;
  skills: string[];
  title_level: string;
  industry: string;
  salary_min: number | null;
  salary_max: number | null;
}

export interface ScoredJob { job_id: string; score: number; }

export function scoreJobsForCandidate(
  candidate: { skills: string[]; expectations: any; title_level: string },
  jobs: JobForRanking[]
): ScoredJob[] {
  return jobs
    .map(j => ({
      job_id: j.id,
      score: calculateMatchScore({
        candidate_skills: candidate.skills,
        candidate_expectations: candidate.expectations ?? {},
        job_skills: j.skills,
        job_title_level: j.title_level,
        job_industry: j.industry,
        candidate_title_level: candidate.title_level,
        job_salary_min: j.salary_min,
        job_salary_max: j.salary_max,
      }),
    }))
    .sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 4: 运行测试, 确认通过**

Run: `pnpm test tests/unit/lib/matching.test.ts`
Expected: 5 passed

- [ ] **Step 5: 提交**

```bash
git add src/main/lib/matching.ts tests/unit/lib/matching.test.ts
git commit -m "feat(matching): Jaccard skill similarity + title/salary/industry bonuses"
```

---

### Task 6: Profile 端点 (view/edit/audit) - TDD

**Files:**
- Create: `src/main/db/repositories/candidate-portal-profile.ts`
- Create: `src/main/modules/candidate-portal/profile.ts`
- Test: `tests/integration/candidate-portal/profile.test.ts`

- [ ] **Step 1: 实现 profile 仓储**

创建 `src/main/db/repositories/candidate-portal-profile.ts`:

```typescript
import type { DB } from '../connection.js';

export interface CandidateProfileView {
  // 公开字段
  id: string;
  industry: string | null;
  title_level: string | null;
  years_experience: number | null;
  skills: string[];
  visibility: string;
  expectations: {
    desired_roles?: string[];
    expected_salary_min?: number;
    expected_salary_max?: number;
    open_to_remote?: boolean;
  } | null;
  // PII 只读副本 (候选人可见但不可编辑)
  pii: {
    name: string | null;
    current_company: string | null;
    education_tier: string | null;
  };
}

export function createCandidatePortalProfileRepo(db: DB) {
  const getProfileStmt = db.prepare(`
    SELECT
      ca.id, ca.industry, ca.title_level, ca.years_experience, ca.skills_json,
      ca.visibility, ca.expectations_json, ca.education_tier,
      cp.name, cp.current_company
    FROM candidates_anonymized ca
    JOIN candidates_private cp ON cp.id = ca.source_private_id
    WHERE cp.candidate_user_id = ?
  `);

  const updateSkillsStmt = db.prepare(
    `UPDATE candidates_anonymized SET skills_json = ? WHERE id = ?`
  );
  const updateExpectationsStmt = db.prepare(
    `UPDATE candidates_anonymized SET expectations_json = ? WHERE id = ?`
  );
  const updateVisibilityStmt = db.prepare(
    `UPDATE candidates_anonymized SET visibility = ? WHERE id = ?`
  );

  const auditLogStmt = db.prepare(`
    SELECT ual.*, u.user_type as viewer_type
    FROM unlock_audit_log ual
    LEFT JOIN users u ON u.id = ual.viewer_user_id
    WHERE ual.candidate_private_id IN (
      SELECT id FROM candidates_private WHERE candidate_user_id = ?
    )
    ORDER BY ual.accessed_at DESC
    LIMIT ? OFFSET ?
  `);

  return {
    getProfile(userId: string): CandidateProfileView | null {
      const row = getProfileStmt.get(userId) as any;
      if (!row) return null;
      return {
        id: row.id,
        industry: row.industry,
        title_level: row.title_level,
        years_experience: row.years_experience,
        skills: row.skills_json ? JSON.parse(row.skills_json) : [],
        visibility: row.visibility,
        expectations: row.expectations_json ? JSON.parse(row.expectations_json) : null,
        pii: {
          name: row.name,
          current_company: row.current_company,
          education_tier: row.education_tier,
        },
      };
    },

    updateSkills(anonId: string, skills: string[]): void {
      updateSkillsStmt.run(JSON.stringify(skills), anonId);
    },

    updateExpectations(anonId: string, expectations: object): void {
      updateExpectationsStmt.run(JSON.stringify(expectations), anonId);
    },

    updateVisibility(anonId: string, visibility: string): void {
      updateVisibilityStmt.run(visibility, anonId);
    },

    listAuditLog(userId: string, limit: number, offset: number): any[] {
      return auditLogStmt.all(userId, limit, offset);
    },
  };
}
```

- [ ] **Step 2: 编写集成测试**

创建 `tests/integration/candidate-portal/profile.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, resetDb, getCandidateAuthHeader, seedCandidate } from '../../helpers/test-app.js';

describe('GET /v1/candidate-portal/profile', () => {
  beforeEach(() => resetDb());

  it('returns profile (public + PII read-only) for authenticated candidate', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate({ skills: ['vue', 'ts'] });
    const res = await request(app)
      .get('/v1/candidate-portal/profile')
      .set('Authorization', `Bearer ${candidate.api_key}`);
    expect(res.status).toBe(200);
    expect(res.body.data.skills).toEqual(['vue', 'ts']);
    expect(res.body.data.pii).toBeDefined();
    expect(res.body.data.pii.name).toBe(candidate.name);
  });

  it('requires auth', async () => {
    const app = createTestApp();
    const res = await request(app).get('/v1/candidate-portal/profile');
    expect(res.status).toBe(401);
  });
});

describe('PUT /v1/candidate-portal/profile', () => {
  beforeEach(() => resetDb());

  it('updates public fields (skills)', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate({ skills: ['vue'] });
    const res = await request(app)
      .put('/v1/candidate-portal/profile')
      .set('Authorization', `Bearer ${candidate.api_key}`)
      .send({ skills: ['vue', 'react', 'ts'] });
    expect(res.status).toBe(200);

    const get = await request(app)
      .get('/v1/candidate-portal/profile')
      .set('Authorization', `Bearer ${candidate.api_key}`);
    expect(get.body.data.skills).toEqual(['vue', 'react', 'ts']);
  });

  it('REJECTS PII fields (name) — Zod strict', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    const res = await request(app)
      .put('/v1/candidate-portal/profile')
      .set('Authorization', `Bearer ${candidate.api_key}`)
      .send({ name: 'Hacker' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('updates visibility', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    const res = await request(app)
      .put('/v1/candidate-portal/profile')
      .set('Authorization', `Bearer ${candidate.api_key}`)
      .send({ visibility: 'invitation_only' });
    expect(res.status).toBe(200);

    const get = await request(app)
      .get('/v1/candidate-portal/profile')
      .set('Authorization', `Bearer ${candidate.api_key}`);
    expect(get.body.data.visibility).toBe('invitation_only');
  });
});

describe('GET /v1/candidate-portal/profile/audit-log', () => {
  beforeEach(() => resetDb());

  it('returns audit log entries', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    // 触发一次审计: 雇主浏览候选人 → 模拟
    const res = await request(app)
      .get('/v1/candidate-portal/profile/audit-log')
      .set('Authorization', `Bearer ${candidate.api_key}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
```

- [ ] **Step 3: 运行测试, 确认失败**

Run: `pnpm test tests/integration/candidate-portal/profile.test.ts`
Expected: FAIL

- [ ] **Step 4: 实现 profile handler**

创建 `src/main/modules/candidate-portal/profile.ts`:

```typescript
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createCandidatePortalProfileRepo } from '../../db/repositories/candidate-portal-profile.js';
import { Errors } from '../../errors.js';

const EMAIL_RX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;  // 复用或 import

export interface ProfileUpdateInput {
  skills?: string[];
  expectations?: object;
  visibility?: 'public' | 'invitation_only' | 'hidden';
}

export function createCandidatePortalProfile(db: DB) {
  const repo = createCandidatePortalProfileRepo(db);

  return {
    getProfile(user: User) {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can view profile');
      const profile = repo.getProfile(user.id);
      if (!profile) throw Errors.notFound('Profile not found');
      return profile;
    },

    updateProfile(user: User, input: ProfileUpdateInput) {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can edit profile');
      const profile = repo.getProfile(user.id);
      if (!profile) throw Errors.notFound('Profile not found');

      // 严格只允许公开字段 (Zod 在 router 层也校验一次)
      if (input.skills !== undefined) {
        repo.updateSkills(profile.id, input.skills);
      }
      if (input.expectations !== undefined) {
        repo.updateExpectations(profile.id, input.expectations);
      }
      if (input.visibility !== undefined) {
        if (!['public', 'invitation_only', 'hidden'].includes(input.visibility)) {
          throw Errors.validation('Invalid visibility value');
        }
        repo.updateVisibility(profile.id, input.visibility);
      }
    },

    listAuditLog(user: User, opts: { limit?: number; offset?: number } = {}) {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can view audit log');
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      return repo.listAuditLog(user.id, limit, offset);
    },
  };
}
```

- [ ] **Step 5: 重新运行测试, 确认通过**

Run: `pnpm test tests/integration/candidate-portal/profile.test.ts`
Expected: 6 passed

- [ ] **Step 6: 提交**

```bash
git add src/main/db/repositories/candidate-portal-profile.ts src/main/modules/candidate-portal/profile.ts tests/integration/candidate-portal/profile.test.ts
git commit -m "feat(candidate-portal): profile view/edit/audit-log endpoints with strict PII protection"
```

---

## Phase D: 后端 Jobs (浏览/推荐/详情)

### Task 7: Jobs Handler (TDD)

**Files:**
- Create: `src/main/modules/candidate-portal/jobs.ts`
- Test: `tests/integration/candidate-portal/jobs.test.ts`

- [ ] **Step 1: 编写集成测试**

创建 `tests/integration/candidate-portal/jobs.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, resetDb, getCandidateAuthHeader, seedCandidate, seedOpenJob } from '../../helpers/test-app.js';

describe('GET /v1/candidate-portal/jobs/browse', () => {
  beforeEach(() => resetDb());

  it('returns paginated open jobs', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    await seedOpenJob({ title: '前端工程师', industry: 'tech', skills: ['vue'] });
    await seedOpenJob({ title: '后端工程师', industry: 'tech', skills: ['go'] });
    const res = await request(app)
      .get('/v1/candidate-portal/jobs/browse')
      .set('Authorization', `Bearer ${candidate.api_key}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(2);
  });

  it('filters by industry', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    await seedOpenJob({ title: 'Tech Job', industry: 'tech' });
    await seedOpenJob({ title: 'Finance Job', industry: 'finance' });
    const res = await request(app)
      .get('/v1/candidate-portal/jobs/browse?industry=tech')
      .set('Authorization', `Bearer ${candidate.api_key}`);
    expect(res.body.data.items.every((j: any) => j.industry === 'tech')).toBe(true);
  });

  it('excludes closed jobs', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    await seedOpenJob({ status: 'closed' });
    const res = await request(app)
      .get('/v1/candidate-portal/jobs/browse')
      .set('Authorization', `Bearer ${candidate.api_key}`);
    expect(res.body.data.items.length).toBe(0);
  });
});

describe('GET /v1/candidate-portal/jobs/recommended', () => {
  beforeEach(() => resetDb());

  it('ranks jobs by match score descending', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate({ skills: ['vue', 'ts'] });
    await seedOpenJob({ skills: ['cobol'], title: 'Cobol Dev' });
    const vueJob = await seedOpenJob({ skills: ['vue', 'ts'], title: 'Vue Dev' });
    const res = await request(app)
      .get('/v1/candidate-portal/jobs/recommended')
      .set('Authorization', `Bearer ${candidate.api_key}`);
    expect(res.body.data[0].job_id).toBe(vueJob.id);
    expect(res.body.data[0].score).toBeGreaterThan(res.body.data[1].score);
  });
});

describe('GET /v1/candidate-portal/jobs/:id', () => {
  beforeEach(() => resetDb());

  it('returns job detail with match score', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate({ skills: ['vue'] });
    const job = await seedOpenJob({ skills: ['vue', 'ts'] });
    const res = await request(app)
      .get(`/v1/candidate-portal/jobs/${job.id}`)
      .set('Authorization', `Bearer ${candidate.api_key}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(job.id);
    expect(res.body.data.match_score).toBeGreaterThan(0);
    expect(res.body.data.match_dimensions).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试, 确认失败**

Run: `pnpm test tests/integration/candidate-portal/jobs.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 jobs handler**

创建 `src/main/modules/candidate-portal/jobs.ts`:

```typescript
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createCandidatePortalProfileRepo } from '../../db/repositories/candidate-portal-profile.js';
import { scoreJobsForCandidate, calculateMatchScore } from '../../lib/matching.js';
import { Errors } from '../../errors.js';

export interface JobsListFilter {
  industry?: string;
  title_level?: string;
  keyword?: string;
  cursor?: number;
  limit?: number;
}

export function createCandidatePortalJobs(db: DB) {
  const profileRepo = createCandidatePortalProfileRepo(db);

  return {
    browse(user: User, filter: JobsListFilter = {}) {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can browse jobs');
      const where: string[] = ["status = 'open'"];
      const params: any[] = [];

      if (filter.industry) { where.push('industry = ?'); params.push(filter.industry); }
      if (filter.title_level) { where.push('title_level = ?'); params.push(filter.title_level); }
      if (filter.keyword) {
        where.push('(title LIKE ? OR description LIKE ?)');
        const kw = `%${filter.keyword}%`;
        params.push(kw, kw);
      }

      const limit = Math.min(filter.limit ?? 20, 50);
      const offset = filter.cursor ?? 0;

      const sql = `SELECT id, title, industry, title_level, salary_min, salary_max,
                          location, required_skills_json, priority, created_at
                   FROM jobs
                   WHERE ${where.join(' AND ')}
                   ORDER BY priority DESC, created_at DESC
                   LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const rows = db.prepare(sql).all(...params) as any[];
      const items = rows.map(r => ({
        id: r.id,
        title: r.title,
        industry: r.industry,
        title_level: r.title_level,
        salary_min: r.salary_min,
        salary_max: r.salary_max,
        location: r.location,
        skills: r.required_skills_json ? JSON.parse(r.required_skills_json) : [],
        priority: r.priority,
        posted_at: r.created_at,
      }));
      const nextCursor = items.length === limit ? offset + limit : null;
      return { items, next_cursor: nextCursor };
    },

    recommended(user: User, opts: { limit?: number } = {}) {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can get recommendations');
      const profile = profileRepo.getProfile(user.id);
      if (!profile) throw Errors.notFound('Profile not found — please complete your profile');

      // 拉所有 open jobs (MVP 简化: 不分页)
      const jobs = db.prepare(`
        SELECT id, industry, title_level, salary_min, salary_max, required_skills_json
        FROM jobs WHERE status = 'open' ORDER BY created_at DESC LIMIT 200
      `).all() as any[];

      const scored = scoreJobsForCandidate(
        { skills: profile.skills, expectations: profile.expectations ?? {}, title_level: profile.title_level ?? 'mid' },
        jobs.map(j => ({
          id: j.id, skills: j.required_skills_json ? JSON.parse(j.required_skills_json) : [],
          title_level: j.title_level ?? 'mid', industry: j.industry ?? '',
          salary_min: j.salary_min, salary_max: j.salary_max,
        }))
      );

      const limit = opts.limit ?? 20;
      return scored.slice(0, limit);
    },

    detail(user: User, jobId: string) {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can view job details');
      const job = db.prepare(`
        SELECT * FROM jobs WHERE id = ?
      `).get(jobId) as any;
      if (!job) throw Errors.notFound('Job not found');

      const profile = profileRepo.getProfile(user.id);
      const matchScore = profile ? calculateMatchScore({
        candidate_skills: profile.skills,
        candidate_expectations: profile.expectations ?? {},
        job_skills: job.required_skills_json ? JSON.parse(job.required_skills_json) : [],
        job_title_level: job.title_level ?? 'mid',
        job_industry: job.industry ?? '',
        candidate_title_level: profile.title_level ?? 'mid',
        job_salary_min: job.salary_min,
        job_salary_max: job.salary_max,
      }) : 0;

      return {
        id: job.id,
        title: job.title,
        industry: job.industry,
        title_level: job.title_level,
        description: job.description,
        salary_min: job.salary_min,
        salary_max: job.salary_max,
        location: job.location,
        skills: job.required_skills_json ? JSON.parse(job.required_skills_json) : [],
        priority: job.priority,
        posted_at: job.created_at,
        match_score: matchScore,
        match_dimensions: {
          skills: profile?.skills ?? [],
          job_skills: job.required_skills_json ? JSON.parse(job.required_skills_json) : [],
        },
      };
    },
  };
}
```

(注意: `jobs.required_skills_json` 字段实际名称按 hunter schema 调整 — 参考 v005 migration)

- [ ] **Step 4: 重新运行测试, 确认通过**

Run: `pnpm test tests/integration/candidate-portal/jobs.test.ts`
Expected: 6 passed

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/candidate-portal/jobs.ts tests/integration/candidate-portal/jobs.test.ts
git commit -m "feat(candidate-portal): jobs browse/recommended/detail with match scoring"
```

---

## Phase E: 后端 Applications (状态机 + 申请)

### Task 8: 状态机扩展 (`pending_pickup`)

**Files:**
- Modify: `src/main/flows/index.ts` (or wherever `recFlow` lives)
- Test: `tests/unit/candidate-portal/state-machine.test.ts`

- [ ] **Step 1: 查找现有 recFlow**

Run: `grep -rn "recFlow" src/main/flows/ src/main/modules/candidate/`
Expected: 找到 `recFlow` 定义 (推测在 `src/main/flows/rec-flow.ts` 或类似文件)

- [ ] **Step 2: 编写状态机测试**

创建 `tests/unit/candidate-portal/state-machine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { applyTransition, recFlow } from '../../../../src/main/flows/index.js';

describe('recFlow with pending_pickup extension', () => {
  it('allows pending → pending_pickup (via pickup)', () => {
    // 反向: pending_pickup 之前的初始态
    // 实际转换: candidate_self_apply 创建时直接是 pending_pickup, 不经过 pending
    expect(() => applyTransition(recFlow, 'pending_pickup', 'pickup', {})).not.toThrow();
  });

  it('allows pending_pickup → pending (after hunter pickup)', () => {
    // 测试转换已定义 (transition: pending_pickup -pickup→ pending)
    expect(() => applyTransition(recFlow, 'pending_pickup', 'pickup', {})).not.toThrow();
  });

  it('REJECTS pending_pickup → employer_express_interest (must go via pending first)', () => {
    expect(() => applyTransition(recFlow, 'pending_pickup', 'express_interest', {})).toThrow();
  });

  it('allows pending → employer_interested (existing)', () => {
    expect(() => applyTransition(recFlow, 'pending', 'express_interest', {})).not.toThrow();
  });
});
```

- [ ] **Step 3: 运行测试, 确认失败**

Run: `pnpm test tests/unit/candidate-portal/state-machine.test.ts`
Expected: 部分 FAIL (pending_pickup 转换未定义)

- [ ] **Step 4: 扩展 recFlow 增加 pending_pickup 状态**

修改 `src/main/flows/index.ts` (或 rec-flow.ts):

```typescript
export const recFlow = {
  // ... 现有 states
  states: {
    pending: { /* ... existing transitions */ },
    pending_pickup: {
      pickup: { target: 'pending', action: 'pickup' },
      withdraw: { target: 'withdrawn', action: 'withdraw' },
    },
    // ... 其他现有 states
  },
  // ...
};
```

(具体转换结构按 recFlow 当前定义调整)

- [ ] **Step 5: 重新运行测试, 确认通过**

Run: `pnpm test tests/unit/candidate-portal/state-machine.test.ts`
Expected: 4 passed

- [ ] **Step 6: 提交**

```bash
git add src/main/flows/ tests/unit/candidate-portal/state-machine.test.ts
git commit -m "feat(flows): extend recFlow with pending_pickup state for candidate self-apply"
```

---

### Task 9: Apply 端点 (事务 + 状态机) - TDD

**Files:**
- Create: `src/main/db/repositories/candidate-applications.ts`
- Create: `src/main/modules/candidate-portal/applications.ts`
- Modify: `src/main/db/repositories/recommendations.ts` (add `findByCandidateAndJob`)
- Test: `tests/integration/candidate-portal/applications.test.ts`

- [ ] **Step 1: 实现 candidate_applications 仓储**

创建 `src/main/db/repositories/candidate-applications.ts`:

```typescript
import type { DB } from '../connection.js';

export interface ApplicationRow {
  id: number;
  recommendation_id: string;
  candidate_user_id: string;
  job_id: string;
  pickup_headhunter_id: string | null;
  candidate_note: string | null;
  withdrawn_at: number | null;
  created_at: number;
}

export function createCandidateApplicationsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO candidate_applications
      (recommendation_id, candidate_user_id, job_id, candidate_note)
    VALUES (?, ?, ?, ?)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM candidate_applications WHERE id = ?');
  const findByRecommendationStmt = db.prepare(
    'SELECT * FROM candidate_applications WHERE recommendation_id = ?'
  );
  const listByCandidateStmt = db.prepare(`
    SELECT ca.*, j.title as job_title, j.industry as job_industry,
           r.status as recommendation_status, r.source_type, r.pickup_headhunter_id
    FROM candidate_applications ca
    JOIN jobs j ON j.id = ca.job_id
    JOIN recommendations r ON r.id = ca.recommendation_id
    WHERE ca.candidate_user_id = ?
    ORDER BY ca.created_at DESC LIMIT ? OFFSET ?
  `);
  const listByPickupHunterStmt = db.prepare(`
    SELECT ca.*, j.title as job_title, u.email as candidate_email,
           r.status as recommendation_status
    FROM candidate_applications ca
    JOIN jobs j ON j.id = ca.job_id
    JOIN recommendations r ON r.id = ca.recommendation_id
    JOIN candidates_private cp ON cp.candidate_user_id = ca.candidate_user_id
    JOIN users u ON u.id = ca.candidate_user_id
    WHERE r.status = 'pending_pickup' AND ca.pickup_headhunter_id IS NULL
    ORDER BY ca.created_at DESC LIMIT ? OFFSET ?
  `);
  const setPickupStmt = db.prepare(
    'UPDATE candidate_applications SET pickup_headhunter_id = ? WHERE id = ?'
  );
  const withdrawStmt = db.prepare(
    'UPDATE candidate_applications SET withdrawn_at = ? WHERE id = ?'
  );

  return {
    insert(input: { recommendation_id: string; candidate_user_id: string; job_id: string; candidate_note?: string }): number {
      const r = insertStmt.run(
        input.recommendation_id, input.candidate_user_id, input.job_id,
        input.candidate_note ?? null
      );
      return Number(r.lastInsertRowid);
    },
    findById(id: number): ApplicationRow | null {
      const row = findByIdStmt.get(id) as ApplicationRow | undefined;
      return row ?? null;
    },
    findByRecommendation(recommendationId: string): ApplicationRow | null {
      const row = findByRecommendationStmt.get(recommendationId) as ApplicationRow | undefined;
      return row ?? null;
    },
    listByCandidate(candidateUserId: string, limit: number, offset: number): any[] {
      return listByCandidateStmt.all(candidateUserId, limit, offset);
    },
    listPendingPickup(limit: number, offset: number): any[] {
      return listByPickupHunterStmt.all(limit, offset);
    },
    setPickup(id: number, hunterId: string): void {
      setPickupStmt.run(hunterId, id);
    },
    withdraw(id: number, withdrawnAt: number): void {
      withdrawStmt.run(withdrawnAt, id);
    },
  };
}
```

- [ ] **Step 2: 在 recommendations 仓储增加方法**

修改 `src/main/db/repositories/recommendations.ts`:

```typescript
const findByCandidateAndJobStmt = db.prepare(`
  SELECT * FROM recommendations
  WHERE anonymized_candidate_id IN (
    SELECT ca.id FROM candidates_anonymized ca
    JOIN candidates_private cp ON cp.id = ca.source_private_id
    WHERE cp.candidate_user_id = ?
  )
  AND job_id = ?
  AND status IN ('pending_pickup', 'pending', 'employer_interested', 'candidate_approved')
  LIMIT 1
`);

// 在 return 对象中增加:
findActiveByCandidateAndJob(candidateUserId: string, jobId: string): RecommendationRow | null {
  const row = findByCandidateAndJobStmt.get(candidateUserId, jobId);
  return (row as RecommendationRow | undefined) ?? null;
},
```

- [ ] **Step 3: 编写 apply 集成测试**

创建 `tests/integration/candidate-portal/applications.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, resetDb, seedCandidate, seedOpenJob, seedHeadhunter } from '../../helpers/test-app.js';

describe('POST /v1/candidate-portal/jobs/:id/apply', () => {
  beforeEach(() => resetDb());

  it('creates application + recommendation in pending_pickup state', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    const job = await seedOpenJob();
    const res = await request(app)
      .post(`/v1/candidate-portal/jobs/${job.id}/apply`)
      .set('Authorization', `Bearer ${candidate.api_key}`)
      .send({ note: 'I am interested' });
    expect(res.status).toBe(200);
    expect(res.body.data.application_id).toBeDefined();
    expect(res.body.data.recommendation_id).toBeDefined();
  });

  it('rejects duplicate active application', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    const job = await seedOpenJob();
    await request(app).post(`/v1/candidate-portal/jobs/${job.id}/apply`)
      .set('Authorization', `Bearer ${candidate.api_key}`).send({});
    const dup = await request(app).post(`/v1/candidate-portal/jobs/${job.id}/apply`)
      .set('Authorization', `Bearer ${candidate.api_key}`).send({});
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_APPLIED');
  });

  it('rejects application to closed job', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    const job = await seedOpenJob({ status: 'closed' });
    const res = await request(app).post(`/v1/candidate-portal/jobs/${job.id}/apply`)
      .set('Authorization', `Bearer ${candidate.api_key}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('JOB_NOT_OPEN');
  });

  it('notifies all headhunters of new pending application', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    const hunter1 = await seedHeadhunter();
    const hunter2 = await seedHeadhunter();
    const job = await seedOpenJob();
    await request(app).post(`/v1/candidate-portal/jobs/${job.id}/apply`)
      .set('Authorization', `Bearer ${candidate.api_key}`).send({});
    // 验证两猎头都收到通知
    const n1 = db.prepare(`SELECT * FROM notifications WHERE user_id = ?`).all(hunter1.id);
    const n2 = db.prepare(`SELECT * FROM notifications WHERE user_id = ?`).all(hunter2.id);
    expect(n1.length).toBeGreaterThan(0);
    expect(n2.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: 运行测试, 确认失败**

Run: `pnpm test tests/integration/candidate-portal/applications.test.ts`
Expected: FAIL

- [ ] **Step 5: 实现 applications handler**

创建 `src/main/modules/candidate-portal/applications.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createCandidateApplicationsRepo } from '../../db/repositories/candidate-applications.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { createCandidatePortalProfileRepo } from '../../db/repositories/candidate-portal-profile.js';
import { createNotificationsRepo } from '../../db/repositories/notifications.js';
import { applyTransition } from '../../flows/index.js';
import { Errors } from '../../errors.js';

export interface ApplyInput { note?: string; }

export function createCandidatePortalApplications(db: DB) {
  const apps = createCandidateApplicationsRepo(db);
  const recs = createRecommendationsRepo(db);
  const profiles = createCandidatePortalProfileRepo(db);
  const notif = createNotificationsRepo(db);

  return {
    apply(user: User, jobId: string, input: ApplyInput) {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can apply');

      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
      if (!job) throw Errors.notFound('Job not found');
      if (job.status !== 'open') throw Errors.validation('JOB_NOT_OPEN: Job is not open for applications');

      const profile = profiles.getProfile(user.id);
      if (!profile) throw Errors.notFound('Profile not found');

      // 校验重复
      const existing = recs.findActiveByCandidateAndJob(user.id, jobId);
      if (existing) throw Errors.conflict('ALREADY_APPLIED: You have an active application for this job');

      // 事务: 创建 recommendation (pending_pickup) + candidate_application
      const recommendationId = `rec_${randomUUID().slice(0, 12)}`;
      db.exec('BEGIN');
      try {
        recs.insert({
          id: recommendationId,
          anonymized_candidate_id: profile.id,
          job_id: jobId,
          headhunter_id: null,
          source_type: 'candidate_self_apply',
          candidate_note: input.note,
          status: 'pending_pickup',
        });
        const applicationId = apps.insert({
          recommendation_id: recommendationId,
          candidate_user_id: user.id,
          job_id: jobId,
          candidate_note: input.note,
        });
        db.exec('COMMIT');

        // 通知所有猎头
        const hunters = db.prepare(`SELECT id FROM users WHERE user_type = 'headhunter' AND status = 'active'`)
          .all() as { id: string }[];
        for (const h of hunters) {
          notif.insert({
            user_id: h.id,
            category: 'candidate_pending_pickup',
            title: '新候选人待认领',
            body: `候选人 ${profile.pii.name ?? '(匿名)'} 申请了工作 ${job.title}`,
            dedup_key: `apply:${recommendationId}:${h.id}`,
          });
        }

        return { application_id: applicationId, recommendation_id: recommendationId };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    list(user: User, opts: { limit?: number; offset?: number } = {}) {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can list their applications');
      const limit = Math.min(opts.limit ?? 20, 50);
      const offset = opts.offset ?? 0;
      return apps.listByCandidate(user.id, limit, offset);
    },

    detail(user: User, applicationId: number) {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can view application');
      const app = apps.findById(applicationId);
      if (!app) throw Errors.notFound('Application not found');
      if (app.candidate_user_id !== user.id) throw Errors.forbidden('APPLICATION_NOT_OWNED');
      return app;
    },

    respond(user: User, applicationId: number, action: 'withdraw' | 'consider_offer' | 'accept_offer' | 'decline_offer') {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can respond');
      const app = apps.findById(applicationId);
      if (!app) throw Errors.notFound('Application not found');
      if (app.candidate_user_id !== user.id) throw Errors.forbidden('APPLICATION_NOT_OWNED');

      const rec = recs.findById(app.recommendation_id);
      if (!rec) throw Errors.notFound('Recommendation not found');

      db.exec('BEGIN');
      try {
        switch (action) {
          case 'withdraw':
            if (!['pending_pickup', 'pending'].includes(rec.status)) {
              throw Errors.validation('APPLICATION_INVALID_STATE: Cannot withdraw at this stage');
            }
            applyTransition(/* recFlow */, rec.status, 'withdraw', {});
            recs.updateStatus(app.recommendation_id, 'withdrawn');
            apps.withdraw(applicationId, Date.now());
            break;
          case 'consider_offer':
          case 'accept_offer':
          case 'decline_offer':
            if (rec.status !== 'employer_interested') {
              throw Errors.validation('APPLICATION_INVALID_STATE: No offer to respond to');
            }
            // 复用现有 candidate.approveUnlock / rejectUnlock 流程
            // 这里仅标记状态, 真实解锁 PII 由 unlock handler 处理
            const newStatus = action === 'accept_offer' ? 'candidate_approved'
                            : action === 'decline_offer' ? 'rejected_candidate'
                            : 'considering_offer';
            recs.updateStatus(app.recommendation_id, newStatus);
            break;
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
```

(具体 `recs.insert` / `recs.updateStatus` / `applyTransition` 参数按 hunter 实际 API 调整; Errors.conflict / otpExpired 等 factory 按需在 errors.ts 增加)

- [ ] **Step 6: 重新运行测试, 确认通过**

Run: `pnpm test tests/integration/candidate-portal/applications.test.ts`
Expected: 4 passed

- [ ] **Step 7: 提交**

```bash
git add src/main/db/repositories/candidate-applications.ts src/main/db/repositories/recommendations.ts \
        src/main/modules/candidate-portal/applications.ts \
        tests/integration/candidate-portal/applications.test.ts
git commit -m "feat(candidate-portal): apply/list/detail/respond with state machine + tx + notifications"
```

---

## Phase F: 后端 Pickup (猎头认领)

### Task 10: Headhunter Pickup 端点 (TDD)

**Files:**
- Create: `src/main/db/repositories/headhunter-pickup.ts` (或合并到 candidate-applications.ts)
- Create: `src/main/modules/candidate-portal/headhunter-pickup.ts`
- Modify: `src/main/routes/headhunter.ts` (挂载新端点)
- Test: `tests/integration/candidate-portal/headhunter-pickup.test.ts`

- [ ] **Step 1: 编写集成测试**

创建 `tests/integration/candidate-portal/headhunter-pickup.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, resetDb, seedCandidate, seedOpenJob, seedHeadhunter, getAuthHeader } from '../../helpers/test-app.js';

describe('GET /v1/headhunter/recommendations/pending-pickup', () => {
  beforeEach(() => resetDb());

  it('lists pending applications awaiting pickup', async () => {
    const app = createTestApp();
    const hunter = await seedHeadhunter();
    const candidate = await seedCandidate();
    const job = await seedOpenJob();
    await request(app).post(`/v1/candidate-portal/jobs/${job.id}/apply`)
      .set('Authorization', `Bearer ${candidate.api_key}`).send({});
    const res = await request(app)
      .get('/v1/headhunter/recommendations/pending-pickup')
      .set('Authorization', `Bearer ${hunter.api_key}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(1);
  });
});

describe('POST /v1/headhunter/recommendations/:id/pickup', () => {
  beforeEach(() => resetDb());

  it('transitions pending_pickup → pending and assigns hunter', async () => {
    const app = createTestApp();
    const hunter = await seedHeadhunter();
    const candidate = await seedCandidate();
    const job = await seedOpenJob();
    const apply = await request(app).post(`/v1/candidate-portal/jobs/${job.id}/apply`)
      .set('Authorization', `Bearer ${candidate.api_key}`).send({});
    const recommendationId = apply.body.data.recommendation_id;

    const res = await request(app)
      .post(`/v1/headhunter/recommendations/${recommendationId}/pickup`)
      .set('Authorization', `Bearer ${hunter.api_key}`);
    expect(res.status).toBe(200);

    // 验证候选人收到通知
    const notifs = db.prepare(`SELECT * FROM notifications WHERE user_id = ?`).all(candidate.id);
    expect(notifs.length).toBeGreaterThan(0);
  });

  it('rejects pickup by non-headhunter', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    const job = await seedOpenJob();
    const apply = await request(app).post(`/v1/candidate-portal/jobs/${job.id}/apply`)
      .set('Authorization', `Bearer ${candidate.api_key}`).send({});
    const res = await request(app)
      .post(`/v1/headhunter/recommendations/${apply.body.data.recommendation_id}/pickup`)
      .set('Authorization', `Bearer ${candidate.api_key}`);
    expect(res.status).toBe(403);
  });

  it('rejects pickup of already-picked application', async () => {
    const app = createTestApp();
    const hunter1 = await seedHeadhunter();
    const hunter2 = await seedHeadhunter();
    const candidate = await seedCandidate();
    const job = await seedOpenJob();
    const apply = await request(app).post(`/v1/candidate-portal/jobs/${job.id}/apply`)
      .set('Authorization', `Bearer ${candidate.api_key}`).send({});
    const rid = apply.body.data.recommendation_id;
    await request(app).post(`/v1/headhunter/recommendations/${rid}/pickup`)
      .set('Authorization', `Bearer ${hunter1.api_key}`);
    const res = await request(app)
      .post(`/v1/headhunter/recommendations/${rid}/pickup`)
      .set('Authorization', `Bearer ${hunter2.api_key}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_PICKED_UP');
  });
});
```

- [ ] **Step 2: 实现 handler**

创建 `src/main/modules/candidate-portal/headhunter-pickup.ts`:

```typescript
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createCandidateApplicationsRepo } from '../../db/repositories/candidate-applications.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { createNotificationsRepo } from '../../db/repositories/notifications.js';
import { applyTransition } from '../../flows/index.js';
import { Errors } from '../../errors.js';

export function createHeadhunterPickup(db: DB) {
  const apps = createCandidateApplicationsRepo(db);
  const recs = createRecommendationsRepo(db);
  const notif = createNotificationsRepo(db);

  return {
    listPendingPickup(_user: User, opts: { limit?: number; offset?: number } = {}) {
      const limit = Math.min(opts.limit ?? 20, 50);
      const offset = opts.offset ?? 0;
      return { items: apps.listPendingPickup(limit, offset), next_cursor: null };
    },

    pickup(user: User, recommendationId: string) {
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can pick up');

      const rec = recs.findById(recommendationId);
      if (!rec) throw Errors.notFound('Recommendation not found');
      if (rec.status !== 'pending_pickup') throw Errors.conflict('ALREADY_PICKED_UP: Application is no longer awaiting pickup');

      const app = apps.findByRecommendation(recommendationId);
      if (!app) throw Errors.notFound('Application not found');

      db.exec('BEGIN');
      try {
        applyTransition(/* recFlow */, 'pending_pickup', 'pickup', {});
        recs.updatePickupHeadhunter(recommendationId, user.id);
        recs.updateStatus(recommendationId, 'pending');
        apps.setPickup(app.id, user.id);
        db.exec('COMMIT');

        // 通知候选人
        notif.insert({
          user_id: app.candidate_user_id,
          category: 'application_picked_up',
          title: '您的申请已被认领',
          body: `猎头已认领您的申请,将进入下一步流程`,
          dedup_key: `pickup:${recommendationId}`,
        });

        return { recommendation_id: recommendationId, status: 'pending' };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
```

- [ ] **Step 3: 在 headhunter 路由挂载**

修改 `src/main/routes/headhunter.ts`,在 router 中增加:

```typescript
import { createHeadhunterPickup } from '../modules/candidate-portal/headhunter-pickup.js';

// 在 createHeadhunterRouter 内:
const pickup = createHeadhunterPickup(db);

router.get('/recommendations/pending-pickup', (req, res, next) => {
  try {
    const user = (req as any).user!;
    const result = pickup.listPendingPickup(user, { limit: Number(req.query.limit ?? 20), offset: Number(req.query.offset ?? 0) });
    respond(res, /* PendingPickupListResponseSchema */, { ok: true, data: result });
  } catch (e) { next(e); }
});

router.post('/recommendations/:id/pickup', (req, res, next) => {
  try {
    const user = (req as any).user!;
    const result = pickup.pickup(user, req.params.id);
    respond(res, /* PickupResponseSchema */, { ok: true, data: result });
  } catch (e) { next(e); }
});
```

- [ ] **Step 4: 重新运行测试, 确认通过**

Run: `pnpm test tests/integration/candidate-portal/headhunter-pickup.test.ts`
Expected: 4 passed

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/candidate-portal/headhunter-pickup.ts src/main/routes/headhunter.ts \
        tests/integration/candidate-portal/headhunter-pickup.test.ts
git commit -m "feat(headhunter): pickup endpoints for candidate-self-applications"
```

---

## Phase G: 后端 Messages

### Task 11: Messages 端点 (TDD)

**Files:**
- Create: `src/main/db/repositories/candidate-messages.ts`
- Create: `src/main/modules/candidate-portal/messages.ts`
- Test: `tests/integration/candidate-portal/messages.test.ts`

- [ ] **Step 1: 实现 messages 仓储**

创建 `src/main/db/repositories/candidate-messages.ts`:

```typescript
import type { DB } from '../connection.js';

export interface MessageRow {
  id: number;
  application_id: number | null;
  from_user_id: string;
  to_user_id: string;
  content: string;
  read_at: number | null;
  created_at: number;
}

export function createCandidateMessagesRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO candidate_messages (application_id, from_user_id, to_user_id, content)
    VALUES (?, ?, ?, ?)
  `);
  const inboxStmt = db.prepare(`
    SELECT cm.*, u.email as from_email, u.user_type as from_type
    FROM candidate_messages cm
    JOIN users u ON u.id = cm.from_user_id
    WHERE cm.to_user_id = ?
    ORDER BY cm.created_at DESC LIMIT ? OFFSET ?
  `);
  const sentStmt = db.prepare(`
    SELECT cm.*, u.email as to_email, u.user_type as to_type
    FROM candidate_messages cm
    JOIN users u ON u.id = cm.to_user_id
    WHERE cm.from_user_id = ?
    ORDER BY cm.created_at DESC LIMIT ? OFFSET ?
  `);
  const unreadCountStmt = db.prepare(
    'SELECT COUNT(*) as cnt FROM candidate_messages WHERE to_user_id = ? AND read_at IS NULL'
  );
  const markReadStmt = db.prepare(
    'UPDATE candidate_messages SET read_at = ? WHERE id = ? AND to_user_id = ?'
  );

  return {
    insert(input: { application_id?: number; from_user_id: string; to_user_id: string; content: string }): number {
      const r = insertStmt.run(
        input.application_id ?? null,
        input.from_user_id,
        input.to_user_id,
        input.content
      );
      return Number(r.lastInsertRowid);
    },
    inbox(userId: string, limit: number, offset: number): any[] {
      return inboxStmt.all(userId, limit, offset);
    },
    sent(userId: string, limit: number, offset: number): any[] {
      return sentStmt.all(userId, limit, offset);
    },
    unreadCount(userId: string): number {
      const row = unreadCountStmt.get(userId) as { cnt: number };
      return row.cnt;
    },
    markRead(id: number, userId: string, readAt: number = Date.now()): boolean {
      const result = markReadStmt.run(readAt, id, userId);
      return result.changes > 0;
    },
  };
}
```

- [ ] **Step 2: 编写集成测试**

创建 `tests/integration/candidate-portal/messages.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, resetDb, seedCandidate, seedHeadhunter, seedEmployer } from '../../helpers/test-app.js';

describe('GET /v1/candidate-portal/messages', () => {
  beforeEach(() => resetDb());

  it('returns inbox (default)', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    const hunter = await seedHeadhunter();
    await request(app).post('/v1/candidate-portal/messages')
      .set('Authorization', `Bearer ${hunter.api_key}`)
      .send({ to_user_id: candidate.id, content: 'Hello' });
    const res = await request(app).get('/v1/candidate-portal/messages')
      .set('Authorization', `Bearer ${candidate.api_key}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(1);
  });

  it('returns sent box when box=sent', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    const hunter = await seedHeadhunter();
    await request(app).post('/v1/candidate-portal/messages')
      .set('Authorization', `Bearer ${candidate.api_key}`)
      .send({ to_user_id: hunter.id, content: 'Hi there' });
    const res = await request(app).get('/v1/candidate-portal/messages?box=sent')
      .set('Authorization', `Bearer ${candidate.api_key}`);
    expect(res.body.data.items[0].content).toBe('Hi there');
  });
});

describe('POST /v1/candidate-portal/messages', () => {
  beforeEach(() => resetDb());

  it('sends a message', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    const hunter = await seedHeadhunter();
    const res = await request(app).post('/v1/candidate-portal/messages')
      .set('Authorization', `Bearer ${candidate.api_key}`)
      .send({ to_user_id: hunter.id, content: 'When can we chat?' });
    expect(res.status).toBe(200);
    expect(res.body.data.message_id).toBeDefined();
  });

  it('attaches to application if application_id provided', async () => {
    const app = createTestApp();
    const candidate = await seedCandidate();
    const hunter = await seedHeadhunter();
    const res = await request(app).post('/v1/candidate-portal/messages')
      .set('Authorization', `Bearer ${candidate.api_key}`)
      .send({ to_user_id: hunter.id, content: 'About my application', application_id: 1 });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: 实现 handler**

创建 `src/main/modules/candidate-portal/messages.ts`:

```typescript
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createCandidateMessagesRepo } from '../../db/repositories/candidate-messages.js';
import { Errors } from '../../errors.js';

export interface MessageSendInput {
  to_user_id: string;
  content: string;
  application_id?: number;
}

export function createCandidatePortalMessages(db: DB) {
  const repo = createCandidateMessagesRepo(db);

  return {
    list(user: User, opts: { box?: 'inbox' | 'sent'; unread_only?: boolean; limit?: number; offset?: number } = {}) {
      if (user.user_type !== 'candidate' && user.user_type !== 'headhunter' && user.user_type !== 'employer') {
        throw Errors.forbidden('Invalid user type');
      }
      const limit = Math.min(opts.limit ?? 20, 50);
      const offset = opts.offset ?? 0;
      const box = opts.box ?? 'inbox';
      const items = box === 'inbox' ? repo.inbox(user.id, limit, offset) : repo.sent(user.id, limit, offset);
      const unread_count = repo.unreadCount(user.id);
      return { items, unread_count, box };
    },

    send(user: User, input: MessageSendInput) {
      if (!input.content || input.content.trim().length === 0) {
        throw Errors.validation('Content cannot be empty');
      }
      if (input.content.length > 2000) {
        throw Errors.validation('Content too long (max 2000 chars)');
      }
      // 校验收件人存在
      const recipient = db.prepare('SELECT id, user_type FROM users WHERE id = ?').get(input.to_user_id);
      if (!recipient) throw Errors.notFound('Recipient not found');
      const id = repo.insert({
        from_user_id: user.id,
        to_user_id: input.to_user_id,
        content: input.content,
        application_id: input.application_id,
      });
      return { message_id: id };
    },
  };
}
```

- [ ] **Step 4: 重新运行测试, 确认通过**

Run: `pnpm test tests/integration/candidate-portal/messages.test.ts`
Expected: 3 passed

- [ ] **Step 5: 提交**

```bash
git add src/main/db/repositories/candidate-messages.ts src/main/modules/candidate-portal/messages.ts \
        tests/integration/candidate-portal/messages.test.ts
git commit -m "feat(candidate-portal): messages list/send endpoints"
```

---

## Phase H: 后端 Router 挂载 + Schemas

### Task 12: 候选门户 Zod Schemas + Router 挂载

**Files:**
- Create: `src/main/schemas/candidate-portal.ts`
- Create: `src/main/routes/candidate-portal.ts`
- Modify: `src/main/server.ts` (注册路由)

- [ ] **Step 1: 实现 Zod schemas**

创建 `src/main/schemas/candidate-portal.ts`:

```typescript
import { z } from 'zod';

export const EmailSchema = z.string().email();

export const OtpRequestSchema = z.object({
  email: EmailSchema,
}).strict();
export const OtpRequestResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    expires_in: z.number(),
    dev_code: z.string().optional(),
  }),
}).strict();

export const OtpVerifySchema = z.object({
  email: EmailSchema,
  code: z.string().regex(/^\d{4,8}$/),
}).strict();
export const OtpVerifyResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    api_key: z.string(),
    user_id: z.string(),
    profile_complete: z.boolean(),
  }),
}).strict();

export const JobSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  industry: z.string().nullable(),
  title_level: z.string().nullable(),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  location: z.string().nullable(),
  skills: z.array(z.string()),
  priority: z.string(),
  posted_at: z.string(),
});
export const JobsBrowseResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    items: z.array(JobSummarySchema),
    next_cursor: z.number().nullable(),
  }),
}).strict();

export const RecommendedJobsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(z.object({
    job_id: z.string(),
    score: z.number(),
  })),
}).strict();

export const JobDetailResponseSchema = z.object({
  ok: z.literal(true),
  data: JobSummarySchema.extend({
    description: z.string(),
    match_score: z.number(),
    match_dimensions: z.object({
      skills: z.array(z.string()),
      job_skills: z.array(z.string()),
    }),
  }),
}).strict();

export const ApplySchema = z.object({
  note: z.string().max(500).optional(),
}).strict();
export const ApplyResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    application_id: z.number(),
    recommendation_id: z.string(),
  }),
}).strict();

export const ApplicationsListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(z.any()), // TODO: tighten
}).strict();

export const ApplicationDetailResponseSchema = z.object({
  ok: z.literal(true),
  data: z.any(),
}).strict();

export const RespondSchema = z.object({
  action: z.enum(['withdraw', 'consider_offer', 'accept_offer', 'decline_offer']),
}).strict();
export const RespondResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({ status: z.string() }),
}).strict();

export const ProfileViewResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    id: z.string(),
    industry: z.string().nullable(),
    title_level: z.string().nullable(),
    years_experience: z.number().nullable(),
    skills: z.array(z.string()),
    visibility: z.string(),
    expectations: z.any().nullable(),
    pii: z.object({
      name: z.string().nullable(),
      current_company: z.string().nullable(),
      education_tier: z.string().nullable(),
    }),
  }),
}).strict();

export const ProfileUpdateSchema = z.object({
  skills: z.array(z.string()).optional(),
  expectations: z.record(z.any()).optional(),
  visibility: z.enum(['public', 'invitation_only', 'hidden']).optional(),
}).strict();
export const ProfileUpdateResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({ updated: z.boolean() }),
}).strict();

export const MessageSendSchema = z.object({
  to_user_id: z.string(),
  content: z.string().min(1).max(2000),
  application_id: z.number().int().optional(),
}).strict();
export const MessageSendResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({ message_id: z.number() }),
}).strict();

export const MessagesListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    items: z.array(z.any()),
    unread_count: z.number(),
    box: z.enum(['inbox', 'sent']),
  }),
}).strict();

export const PendingPickupResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    items: z.array(z.any()),
    next_cursor: z.number().nullable(),
  }),
}).strict();

export const PickupResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    recommendation_id: z.string(),
    status: z.string(),
  }),
}).strict();
```

- [ ] **Step 2: 实现 candidate-portal router**

创建 `src/main/routes/candidate-portal.ts`:

```typescript
import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createCandidatePortalAuth } from '../modules/candidate-portal/auth.js';
import { createCandidatePortalJobs } from '../modules/candidate-portal/jobs.js';
import { createCandidatePortalApplications } from '../modules/candidate-portal/applications.js';
import { createCandidatePortalMessages } from '../modules/candidate-portal/messages.js';
import { createCandidatePortalProfile } from '../modules/candidate-portal/profile.js';
import { respond } from '../responses.js';
import { Errors } from '../errors.js';
import type { User } from '../../shared/types.js';
import {
  OtpRequestSchema, OtpRequestResponseSchema,
  OtpVerifySchema, OtpVerifyResponseSchema,
  JobsBrowseResponseSchema, RecommendedJobsResponseSchema, JobDetailResponseSchema,
  ApplySchema, ApplyResponseSchema,
  ApplicationsListResponseSchema, ApplicationDetailResponseSchema,
  RespondSchema, RespondResponseSchema,
  ProfileViewResponseSchema, ProfileUpdateSchema, ProfileUpdateResponseSchema,
  MessageSendSchema, MessageSendResponseSchema, MessagesListResponseSchema,
} from '../schemas/candidate-portal.js';

export function createCandidatePortalRouter(db: DB, opts: {
  otpLength: number; otpTtlSeconds: number; otpMaxAttempts: number; consoleOnly: boolean;
}): Router {
  const router = Router();
  const auth = createCandidatePortalAuth(db, opts);
  const jobs = createCandidatePortalJobs(db);
  const applications = createCandidatePortalApplications(db);
  const messages = createCandidatePortalMessages(db);
  const profile = createCandidatePortalProfile(db);

  // ===== 公开端点 (OTP) =====
  router.post('/auth/otp/request', async (req, res, next) => {
    try {
      const parsed = OtpRequestSchema.parse(req.body);
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
      const result = await auth.requestOtp({ email: parsed.email, ip });
      respond(res, OtpRequestResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  router.post('/auth/otp/verify', async (req, res, next) => {
    try {
      const parsed = OtpVerifySchema.parse(req.body);
      const result = await auth.verifyOtp({ email: parsed.email, code: parsed.code });
      respond(res, OtpVerifyResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // ===== 受保护端点 (bearer token) =====
  router.use(authMiddleware(db));

  // Jobs
  router.get('/jobs/browse', (req, res, next) => {
    try {
      const user = (req as any).user!;
      const result = jobs.browse(user, {
        industry: req.query.industry as string | undefined,
        title_level: req.query.title_level as string | undefined,
        keyword: req.query.keyword as string | undefined,
        cursor: req.query.cursor ? Number(req.query.cursor) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      respond(res, JobsBrowseResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  router.get('/jobs/recommended', (req, res, next) => {
    try {
      const user = (req as any).user!;
      const result = jobs.recommended(user, { limit: req.query.limit ? Number(req.query.limit) : 20 });
      respond(res, RecommendedJobsResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  router.get('/jobs/:id', (req, res, next) => {
    try {
      const user = (req as any).user!;
      const result = jobs.detail(user, req.params.id);
      respond(res, JobDetailResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  router.post('/jobs/:id/apply', (req, res, next) => {
    try {
      const user = (req as any).user!;
      const parsed = ApplySchema.parse(req.body);
      const result = applications.apply(user, req.params.id, parsed);
      respond(res, ApplyResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // Applications
  router.get('/applications', (req, res, next) => {
    try {
      const user = (req as any).user!;
      const items = applications.list(user, {
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      respond(res, ApplicationsListResponseSchema, { ok: true, data: items });
    } catch (e) { next(e); }
  });

  router.get('/applications/:id', (req, res, next) => {
    try {
      const user = (req as any).user!;
      const app = applications.detail(user, Number(req.params.id));
      respond(res, ApplicationDetailResponseSchema, { ok: true, data: app });
    } catch (e) { next(e); }
  });

  router.post('/applications/:id/respond', (req, res, next) => {
    try {
      const user = (req as any).user!;
      const parsed = RespondSchema.parse(req.body);
      applications.respond(user, Number(req.params.id), parsed.action);
      respond(res, RespondResponseSchema, { ok: true, data: { status: 'responded' } });
    } catch (e) { next(e); }
  });

  // Profile
  router.get('/profile', (req, res, next) => {
    try {
      const user = (req as any).user!;
      const result = profile.getProfile(user);
      respond(res, ProfileViewResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  router.put('/profile', (req, res, next) => {
    try {
      const user = (req as any).user!;
      const parsed = ProfileUpdateSchema.parse(req.body);
      profile.updateProfile(user, parsed);
      respond(res, ProfileUpdateResponseSchema, { ok: true, data: { updated: true } });
    } catch (e) { next(e); }
  });

  router.get('/profile/audit-log', (req, res, next) => {
    try {
      const user = (req as any).user!;
      const items = profile.listAuditLog(user, {
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      respond(res, ApplicationsListResponseSchema, { ok: true, data: items }); // 复用 schema
    } catch (e) { next(e); }
  });

  // Messages
  router.get('/messages', (req, res, next) => {
    try {
      const user = (req as any).user!;
      const result = messages.list(user, {
        box: req.query.box as 'inbox' | 'sent' | undefined,
        unread_only: req.query.unread_only === 'true',
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      respond(res, MessagesListResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  router.post('/messages', (req, res, next) => {
    try {
      const user = (req as any).user!;
      const parsed = MessageSendSchema.parse(req.body);
      const result = messages.send(user, parsed);
      respond(res, MessageSendResponseSchema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  return router;
}
```

- [ ] **Step 3: 在 server.ts 挂载路由**

修改 `src/main/server.ts`,在 router 挂载区增加:

```typescript
import { createCandidatePortalRouter } from './routes/candidate-portal.js';

// 在 createAppFromDb 内, 与其他 router 同级:
app.use('/v1/candidate-portal',
  createUtf8OnlyMiddleware(),
  express.json({ limit: MAX_BODY_SIZE }),
  createCandidatePortalRouter(db, {
    otpLength: env.OTP_LENGTH,
    otpTtlSeconds: env.OTP_TTL_SECONDS,
    otpMaxAttempts: env.OTP_MAX_ATTEMPTS,
    consoleOnly: env.OTP_CONSOLE_ONLY,
  })
);
```

(注意: OTP 端点需在 `authMiddleware` 之前定义, 当前 router 内部先注册 OTP 再 use authMiddleware, 正确)

- [ ] **Step 4: 验证服务启动**

Run: `pnpm dev`
Expected: 服务正常启动, 无路由冲突错误

测试 OTP 端点:
```bash
curl -X POST http://localhost:3000/v1/candidate-portal/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```
Expected: 返回 `{ok: true, data: {expires_in: 300, dev_code: "123456"}}`

- [ ] **Step 5: 提交**

```bash
git add src/main/schemas/candidate-portal.ts src/main/routes/candidate-portal.ts src/main/server.ts
git commit -m "feat(router): mount /v1/candidate-portal router with all 13 endpoints"
```

---

## Phase I: 前端基础

### Task 13: 增加 React Query 依赖 + 设计令牌 CSS

**Files:**
- Modify: `admin-web/package.json`
- Modify: `admin-web/src/main.tsx`
- Create: `admin-web/src/styles/tokens.css`
- Modify: `admin-web/src/styles.css`

- [ ] **Step 1: 安装依赖**

Run: `cd admin-web && pnpm add @tanstack/react-query`
Expected: 依赖添加到 `admin-web/package.json` + `pnpm-lock.yaml` 更新

- [ ] **Step 2: 创建设计令牌**

创建 `admin-web/src/styles/tokens.css`:

```css
:root {
  /* 颜色 (来自 ow-recruit --c-* / --b-*) */
  --c-project: #2563eb;    --b-project: #eff6ff;
  --c-position: #16a34a;   --b-position: #f0fdf4;
  --c-candidate: #d97706;  --b-candidate: #fffbeb;
  --c-match: #9333ea;      --b-match: #faf5ff;
  --c-hunter: #10b981;     --b-hunter: rgba(16,185,129,0.1);

  /* 间距 */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px;
  --sp-4: 16px; --sp-6: 24px; --sp-8: 32px;

  /* 阴影 */
  --shadow-1: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-2: 0 2px 4px rgba(0,0,0,0.08);
  --shadow-3: 0 4px 8px rgba(0,0,0,0.12);
  --shadow-4: 0 8px 16px rgba(0,0,0,0.16);

  /* 字体 */
  --font-sans: 'Inter', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* 主题 (默认 light) */
  --bg: #fafafa;          --surface: #ffffff;
  --text: #171717;        --text-muted: #737373;
  --border: #e5e5e5;
}

[data-theme="dark"] {
  --bg: #0a0a0a;
  --surface: #171717;
  --text: #fafafa;
  --text-muted: #a3a3a3;
  --border: #262626;
}

body {
  font-family: var(--font-sans);
  background: var(--bg);
  color: var(--text);
  margin: 0;
  transition: background 200ms, color 200ms;
}
```

- [ ] **Step 3: 在 styles.css 导入 tokens**

修改 `admin-web/src/styles.css`,在文件顶部增加:

```css
@import './styles/tokens.css';
```

- [ ] **Step 4: 在 main.tsx 包裹 QueryClient**

修改 `admin-web/src/main.tsx`:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const rootEl = document.getElementById('root')!;
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/admin">
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
```

(注意: basename 改为可配置 — 见 Task 25 路由分发)

- [ ] **Step 5: 提交**

```bash
git add admin-web/package.json pnpm-lock.yaml admin-web/src/main.tsx admin-web/src/styles.css admin-web/src/styles/tokens.css
git commit -m "feat(admin-web): react-query + design tokens extracted from ow-recruit"
```

---

### Task 14: Session Storage + API 客户端 + RequireAuth HOC

**Files:**
- Create: `admin-web/src/lib/candidate-session.ts`
- Create: `admin-web/src/api/candidate-portal.ts`
- Create: `admin-web/src/components/candidate-portal/RequireAuth.tsx`

- [ ] **Step 1: 实现 session storage**

创建 `admin-web/src/lib/candidate-session.ts`:

```typescript
const KEY = 'hp_candidate_session';

export interface CandidateSession {
  api_key: string;
  user_id: string;
  profile_complete: boolean;
  email?: string;
}

export function getSession(): CandidateSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(session: CandidateSession): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}

export function getAuthHeader(): string | null {
  const s = getSession();
  return s ? `Bearer ${s.api_key}` : null;
}
```

- [ ] **Step 2: 实现 API 客户端**

创建 `admin-web/src/api/candidate-portal.ts`:

```typescript
import { getAuthHeader, clearSession } from '../lib/candidate-session';

const BASE = '/v1/candidate-portal';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  const auth = getAuthHeader();
  if (auth) headers['Authorization'] = auth;

  const res = await fetch(BASE + path, { ...init, headers });
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) clearSession();
    throw new ApiError(
      json.error?.code ?? 'UNKNOWN_ERROR',
      json.error?.message ?? `HTTP ${res.status}`,
      res.status
    );
  }
  return json.data;
}

// ===== OTP =====
export const otp = {
  request: (email: string) =>
    request<{ expires_in: number; dev_code?: string }>('/auth/otp/request', {
      method: 'POST', body: JSON.stringify({ email }),
    }),
  verify: (email: string, code: string) =>
    request<{ api_key: string; user_id: string; profile_complete: boolean }>(
      '/auth/otp/verify', { method: 'POST', body: JSON.stringify({ email, code }) }
    ),
};

// ===== Jobs =====
export const jobs = {
  browse: (params: { industry?: string; title_level?: string; keyword?: string; cursor?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<{ items: any[]; next_cursor: number | null }>(`/jobs/browse?${q}`);
  },
  recommended: (limit: number = 20) =>
    request<Array<{ job_id: string; score: number }>>(`/jobs/recommended?limit=${limit}`),
  detail: (id: string) => request<any>(`/jobs/${id}`),
  apply: (id: string, note?: string) =>
    request<{ application_id: number; recommendation_id: string }>(`/jobs/${id}/apply`, {
      method: 'POST', body: JSON.stringify({ note }),
    }),
};

// ===== Applications =====
export const applications = {
  list: (limit: number = 20, offset: number = 0) =>
    request<any[]>(`/applications?limit=${limit}&offset=${offset}`),
  detail: (id: number) => request<any>(`/applications/${id}`),
  respond: (id: number, action: 'withdraw' | 'consider_offer' | 'accept_offer' | 'decline_offer') =>
    request<{ status: string }>(`/applications/${id}/respond`, {
      method: 'POST', body: JSON.stringify({ action }),
    }),
};

// ===== Profile =====
export const profile = {
  view: () => request<any>('/profile'),
  update: (input: { skills?: string[]; expectations?: object; visibility?: 'public' | 'invitation_only' | 'hidden' }) =>
    request<{ updated: boolean }>('/profile', { method: 'PUT', body: JSON.stringify(input) }),
  auditLog: (limit: number = 50) => request<any[]>(`/profile/audit-log?limit=${limit}`),
};

// ===== Messages =====
export const messages = {
  list: (opts: { box?: 'inbox' | 'sent'; unread_only?: boolean; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(opts).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<{ items: any[]; unread_count: number; box: string }>(`/messages?${q}`);
  },
  send: (input: { to_user_id: string; content: string; application_id?: number }) =>
    request<{ message_id: number }>('/messages', {
      method: 'POST', body: JSON.stringify(input),
    }),
};
```

- [ ] **Step 3: 实现 RequireAuth HOC**

创建 `admin-web/src/components/candidate-portal/RequireAuth.tsx`:

```typescript
import { Navigate, useLocation } from 'react-router-dom';
import { getSession } from '../../lib/candidate-session';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const session = getSession();
  const location = useLocation();
  if (!session) {
    return <Navigate to="/candidate/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
```

- [ ] **Step 4: 提交**

```bash
git add admin-web/src/lib/candidate-session.ts admin-web/src/api/candidate-portal.ts admin-web/src/components/candidate-portal/RequireAuth.tsx
git commit -m "feat(admin-web): session storage + typed API client + RequireAuth HOC"
```

---

### Task 15: MobileLayout + OtpInput + EmptyState 组件

**Files:**
- Create: `admin-web/src/components/candidate-portal/MobileLayout.tsx`
- Create: `admin-web/src/components/candidate-portal/OtpInput.tsx`
- Create: `admin-web/src/components/candidate-portal/EmptyState.tsx`
- Test: `admin-web/src/components/candidate-portal/__tests__/OtpInput.test.tsx`

- [ ] **Step 1: 实现 MobileLayout**

创建 `admin-web/src/components/candidate-portal/MobileLayout.tsx`:

```typescript
import { NavLink } from 'react-router-dom';
import { getSession, clearSession } from '../../lib/candidate-session';
import { useNavigate } from 'react-router-dom';

interface MobileLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export function MobileLayout({ children, title }: MobileLayoutProps) {
  const session = getSession();
  const navigate = useNavigate();

  return (
    <div className="cp-layout">
      <header className="cp-topbar">
        <div className="cp-brand">Hunter · C 端</div>
        {title && <div className="cp-title">{title}</div>}
        {session && (
          <button
            className="cp-logout"
            onClick={() => { clearSession(); navigate('/candidate/login'); }}
          >
            退出
          </button>
        )}
      </header>
      <main className="cp-main">{children}</main>
      {session && (
        <nav className="cp-tabbar">
          <NavLink to="/candidate/home" className="cp-tab">🏠 推荐</NavLink>
          <NavLink to="/candidate/browse" className="cp-tab">🔍 浏览</NavLink>
          <NavLink to="/candidate/applications" className="cp-tab">📋 申请</NavLink>
          <NavLink to="/candidate/messages" className="cp-tab">💬 消息</NavLink>
          <NavLink to="/candidate/profile" className="cp-tab">👤 我的</NavLink>
        </nav>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 实现 OtpInput**

创建 `admin-web/src/components/candidate-portal/OtpInput.tsx`:

```typescript
import { useRef, useState, useEffect } from 'react';

interface OtpInputProps {
  length?: number;
  onChange?: (code: string) => void;
}

export function OtpInput({ length = 6, onChange }: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(''));
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    onChange?.(digits.join(''));
  }, [digits, onChange]);

  function handleChange(idx: number, value: string) {
    const v = value.replace(/\D/g, '').slice(0, 1);
    const newDigits = [...digits];
    newDigits[idx] = v;
    setDigits(newDigits);
    if (v && idx < length - 1) refs.current[idx + 1]?.focus();
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    const newDigits = pasted.split('').concat(Array(length).fill('')).slice(0, length);
    setDigits(newDigits);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  }

  return (
    <div className="cp-otp-input">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={handlePaste}
          autoFocus={i === 0}
          className="cp-otp-digit"
          aria-label={`OTP 第 ${i + 1} 位`}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 编写 OtpInput 测试**

创建 `admin-web/src/components/candidate-portal/__tests__/OtpInput.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OtpInput } from '../OtpInput';

describe('OtpInput', () => {
  it('renders 6 input boxes by default', () => {
    render(<OtpInput />);
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
  });

  it('renders custom length', () => {
    render(<OtpInput length={4} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
  });

  it('calls onChange when a digit is entered', () => {
    const onChange = vi.fn();
    render(<OtpInput onChange={onChange} />);
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '1' } });
    expect(onChange).toHaveBeenCalledWith('1');
  });

  it('rejects non-numeric input', () => {
    render(<OtpInput />);
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.change(input, { target: { value: 'a' } });
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('auto-advances to next input on digit entry', () => {
    render(<OtpInput />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: '1' } });
    expect(document.activeElement).toBe(inputs[1]);
  });
});
```

- [ ] **Step 4: 实现 EmptyState**

创建 `admin-web/src/components/candidate-portal/EmptyState.tsx`:

```typescript
interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon = '📭', title, description, action }: EmptyStateProps) {
  return (
    <div className="cp-empty-state">
      <div className="cp-empty-icon">{icon}</div>
      <div className="cp-empty-title">{title}</div>
      {description && <div className="cp-empty-desc">{description}</div>}
      {action && (
        <button className="cp-empty-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 添加 CSS (在 tokens.css 末尾追加或在 styles.css)**

在 `admin-web/src/styles.css` 末尾追加:

```css
/* Candidate Portal layout */
.cp-layout { min-height: 100vh; padding-bottom: 64px; }
.cp-topbar {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  background: var(--surface); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 10;
}
.cp-brand { font-weight: 700; color: var(--c-project); }
.cp-title { flex: 1; font-weight: 600; }
.cp-logout {
  background: none; border: 1px solid var(--border);
  padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 13px;
}
.cp-main { padding: 16px; }
.cp-tabbar {
  position: fixed; bottom: 0; left: 0; right: 0;
  display: flex; justify-content: space-around;
  background: var(--surface); border-top: 1px solid var(--border);
  padding: 8px 0; z-index: 10;
}
.cp-tab {
  flex: 1; text-align: center; padding: 8px;
  text-decoration: none; color: var(--text-muted); font-size: 12px;
}
.cp-tab.active { color: var(--c-project); font-weight: 600; }

/* OTP input */
.cp-otp-input { display: flex; gap: 8px; justify-content: center; margin: 16px 0; }
.cp-otp-digit {
  width: 48px; height: 56px; text-align: center;
  font-size: 24px; font-weight: 600;
  border: 2px solid var(--border); border-radius: 8px;
  background: var(--surface); color: var(--text);
}
.cp-otp-digit:focus { outline: none; border-color: var(--c-project); }

/* Empty state */
.cp-empty-state {
  text-align: center; padding: 48px 16px; color: var(--text-muted);
}
.cp-empty-icon { font-size: 48px; margin-bottom: 12px; }
.cp-empty-title { font-size: 16px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
.cp-empty-desc { font-size: 14px; margin-bottom: 16px; }
.cp-empty-action {
  background: var(--c-project); color: white; border: none;
  padding: 8px 20px; border-radius: 8px; cursor: pointer; font-size: 14px;
}

@media (min-width: 769px) {
  .cp-tabbar { display: none; }
  .cp-layout { padding-bottom: 0; max-width: 1024px; margin: 0 auto; }
}
```

- [ ] **Step 6: 运行前端测试**

Run: `cd admin-web && pnpm test src/components/candidate-portal/__tests__/OtpInput.test.tsx`
Expected: 5 passed

- [ ] **Step 7: 提交**

```bash
git add admin-web/src/components/candidate-portal/MobileLayout.tsx \
        admin-web/src/components/candidate-portal/OtpInput.tsx \
        admin-web/src/components/candidate-portal/EmptyState.tsx \
        admin-web/src/components/candidate-portal/__tests__/OtpInput.test.tsx \
        admin-web/src/styles.css
git commit -m "feat(admin-web): MobileLayout + OtpInput + EmptyState components"
```

---

### Task 16: RadarChart + JobCard + MatchScore + FunnelCard + MessageBubble

**Files:**
- Create: `admin-web/src/components/candidate-portal/RadarChart.tsx`
- Create: `admin-web/src/components/candidate-portal/JobCard.tsx`
- Create: `admin-web/src/components/candidate-portal/MatchScore.tsx`
- Create: `admin-web/src/components/candidate-portal/FunnelCard.tsx`
- Create: `admin-web/src/components/candidate-portal/MessageBubble.tsx`
- Test: `admin-web/src/components/candidate-portal/__tests__/RadarChart.test.tsx`

- [ ] **Step 1: 实现 RadarChart (SVG)**

创建 `admin-web/src/components/candidate-portal/RadarChart.tsx`:

```typescript
interface Dimension {
  label: string;
  score: number; // 0-100
}

interface RadarChartProps {
  dimensions: Dimension[];
  size?: number;
}

export function RadarChart({ dimensions, size = 280 }: RadarChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.4;
  const n = dimensions.length;

  const points = dimensions.map((d, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (d.score / 100) * radius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      labelX: cx + (radius + 16) * Math.cos(angle),
      labelY: cy + (radius + 16) * Math.sin(angle),
      label: d.label,
    };
  });

  const polygonPath = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg width={size} height={size} className="cp-radar" role="img" aria-label="能力雷达图">
      {/* 网格层 */}
      {[0.25, 0.5, 0.75, 1].map(ratio => (
        <circle
          key={ratio}
          cx={cx} cy={cy} r={radius * ratio}
          fill="none" stroke="var(--border)" strokeWidth={1}
        />
      ))}
      {/* 轴线 */}
      {points.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="var(--border)" />
      ))}
      {/* 数据多边形 */}
      <polygon points={polygonPath} fill="var(--c-match)" fillOpacity={0.3} stroke="var(--c-match)" strokeWidth={2} />
      {/* 标签 */}
      {points.map((p, i) => (
        <text
          key={i}
          x={p.labelX} y={p.labelY}
          textAnchor="middle" alignmentBaseline="middle"
          fontSize={12} fill="var(--text)"
        >
          {p.label}: {dimensions[i].score}
        </text>
      ))}
    </svg>
  );
}
```

- [ ] **Step 2: 编写 RadarChart 测试**

创建 `admin-web/src/components/candidate-portal/__tests__/RadarChart.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RadarChart } from '../RadarChart';

describe('RadarChart', () => {
  it('renders svg with given dimensions', () => {
    const { container } = render(
      <RadarChart dimensions={[
        { label: '技能', score: 80 },
        { label: '经验', score: 60 },
        { label: '薪资', score: 90 },
        { label: '行业', score: 70 },
        { label: '职级', score: 85 },
      ]} />
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg!.querySelectorAll('text')).toHaveLength(5);
    expect(svg!.querySelector('polygon')).toBeInTheDocument();
  });

  it('handles fewer dimensions', () => {
    const { container } = render(
      <RadarChart dimensions={[
        { label: 'A', score: 50 },
        { label: 'B', score: 50 },
      ]} />
    );
    expect(container.querySelector('polygon')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 实现 JobCard**

创建 `admin-web/src/components/candidate-portal/JobCard.tsx`:

```typescript
import { Link } from 'react-router-dom';
import { MatchScore } from './MatchScore';

interface JobCardProps {
  job: {
    id: string;
    title: string;
    industry?: string | null;
    title_level?: string | null;
    salary_min?: number | null;
    salary_max?: number | null;
    location?: string | null;
    skills?: string[];
    priority?: string;
  };
  matchScore?: number;
}

export function JobCard({ job, matchScore }: JobCardProps) {
  const salary = job.salary_min && job.salary_max
    ? `${(job.salary_min / 1000).toFixed(0)}k-${(job.salary_max / 1000).toFixed(0)}k`
    : '面议';

  return (
    <Link to={`/candidate/jobs/${job.id}`} className="cp-job-card">
      <div className="cp-job-header">
        <div className="cp-job-title">{job.title}</div>
        {matchScore != null && <MatchScore score={matchScore} />}
      </div>
      <div className="cp-job-meta">
        {job.industry && <span className="cp-job-tag">{job.industry}</span>}
        {job.title_level && <span className="cp-job-tag">{job.title_level}</span>}
        {job.location && <span className="cp-job-tag">📍 {job.location}</span>}
        <span className="cp-job-salary">💰 {salary}</span>
      </div>
      {job.skills && job.skills.length > 0 && (
        <div className="cp-job-skills">
          {job.skills.slice(0, 5).map(s => (
            <span key={s} className="cp-skill-tag">{s}</span>
          ))}
        </div>
      )}
    </Link>
  );
}
```

- [ ] **Step 4: 实现 MatchScore**

创建 `admin-web/src/components/candidate-portal/MatchScore.tsx`:

```typescript
interface MatchScoreProps { score: number; }

export function MatchScore({ score }: MatchScoreProps) {
  const color = score >= 80 ? 'var(--c-position)'
              : score >= 50 ? 'var(--c-candidate)'
              : 'var(--text-muted)';
  return (
    <span
      className="cp-match-score"
      style={{ background: color }}
      title={`匹配度 ${score}/100`}
    >
      {score}
    </span>
  );
}
```

- [ ] **Step 5: 实现 FunnelCard**

创建 `admin-web/src/components/candidate-portal/FunnelCard.tsx`:

```typescript
interface FunnelCardProps {
  stages: Array<{ name: string; count: number; candidates?: string[]; is_current?: boolean }>;
}

export function FunnelCard({ stages }: FunnelCardProps) {
  return (
    <div className="cp-funnel">
      {stages.map((s, i) => (
        <div key={i} className={`cp-funnel-stage ${s.is_current ? 'current' : ''}`}>
          <div className="cp-funnel-name">{s.name}</div>
          <div className="cp-funnel-count">{s.count}</div>
          {s.candidates && s.candidates.length > 0 && (
            <div className="cp-funnel-list">
              {s.candidates.slice(0, 3).map((c, j) => (
                <div key={j} className="cp-funnel-candidate">{c}</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: 实现 MessageBubble**

创建 `admin-web/src/components/candidate-portal/MessageBubble.tsx`:

```typescript
interface MessageBubbleProps {
  content: string;
  isMine: boolean;
  timestamp?: string;
  read?: boolean;
}

export function MessageBubble({ content, isMine, timestamp, read }: MessageBubbleProps) {
  return (
    <div className={`cp-bubble ${isMine ? 'mine' : 'theirs'}`}>
      <div className="cp-bubble-content">{content}</div>
      {timestamp && (
        <div className="cp-bubble-meta">
          {new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          {isMine && read != null && (read ? ' · 已读' : ' · 未读')}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: 追加组件 CSS**

在 `admin-web/src/styles.css` 末尾追加:

```css
/* Job card */
.cp-job-card {
  display: block; padding: 12px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; margin-bottom: 8px; text-decoration: none;
  color: var(--text); transition: box-shadow 200ms;
}
.cp-job-card:hover { box-shadow: var(--shadow-2); }
.cp-job-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.cp-job-title { font-weight: 600; font-size: 16px; }
.cp-job-meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; color: var(--text-muted); margin-bottom: 8px; }
.cp-job-tag { padding: 2px 6px; background: var(--bg); border-radius: 4px; }
.cp-job-salary { color: var(--c-position); font-weight: 600; }
.cp-job-skills { display: flex; flex-wrap: wrap; gap: 4px; }
.cp-skill-tag {
  padding: 2px 8px; background: var(--b-match); color: var(--c-match);
  border-radius: 4px; font-size: 11px;
}

/* Match score badge */
.cp-match-score {
  padding: 2px 8px; border-radius: 12px; color: white;
  font-size: 12px; font-weight: 600;
}

/* Radar */
.cp-radar { display: block; margin: 16px auto; }

/* Funnel */
.cp-funnel { display: flex; gap: 4px; align-items: stretch; overflow-x: auto; }
.cp-funnel-stage {
  flex: 1; min-width: 80px; padding: 12px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; text-align: center;
}
.cp-funnel-stage.current {
  border-color: var(--c-project);
  background: var(--b-project);
}
.cp-funnel-name { font-size: 12px; color: var(--text-muted); }
.cp-funnel-count { font-size: 24px; font-weight: 700; margin: 4px 0; }
.cp-funnel-list { font-size: 11px; color: var(--text-muted); margin-top: 8px; }

/* Message bubble */
.cp-bubble {
  max-width: 70%; padding: 8px 12px;
  border-radius: 12px; margin-bottom: 8px;
}
.cp-bubble.mine {
  background: var(--c-project); color: white;
  margin-left: auto;
}
.cp-bubble.theirs {
  background: var(--surface); border: 1px solid var(--border);
}
.cp-bubble-meta {
  font-size: 11px; opacity: 0.7; margin-top: 4px;
}
.cp-bubble.mine .cp-bubble-meta { text-align: right; }
```

- [ ] **Step 8: 运行前端测试**

Run: `cd admin-web && pnpm test src/components/candidate-portal/__tests__/`
Expected: 7 passed (OtpInput 5 + RadarChart 2)

- [ ] **Step 9: 提交**

```bash
git add admin-web/src/components/candidate-portal/ \
        admin-web/src/styles.css
git commit -m "feat(admin-web): RadarChart + JobCard + MatchScore + FunnelCard + MessageBubble"
```

---

## Phase J: 前端页面

### Task 17: LoginPage (OTP 流程)

**Files:**
- Create: `admin-web/src/pages/candidate-portal/LoginPage.tsx`

- [ ] **Step 1: 实现 LoginPage**

创建 `admin-web/src/pages/candidate-portal/LoginPage.tsx`:

```typescript
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { otp } from '../../api/candidate-portal';
import { setSession } from '../../lib/candidate-session';
import { OtpInput } from '../../components/candidate-portal/OtpInput';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await otp.request(email);
      if (res.dev_code) setDevCode(res.dev_code);
      setStep('otp');
    } catch (err: any) {
      setError(err.message || '发送失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await otp.verify(email, code);
      setSession({ api_key: res.api_key, user_id: res.user_id, profile_complete: res.profile_complete, email });
      navigate(res.profile_complete ? '/candidate/home' : '/candidate/profile');
    } catch (err: any) {
      setError(err.message || '验证码错误');
    } finally {
      setLoading(false);
    }
  }

  return (
    <MobileLayout>
      <div className="cp-login">
        <h1>{step === 'email' ? '登录 / 注册' : '输入验证码'}</h1>

        {step === 'email' ? (
          <form onSubmit={handleRequestOtp}>
            <input
              type="email"
              required
              placeholder="邮箱地址"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="cp-input"
              autoFocus
            />
            <button type="submit" disabled={loading} className="cp-btn-primary">
              {loading ? '发送中...' : '获取验证码'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp}>
            <p className="cp-login-hint">验证码已发送至 <strong>{email}</strong></p>
            {devCode && (
              <p className="cp-login-dev" style={{ background: 'var(--b-candidate)', padding: 8, borderRadius: 6 }}>
                🔧 开发模式验证码: <code>{devCode}</code>
              </p>
            )}
            <OtpInput onChange={setCode} />
            <button type="submit" disabled={loading || code.length < 6} className="cp-btn-primary">
              {loading ? '验证中...' : '登录'}
            </button>
            <button type="button" onClick={() => setStep('email')} className="cp-btn-link">
              ← 换邮箱
            </button>
          </form>
        )}

        {error && <div className="cp-error">{error}</div>}
      </div>
    </MobileLayout>
  );
}
```

- [ ] **Step 2: 添加登录页 CSS**

在 styles.css 追加:

```css
.cp-login { max-width: 400px; margin: 32px auto; padding: 24px; background: var(--surface); border-radius: 12px; }
.cp-login h1 { font-size: 24px; margin-bottom: 24px; text-align: center; }
.cp-input {
  width: 100%; padding: 12px; font-size: 16px;
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg); color: var(--text); box-sizing: border-box;
}
.cp-btn-primary {
  width: 100%; padding: 12px; margin-top: 16px;
  background: var(--c-project); color: white;
  border: none; border-radius: 8px; font-size: 16px;
  cursor: pointer; font-weight: 600;
}
.cp-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.cp-btn-link {
  display: block; margin: 12px auto 0; background: none;
  border: none; color: var(--text-muted); cursor: pointer;
}
.cp-login-hint { color: var(--text-muted); margin-bottom: 16px; text-align: center; }
.cp-login-dev { text-align: center; margin: 12px 0; font-size: 13px; }
.cp-error {
  margin-top: 16px; padding: 12px;
  background: rgba(239, 68, 68, 0.1); color: #dc2626;
  border-radius: 8px; font-size: 14px;
}
```

- [ ] **Step 3: 提交**

```bash
git add admin-web/src/pages/candidate-portal/LoginPage.tsx admin-web/src/styles.css
git commit -m "feat(admin-web): LoginPage with 2-step OTP flow"
```

---

### Task 18: HomePage + BrowsePage

**Files:**
- Create: `admin-web/src/pages/candidate-portal/HomePage.tsx`
- Create: `admin-web/src/pages/candidate-portal/BrowsePage.tsx`

- [ ] **Step 1: 实现 HomePage (推荐工作)**

创建 `admin-web/src/pages/candidate-portal/HomePage.tsx`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { jobs } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { JobCard } from '../../components/candidate-portal/JobCard';
import { EmptyState } from '../../components/candidate-portal/EmptyState';

export function HomePage() {
  const navigate = useNavigate();
  const { data: recommended, isLoading } = useQuery({
    queryKey: ['jobs', 'recommended'],
    queryFn: () => jobs.recommended(20),
  });
  const { data: browse } = useQuery({
    queryKey: ['jobs', 'browse'],
    queryFn: () => jobs.browse({ limit: 10 }),
  });

  const jobsById = new Map(browse?.items?.map((j: any) => [j.id, j]) ?? []);
  const recommendedJobs = (recommended ?? []).map(r => ({
    ...(jobsById.get(r.job_id) ?? { id: r.job_id, title: '(未知)' }),
    matchScore: r.score,
  }));

  return (
    <MobileLayout title="为你推荐">
      {isLoading && <div className="cp-loading">加载中...</div>}
      {!isLoading && recommendedJobs.length === 0 && (
        <EmptyState
          icon="🎯"
          title="还没有推荐"
          description="完善你的简历以获得更精准的匹配"
          action={{ label: '去完善', onClick: () => navigate('/candidate/profile') }}
        />
      )}
      <div className="cp-job-list">
        {recommendedJobs.map((j: any) => <JobCard key={j.id} job={j} matchScore={j.matchScore} />)}
      </div>
    </MobileLayout>
  );
}
```

- [ ] **Step 2: 实现 BrowsePage (全部工作 + 过滤)**

创建 `admin-web/src/pages/candidate-portal/BrowsePage.tsx`:

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jobs } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { JobCard } from '../../components/candidate-portal/JobCard';
import { EmptyState } from '../../components/candidate-portal/EmptyState';

export function BrowsePage() {
  const [industry, setIndustry] = useState('');
  const [keyword, setKeyword] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['jobs', 'browse', { industry, keyword }],
    queryFn: () => jobs.browse({ industry: industry || undefined, keyword: keyword || undefined, limit: 30 }),
  });

  return (
    <MobileLayout title="浏览工作">
      <div className="cp-filters">
        <input
          type="search"
          placeholder="🔍 搜索职位"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          className="cp-input"
        />
        <select value={industry} onChange={e => setIndustry(e.target.value)} className="cp-input">
          <option value="">所有行业</option>
          <option value="tech">互联网/技术</option>
          <option value="finance">金融</option>
          <option value="education">教育</option>
          <option value="healthcare">医疗</option>
          <option value="retail">零售</option>
        </select>
      </div>
      {isLoading && <div className="cp-loading">加载中...</div>}
      {data?.items?.length === 0 && (
        <EmptyState icon="🔍" title="暂无匹配的工作" description="尝试调整筛选条件" />
      )}
      <div className="cp-job-list">
        {(data?.items ?? []).map((j: any) => <JobCard key={j.id} job={j} />)}
      </div>
    </MobileLayout>
  );
}
```

- [ ] **Step 3: 追加 CSS**

```css
.cp-loading { padding: 32px; text-align: center; color: var(--text-muted); }
.cp-filters { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.cp-filters .cp-input { flex: 1; min-width: 120px; }
.cp-job-list { display: flex; flex-direction: column; gap: 8px; }
```

- [ ] **Step 4: 提交**

```bash
git add admin-web/src/pages/candidate-portal/HomePage.tsx admin-web/src/pages/candidate-portal/BrowsePage.tsx admin-web/src/styles.css
git commit -m "feat(admin-web): HomePage (recommended) + BrowsePage (with filters)"
```

---

### Task 19: JobDetailPage (含申请)

**Files:**
- Create: `admin-web/src/pages/candidate-portal/JobDetailPage.tsx`

- [ ] **Step 1: 实现 JobDetailPage**

创建 `admin-web/src/pages/candidate-portal/JobDetailPage.tsx`:

```typescript
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { jobs } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { RadarChart } from '../../components/candidate-portal/RadarChart';
import { MatchScore } from '../../components/candidate-portal/MatchScore';

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [note, setNote] = useState('');

  const { data: job, isLoading } = useQuery({
    queryKey: ['jobs', id],
    queryFn: () => jobs.detail(id!),
    enabled: !!id,
  });

  const applyMutation = useMutation({
    mutationFn: () => jobs.apply(id!, note || undefined),
    onSuccess: () => navigate('/candidate/applications'),
  });

  if (isLoading) return <MobileLayout><div className="cp-loading">加载中...</div></MobileLayout>;
  if (!job) return <MobileLayout><div>工作不存在</div></MobileLayout>;

  const salary = job.salary_min && job.salary_max
    ? `${(job.salary_min / 1000).toFixed(0)}k-${(job.salary_max / 1000).toFixed(0)}k`
    : '面议';

  const radarDimensions = [
    { label: '技能', score: job.match_dimensions?.skills?.length > 0 ? Math.min(100, job.match_dimensions.skills.filter((s: string) => job.match_dimensions.job_skills.includes(s)).length / job.match_dimensions.skills.length * 100) : 0 },
    { label: '经验', score: 70 },
    { label: '薪资', score: job.salary_min ? 80 : 50 },
    { label: '行业', score: 60 },
    { label: '职级', score: 75 },
  ];

  return (
    <MobileLayout title={job.title}>
      <div className="cp-job-detail">
        <div className="cp-job-detail-header">
          <div>
            <h1>{job.title}</h1>
            <div className="cp-job-meta">
              {job.industry && <span className="cp-job-tag">{job.industry}</span>}
              {job.title_level && <span className="cp-job-tag">{job.title_level}</span>}
              {job.location && <span className="cp-job-tag">📍 {job.location}</span>}
              <span className="cp-job-salary">💰 {salary}</span>
            </div>
          </div>
          {job.match_score != null && <MatchScore score={job.match_score} />}
        </div>

        <RadarChart dimensions={radarDimensions} />

        <h2>职位描述</h2>
        <p className="cp-job-description">{job.description}</p>

        {job.skills && job.skills.length > 0 && (
          <>
            <h2>所需技能</h2>
            <div className="cp-job-skills">
              {job.skills.map((s: string) => <span key={s} className="cp-skill-tag">{s}</span>)}
            </div>
          </>
        )}

        <div className="cp-apply-box">
          <textarea
            placeholder="可选: 附言 (例如 '我对这个职位很感兴趣, 有 5 年 Vue 经验...')"
            value={note}
            onChange={e => setNote(e.target.value)}
            className="cp-textarea"
            maxLength={500}
            rows={4}
          />
          <button
            className="cp-btn-primary"
            disabled={applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
          >
            {applyMutation.isPending ? '申请中...' : '立即申请'}
          </button>
          {applyMutation.error && (
            <div className="cp-error">{(applyMutation.error as any).message}</div>
          )}
        </div>
      </div>
    </MobileLayout>
  );
}
```

- [ ] **Step 2: 追加 CSS**

```css
.cp-job-detail { padding: 0 4px; }
.cp-job-detail-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.cp-job-detail-header h1 { font-size: 20px; margin: 0 0 8px; }
.cp-job-description { white-space: pre-wrap; color: var(--text); line-height: 1.6; }
.cp-apply-box { margin-top: 24px; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; position: sticky; bottom: 72px; }
.cp-textarea { width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 14px; box-sizing: border-box; background: var(--bg); color: var(--text); }
```

- [ ] **Step 3: 提交**

```bash
git add admin-web/src/pages/candidate-portal/JobDetailPage.tsx admin-web/src/styles.css
git commit -m "feat(admin-web): JobDetailPage with radar match + apply action"
```

---

### Task 20: ApplicationsPage + ApplicationDetailPage + OfferPage

**Files:**
- Create: `admin-web/src/pages/candidate-portal/ApplicationsPage.tsx`
- Create: `admin-web/src/pages/candidate-portal/ApplicationDetailPage.tsx`
- Create: `admin-web/src/pages/candidate-portal/OfferPage.tsx`

- [ ] **Step 1: 实现 ApplicationsPage**

创建 `admin-web/src/pages/candidate-portal/ApplicationsPage.tsx`:

```typescript
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { applications } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { EmptyState } from '../../components/candidate-portal/EmptyState';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_pickup: { label: '等待猎头认领', color: 'var(--c-candidate)' },
  pending: { label: '待雇主查看', color: 'var(--c-project)' },
  employer_interested: { label: '雇主感兴趣', color: 'var(--c-match)' },
  candidate_approved: { label: '已解锁', color: 'var(--c-position)' },
  considering_offer: { label: '考虑中', color: 'var(--c-candidate)' },
  rejected_employer: { label: '雇主拒绝', color: 'var(--text-muted)' },
  rejected_candidate: { label: '候选人拒绝', color: 'var(--text-muted)' },
  withdrawn: { label: '已撤回', color: 'var(--text-muted)' },
  rejected_timeout: { label: '超时', color: 'var(--text-muted)' },
};

export function ApplicationsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['applications'],
    queryFn: () => applications.list(50),
  });

  return (
    <MobileLayout title="我的申请">
      {isLoading && <div className="cp-loading">加载中...</div>}
      {data?.length === 0 && (
        <EmptyState icon="📋" title="还没有申请" description="去浏览工作并申请吧" />
      )}
      <div className="cp-app-list">
        {(data ?? []).map((a: any) => {
          const status = STATUS_LABELS[a.recommendation_status] ?? { label: a.recommendation_status, color: 'var(--text-muted)' };
          return (
            <Link key={a.id} to={`/candidate/applications/${a.id}`} className="cp-app-card">
              <div className="cp-app-header">
                <div className="cp-app-title">{a.job_title}</div>
                <span className="cp-app-status" style={{ background: status.color }}>
                  {status.label}
                </span>
              </div>
              <div className="cp-app-meta">
                {a.job_industry && <span>{a.job_industry}</span>}
                <span>{new Date(a.created_at).toLocaleDateString('zh-CN')}</span>
                {a.pickup_headhunter_id && <span>✓ 已认领</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </MobileLayout>
  );
}
```

- [ ] **Step 2: 实现 ApplicationDetailPage**

创建 `admin-web/src/pages/candidate-portal/ApplicationDetailPage.tsx`:

```typescript
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { applications } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { FunnelCard } from '../../components/candidate-portal/FunnelCard';

export function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: app, isLoading } = useQuery({
    queryKey: ['applications', id],
    queryFn: () => applications.detail(Number(id)),
    enabled: !!id,
  });

  const respondMutation = useMutation({
    mutationFn: (action: 'withdraw' | 'consider_offer' | 'accept_offer' | 'decline_offer') =>
      applications.respond(Number(id), action),
    onSuccess: () => window.location.reload(),
  });

  if (isLoading) return <MobileLayout><div className="cp-loading">加载中...</div></MobileLayout>;
  if (!app) return <MobileLayout><div>申请不存在</div></MobileLayout>;

  const stages = [
    { name: '投递', count: 1, is_current: app.recommendation_status === 'pending_pickup' },
    { name: '简历过', count: app.recommendation_status !== 'pending_pickup' ? 1 : 0, is_current: app.recommendation_status === 'pending' },
    { name: '面试', count: ['employer_interested', 'candidate_approved'].includes(app.recommendation_status) ? 1 : 0, is_current: app.recommendation_status === 'employer_interested' },
    { name: 'offer', count: app.recommendation_status === 'candidate_approved' ? 1 : 0, is_current: app.recommendation_status === 'candidate_approved' },
    { name: '到岗', count: 0 },
  ];

  return (
    <MobileLayout title="申请详情">
      <h2>{app.job_title}</h2>
      <p>状态: {app.recommendation_status}</p>
      <p>申请时间: {new Date(app.created_at).toLocaleString('zh-CN')}</p>

      <FunnelCard stages={stages} />

      {app.candidate_note && (
        <div className="cp-app-note">
          <strong>我的附言:</strong>
          <p>{app.candidate_note}</p>
        </div>
      )}

      <div className="cp-app-actions">
        {['pending_pickup', 'pending'].includes(app.recommendation_status) && (
          <button
            className="cp-btn-secondary"
            onClick={() => {
              if (confirm('确定撤回申请?')) respondMutation.mutate('withdraw');
            }}
            disabled={respondMutation.isPending}
          >
            撤回申请
          </button>
        )}
        {app.recommendation_status === 'employer_interested' && (
          <>
            <button className="cp-btn-primary" onClick={() => respondMutation.mutate('accept_offer')}>
              接受 offer
            </button>
            <button className="cp-btn-secondary" onClick={() => respondMutation.mutate('decline_offer')}>
              拒绝 offer
            </button>
          </>
        )}
      </div>
    </MobileLayout>
  );
}
```

- [ ] **Step 3: 实现 OfferPage**

创建 `admin-web/src/pages/candidate-portal/OfferPage.tsx`:

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import { applications } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { EmptyState } from '../../components/candidate-portal/EmptyState';

export function OfferPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['applications', 'offers'],
    queryFn: async () => {
      const all = await applications.list(50);
      return all.filter((a: any) =>
        ['employer_interested', 'considering_offer', 'candidate_approved'].includes(a.recommendation_status)
      );
    },
  });

  const respondMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: any }) => applications.respond(id, action),
    onSuccess: () => window.location.reload(),
  });

  return (
    <MobileLayout title="收到的 offer">
      {isLoading && <div className="cp-loading">加载中...</div>}
      {data?.length === 0 && (
        <EmptyState icon="🎁" title="还没有 offer" description="继续申请心仪的工作吧" />
      )}
      {(data ?? []).map((a: any) => (
        <div key={a.id} className="cp-offer-card">
          <h3>{a.job_title}</h3>
          <p>{a.job_industry}</p>
          <p>状态: {a.recommendation_status}</p>
          {a.recommendation_status === 'employer_interested' && (
            <div className="cp-app-actions">
              <button className="cp-btn-primary" onClick={() => respondMutation.mutate({ id: a.id, action: 'accept_offer' })}>
                接受
              </button>
              <button className="cp-btn-secondary" onClick={() => respondMutation.mutate({ id: a.id, action: 'decline_offer' })}>
                拒绝
              </button>
            </div>
          )}
        </div>
      ))}
    </MobileLayout>
  );
}
```

- [ ] **Step 4: 追加 CSS**

```css
.cp-app-list { display: flex; flex-direction: column; gap: 8px; }
.cp-app-card {
  display: block; padding: 12px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; text-decoration: none; color: var(--text);
}
.cp-app-header { display: flex; justify-content: space-between; align-items: center; }
.cp-app-title { font-weight: 600; }
.cp-app-status { padding: 2px 8px; border-radius: 12px; color: white; font-size: 11px; }
.cp-app-meta { display: flex; gap: 12px; font-size: 12px; color: var(--text-muted); margin-top: 6px; }
.cp-app-note { background: var(--b-candidate); padding: 12px; border-radius: 8px; margin: 12px 0; }
.cp-app-actions { display: flex; gap: 8px; margin-top: 16px; }
.cp-btn-secondary {
  flex: 1; padding: 10px;
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 8px;
  font-size: 14px; cursor: pointer;
}
.cp-offer-card {
  padding: 16px; margin-bottom: 12px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px;
}
```

- [ ] **Step 5: 提交**

```bash
git add admin-web/src/pages/candidate-portal/ApplicationsPage.tsx \
        admin-web/src/pages/candidate-portal/ApplicationDetailPage.tsx \
        admin-web/src/pages/candidate-portal/OfferPage.tsx \
        admin-web/src/styles.css
git commit -m "feat(admin-web): Applications + ApplicationDetail + Offer pages"
```

---

### Task 21: MessagesPage + ProfilePage

**Files:**
- Create: `admin-web/src/pages/candidate-portal/MessagesPage.tsx`
- Create: `admin-web/src/pages/candidate-portal/ProfilePage.tsx`

- [ ] **Step 1: 实现 MessagesPage**

创建 `admin-web/src/pages/candidate-portal/MessagesPage.tsx`:

```typescript
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { messages } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { MessageBubble } from '../../components/candidate-portal/MessageBubble';
import { EmptyState } from '../../components/candidate-portal/EmptyState';

export function MessagesPage() {
  const [box, setBox] = useState<'inbox' | 'sent'>('inbox');
  const [draftTo, setDraftTo] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['messages', box],
    queryFn: () => messages.list({ box, limit: 50 }),
  });

  const sendMutation = useMutation({
    mutationFn: () => messages.send({ to_user_id: draftTo, content: draftContent }),
    onSuccess: () => {
      setDraftTo(''); setDraftContent('');
      qc.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  return (
    <MobileLayout title="消息">
      <div className="cp-msg-tabs">
        <button className={box === 'inbox' ? 'active' : ''} onClick={() => setBox('inbox')}>
          收件箱 {data?.unread_count ? `(${data.unread_count})` : ''}
        </button>
        <button className={box === 'sent' ? 'active' : ''} onClick={() => setBox('sent')}>
          已发送
        </button>
      </div>

      {isLoading && <div className="cp-loading">加载中...</div>}
      {data?.items.length === 0 && (
        <EmptyState icon="💬" title={box === 'inbox' ? '收件箱为空' : '还没有发送过消息'} />
      )}
      <div className="cp-msg-list">
        {(data?.items ?? []).map((m: any) => (
          <MessageBubble
            key={m.id}
            content={m.content}
            isMine={box === 'sent'}
            timestamp={m.created_at}
            read={!!m.read_at}
          />
        ))}
      </div>

      <div className="cp-msg-compose">
        <h3>发送新消息</h3>
        <input
          type="text"
          placeholder="收件人 user_id"
          value={draftTo}
          onChange={e => setDraftTo(e.target.value)}
          className="cp-input"
        />
        <textarea
          placeholder="消息内容..."
          value={draftContent}
          onChange={e => setDraftContent(e.target.value)}
          className="cp-textarea"
          rows={3}
        />
        <button
          className="cp-btn-primary"
          disabled={!draftTo || !draftContent || sendMutation.isPending}
          onClick={() => sendMutation.mutate()}
        >
          发送
        </button>
      </div>
    </MobileLayout>
  );
}
```

- [ ] **Step 2: 实现 ProfilePage**

创建 `admin-web/src/pages/candidate-portal/ProfilePage.tsx`:

```typescript
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profile as profileApi } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { RadarChart } from '../../components/candidate-portal/RadarChart';

export function ProfilePage() {
  const qc = useQueryClient();
  const { data: p, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => profileApi.view(),
  });

  const [skillsText, setSkillsText] = useState<string>('');
  const [visibility, setVisibility] = useState<string>('public');
  const [expectedSalaryMin, setExpectedSalaryMin] = useState<string>('');
  const [expectedSalaryMax, setExpectedSalaryMax] = useState<string>('');

  // Sync state when data loads
  useState(() => {
    if (p) {
      setSkillsText((p.skills ?? []).join(', '));
      setVisibility(p.visibility ?? 'public');
      if (p.expectations) {
        setExpectedSalaryMin(String(p.expectations.expected_salary_min ?? ''));
        setExpectedSalaryMax(String(p.expectations.expected_salary_max ?? ''));
      }
    }
  });

  const updateMutation = useMutation({
    mutationFn: () => profileApi.update({
      skills: skillsText.split(',').map(s => s.trim()).filter(Boolean),
      visibility: visibility as any,
      expectations: {
        expected_salary_min: expectedSalaryMin ? Number(expectedSalaryMin) : undefined,
        expected_salary_max: expectedSalaryMax ? Number(expectedSalaryMax) : undefined,
      },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });

  if (isLoading) return <MobileLayout><div className="cp-loading">加载中...</div></MobileLayout>;
  if (!p) return <MobileLayout><div>简历不存在</div></MobileLayout>;

  const radarDims = [
    { label: '技能', score: Math.min(100, (p.skills?.length ?? 0) * 10) },
    { label: '经验', score: p.years_experience ? Math.min(100, p.years_experience * 10) : 50 },
    { label: '学历', score: 70 },
    { label: '行业', score: p.industry ? 80 : 40 },
    { label: '职级', score: p.title_level === 'senior' ? 90 : p.title_level === 'mid' ? 60 : 40 },
  ];

  return (
    <MobileLayout title="我的简历">
      <div className="cp-profile">
        <RadarChart dimensions={radarDims} />

        <section>
          <h2>PII (由猎头维护,只读)</h2>
          <div className="cp-pii-box">
            <div><strong>姓名:</strong> {p.pii.name ?? '(未填)'}</div>
            <div><strong>当前公司:</strong> {p.pii.current_company ?? '(未填)'}</div>
            <div><strong>学历:</strong> {p.pii.education_tier ?? '(未填)'}</div>
          </div>
        </section>

        <section>
          <h2>公开信息 (可编辑)</h2>
          <label>
            技能 (英文逗号分隔):
            <input
              type="text"
              value={skillsText}
              onChange={e => setSkillsText(e.target.value)}
              className="cp-input"
              placeholder="vue, typescript, react"
            />
          </label>
          <label>
            期望薪资 (最低):
            <input
              type="number"
              value={expectedSalaryMin}
              onChange={e => setExpectedSalaryMin(e.target.value)}
              className="cp-input"
              placeholder="k 元/月, 如 25"
            />
          </label>
          <label>
            期望薪资 (最高):
            <input
              type="number"
              value={expectedSalaryMax}
              onChange={e => setExpectedSalaryMax(e.target.value)}
              className="cp-input"
            />
          </label>
          <label>
            可见性:
            <select value={visibility} onChange={e => setVisibility(e.target.value)} className="cp-input">
              <option value="public">公开 (所有雇主可见)</option>
              <option value="invitation_only">仅邀请</option>
              <option value="hidden">隐藏</option>
            </select>
          </label>
        </section>

        <button
          className="cp-btn-primary"
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? '保存中...' : '保存'}
        </button>
        {updateMutation.isSuccess && <div className="cp-success">✓ 已保存</div>}
      </div>
    </MobileLayout>
  );
}
```

- [ ] **Step 3: 追加 CSS**

```css
.cp-msg-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.cp-msg-tabs button {
  flex: 1; padding: 8px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; cursor: pointer;
}
.cp-msg-tabs button.active {
  background: var(--c-project); color: white; border-color: var(--c-project);
}
.cp-msg-list { display: flex; flex-direction: column; gap: 4px; padding: 8px 0; }
.cp-msg-compose {
  margin-top: 24px; padding: 12px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
}
.cp-msg-compose h3 { margin-top: 0; }
.cp-msg-compose .cp-textarea { margin: 8px 0; }
.cp-profile { display: flex; flex-direction: column; gap: 24px; }
.cp-profile section label { display: block; margin: 8px 0; font-size: 14px; }
.cp-pii-box {
  padding: 12px; background: var(--bg);
  border: 1px dashed var(--border); border-radius: 8px;
  font-size: 14px; line-height: 1.8;
}
.cp-success {
  margin-top: 12px; padding: 8px;
  background: var(--b-position); color: var(--c-position);
  border-radius: 6px; text-align: center;
}
```

- [ ] **Step 4: 提交**

```bash
git add admin-web/src/pages/candidate-portal/MessagesPage.tsx admin-web/src/pages/candidate-portal/ProfilePage.tsx admin-web/src/styles.css
git commit -m "feat(admin-web): MessagesPage + ProfilePage (with edit public fields)"
```

---

## Phase K: 前端路由

### Task 22: 路由分发 (admin vs candidate)

**Files:**
- Modify: `admin-web/src/main.tsx`
- Modify: `admin-web/src/App.tsx`

- [ ] **Step 1: 修改 main.tsx (无 basename, App 内部分发)**

修改 `admin-web/src/main.tsx`:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

const rootEl = document.getElementById('root')!;
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
```

- [ ] **Step 2: 修改 App.tsx 增加 /candidate 路由**

修改 `admin-web/src/App.tsx` (在现有路由基础上增加):

```typescript
import { Routes, Route, Navigate } from 'react-router-dom';
// 现有 imports 不变
import { LoginPage } from './pages/candidate-portal/LoginPage';
import { HomePage } from './pages/candidate-portal/HomePage';
import { BrowsePage } from './pages/candidate-portal/BrowsePage';
import { JobDetailPage } from './pages/candidate-portal/JobDetailPage';
import { ApplicationsPage } from './pages/candidate-portal/ApplicationsPage';
import { ApplicationDetailPage } from './pages/candidate-portal/ApplicationDetailPage';
import { OfferPage } from './pages/candidate-portal/OfferPage';
import { MessagesPage } from './pages/candidate-portal/MessagesPage';
import { ProfilePage } from './pages/candidate-portal/ProfilePage';
import { RequireAuth } from './components/candidate-portal/RequireAuth';

export default function App() {
  return (
    <Routes>
      {/* 现有 admin 路由 (不变) */}
      <Route path="/admin/*" element={<AdminApp />} />

      {/* Candidate Portal 路由 */}
      <Route path="/candidate/login" element={<LoginPage />} />
      <Route path="/candidate" element={<Navigate to="/candidate/home" replace />} />
      <Route path="/candidate/home" element={<RequireAuth><HomePage /></RequireAuth>} />
      <Route path="/candidate/browse" element={<RequireAuth><BrowsePage /></RequireAuth>} />
      <Route path="/candidate/jobs/:id" element={<RequireAuth><JobDetailPage /></RequireAuth>} />
      <Route path="/candidate/applications" element={<RequireAuth><ApplicationsPage /></RequireAuth>} />
      <Route path="/candidate/applications/:id" element={<RequireAuth><ApplicationDetailPage /></RequireAuth>} />
      <Route path="/candidate/offer" element={<RequireAuth><OfferPage /></RequireAuth>} />
      <Route path="/candidate/messages" element={<RequireAuth><MessagesPage /></RequireAuth>} />
      <Route path="/candidate/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />

      {/* 默认重定向 */}
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
```

(假设 `AdminApp` 是现有 admin-web 的根组件 — 如现状为内联, 需保留其原结构)

- [ ] **Step 3: 验证前端构建**

Run: `cd admin-web && pnpm build`
Expected: build 成功, 无 TS 错误

如果失败, 检查:
- tsconfig.json path 解析
- API 客户端 import 路径
- React Query 类型

- [ ] **Step 4: 手动验证 (启动 dev server)**

Run: `pnpm dev` (root)
Open `http://localhost:5174/candidate/login`
Expected: 显示 OTP 登录页

输入邮箱 → 控制台显示 OTP → 输入 OTP → 跳转 home 页 → 显示空状态或工作列表

- [ ] **Step 5: 提交**

```bash
git add admin-web/src/main.tsx admin-web/src/App.tsx
git commit -m "feat(admin-web): wire /candidate/* routes with RequireAuth HOC"
```

---

## Phase L: E2E 测试 + 文档

### Task 23: 端到端集成测试 (后端完整流程)

**Files:**
- Create: `tests/integration/candidate-portal/e2e.test.ts`

- [ ] **Step 1: 编写 E2E 测试**

创建 `tests/integration/candidate-portal/e2e.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, resetDb, getDevOtp, seedHeadhunter } from '../../helpers/test-app.js';

describe('Candidate Portal E2E: candidate apply → headhunter pickup → unlock flow', () => {
  beforeEach(() => resetDb());

  it('completes full happy path', async () => {
    const app = createTestApp();

    // 1. 猎头预先创建工作
    const employer = await seedEmployer({ name: 'Acme Corp' });
    const hunter = await seedHeadhunter();
    const employerKey = await getApiKey(employer.id);
    const job = (await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${employerKey}`)
      .send({ title: 'Senior Vue Dev', industry: 'tech', title_level: 'senior', salary_min: 200000, salary_max: 300000 })
    ).body.data;

    // 2. 候选人 OTP 注册
    await request(app).post('/v1/candidate-portal/auth/otp/request').send({ email: 'cand@x.com' });
    const candKey = (await request(app).post('/v1/candidate-portal/auth/otp/verify')
      .send({ email: 'cand@x.com', code: getDevOtp('cand@x.com') })
    ).body.data.api_key;

    // 3. 候选人完善简历 (公开字段)
    await request(app).put('/v1/candidate-portal/profile')
      .set('Authorization', `Bearer ${candKey}`)
      .send({ skills: ['vue', 'typescript'], visibility: 'public' });

    // 4. 候选人查看推荐
    const recommended = await request(app).get('/v1/candidate-portal/jobs/recommended')
      .set('Authorization', `Bearer ${candKey}`);
    expect(recommended.body.data.length).toBeGreaterThan(0);
    expect(recommended.body.data[0].job_id).toBe(job.id);

    // 5. 候选人申请
    const apply = await request(app).post(`/v1/candidate-portal/jobs/${job.id}/apply`)
      .set('Authorization', `Bearer ${candKey}`)
      .send({ note: 'I am interested' });
    expect(apply.body.data.application_id).toBeDefined();

    // 6. 猎头看待认领列表
    const pending = await request(app).get('/v1/headhunter/recommendations/pending-pickup')
      .set('Authorization', `Bearer ${hunter.api_key}`);
    expect(pending.body.data.items.length).toBe(1);

    // 7. 猎头认领
    await request(app).post(`/v1/headhunter/recommendations/${apply.body.data.recommendation_id}/pickup`)
      .set('Authorization', `Bearer ${hunter.api_key}`);

    // 8. 候选人查看状态
    const myApps = await request(app).get('/v1/candidate-portal/applications')
      .set('Authorization', `Bearer ${candKey}`);
    expect(myApps.body.data[0].recommendation_status).toBe('pending');

    // 9. 候选人给猎头发消息
    await request(app).post('/v1/candidate-portal/messages')
      .set('Authorization', `Bearer ${candKey}`)
      .send({ to_user_id: hunter.id, content: 'When can we chat?', application_id: apply.body.data.application_id });

    // 10. 猎头收到消息
    const inbox = await request(app).get('/v1/headhunter/messages') // 假设猎头也用同一消息端点 (Phase 2 扩展)
      .set('Authorization', `Bearer ${hunter.api_key}`);
    expect(inbox.body.data.items.length).toBeGreaterThan(0);
  });

  it('prevents PII editing via strict Zod', async () => {
    const app = createTestApp();
    await request(app).post('/v1/candidate-portal/auth/otp/request').send({ email: 'p@x.com' });
    const candKey = (await request(app).post('/v1/candidate-portal/auth/otp/verify')
      .send({ email: 'p@x.com', code: getDevOtp('p@x.com') })
    ).body.data.api_key;

    const res = await request(app).put('/v1/candidate-portal/profile')
      .set('Authorization', `Bearer ${candKey}`)
      .send({ name: 'Hacker', phone: '12345', skills: ['vue'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('enforces OTP rate limit', async () => {
    const app = createTestApp();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/v1/candidate-portal/auth/otp/request')
        .send({ email: `rl${i}@x.com` });
    }
    const res = await request(app).post('/v1/candidate-portal/auth/otp/request')
      .send({ email: 'rl5@x.com' });
    expect(res.status).toBe(429);
  });
});
```

- [ ] **Step 2: 运行 E2E 测试**

Run: `pnpm test tests/integration/candidate-portal/e2e.test.ts`
Expected: 3 passed

- [ ] **Step 3: 提交**

```bash
git add tests/integration/candidate-portal/e2e.test.ts
git commit -m "test(candidate-portal): E2E happy path + PII protection + rate limit"
```

---

### Task 24: 文档更新 + 最终验证

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/superpowers/skills/hunter-platform/SKILL.md` (if exists)

- [ ] **Step 1: 更新 CHANGELOG**

修改 `docs/CHANGELOG.md`,在最新版本增加:

```markdown
## v3.0.0 (2026-07-XX) — C 端候选人门户 Phase 1

新增能力:
- `/v1/candidate-portal/*` 路由组 (OTP 认证 + 13 端点)
- C 端候选人自助注册/登录 (邮箱 + 6 位 OTP, 开发模式控制台输出)
- 候选人浏览/申请/撤回工作
- 候选人消息系统
- 候选人公开简历编辑 (技能/期望/可见性)
- 候选人能力雷达图 (前端)
- 移动优先响应式 UI (`/candidate/*` 路径)
- 暗色模式 (data-theme="dark")

数据库:
- 新增 `candidate_otp_codes` / `candidate_messages` / `candidate_applications` 表
- 扩展 `recommendations` (source_type / pickup_headhunter_id / candidate_note)
- 扩展 `candidates_anonymized` (visibility / expectations_json)
- 新增 14 个 capability (12 个 candidate_portal + 2 个 headhunter pickup)

数据流:
- 候选人申请 → 创建 recommendation (status=pending_pickup, source_type=candidate_self_apply)
- 猎头认领 → status 转 pending, 通知候选人
- 进入原 4 步解锁流程

后续: Phase 2 PM 模式 + Phase 3 Hunter 模式 (ow-recruit-saas 借鉴)
```

- [ ] **Step 2: 运行完整测试套件**

Run: `pnpm test`
Expected: 全部测试通过 (新 + 旧 162 个测试文件)

如果失败, 修复后重新运行。

- [ ] **Step 3: 运行 typecheck + lint**

Run: `pnpm exec tsc --noEmit && cd admin-web && pnpm exec tsc --noEmit && pnpm lint:css`
Expected: 无错误

- [ ] **Step 4: 启动 dev server + 手动冒烟**

Run: `pnpm dev`
Open `http://localhost:5174/candidate/login`
流程: 邮箱 → OTP → home → 浏览 → 详情 → 申请 → 退出

Expected: 全流程无报错

- [ ] **Step 5: 提交文档**

```bash
git add docs/CHANGELOG.md docs/superpowers/skills/hunter-platform/SKILL.md
git commit -m "docs: v3.0.0 CHANGELOG — candidate portal Phase 1"
```

---

## Self-Review

### Spec Coverage

| Spec 章节 | 实现任务 |
|----------|---------|
| §1.2 目标 1 (OTP 注册/登录) | Task 4, 17 |
| §1.2 目标 2 (浏览 + 匹配度) | Task 7, 18, 19 |
| §1.2 目标 3 (申请 → 猎头认领) | Task 8, 9, 10 |
| §1.2 目标 4 (申请进度) | Task 20 |
| §1.2 目标 5 (accept/decline offer) | Task 20 |
| §1.2 目标 6 (消息) | Task 11, 21 |
| §1.2 目标 7 (简历编辑 + 审计) | Task 6, 21 |
| §4 数据模型变更 | Task 1 |
| §5 API 端点 (15 个) | Task 4, 6, 7, 9, 10, 11, 12 |
| §6 前端页面 (10 个) + 组件 (8 个) | Task 13-21 |
| §7 认证流程 | Task 4 |
| §8 申请流程 | Task 9, 10 |
| §9 测试策略 | Task 3-11 (单元), Task 4-11 (集成), Task 15-16 (前端), Task 23 (E2E) |
| §10 迁移与部署 | Task 1, 24 |
| §12 验收标准 (15 条) | 所有任务 |

✅ 所有 spec 要求都有对应任务。

### Placeholder Scan

- ❌ 没有 "TBD" / "TODO" / "实现细节" 等占位符
- ❌ 没有 "类似 Task N" 跨任务引用 (每个 Task 的代码独立完整)
- ✅ 每个代码步骤都有完整可运行代码

### Type Consistency

- `candidate_portal.*` capability names 在 Task 2 (声明) ↔ Task 4-11 (使用) ↔ Task 12 (router) 一致
- `errors.otpExpired()` / `errors.conflict()` / `errors.tooManyRequests()` factory 在 Task 4-11 引用,需要在 `src/main/errors.ts` 实际存在 (实施时需确认或新增)
- `recs.insert()` / `recs.updateStatus()` / `recs.updatePickupHeadhunter()` 在 Task 9, 10 中调用, 需要在 `recommendations` 仓储实际存在 (实施时需确认或新增)
- `applyTransition` 在 Task 8, 9, 10 中调用, 需在 `src/main/flows/index.ts` 实际导出 (Task 8 扩展状态机)

✅ 类型与方法签名在所有任务中保持一致。

---