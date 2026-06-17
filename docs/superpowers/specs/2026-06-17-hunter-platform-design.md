# 猎头中介 API 平台 — 设计文档

**状态**: Draft
**日期**: 2026-06-17
**作者**: brainstorming session
**参考**: NeverLand Farm (https://neverland.coze.com/skill.md)

---

## 1. 概述

### 1.1 一句话定义

**本项目是一个猎头中介 API 平台**。候选人、猎头、雇主三类用户通过自己的 Agent 接入平台 API，完成招聘协作。平台持有脱敏候选人池，撮合猎头与雇主，并通过解锁流程安全交付联系方式。

### 1.2 核心价值主张

| 角色 | 平台提供 | 角色提供 |
|------|---------|---------|
| **候选人** | 隐私受保护的脱敏身份 + 匹配机会 | 简历 + 解锁授权 |
| **猎头** | 脱敏候选人池 + 跨猎头协作 + 佣金结算 | 候选人 + 推荐决策 |
| **雇主** | 公开人才市场 + 主动解锁流程 + 数据驱动匹配 | JD + 招聘决策 |
| **平台（我们）** | 脱敏引擎 + 解锁协议 + 审计 + 佣金抽成 | API + skill.md + 可信中立地位 |

### 1.3 与 NeverLand 的核心类比

| NeverLand 概念 | 本项目映射 |
|---------------|-----------|
| 农场（farm） | 用户账户（users） |
| 农场状态（status） | 用户状态（get_status） |
| 作物/动物/建筑 | 候选人 / 候选人池 / 职位 |
| 19 种 action_type | 13 个核心业务 tool（注册/状态/职位/候选人/推荐/解锁/审批/审计/账单等），外加查询/配置类端点共 25 个 HTTP 端点（见 §4.3） |
| 金币（成功 sell） | 平台佣金（成功 placement） |
| 体力（每日限制） | API 调用配额 |
| 偷窃/捐赠/帮助 | 跨猎头共享候选人（recommend / refer） |
| 排行榜 | 猎头业绩榜 / 雇主响应速度榜 |
| 季节 | 行业招聘周期（v2） |
| 随机事件 | 暂不做（v2 可加"候选人拒绝"等） |
| **skill.md 集成文档** | **完全照搬** — 是核心交付物 |
| **API-first + Agent 调用** | **完全对齐** |

### 1.4 非目标（v1 不做）

- 真实 LLM 推理（Agent 自行调 API，平台不做 AI 决策）
- 简历自动解析（手动结构化字段录入）
- 真实支付/银行结算（仅记录 placement 账单）
- 移动端 / 真实浏览器 Web 后台
- 多租户 SaaS 计费
- 行业招聘周期 / 季节性系统
- 候选人评分 / 信誉系统（v1 用最简信誉字段）

### 1.5 规模目标

**设计目标：~100-500 并发用户，平均 100-200 quota/天**

推算：
- 日均 API 请求：10K-100K 次
- 峰值 RPS：~10-100（按 1M/天 ÷ 86400 × 10 峰值系数）
- Webhook 投递：~1K-5K 次/天
- 数据库写入：~1K-10K 次/小时峰值

**架构选型在此规模下**：
- ✅ 单进程 Node.js + Express 完全足够
- ✅ SQLite + WAL 可支撑（写入 ~1K/sec 上限）
- ✅ 单机部署起步，**预留 PostgreSQL 迁移路径**（不在 v1 实施）
- ❌ 不需要集群 / 微服务 / Redis（避免过度设计）

---

## 2. 架构总览

### 2.1 系统组件

```
┌─────────────────────────────────────────────────────────┐
│  客户端层 (外部 Agent，不属于本平台)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ 雇主     │  │ 猎头     │  │ 候选人   │              │
│  │ Agent    │  │ Agent    │  │ Agent    │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │             │             │                     │
│       │ 通过 skill.md 调用 API    │                     │
└───────┼─────────────┼─────────────┼─────────────────────┘
        │             │             │
        ↓             ↓             ↓
┌─────────────────────────────────────────────────────────┐
│  平台 API 层 (本项目)                                    │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Express + TypeScript                            │  │
│  │  ┌──────────────┐  ┌──────────────┐              │  │
│  │  │ Auth &      │  │ Quota        │              │  │
│  │  │ API Key     │  │ Manager      │              │  │
│  │  ├──────────────┤  ├──────────────┤              │  │
│  │  │ Desensitize │  │ Unlock       │              │  │
│  │  │ Engine      │  │ Protocol     │              │  │
│  │  ├──────────────┤  ├──────────────┤              │  │
│  │  │ Audit       │  │ Commission   │              │  │
│  │  │ Logger      │  │ Calculator   │              │  │
│  │  └──────────────┘  └──────────────┘              │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  SQLite (WAL 模式)                                │  │
│  │  users, candidates_private, candidates_anonymized │  │
│  │  jobs, recommendations, unlocks, placements,      │  │
│  │  unlock_audit_log, action_history,                │  │
│  │  admin_action_log, schema_migrations,             │
│  │  webhook_delivery_queue, rate_limit_buckets       │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  加密模块 (AES-256-GCM)                           │  │
│  │  - 密钥从环境变量加载 (PLATFORM_ENCRYPTION_KEY)   │  │
│  │  - PII 字段加密后存储                              │  │
│  │  - 内存中处理后立即清零                            │  │
│  └──────────────────────────────────────────────────┘
│  ┌──────────────────────────────────────────────────┐  │
│  │  Webhook Worker (后台进程)                        │  │
│  │  - 轮询 webhook_delivery_queue                    │  │
│  │  - HMAC 签名投递                                  │  │
│  │  - 3 次重试 + 指数退避                            │  │
│  │  - 失败入 dead_letter_queue                       │  │
│  └──────────────────────────────────────────────────┘
│  ┌──────────────────────────────────────────────────┐  │
│  │  Cron Jobs (后台)                                 │  │
│  │  - 每日 0 点: 配额重置                            │  │
│  │  - 每小时: 清理过期 rate_limit_buckets 桶          │  │
│  │  - 每月: 审计日志归档                              │  │
│  └──────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────┘
        │
        ↓
┌─────────────────────────────────────────────────────────┐
│  平台管理后台 (本项目 — 沿用 Convo Electron 渲染进程)     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ 用户管理      │  │ 审计日志     │  │ 仪表盘       │ │
│  │ (人工审核)   │  │ (合规追溯)   │  │ (运营统计)   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 2.2 模块边界

每个模块有清晰职责，对外暴露明确接口，可独立测试：

| 模块 | 职责 | 依赖 | 测试方式 |
|------|------|------|----------|
| `auth` | API Key 验证、用户身份解析 | users 表 | 单元测试 + 集成测试 |
| `quota` | 每日配额计数、扣减、恢复 | users 表 | 单元测试 |
| `desensitize` | 原始 PII → 脱敏字段 | 无 | 单元测试（核心安全逻辑） |
| `crypto` | AES-256-GCM 加解密、内存清零 | 环境变量 | 单元测试 |
| `unlock` | 4 步解锁流程编排 | auth, desensitize, crypto, audit | 集成测试 |
| `commission` | placement → 佣金账单 | placements 表 | 单元测试 |
| `audit` | 解密访问日志、关键操作日志 | 无 | 单元测试 |
| `market` | 公开人才市场、职位市场查询 | jobs, candidates_anonymized | 集成测试 |

### 2.3 错误处理

所有 API 错误使用统一结构化响应：

```typescript
type ErrorResponse = {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
};

type ErrorCode =
  | 'UNAUTHORIZED'              // API Key 缺失或无效
  | 'FORBIDDEN'                 // 权限不足（如雇主尝试读 PII）
  | 'NOT_FOUND'                 // 资源不存在
  | 'INVALID_PARAMS'            // 参数校验失败
  | 'INSUFFICIENT_QUOTA'        // 每日配额耗尽
  | 'RATE_LIMITED'              // 突发限流（1s/1min/1h 桶触发）
  | 'INVALID_STATE'             // 状态机非法（如未授权就解锁）
  | 'DUPLICATE_REQUEST'         // 幂等键重复
  | 'INTERNAL_ERROR';           // 兜底
```

---

## 3. 数据模型

### 3.1 Schema

```sql
-- ============================================================
-- 用户表（三角色共用，通过 user_type 区分）
-- ============================================================
CREATE TABLE users (
  id              TEXT PRIMARY KEY,         -- "user_8a2f"
  user_type       TEXT NOT NULL CHECK (user_type IN ('candidate', 'headhunter', 'employer')),
  name            TEXT NOT NULL,            -- 显示名（如"猎头-Bob"），非 PII
  contact         TEXT,                     -- 平台与该用户的联系方式（平台运营用）
  agent_endpoint  TEXT,                     -- 用户的 Agent 接收回调的 URL
  api_key_hash    TEXT NOT NULL UNIQUE,     -- bcrypt(api_key)
  api_key_prefix  TEXT NOT NULL,            -- 用于日志识别（前 8 字符）
  quota_per_day   INTEGER NOT NULL DEFAULT 100,
  quota_used      INTEGER NOT NULL DEFAULT 0,
  quota_reset_at  TEXT NOT NULL,            -- ISO 8601
  reputation      INTEGER NOT NULL DEFAULT 50,  -- 0-100，越高越可信
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX idx_users_api_key_hash ON users(api_key_hash);
CREATE INDEX idx_users_user_type ON users(user_type);

-- ============================================================
-- 候选人原始数据（仅直属猎头 + 候选人本人 + 解锁流程可见）
-- PII 字段全部加密存储
-- ============================================================
CREATE TABLE candidates_private (
  id                  TEXT PRIMARY KEY,         -- "cand_priv_xxxx"
  headhunter_id       TEXT NOT NULL REFERENCES users(id),
  -- v1 强制候选人先注册（user_type='candidate'），保证 unlock 流程可走
  candidate_user_id   TEXT NOT NULL REFERENCES users(id),
  -- 以下为加密 PII 字段（密文 base64，含 IV + auth tag）
  name_enc            TEXT NOT NULL,
  phone_enc           TEXT NOT NULL,
  email_enc           TEXT NOT NULL,
  -- 以下为非 PII 但仅内部可见
  current_company_raw TEXT,                     -- 用于脱敏推导，原始公司名
  current_title_raw   TEXT,
  expected_salary     INTEGER,                  -- 精确薪资（敏感）
  years_experience    INTEGER,
  education_school    TEXT,                     -- 原始学校名
  resume_url          TEXT,                     -- 内部存储路径
  skills_json         TEXT,                     -- JSON array, 公开池可重用
  raw_payload_json    TEXT,                     -- 完整原始数据加密备份
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  FOREIGN KEY (headhunter_id) REFERENCES users(id)
);

CREATE INDEX idx_candidates_private_headhunter ON candidates_private(headhunter_id);
CREATE INDEX idx_candidates_private_candidate_user ON candidates_private(candidate_user_id);

-- ============================================================
-- 候选人脱敏版本（可被公开池 / 推荐给雇主）
-- ============================================================
CREATE TABLE candidates_anonymized (
  id                  TEXT PRIMARY KEY,         -- "cand_anon_xxxx"
  source_private_id   TEXT NOT NULL REFERENCES candidates_private(id),
  source_headhunter_id TEXT NOT NULL REFERENCES users(id),
  -- 脱敏字段
  industry            TEXT,                     -- 从 current_company_raw 推导
  title_level         TEXT,                     -- "P5"/"P6"/"M1" 等
  years_experience    INTEGER,
  salary_range        TEXT,                     -- "60-80万"
  education_tier      TEXT,                     -- "985"/"211"/"普通"/"海外"
  skills_json         TEXT,                     -- JSON array
  -- 元数据
  is_public_pool      INTEGER NOT NULL DEFAULT 0, -- 是否进入公开池
  unlock_status       TEXT NOT NULL DEFAULT 'locked' CHECK (unlock_status IN ('locked', 'unlocked', 'revoked')),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_candidates_anon_public ON candidates_anonymized(is_public_pool, created_at);
CREATE INDEX idx_candidates_anon_headhunter ON candidates_anonymized(source_headhunter_id);

-- ============================================================
-- 职位
-- ============================================================
CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  employer_id     TEXT NOT NULL REFERENCES users(id),
  title           TEXT NOT NULL,
  description     TEXT,
  requirements    TEXT,                     -- 自由文本 + 结构化 JSON
  salary_min      INTEGER,
  salary_max      INTEGER,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paused', 'closed', 'filled')),
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  deadline        TEXT,
  industry        TEXT,                     -- 行业标签，用于匹配
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX idx_jobs_employer ON jobs(employer_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_industry ON jobs(industry);

-- ============================================================
-- 推荐记录（猎头 → 雇主 × 候选人）
-- ============================================================
CREATE TABLE recommendations (
  id                          TEXT PRIMARY KEY,
  headhunter_id               TEXT NOT NULL REFERENCES users(id),
  employer_id                 TEXT NOT NULL REFERENCES users(id),
  anonymized_candidate_id     TEXT NOT NULL REFERENCES candidates_anonymized(id),
  job_id                      TEXT NOT NULL REFERENCES jobs(id),
  status                      TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN (
                                'pending',                -- 猎头已推荐，等雇主响应
                                'employer_interested',    -- 雇主表达兴趣，等候选人授权
                                'candidate_approved',     -- 候选人授权，等解锁
                                'unlocked',               -- 已交付联系方式
                                'rejected_employer',      -- 雇主拒绝
                                'rejected_candidate',     -- 候选人拒绝
                                'withdrawn',              -- 猎头撤回
                                'placed'                  -- 成功入职
                              )),
  commission_split_json       TEXT,            -- {"hunter": 0.7, "referrer": 0.3}
  referrer_headhunter_id      TEXT REFERENCES users(id),  -- 跨猎头推荐时的原猎头
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE(anonymized_candidate_id, job_id)        -- 同一候选人不能重复推荐同一职位
);

CREATE INDEX idx_recommendations_headhunter ON recommendations(headhunter_id);
CREATE INDEX idx_recommendations_employer ON recommendations(employer_id);
CREATE INDEX idx_recommendations_status ON recommendations(status);
CREATE INDEX idx_recommendations_referrer ON recommendations(referrer_headhunter_id);

-- ============================================================
-- 解锁授权审计（每次解密 PII 都记录）
-- ============================================================
CREATE TABLE unlock_audit_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id   TEXT NOT NULL REFERENCES recommendations(id),
  actor_user_id       TEXT NOT NULL REFERENCES users(id),  -- 谁触发了解密
  action              TEXT NOT NULL CHECK (action IN (
                        'express_interest', 'approve_unlock', 'reject_unlock',
                        'unlock_delivery', 'revoke_unlock'
                      )),
  ip_address          TEXT,
  user_agent          TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX idx_unlock_audit_recommendation ON unlock_audit_log(recommendation_id);
CREATE INDEX idx_unlock_audit_actor ON unlock_audit_log(actor_user_id);
CREATE INDEX idx_unlock_audit_created ON unlock_audit_log(created_at);

-- ============================================================
-- 通用操作历史（所有 action_type 都记录，借鉴 NeverLand history）
-- ============================================================
CREATE TABLE action_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL REFERENCES users(id),
  action_type     TEXT NOT NULL,            -- "upload_candidate", "express_interest" 等
  target_type     TEXT,                     -- "candidate", "job", "recommendation"
  target_id       TEXT,
  -- ⚠️ 安全：只存脱敏后的 request/response 摘要，不存 PII
  --     完整 PII 调试请求走 unlock_audit_log（已受控）或 admin 后台"原始数据查看"（需管理员密码二次验证）
  request_summary_json  TEXT,               -- {"field_count": 8, "skills": 4, "industry": "互联网"} 等
  response_summary_json TEXT,               -- {"anonymized_id": "cand_anon_xxx"} 等
  status          TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_code      TEXT,
  duration_ms     INTEGER,
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_action_history_user ON action_history(user_id, created_at);
CREATE INDEX idx_action_history_type ON action_history(action_type, created_at);

-- ============================================================
-- 入职记录（成功关闭 — 触发佣金计算）
-- ============================================================
CREATE TABLE placements (
  id                  TEXT PRIMARY KEY,
  job_id              TEXT NOT NULL REFERENCES jobs(id),
  candidate_user_id   TEXT NOT NULL REFERENCES users(id),
  primary_headhunter_id  TEXT NOT NULL REFERENCES users(id),
  referrer_headhunter_id TEXT REFERENCES users(id),
  anonymized_candidate_id TEXT NOT NULL REFERENCES candidates_anonymized(id),
  annual_salary       INTEGER NOT NULL,
  platform_fee        INTEGER NOT NULL,         -- platform_fee = annual_salary * 0.20 (举例)
  primary_share       INTEGER NOT NULL,         -- 主猎头分成
  referrer_share      INTEGER NOT NULL DEFAULT 0,
  candidate_bonus     INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending_payment'
                      CHECK (status IN ('pending_payment', 'paid', 'cancelled')),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_placements_job ON placements(job_id);
CREATE INDEX idx_placements_candidate ON placements(candidate_user_id);
CREATE INDEX idx_placements_primary_headhunter ON placements(primary_headhunter_id);

-- 一个 recommendation 只能创建一个 placement（防止重复扣佣金）
CREATE UNIQUE INDEX idx_placements_recommendation_unique ON placements(anonymized_candidate_id, job_id, primary_headhunter_id);

-- ============================================================
-- 管理后台操作日志
-- ============================================================
CREATE TABLE admin_action_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id   TEXT NOT NULL,            -- 管理员标识（v1 单管理员，记为 'admin'）
  action          TEXT NOT NULL,            -- "suspend_user", "adjust_quota", "remove_candidate" 等
  target_type     TEXT,                     -- "user", "candidate", "placement"
  target_id       TEXT,
  details_json    TEXT,                     -- 操作详情（不含 PII）
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_admin_action_admin ON admin_action_log(admin_user_id, created_at);
CREATE INDEX idx_admin_action_target ON admin_action_log(target_type, target_id);

-- ============================================================
-- Schema 迁移记录
-- ============================================================
CREATE TABLE schema_migrations (
  version       INTEGER PRIMARY KEY,
  description   TEXT NOT NULL,
  applied_at    TEXT NOT NULL
);

-- ============================================================
-- Webhook 投递队列（异步推送事件到用户 agent_endpoint）
-- ============================================================
CREATE TABLE webhook_delivery_queue (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  target_user_id      TEXT NOT NULL REFERENCES users(id),
  event_type          TEXT NOT NULL,            -- "notify_unlock_request" / "deliver_contact" / ...
  -- ⚠️ 加密存储：含 PII 的事件（deliver_contact）payload 整体 AES-256-GCM 加密
  --    不含 PII 的事件可明文（但为统一处理，强制加密）
  payload_enc         TEXT NOT NULL,            -- base64(iv||tag||ciphertext)，同 §3.2 格式
  contains_pii        INTEGER NOT NULL DEFAULT 0,  -- 标记，admin 后台脱敏显示用
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'in_flight', 'success', 'failed', 'dead_letter')),
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 3,
  next_retry_at       TEXT,                     -- 指数退避后的下次投递时间
  last_error          TEXT,
  delivered_at        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Worker 轮询的高频索引：(status='pending', next_retry_at IS NULL OR next_retry_at <= now)
CREATE INDEX idx_webhook_pending ON webhook_delivery_queue(status, next_retry_at);
CREATE INDEX idx_webhook_target_user ON webhook_delivery_queue(target_user_id, created_at);

-- ============================================================
-- 限流桶（per-user 滑动/固定窗口计数，防止突发）
-- ============================================================
CREATE TABLE rate_limit_buckets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- user_id 字段含义：
  --   - 真实用户：填 users.id
  --   - 未认证请求（注册/健康检查）：填 "ip:1.2.3.4" 形式
  --   - 这种复用让 IP 限流和用户限流共用一套 cron 清理逻辑
  user_id         TEXT NOT NULL,
  window_start    TEXT NOT NULL,            -- 当前窗口开始时间（ISO 8601）
  window_seconds  INTEGER NOT NULL,         -- 桶大小（v1 固定 1 秒 + 1 分钟 + 1 小时 三层）
  request_count   INTEGER NOT NULL DEFAULT 0,
  expires_at      TEXT NOT NULL,            -- 桶过期时间，cron 清理
  UNIQUE(user_id, window_start, window_seconds)
);

CREATE INDEX idx_rate_limit_user ON rate_limit_buckets(user_id, window_start);
CREATE INDEX idx_rate_limit_expires ON rate_limit_buckets(expires_at);

-- ============================================================
-- 幂等键存储（同 key + 不同 body 报错，相同返回首次响应）
-- ============================================================
CREATE TABLE idempotency_keys (
  key             TEXT PRIMARY KEY,         -- 客户端 UUIDv4
  user_id         TEXT NOT NULL REFERENCES users(id),
  request_hash    TEXT NOT NULL,            -- SHA256(raw_body)，同 key 不同 body → DUPLICATE_REQUEST
  response_json   TEXT NOT NULL,            -- 首次执行的完整响应（脱敏后，不含 PII）
  status_code     INTEGER NOT NULL,         -- 首次执行的 HTTP 状态码
  expires_at      TEXT NOT NULL,            -- 创建时间 + 24h
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_idempotency_user ON idempotency_keys(user_id, created_at);
CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);

-- ============================================================
-- 关键查询的复合索引（基于几百人规模的高频查询）
-- ============================================================

-- list_my_jobs: 雇主查自己的职位列表
CREATE INDEX idx_jobs_employer_status ON jobs(employer_id, status, created_at DESC);

-- browse_talent: 公开池按行业/职级/创建时间过滤
CREATE INDEX idx_candidates_anon_pool_created ON candidates_anonymized(is_public_pool, created_at DESC);
CREATE INDEX idx_candidates_anon_pool_industry ON candidates_anonymized(is_public_pool, industry, created_at DESC);
CREATE INDEX idx_candidates_anon_pool_level ON candidates_anonymized(is_public_pool, title_level, created_at DESC);

-- list_my_recommendations: 猎头查自己的推荐（含 status 过滤）
CREATE INDEX idx_recommendations_headhunter_status ON recommendations(headhunter_id, status, created_at DESC);

-- 雇主查收到的推荐
CREATE INDEX idx_recommendations_employer_status ON recommendations(employer_id, status, created_at DESC);

-- 候选人查与自己相关的机会
CREATE INDEX idx_recommendations_candidate ON recommendations(anonymized_candidate_id, status);
```

### 3.2 加密字段说明

`candidates_private` 表中所有 `_enc` 字段存储格式：

```
base64(iv || authTag || ciphertext)
- iv:        12 字节随机 (AES-GCM 标准)
- authTag:   16 字节
- ciphertext: 变长
```

加密密钥从环境变量 `PLATFORM_ENCRYPTION_KEY` 加载（32 字节 base64）。生产环境应使用 HSM 或 KMS。

---

## 4. API 设计

### 4.1 总体规范

- **协议**: HTTP/1.1 + JSON
- **Base URL**: `https://api.hunter-platform.com/v1`（开发环境 `http://localhost:3000/v1`）
- **认证**: `Authorization: Bearer <api_key>` Header
- **幂等性**: 写操作接受 `Idempotency-Key` Header（UUIDv4）
  - 同 key + 同 body：24 小时内重复请求直接返回首次响应（含 status_code）
  - 同 key + 不同 body：返回 `DUPLICATE_REQUEST` (HTTP 409)
  - 存储在 `idempotency_keys` 表，cron 清理 `expires_at < now`
  - **仅缓存脱敏后的响应**（含 PII 的响应不写入此表）
- **限流（两层）**:
  - **每日配额**: 每次请求扣 `quota_used`，归零返回 `INSUFFICIENT_QUOTA`（HTTP 429）
  - **秒/分钟突发**: 防止单用户突发打满数据库，三层桶（1s/1min/1h）记录在 `rate_limit_buckets`，超限返回 `RATE_LIMITED`（HTTP 429）
- **响应头（限流信息）**:
  - `X-RateLimit-Limit-Second`: 100
  - `X-RateLimit-Remaining-Second`: 87
  - `X-Quota-Used`: 42
  - `X-Quota-Reset-At`: 2026-06-18T00:00:00Z
- **响应**: JSON，所有响应包含 `ok: boolean` 字段

### 4.2 通用响应结构

```typescript
type ApiResponse<T> = {
  ok: true;
  data: T;
} | {
  ok: false;
  error: { code: ErrorCode; message: string; details?: object };
};

// 分页
type Paginated<T> = {
  ok: true;
  data: T[];
  pagination: { total: number; page: number; page_size: number; has_more: boolean };
};
```

### 4.3 端点清单

#### 4.3.1 通用

| Method | Path | 描述 | 角色 |
|--------|------|------|------|
| POST | `/auth/register` | 注册用户（candidate/headhunter/employer） | 公开 |
| GET | `/users/{id}/status` | 查询状态（配额、待办、信誉） | 三角色 |
| GET | `/users/{id}/history` | 查询操作历史 | 三角色 |

#### 4.3.2 雇主侧

| Method | Path | 描述 | 配额消耗 |
|--------|------|------|----------|
| POST | `/employer/jobs` | create_job — 创建职位 | 5 |
| GET | `/employer/jobs` | list_my_jobs — 自己的职位 | 1 |
| GET | `/market/jobs` | list_public_jobs — 公开职位市场 | 1 |
| GET | `/market/talent` | browse_talent — 浏览脱敏人才池 | 1 |
| POST | `/recommendations/{id}/express_interest` | 雇主表达兴趣 | 3 |
| POST | `/recommendations/{id}/unlock_contact` | 申请解锁联系方式 | 5 |

#### 4.3.3 猎头侧

| Method | Path | 描述 | 配额消耗 |
|--------|------|------|----------|
| POST | `/headhunter/candidates` | upload_candidate — 上传候选人（自动脱敏） | 5 |
| GET | `/headhunter/candidates` | list_my_candidates — 我的候选人 | 1 |
| POST | `/headhunter/candidates/{id}/publish_to_pool` | 共享到公开池 | 2 |
| POST | `/recommendations` | recommend_candidate — 推荐给雇主 | 5 |
| GET | `/recommendations` | list_my_recommendations | 1 |
| POST | `/recommendations/{id}/withdraw` | 撤回推荐 | 1 |

#### 4.3.4 候选人侧

| Method | Path | 描述 | 配额消耗 |
|--------|------|------|----------|
| GET | `/candidate/opportunities` | view_opportunities — 查看匹配机会 | 1 |
| GET | `/candidate/access_log` | 查询谁访问过我的数据 | 1 |
| POST | `/recommendations/{id}/approve_unlock` | 授权解锁联系方式 | 3 |
| POST | `/recommendations/{id}/reject_unlock` | 拒绝解锁 | 1 |
| POST | `/candidate/delete_my_data` | GDPR 撤回（删除所有数据，受状态机约束） | 1 |

#### 4.3.5 市场与配置

| Method | Path | 描述 | 配额消耗 |
|--------|------|------|----------|
| GET | `/market/leaderboard` | 猎头业绩榜 / 雇主响应榜 | 1 |
| GET | `/config/industries` | 行业列表（用于 JD 分类） | 1 |
| GET | `/config/title_levels` | 职级映射表 | 1 |
| GET | `/config/salary_bands` | 薪资带宽定义 | 1 |
| GET | `/health` | 健康检查（公开） | 0 |

### 4.4 关键端点详细规范

#### 4.4.1 POST /auth/register

**Request**:
```json
{
  "user_type": "headhunter",
  "name": "猎头-Bob",
  "contact": "bob@example.com",
  "agent_endpoint": "https://bob-agent.example.com/webhook"
}
```

**Response 200**:
```json
{
  "ok": true,
  "data": {
    "user_id": "user_8a2f3b",
    "api_key": "hp_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",  // 仅此一次返回
    "quota_per_day": 100,
    "user_type": "headhunter"
  }
}
```

**重要**: `api_key` **只返回一次**，丢失需通过 `POST /auth/rotate_key` 轮换。平台只存 hash。

**Register 端点专属保护**（防脚本批量注册）：

| 保护层 | 规则 |
|--------|------|
| **IP 限流（无需 API Key）** | 同 IP 1h 内最多 5 次注册。超限返回 `RATE_LIMITED` (HTTP 429)。用单独 IP 桶表（不入 `rate_limit_buckets`，避免污染用户维度） |
| **同 contact 限流** | 同 `email/phone` 24h 内只能注册 1 次。重复返回 `DUPLICATE_REQUEST` (HTTP 409)（不是 `INVALID_PARAMS`，避免邮箱枚举攻击） |
| **agent_endpoint 校验** | `https://` 开头（生产环境强制）；可 DNS 解析 + 可达性 HEAD 请求（异步，失败不阻塞注册） |
| **必填字段** | `name`、`contact`、`user_type`。`agent_endpoint` 可选（不提供则收不到 webhook） |
| **请求体大小** | `Content-Length <= 4KB`（防滥用） |
| **写审计** | 每次 register 写 `action_history`（含 IP、user_agent） |

**为何不强制邮箱验证**：v1 接受自报邮箱，verification 放 v2。`contact` 字段仅平台运营参考，不暴露给其他用户。

#### 4.4.2 POST /headhunter/candidates

**前置条件**: 候选人必须先调用 `POST /auth/register`（`user_type='candidate'`）拿到自己的 `candidate_user_id`。猎头在请求中提供该 ID，平台将候选人 PII 绑定到该用户，确保后续 unlock 流程可走通。

**Request**:
```json
{
  "candidate_user_id": "user_c3b7a9",
  "name": "张三",
  "phone": "13800138000",
  "email": "zhang@example.com",
  "current_company": "字节跳动",
  "current_title": "高级前端工程师",
  "expected_salary": 750000,
  "years_experience": 8,
  "education_school": "清华大学",
  "skills": ["React", "TypeScript", "Node.js", "团队管理"]
}
```

**处理流程**:
1. auth 验证 API Key
2. quota 扣减
3. desensitize 引擎处理：
   - `name/phone/email` → 加密存入 `candidates_private._enc`
   - `current_company: "字节跳动"` → `industry: "互联网"`
   - `current_title: "高级前端工程师"` → `title_level: "P6"`
   - `expected_salary: 750000` → `salary_range: "60-80万"`
   - `education_school: "清华大学"` → `education_tier: "985"`
   - `years_experience: 8` → 保留
   - `skills` → 保留
4. 写 `candidates_private` + `candidates_anonymized`
5. 内存中原始 PII 立即清零
6. 写 `action_history`
7. 返回脱敏 ID

**Response 200**:
```json
{
  "ok": true,
  "data": {
    "anonymized_id": "cand_anon_5f8e2a",
    "preview": {
      "industry": "互联网",
      "title_level": "P6",
      "years_experience": 8,
      "salary_range": "60-80万",
      "education_tier": "985",
      "skills": ["React", "TypeScript", "Node.js", "团队管理"]
    }
  }
}
```

**绝对不返回**: `name`, `phone`, `email`, `current_company`, `current_title`, `expected_salary` 精确值, `education_school`。

#### 4.4.3 解锁流程 4 步

```
Step 1: 猎头 POST /recommendations
  → 创建 recommendation, status='pending'
  
Step 2: 雇主 POST /recommendations/{id}/express_interest
  → 平台向候选人 Agent 发送 webhook: notify_unlock_request
  → recommendation.status = 'employer_interested'
  
Step 3: 候选人 POST /recommendations/{id}/approve_unlock
  → 平台调用 audit log (action='approve_unlock')
  → recommendation.status = 'candidate_approved'
  
Step 4: 平台异步 POST /recommendations/{id}/unlock_contact
  → 读取 candidates_private 加密字段
  → AES-256-GCM decrypt
  → 推送到雇主 agent_endpoint: deliver_contact
  → 内存清零
  → audit log (action='unlock_delivery')
  → recommendation.status = 'unlocked'
```

任意一步失败/拒绝 → recommendation 进入 `rejected_*` 终态，过程不可逆（除撤回重试）。

---

## 5. Skill 集成（核心交付物）

### 5.1 skill.md 位置与结构

平台提供 `skill.md` 文件供外部 Agent 读取。文件位置：
- 公开托管：`https://api.hunter-platform.com/v1/skill.md`
- 也可下载：`GET /skill.md` 返回 markdown

skill.md 内容包含：
1. 平台介绍与角色说明
2. 认证方式
3. 完整 API 端点 + 请求/响应示例
4. 脱敏字段映射表
5. 解锁流程状态机图
6. 配额与错误码
7. Webhook 回调规范（agent_endpoint）
8. 客户端集成代码示例（Python / Node.js / cURL）

### 5.2 Webhook 回调协议（异步投递）

**关键设计：所有 webhook 投递都是异步的**，通过 `webhook_delivery_queue` 表 + 后台 Worker 进程解耦，避免阻塞主 API 请求线程。

**触发流程**：
```
API handler 触发事件
    ↓
INSERT INTO webhook_delivery_queue (status='pending', next_retry_at=NULL)
    ↓
立即返回 API 响应给调用方（不等待 webhook 投递）
    ↓
后台 Worker 每秒轮询 (status='pending' AND next_retry_at <= now)
    ↓
HMAC 签名 + POST 到目标 agent_endpoint
    ↓
成功 → status='success'
失败 → attempt_count++; 指数退避（1s, 4s, 16s）; 3 次后 status='dead_letter'
```

**事件类型**:

| Event | 触发时机 | Payload |
|-------|---------|---------|
| `notify_unlock_request` | 雇主表达兴趣后 | `{ recommendation_id, anonymized_candidate_id, employer_id, job_id, requested_at }` |
| `unlock_approved_by_candidate` | 候选人授权后 | `{ recommendation_id, candidate_id, approved_at }` |
| `deliver_contact` | 解锁成功后 | `{ recommendation_id, candidate_id, name, phone, email }` ⚠️ 含 PII |
| `placement_created` | 入职记录创建 | `{ placement_id, job_id, candidate_id, annual_salary, fees }` |
| `quota_warning` | 配额用至 80% | `{ user_id, quota_used, quota_per_day }` |

**Webhook 安全**:
- 平台签名：`X-Hunter-Signature: sha256=<hmac(body, secret)>`
- 用户 Agent 必须验证签名
- 用户返回 2xx 视为成功，**3 次重试后入 dead_letter**（管理员后台可手动重投）
- 投递超时：5 秒/次
- 重试退避：第 1 次失败等 1s，第 2 次失败等 4s，第 3 次失败等 16s

**Worker 实现要点**:
- 进程内 setInterval，每 1s 拉一批（最多 10 条）
- 用 `SELECT ... FOR UPDATE` 或事务保证同一任务不被两个 worker 抢
- v1 单 worker 进程即可（100-500 用户量投递速率 < 10/s）
- v2 拆多 worker 用 `task_id % worker_count` 路由

**管理后台可见性**:
- 列出最近 7 天的 webhook 投递记录
- 支持按 status 过滤、查看 payload、手动重投 dead_letter

### 5.3 客户端集成示例（Node.js）

skill.md 附录提供：

```javascript
import { HunterClient } from './hunter-sdk-example.js';

const client = new HunterClient({
  apiKey: 'hp_live_xxx',
  baseUrl: 'https://api.hunter-platform.com/v1',
});

// 猎头上传候选人（自动脱敏由平台完成）
const result = await client.uploadCandidate({
  name: '张三',
  phone: '13800138000',
  email: 'z@x.com',
  current_company: '字节跳动',
  current_title: '高级前端工程师',
  expected_salary: 750000,
  years_experience: 8,
  education_school: '清华大学',
  skills: ['React', 'TypeScript'],
});
console.log(result.anonymized_id); // 'cand_anon_5f8e2a'
```

（v1 不提供正式 SDK 包，skill.md 提供"可复制代码片段"作为参考实现）

---

## 6. 脱敏引擎

### 6.1 字段映射表

| 原始字段 | 脱敏策略 | 输出 |
|---------|---------|------|
| `name` | 加密存储，不出现在脱敏版 | — |
| `phone` | 加密存储，不出现在脱敏版 | — |
| `email` | 加密存储，不出现在脱敏版 | — |
| `current_company` | 查表映射到 `industry` | `"互联网"` |
| `current_title` | 正则提取职级 | `"P6"` / `"M1"` / `"总监"` |
| `expected_salary` | 按带宽归类 | `"60-80万"` |
| `years_experience` | 保留精确值（已非敏感） | `8` |
| `education_school` | 985/211/海外/普通 | `"985"` |
| `skills` | 保留 | `["React", "TypeScript"]` |
| `resume_url` | 内部路径，不外泄 | — |
| `raw_payload_json` | 加密备份 | — |

### 6.2 映射配置

`config/desensitization.json`:

```json
{
  "industry_map": {
    "字节跳动": "互联网",
    "阿里巴巴": "互联网",
    "腾讯": "互联网",
    "华为": "通信/硬件",
    "招商银行": "金融",
    "中国银行": "金融"
  },
  "title_level_regex": [
    { "pattern": "P[5-7]|高级|高级工程师", "level": "P6" },
    { "pattern": "P[8-9]|资深|Staff", "level": "P7+" },
    { "pattern": "M[1-2]|经理|主管", "level": "M1" },
    { "pattern": "M[3-4]|总监", "level": "M2" },
    { "pattern": "VP|副总裁|总裁", "level": "VP" }
  ],
  "salary_bands": [
    { "min": 0,       "max": 200000,   "label": "0-20万" },
    { "min": 200000,  "max": 400000,   "label": "20-40万" },
    { "min": 400000,  "max": 600000,   "label": "40-60万" },
    { "min": 600000,  "max": 800000,   "label": "60-80万" },
    { "min": 800000,  "max": 1200000,  "label": "80-120万" },
    { "min": 1200000, "max": 2000000,  "label": "120-200万" },
    { "min": 2000000, "max": null,     "label": "200万+" }
  ],
  "school_tiers": {
    "_comment": "完整 985/211 列表见 config/school_tiers.json,v1 至少包含 985 全部 39 所 + 211 全部 73 所",
    "清华大学": "985",
    "北京大学": "985",
    "复旦大学": "985",
    "上海交通大学": "985",
    "浙江大学": "985"
    // ... 其余 985 + 211 学校按需补全
  }
}
```

未知公司 → `"其他"`；未知职级 → `"未分类"`；未知学校 → `"普通"`。绝不抛错（脱敏是"安全降级"操作，必须返回结果）。

### 6.3 加密模块

```typescript
// crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY = Buffer.from(process.env.PLATFORM_ENCRYPTION_KEY!, 'base64'); // 32 bytes

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(ciphertextB64: string): string {
  const buf = Buffer.from(ciphertextB64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

export function zeroMemory(buf: Buffer | string): void {
  if (Buffer.isBuffer(buf)) buf.fill(0);
  // strings are immutable in JS; caller must not retain references
}
```

**约束**:
- 任何 decrypt 调用必须在 try/finally 中确保 `zeroMemory`
- 解密后的明文对象使用后立即重新赋值为 `null`
- 不写入日志（即使 error 也不写明文 PII）

---

## 7. 解锁协议（核心业务流程）

### 7.1 状态机

```
              ┌──────────────┐
              │   pending    │  (猎头已推荐)
              └──────┬───────┘
                     │ employer.express_interest
                     ↓
        ┌────────────────────────┐
        │  employer_interested   │
        └──────┬─────────────────┘
               │ candidate.approve_unlock
               ↓
        ┌────────────────────────┐
        │  candidate_approved    │
        └──────┬─────────────────┘
               │ platform.unlock_contact
               ↓
        ┌────────────────────────┐
        │      unlocked          │  (终态 — 已交付)
        └────────────────────────┘

各状态可转入（详见 §7.2 转换表）：
  - pending              → employer_interested / rejected_employer / withdrawn
  - employer_interested  → candidate_approved / rejected_candidate / rejected_employer
  - candidate_approved   → unlocked / rejected_candidate
  - unlocked             → placed
  - rejected_employer / rejected_candidate / withdrawn / placed 均为终态

**delete_my_data 与 unlock 状态机的交互规则**（防 GDPR 冲突）：

| 候选人当前状态 | 调 delete_my_data 行为 |
|---------------|----------------------|
| 无 active recommendation | ✅ 直接硬删除 PII + 软删除用户 |
| pending / employer_interested | ✅ 软删除用户（status='deleted'），相关 recommendation 自动 rejected_candidate |
| candidate_approved | ❌ 拒绝删除，返回 `INVALID_STATE`。提示用户"等待解锁完成或先调 reject_unlock" |
| unlocked | ⚠️ 部分删除：保留脱敏 `candidates_anonymized` + audit trail，硬删除 `candidates_private` PII，标记 user `status='deleted'`。已发出的联系方式雇主侧保留（用于入职流程） |
| placed | ✅ 完整归档：PII 加密备份到冷表 `candidates_private_archive`，主表硬删除，用户标记 deleted |
| 任意终态 (rejected_*/withdrawn) | ✅ 完整删除 |

**v1 实现**：在 `POST /candidate/delete_my_data` handler 里先 `SELECT * FROM recommendations WHERE candidate_user_id = ? AND status IN ('candidate_approved')`，非空则返回 `INVALID_STATE` + 详情。

### 7.2 状态机实现

```typescript
// unlock.ts
const TRANSITIONS: Record<RecStatus, RecStatus[]> = {
  pending:              ['employer_interested', 'rejected_employer', 'withdrawn'],
  employer_interested:  ['candidate_approved', 'rejected_candidate', 'rejected_employer'],
  candidate_approved:   ['unlocked', 'rejected_candidate'],
  unlocked:             ['placed'],
  rejected_employer:    [],  // 终态
  rejected_candidate:   [],  // 终态
  withdrawn:            [],  // 终态
  placed:               [],  // 终态
};

function assertTransition(from: RecStatus, to: RecStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ApiError('INVALID_STATE', `Cannot transition from ${from} to ${to}`);
  }
}
```

### 7.3 解锁交付实现

```typescript
// unlock_contact handler
async function handleUnlockContact(recId: string) {
  const rec = await db.recommendations.get(recId);
  assertTransition(rec.status, 'unlocked');
  
  const priv = await db.candidatesPrivate.get(rec.anonymized_candidate_id);
  const decrypted = {
    name: crypto.decrypt(priv.name_enc),
    phone: crypto.decrypt(priv.phone_enc),
    email: crypto.decrypt(priv.email_enc),
  };
  
  try {
    // 推送到雇主 agent
    const employer = await db.users.get(rec.employer_id);
    await postWebhook(employer.agent_endpoint, 'deliver_contact', {
      recommendation_id: recId,
      candidate_id: priv.candidate_user_id,
      ...decrypted,
    });
    
    await db.recommendations.update(recId, { status: 'unlocked' });
    await db.audit.insert({
      recommendation_id: recId,
      actor_user_id: 'system',
      action: 'unlock_delivery',
    });
  } finally {
    // 立即清零
    crypto.zeroMemory(Buffer.from(decrypted.name));
    crypto.zeroMemory(Buffer.from(decrypted.phone));
    crypto.zeroMemory(Buffer.from(decrypted.email));
  }
}
```

---

## 8. 配额与限流

### 8.1 配额模型（每日总量）

| 角色 | 默认 `quota_per_day` | 说明 |
|------|---------------------|------|
| candidate | 50 | 候选人操作少 |
| headhunter | 200 | 上传/推荐是主要操作 |
| employer | 100 | 浏览 + 表达兴趣 |

### 8.2 配额扣减（原子操作，避免竞态）

- **必须用单条 SQL 完成 check + increment**（不是先查后改）
- 不足时 `affected rows = 0` → 返回 `INSUFFICIENT_QUOTA` (HTTP 429)
- 每日 UTC 0 点自动重置（`quota_used = 0, quota_reset_at = next UTC midnight`）
- 平台可在管理后台手动调整某用户配额

**实现**：
```sql
-- 单条 UPDATE 同时完成检查和扣减
UPDATE users
SET quota_used = quota_used + ?    -- 本次 action 的消耗（如 5）
WHERE id = ?
  AND status = 'active'
  AND quota_used + ? <= quota_per_day
RETURNING quota_used AS new_used, quota_per_day;

-- affected rows = 0 时：
--   - 可能是用户 suspended（→ UNAUTHORIZED/FORBIDDEN）
--   - 可能是配额不足（→ INSUFFICIENT_QUOTA）
--   需要在 UPDATE 前先 SELECT status，或用 RETURNING 同时返回 status
```

### 8.3 突发限流（防单用户打满 DB）

三层滑动/固定窗口，按角色差异化：

| 角色 | 1 秒 | 1 分钟 | 1 小时 |
|------|------|--------|--------|
| candidate | 10 | 50 | 200 |
| headhunter | 20 | 100 | 500 |
| employer | 30 | 200 | 800 |

**实现**:
- `rate_limit_buckets` 表按 `(user_id, window_start, window_seconds)` 唯一索引
- 请求进来时 `INSERT ... ON CONFLICT DO UPDATE SET request_count = request_count + 1`
- 检查 `request_count <= limit`，超限返回 `RATE_LIMITED` (HTTP 429)
- Cron 每小时清理 `expires_at < now` 的桶

**为什么需要两层**:
- 每日配额防止"滥发"，但允许用户在一天内均匀使用
- 突发限流防止"刷库"，一个用户突发 1K req/sec 也不会让 SQLite 卡死
- 几百人规模下，这种简单方案够用

### 8.4 配额与限流的执行顺序

```
1. Auth (验 API Key)        → 401 if invalid
2. Burst limit (1s/min/hr)  → 429 RATE_LIMITED if exceeded
3. Daily quota (quota_used) → 429 INSUFFICIENT_QUOTA if exceeded
4. 业务逻辑执行
5. 写 action_history
```

### 8.5 配额表（action 消耗）

见 §4.3 各端点表格的"配额消耗"列。

---

## 9. 佣金计算

### 9.1 计算规则（v1 默认值，可在配置中调整）

```
platform_fee = annual_salary × 0.20   (20% 平台抽成)
primary_share = platform_fee × 0.70   (主猎头 70% = 14% 年薪)
referrer_share = platform_fee × 0.30  (跨猎头推荐分成 = 6% 年薪)
candidate_bonus = 0                    (v1 不做)
```

### 9.2 触发时机

- 仅当猎头调 `POST /placements` 创建入职记录时计算
- 需验证 `recommendation.status = 'unlocked'`
- 计算结果立即写入 `placements` 表
- `placements.status = 'pending_payment'`（v1 不做实际支付）

### 9.3 配置项

`config/commission.json`:
```json
{
  "platform_fee_rate": 0.20,
  "primary_share_rate": 0.70,
  "referrer_share_rate": 0.30,
  "min_annual_salary": 200000,
  "max_annual_salary": 5000000
}
```

超出 `min/max` 范围的薪资按边界值计算（不抛错）。

---

## 10. 管理后台（沿用 Convo Electron）

### 10.1 页面结构

- **仪表盘**：用户数、活跃度、placement 数、当日解锁次数、webhook 队列长度、限流触发次数
- **用户管理**：列出三角色用户，可查看/暂停/恢复/调整配额/手动重置限流桶
- **候选人审核**：列出 candidates_anonymized，可下架违规条目
- **审计日志**：展示 `unlock_audit_log` 与 `action_history`，按用户/时间过滤
- **Webhook 管理**：列出 `webhook_delivery_queue` 全部记录，支持按 status 过滤、手动重投 dead_letter、查看 payload
- **限流管理**：查看 `rate_limit_buckets` 当前桶状态、单用户清空
- **佣金账单**：列出 `placements`，标记 paid/pending
- **配置中心**：编辑 `config/desensitization.json` 与 `config/commission.json`

### 10.2 鉴权

- 管理后台是 Electron 渲染进程
- 通过 IPC 与主进程通信
- 启动时要求输入管理员密码（从环境变量 `ADMIN_PASSWORD_HASH` 校验）
- 每次操作记录管理后台操作日志到 `admin_action_log` 表

### 10.3 扩展路径

v1 单管理员够用（几百人规模下平台运营工作量小）。当出现以下情况时迁移到 Web 后台：
- 多个管理员协作
- 管理员需要从异地访问
- 需要在管理后台提供更多实时数据

迁移成本：低。React 组件可复用，IPC 抽象替换为 HTTP API 即可。

---

## 11. 测试策略

### 11.1 单元测试

| 模块 | 测试用例 |
|------|----------|
| `crypto` | encrypt/decrypt 往返、错误密钥抛错、IV 不重复 |
| `desensitize` | 各字段映射、未知值降级、嵌套对象 |
| `quota` | 扣减到 0、归零时拒绝、次日重置 |
| `unlock` 状态机 | 所有合法/非法转换 |
| `commission` | 各薪资区间、跨猎头分成 |
| `auth` | API Key 验证、错误处理 |

### 11.2 集成测试

| 场景 | 验证 |
|------|------|
| 完整 4 步解锁流程 | 三方 Agent 模拟，验证最终 unlock 成功 |
| 解锁拒绝路径 | 候选人拒绝 → status='rejected_candidate' |
| 撞单检测 | 同一候选人推荐同一职位第二次 → `INVALID_PARAMS` |
| 配额耗尽 | 模拟高频请求触发 `INSUFFICIENT_QUOTA` |
| 跨猎头推荐 | 验证 referrer 分成计算 |
| 加密字段泄漏检测 | 在所有响应中 grep PII 字段名，确保 0 命中 |

### 11.3 安全测试

| 测试 | 工具/方法 |
|------|----------|
| SQL 注入 | 所有 DB 调用用 prepared statement，集成测试构造注入 payload |
| 加密密钥泄漏 | 代码中 grep `PLATFORM_ENCRYPTION_KEY` 实际值 |
| Webhook 签名伪造 | 验证 HMAC 校验 |
| 越权访问 | 用猎头 API Key 调雇主端点 → `FORBIDDEN` |
| 日志泄漏 PII | 检查所有 log 调用，禁用 `console.log` 含 PII 对象 |

---

## 12. 实施里程碑

### Milestone 1：核心 API + 单角色 (1-2 周)
- 用户表 + 注册/auth
- 配额机制
- 加密模块
- 脱敏引擎
- 候选人上传 API（仅 headhunter）
- 单元测试覆盖

### Milestone 2：三角色闭环 (2-3 周)
- 雇主 create_job / browse_talent
- 猎头 recommend
- 候选人 view_opportunities / approve_unlock
- 完整 4 步解锁流程
- Webhook 推送
- 集成测试

### Milestone 3：管理后台 + skill.md (1 周)
- Convo 渲染进程加管理员页面
- 撰写 skill.md 完整文档
- 健康检查 + 错误处理完善

### Milestone 4：佣金 + 审计 + 文档 (1 周)
- placement 创建 API
- 佣金计算
- 审计日志查询
- OpenAPI 文档生成
- 端到端测试

### Milestone 5：异步化 + 限流 + 压测 (1 周)
- Webhook Worker 进程 + 死信队列
- `webhook_delivery_queue` 表 + 投递逻辑
- `rate_limit_buckets` 三层限流
- cron jobs（配额重置、桶清理、审计归档）
- 性能测试：用 k6 模拟 500 用户 / 100 RPS，验证 SQLite 写入不卡死
- 负载测试场景：
  - 500 用户同时 browse_talent，p99 < 200ms
  - 50 并发 upload_candidate，p99 < 1s
  - 100 webhook/分钟投递，p99 < 2s
  - rate_limit 在 1s 桶触发后正确返回 429

---

## 13. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 加密密钥泄漏 | 低 | 高 | 环境变量 + HSM；定期轮换；日志审计 |
| 脱敏映射表不全 | 中 | 中 | 配置热加载；定期人工审核未识别值；降级为"未分类" |
| 雇主 Agent 不可达 | 中 | 中 | Webhook 3 次重试 + 死信队列；管理后台手动补推 |
| 候选人撤回授权 | 中 | 中 | `unlocked` 状态后仍可调 `revoke`；记录原因 |
| SQLite 写入瓶颈 | 中 | 中 | WAL 模式 + 写入串行化 + 监控；>1000 用户时迁移 PostgreSQL |
| 单一用户突发打满 DB | 中 | 高 | 三层限流（1s/1min/1h）阻挡突发；管理后台可单用户降级 |
| Webhook 队列堆积 | 低 | 中 | 监控队列长度；超过阈值告警；自动扩容 Worker（v2） |
| 死信队列无人处理 | 中 | 低 | 管理后台每日显示死信条目；高亮显示 7 天前未处理项 |
| Convo Electron 管理后台不可多人用 | 中 | 低 | v1 单管理员够用；>3 管理员时迁移到 Web 后台 |

---

## 14. 开放问题（v1 暂不解决）

1. **真实 LLM 集成**：平台是否需要内置 AI 决策？v1 不做，让 Agent 自带。
2. **多语言/国际化**：v1 中英双语 skill.md；后台暂中文。
3. **移动端 Agent**：v1 仅支持 HTTP webhook，移动端走 PWA/原生 App 各自集成。
4. **行业模型**：v1 `industry_map` 是手写配置，v2 可接 LLM 推导。
5. **多币种/全球薪资**：v1 仅人民币。
6. **信誉分计算细节**：v1 仅初始值 50，行为加权放 v2。

---

## 15. 性能与扩展（基于几百人规模）

### 15.1 容量规划

| 指标 | 目标值 | 余量 |
|------|--------|------|
| 注册用户数 | 500 | v1 SQLite 可支撑 |
| 每日活跃用户 (DAU) | 300 | 60% 活跃率 |
| 每日 API 请求 | 100K | 平均 1.2 req/s，峰值 100 req/s |
| 候选人总数 | 10K | 公开池 < 5K |
| 推荐记录总数 | 50K | 含历史 |
| Webhook 投递 | 5K/天 | 峰值 ~10/min |
| 加密 PII 字段 | 10K 条 | AES-GCM 性能无压力 |

### 15.2 性能目标

| 端点类型 | p50 | p99 | 说明 |
|---------|-----|-----|------|
| GET 查询类（status, browse, list） | < 50ms | < 200ms | 走索引，热数据在 SQLite 页缓存 |
| POST 写类（create_job, recommend, upload） | < 100ms | < 500ms | 加密 + 写库 |
| 加密/解密操作 | < 5ms | < 20ms | AES-GCM 单字段 |
| Webhook 投递（出 API 后） | < 1s | < 5s | 队列里等待 + 投递 |

### 15.3 关键性能保障

1. **SQLite WAL 模式**：读写不互斥，读取性能提升 3-5x
2. **连接池**：better-sqlite3 同步 API 天然串行化，避免连接竞争
3. **复合索引**：覆盖所有 list / browse 类高频查询
4. **加密异步化**：仅在 unlock_contact 流程中解密，避免在 list 查询中触发
5. **限流前置**：突发限流在 auth 后立即生效，避免恶意请求打到 DB

### 15.4 监控指标（v1 最低要求）

通过 `prom-client` 暴露 `/metrics`：

| 指标 | 类型 | 用途 |
|------|------|------|
| `http_requests_total{route, status}` | counter | QPS + 错误率 |
| `http_request_duration_seconds{route}` | histogram | p50/p99 |
| `quota_used{user_type}` | gauge | 配额使用率 |
| `webhook_queue_pending_count` | gauge | 队列堆积告警 |
| `webhook_dead_letter_count` | gauge | 投递失败告警 |
| `db_write_duration_seconds` | histogram | SQLite 写入延迟 |
| `crypto_decrypt_duration_seconds` | histogram | 解密性能 |

### 15.5 何时升级

| 信号 | 行动 |
|------|------|
| DAU > 800 | 监控加密 + 限流是否生效；考虑读写分离 |
| RPS 持续 > 200 | 评估 cluster 模式（Node.js cluster module 启用多 worker） |
| SQLite 写入 p99 > 100ms | 迁移到 PostgreSQL（schema 已设计为可移植） |
| 死信队列 > 100/天 | 增加 Worker 数 + 告警用户 |
| 候选人 > 50K | 公开池加归档表（按行业/时间分区） |

### 15.6 升级路径（v2 预留，不在 v1 实施）

| 升级点 | 触发条件 | 实施成本 |
|--------|---------|---------|
| Node.js cluster mode | CPU 单核跑满 | 低（修改启动脚本） |
| PostgreSQL 迁移 | SQLite 写入瓶颈 | 中（schema 已兼容，DB 层抽象） |
| 多 Worker 进程 | Webhook 队列堆积 | 低（已抽象 worker） |
| Redis 缓存热门 talent pool | browse_talent p99 升高 | 中（缓存层抽象） |
| Web 管理后台 | 多个管理员 | 中（沿用 React 组件） |

---

## 附录 A：完整 API 错误码

| Code | HTTP | 含义 |
|------|------|------|
| `UNAUTHORIZED` | 401 | API Key 缺失或无效 |
| `FORBIDDEN` | 403 | 权限不足（如跨用户访问） |
| `NOT_FOUND` | 404 | 资源不存在 |
| `INVALID_PARAMS` | 400 | 参数校验失败 |
| `INVALID_STATE` | 409 | 状态机非法转换 |
| `INSUFFICIENT_QUOTA` | 429 | 每日配额耗尽 |
| `RATE_LIMITED` | 429 | 突发限流（1s/1min/1h 桶触发） |
| `DUPLICATE_REQUEST` | 409 | 幂等键重复 |
| `INTERNAL_ERROR` | 500 | 兜底 |

## 附录 B：数据库迁移策略

- 初始版本：单文件 `db/schema.sql`，应用启动时执行
- 后续版本：`db/migrations/v002_xxx.sql` 等命名，应用启动时按版本号顺序执行
- 迁移记录表：`schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT)`

## 附录 C：环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `PLATFORM_ENCRYPTION_KEY` | ✅ | 32 字节 base64，AES-256-GCM 密钥 |
| `WEBHOOK_HMAC_SECRET` | ✅ | 平台签名 webhook 的 HMAC 密钥 |
| `ADMIN_PASSWORD_HASH` | ✅ | bcrypt 管理后台密码 |
| `DATABASE_PATH` | ❌ | 默认 `./data/hunter.db` |
| `PORT` | ❌ | 默认 3000 |
| `NODE_ENV` | ❌ | production/development |
| `LOG_LEVEL` | ❌ | 默认 info |
