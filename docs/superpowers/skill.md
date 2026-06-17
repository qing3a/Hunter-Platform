# Hunter Platform — Skill (v1)

> 任何外部 Agent 通过本文档即可接入本平台。三角色（候选人 / 猎头 / 雇主）共享同一套 API。

## 1. 平台简介

Hunter Platform 是一个**猎头中介 API 平台**，撮合三类用户：

| 角色 | 角色做什么 | 怎么接入 |
|------|-----------|----------|
| **候选人 (candidate)** | 注册 + 提供简历（脱敏入库） | 注册后获 API key，Agent 调 `/v1/candidate/*` |
| **猎头 (headhunter)** | 上传候选人 + 推荐给雇主 + 跨猎头协作 | 注册后获 API key，Agent 调 `/v1/headhunter/*` |
| **雇主 (employer)** | 发 JD + 浏览脱敏人才 + 解锁联系方式 | 注册后获 API key + 接收 webhook，Agent 调 `/v1/employer/*` |

**核心价值**：
- 候选人 PII 加密存储，仅暴露脱敏版
- 4 步解锁协议：猎头推荐 → 雇主表兴趣 → 候选人授权 → 平台交付联系方式
- 平台抽佣 20%（成功入职后）

## 2. 认证

所有受保护端点需要 `Authorization: Bearer <api_key>` Header。

```bash
curl -H "Authorization: Bearer hp_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" https://api.hunter-platform.com/v1/users/{id}/status
```

**API key 只能获取一次**（注册时）。丢失后用 `POST /v1/auth/rotate_key` 轮换（v2）。

## 3. 完整 API 端点

### 3.1 通用

| Method | Path | 描述 |
|--------|------|------|
| POST | `/v1/auth/register` | 注册用户（三角色之一） |
| POST | `/v1/auth/rotate_key` | 轮换 API key（v2） |
| GET | `/v1/users/{id}/status` | 查询用户状态（配额/待办） |
| GET | `/v1/users/{id}/history` | 查询操作历史 |
| GET | `/v1/health` | 健康检查（公开） |

### 3.2 雇主

| Method | Path | 描述 | 配额 |
|--------|------|------|------|
| POST | `/v1/employer/jobs` | 创建职位 | 5 |
| GET | `/v1/employer/jobs` | 我的职位列表 | 1 |
| GET | `/v1/employer/talent` | 浏览脱敏人才池 | 1 |
| POST | `/v1/employer/recommendations/{id}/express-interest` | 对候选人表达兴趣 | 3 |
| POST | `/v1/employer/recommendations/{id}/unlock-contact` | 申请解锁联系方式 | 5 |

### 3.3 猎头

| Method | Path | 描述 | 配额 |
|--------|------|------|------|
| POST | `/v1/headhunter/candidates` | 上传候选人（自动脱敏） | 5 |
| GET | `/v1/headhunter/candidates` | 我的候选人列表 | 1 |
| POST | `/v1/headhunter/candidates/{id}/publish-to-pool` | 共享到公开池 | 2 |
| POST | `/v1/headhunter/recommendations` | 推荐给雇主 | 5 |
| GET | `/v1/headhunter/recommendations` | 我的推荐列表 | 1 |
| POST | `/v1/headhunter/recommendations/{id}/withdraw` | 撤回推荐 | 1 |

### 3.4 候选人

| Method | Path | 描述 | 配额 |
|--------|------|------|------|
| GET | `/v1/candidate/opportunities` | 查看匹配机会 | 1 |
| GET | `/v1/candidate/access_log` | 查看谁访问过我的数据 | 1 |
| POST | `/v1/candidate/recommendations/{id}/approve-unlock` | 授权解锁 | 3 |
| POST | `/v1/candidate/recommendations/{id}/reject-unlock` | 拒绝解锁 | 1 |
| POST | `/v1/candidate/delete_my_data` | GDPR 撤回 | 1 |

### 3.5 市场与配置

| Method | Path | 描述 | 配额 |
|--------|------|------|------|
| GET | `/v1/market/leaderboard` | 猎头业绩榜 | 1 |
| GET | `/v1/config/industries` | 行业列表 | 1 |
| GET | `/v1/config/title_levels` | 职级映射 | 1 |
| GET | `/v1/config/salary_bands` | 薪资带宽 | 1 |
| GET | `/v1/skill.md` | 本文档 | 0 |

## 4. 脱敏字段映射

服务端在 `POST /v1/headhunter/candidates` 时执行：

| 原始字段 | 脱敏后 |
|---------|--------|
| `name` | 删除（加密存 `candidates_private.name_enc`）|
| `phone` | 删除（加密存 `candidates_private.phone_enc`）|
| `email` | 删除（加密存 `candidates_private.email_enc`）|
| `current_company` | `industry: "互联网"` 等 |
| `current_title` | `title_level: "P6"` 等 |
| `expected_salary` | `salary_range: "60-80万"` |
| `education_school` | `education_tier: "985"` |
| `years_experience` | 保留 |
| `skills` | 保留 |

雇主 `GET /v1/employer/talent` 只返回脱敏字段，**绝对不返回 PII**。

## 5. 解锁流程状态机

```
pending              → employer_interested / rejected_employer / withdrawn
employer_interested  → candidate_approved / rejected_candidate / rejected_employer
candidate_approved   → unlocked / rejected_candidate
unlocked             → placed
(rejected_*/withdrawn/placed 终态)
```

完整流程：
1. 猎头 `POST /v1/headhunter/recommendations` → status=pending
2. 雇主 `POST /v1/employer/recommendations/{id}/express-interest` → status=employer_interested，webhook 通知候选人
3. 候选人 `POST /v1/candidate/recommendations/{id}/approve-unlock` → status=candidate_approved
4. 雇主 `POST /v1/employer/recommendations/{id}/unlock-contact` → status=unlocked，平台解密 PII 推 webhook 给雇主

## 6. 配额与错误码

### 6.1 配额

每日 quota + 1s/1min/1h 三层限流。超限返回 429。

| 角色 | 每日 quota | 1 秒 | 1 分 | 1 时 |
|------|-----------|------|------|------|
| candidate | 50 | 10 | 50 | 200 |
| headhunter | 200 | 20 | 100 | 500 |
| employer | 100 | 30 | 200 | 800 |

### 6.2 错误码

| Code | HTTP | 含义 |
|------|------|------|
| `UNAUTHORIZED` | 401 | API Key 缺失或无效 |
| `FORBIDDEN` | 403 | 权限不足 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `INVALID_PARAMS` | 400 | 参数校验失败 |
| `INVALID_STATE` | 409 | 状态机非法转换 |
| `INSUFFICIENT_QUOTA` | 429 | 每日配额耗尽 |
| `RATE_LIMITED` | 429 | 突发限流（1s/1min/1h 桶）|
| `DUPLICATE_REQUEST` | 409 | 幂等键复用 + body 不同 |
| `INTERNAL_ERROR` | 500 | 兜底 |

## 7. Webhook 回调规范

在 `POST /v1/auth/register` 时提供 `agent_endpoint`，平台会向该 URL POST 事件。

### 7.1 事件类型

| Event | 触发时机 |
|-------|---------|
| `notify_unlock_request` | 雇主对候选人表达兴趣 |
| `unlock_approved_by_candidate` | 候选人授权 |
| `deliver_contact` | 解锁成功（payload 含 PII）|
| `placement_created` | 入职记录创建 |
| `quota_warning` | 配额用至 80% |

### 7.2 签名验证

平台用 `WEBHOOK_HMAC_SECRET` 做 HMAC-SHA256 签名：

```
X-Hunter-Signature: sha256=<hmac-hex>
X-Hunter-Timestamp: <unix-seconds>
X-Hunter-Event: <event_type>

签名数据: `${timestamp}.${raw_body}`
```

接收方必须：
1. 验证时间戳（|now - ts| < 300s）
2. 用恒定时间比较（`crypto.timingSafeEqual`）

### 7.3 重试

3 次重试，指数退避（1s / 4s / 16s）。失败入 `dead_letter`（v1 手动重投，v2 自动化）。

## 8. 客户端集成示例

### Node.js / TypeScript

```typescript
const API_KEY = 'hp_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const BASE = 'https://api.hunter-platform.com/v1';

// 1. 注册猎头
const reg = await fetch(`${BASE}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_type: 'headhunter',
    name: 'My Agent',
    contact: 'agent@example.com',
    agent_endpoint: 'https://my-agent.example.com/webhook',
  }),
}).then(r => r.json());
console.log('api_key:', reg.data.api_key);

// 2. 上传候选人
const upload = await fetch(`${BASE}/headhunter/candidates`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    candidate_user_id: reg_candidate.data.user_id,  // 候选人先注册
    name: '张三', phone: '13800138000', email: 'z@x.com',
    current_company: '字节跳动', current_title: '高级前端',
    expected_salary: 750000, years_experience: 8,
    education_school: '清华大学', skills: ['React', 'TypeScript'],
  }),
}).then(r => r.json());
console.log('anonymized_id:', upload.data.anonymized_id);

// 3. 推荐给雇主
const rec = await fetch(`${BASE}/headhunter/recommendations`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    anonymized_candidate_id: upload.data.anonymized_id,
    job_id: 'job_xxx',
  }),
}).then(r => r.json());
```

### Python

```python
import requests

API_KEY = 'hp_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
BASE = 'https://api.hunter-platform.com/v1'
headers = {'Authorization': f'Bearer {API_KEY}'}

# 浏览脱敏人才
resp = requests.get(f'{BASE}/employer/talent', headers=headers, params={'industry': '互联网'})
candidates = resp.json()['data']
for c in candidates:
    print(c['anonymized_id'], c['title_level'], c['salary_range'])
```

### cURL

```bash
# 表达兴趣
curl -X POST https://api.hunter-platform.com/v1/employer/recommendations/rec_xxx/express-interest \
  -H "Authorization: Bearer hp_live_xxx"

# 解锁联系方式
curl -X POST https://api.hunter-platform.com/v1/employer/recommendations/rec_xxx/unlock-contact \
  -H "Authorization: Bearer hp_live_xxx"
```

---

## v1 范围

- ✅ 注册/认证/三角色基础
- ✅ 候选人上传/脱敏
- ✅ 雇主发 JD + 浏览脱敏人才
- ✅ 猎头推荐 + 跨猎头协作（UNIQUE 约束防重复）
- ✅ 4 步解锁协议 + Webhook 异步投递
- ✅ 服务端脱敏 + AES-256-GCM 加密
- ✅ 每日配额 + 三层限流
- ✅ 管理后台（Electron 桌面应用）

## 9. 监控指标（v1 新增）

平台暴露 Prometheus 格式指标在 `GET /metrics` 和 `GET /v1/metrics`：

| 指标 | 类型 | 标签 |
|------|------|------|
| `hunter_http_requests_total` | counter | route, method, status |
| `hunter_http_request_duration_seconds` | histogram | route, method, status |
| `hunter_quota_used` | gauge | user_type |
| `hunter_webhook_queue_pending_count` | gauge | — |
| `hunter_webhook_dead_letter_count` | gauge | — |
| `hunter_db_write_duration_seconds` | histogram | operation |
| `hunter_crypto_decrypt_duration_seconds` | histogram | — |

外加 `process_*` 和 `nodejs_*` 默认 Node.js 指标。`/metrics` 端点本身不被记录以避免自递归。

## 10. 加密密钥轮换（v1 新增）

加密 payload 格式：`v1:<base64(iv||tag||ciphertext)>`。`v1:` 前缀让 decrypt 能区分版本，未来按版本号选不同密钥解密。

环境变量（向后兼容）：
- **单 key**（默认）：`PLATFORM_ENCRYPTION_KEY=<base64 32 字节>`
- **多 key**（轮换）：`PLATFORM_ENCRYPTION_KEYS=v1:<b64>,v2:<b64>`（**最新 key 用于加密**）

```bash
# 启动时配置
export PLATFORM_ENCRYPTION_KEYS="v1:$(openssl rand -base64 32),v2:$(openssl rand -base64 32)"
```

⚠️ 旧格式（无 `v1:` 前缀）会在 M5 之后被解密逻辑拒绝。如有遗留数据需先迁移（v1: prefix 后重新加密）。

## 11. Cron Jobs（v1 新增）

服务启动时自动注册 3 个 cron job（UTC 时间）：

| 任务 | 表达式 | 行为 |
|------|--------|------|
| `quota-reset` | `0 0 * * *`（每日 UTC 0） | 重置所有 active user 的 `quota_used = 0` |
| `rate-limit-cleanup` | `0 * * * *`（每小时） | 删除 `expires_at < now` 的 rate_limit_buckets |
| `audit-archive` | `0 0 1 * *`（每月 1 号） | 删除 90 天前的 action_history（M5 v1 简单删除；v2 应归档到 S3） |

优雅关闭：HTTP server `close` 事件触发 `stopMetricsRefresh()` + `stopScheduler()`。

## 12. 压测（v1 新增）

k6 脚本在 `tests/load/`，覆盖 spec §15.2 全部场景。详见 [`tests/load/README.md`](../load/README.md)。
- ⏳ v2：加密密钥轮换、跨猎头推荐细分、多语言、完整 GDPR 导出