# Hunter Platform 修复执行计划 v1.4：skill.md 完整化 + OpenAPI 自动化

> **任务**：4 项 polish + 1 个代码工具
>
> - T1: §13 SDK 重复精简
> - T2: §9/§10 拆分到 `docs/OPERATIONS.md`
> - T3: §14 Agent 决策手册（策略层）
> - T4: OpenAPI 自动生成脚本
>
> **背景**：v1.3.1 已完成 6 项 polish 收尾。本轮完成"机制层 → 策略层"的关键补缺。

---

## 上下文

- 服务跑在 `http://localhost:3000`，源码 `D:\dev-hunter-platform`
- v1.3.1 已合并：skill.md 全部 polish 完毕
- 测试 387/387 通过
- 当前 §14 = "Employer browseTalent 详解"（v1.2 加的，单 endpoint 说明）
- 本轮新内容 = "Agent 决策手册"（策略层，多角色 workflow）—— 完全不同维度
- §14 现有内容 = 保留并后移（详见 T3 决策）

---

## 关键事实（已核实）

| 事实 | 来源 |
|---|---|
| §13 现有 3 个子节：13.1 Node.js / 13.2 Python / 13.3 cURL | `docs/superpowers/skill.md:702-748` |
| §13.2 Python 与 §11 Day-1 Python 教程 ~80% 重复 | grep 验证 |
| §9 加密密钥管理 = 运维内容（PLATFORM_ENCRYPTION_KEYS 轮换） | `skill.md:450-468` |
| §10 后台任务 = 运维内容（cron 表达式、优雅关闭） | `skill.md:478-490` |
| `docs/superpowers/openapi.json` 现 29 路径，**schema 是手写静态 JSON** | `docs/superpowers/openapi.json` |
| §14 已存在（"Employer browseTalent 详解"，v1.2 加的） | `skill.md:699-...` |
| §15+ 是附录（A-G），不会被新 §14 撞 | `skill.md:761+` |
| Zod schema 在 routes/*.ts 里（如 `UploadSchema`、`CreateJobSchema`） | `src/main/routes/*.ts` |

---

## T1：§13 SDK 精简（10 分钟）

**改的文件**：`docs/superpowers/skill.md` §13

**目标**：删 §13.3 cURL（与 §13.2 Python 重复），§13 砍为 2 个子节

**当前结构**：
```
### 13.1 Node.js / TypeScript
### 13.2 Python (requests)
### 13.3 cURL  ← 删
```

**改为**：
```
### 13.1 Node.js / TypeScript
### 13.2 Python (requests)
```

**T1.1**：删 §13.3 cURL（line 746-758 的整个 sub-section + 1 个空行）

**保留**：
- 13.1 Node.js 示例（不同语言，有增量）
- 13.2 Python 示例（**注意**：这是 requests 库，与 §11 urllib 不同，有补充价值）

**不动**：§11 Day-1 完整教程（这是端到端 happy path，比 §13 SDK 单点示例更深）

---

## T2：§9/§10 拆分（15 分钟）

**改的文件**：
- 改：`docs/superpowers/skill.md`（删 §9 §10 内容，改为"见 OPERATIONS.md"）
- 新建：`docs/OPERATIONS.md`

**T2.1 新建 `docs/OPERATIONS.md`**：

```markdown
# Hunter Platform 运维指南

> 此文档面向**部署方 / SRE / 平台管理员**，与 agent skill.md 分离。
> Agent 不需要看这里。

---

## 1. 环境变量

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `PLATFORM_ENCRYPTION_KEY` | ✅ | — | AES-256-GCM 密钥，base64 of 32 bytes。单 key 模式。 |
| `PLATFORM_ENCRYPTION_KEYS` | ❌ | — | 多 key 轮换模式：`v1:<b64>,v2:<b64>`，最新 key 用于加密 |
| `WEBHOOK_HMAC_SECRET` | ✅ | — | webhook 签名密钥，≥ 16 字符 |
| `ADMIN_PASSWORD_HASH` | ✅ | — | bcrypt 哈希 |
| `DATABASE_PATH` | ❌ | `./data/hunter.db` | SQLite 文件路径 |
| `PORT` | ❌ | `3000` | HTTP 监听端口 |
| `NODE_ENV` | ❌ | `development` | `development` / `test` / `production` |
| `LOG_LEVEL` | ❌ | `info` | `debug` / `info` / `warn` / `error` |
| `RATE_LIMIT_ENABLED` | ❌ | `true` | `false` 关闭所有限流（仅本地开发） |

---

## 2. 加密密钥轮换

加密 payload 格式：`v1:<base64(iv||tag||ciphertext)>`。`v1:` 前缀让 decrypt 能区分版本。

### 模式 1：单 key（默认）
```bash
PLATFORM_ENCRYPTION_KEY=<base64 32 字节>
```

### 模式 2：多 key 轮换
```bash
export PLATFORM_ENCRYPTION_KEYS="v1:$(openssl rand -base64 32),v2:$(openssl rand -base64 32)"
```
- **最新 key（v2）用于加密**
- 旧 key（v1）用于解密遗留数据
- 客户端无需改任何代码

> ⚠️ 旧格式（无 `v1:` 前缀）已停止支持。如有遗留数据需先重新加密。

---

## 3. 后台任务

| 任务 | 表达式 | 行为 |
|------|--------|------|
| `quota-reset` | `0 0 * * *`（每日 UTC 0）| 重置所有 active user 的 `quota_used = 0` |
| `rate-limit-cleanup` | `0 * * * *`（每小时）| 删除 `expires_at < now` 的 rate_limit_buckets |
| `audit-archive` | `0 0 1 * *`（每月 1 号）| 删除 90 天前的 action_history |

---

## 4. 优雅关闭

HTTP `close` 事件触发：
- `stopMetricsRefresh()` — 停止 Prometheus 指标刷新
- `stopScheduler()` — 停止 cron 任务

部署方应监听 `SIGINT` / `SIGTERM` 并优雅关闭。

---

## 5. 数据库迁移

迁移版本控制 `src/main/db/migrations/`。升级流程：
1. 启动时自动应用新 migration
2. 不可回滚（v1 不支持 downgrade）
3. v008 是当前最新（GDPR soft-delete）
```

**T2.2 改 `docs/superpowers/skill.md` §9 和 §10**：

**当前**（line 450-490）：
```markdown
## 🔐 9. 加密密钥管理

加密 payload 格式：`v1:<base64(iv||tag||ciphertext)>`...

[整个 §9 内容]

## ⚙️ 10. 后台任务

| 任务 | 表达式 | 行为 |
|...|

优雅关闭：HTTP close 事件...
```

**改为**（§9）：
```markdown
## 🔐 9. 加密密钥管理

加密 payload 格式：`v1:<base64(iv||tag||ciphertext)>`。

> 💡 **Agent 视角**：你只消费**已解密**的 PII（如 `deliver_contact` webhook 里的明文 name/phone/email），不需要接触密钥。运维密钥轮换详见 [`OPERATIONS.md`](../OPERATIONS.md)。
```

**改为**（§10）：
```markdown
## ⚙️ 10. 后台任务

| 任务 | 表达式 | 行为 |
|------|--------|------|
| `quota-reset` | `0 0 * * *`（每日 UTC 0）| 重置所有 active user 的 `quota_used = 0` |
| `rate-limit-cleanup` | `0 * * * *`（每小时）| 删除 `expires_at < now` 的 rate_limit_buckets |
| `audit-archive` | `0 0 1 * *`（每月 1 号）| 删除 90 天前的 action_history |

> 💡 **Agent 视角**：你**不能**触发这些任务，是平台自动跑的。运维 cron 配置详见 [`OPERATIONS.md`](../OPERATIONS.md)。
```

**保留部分**：
- §10 表格的 3 行 cron 任务（agent 想知道"UTC 0 重置"等关键时间点）
- §10 末尾的优雅关闭行（**不**放 OPERATIONS.md，因为 webhook 接收方 agent 也关心）

---

## T3：§14 Agent 决策手册（30-45 分钟）

**改的文件**：`docs/superpowers/skill.md`

**核心问题**：当前 §14 是 "Employer browseTalent 详解"（v1.2 加的，单 endpoint 说明）。新内容是 "Agent 决策手册"（多角色 workflow），完全是不同维度。

**决策方案**（两种选其一）：

### 方案 A：在 §14 之前插入新"§14 Agent 决策手册"，旧 §14 后移为 §15

这是推荐方案。结构：
- §0-§13：API / 机制文档
- **§14 Agent 决策手册**（新，策略层）★
- §15 Employer browseTalent 详解（旧 §14 移过来）
- 附录 A-G（不变）

### 方案 B：把新内容追加到现有 §14 后面作为子节（§14.5+）

不推荐。结构混乱，"Employer browseTalent 详解"和"Agent 决策手册"性质不同。

---

**执行方案 A**：

**T3.1 现有 §14 改名为 §15**

找到 §14 标题（line 698-700）：
```markdown
## 🧭 14. Employer browseTalent 详解（v1.2 起）
```

改为：
```markdown
## 🧭 15. Employer browseTalent 详解（v1.2 起）
```

**同时把 §14 内所有"§14.x"子节标题改为"§15.x"**：
- §14.1 → §15.1
- §14.2 → §15.2
- §14.3 → §15.3
- §14.3.1 → §15.3.1
- §14.4 → §15.4

**T3.2 在 §13 之后插入新 §14 Agent 决策手册**

在 §13 SDK（line 758 末尾）后、当前 §14（已改名为 §15）前插入新 §14。

**新 §14 完整内容**（~280 行）：

```markdown
## 🧭 14. Agent 决策手册（策略层）

> §0–§13 描述**机制**（能做什么）。本节描述**策略**（什么时候该做什么）。
> 三角色 agent 都应把本节当作 playbook，而不是来回试 API。

### 14.1 通用启动循环

无论扮演哪个角色，每个 agent 启动后先按这个顺序做：

1. `GET /v1/users/{id}/status` → 拿 `quota_used` / 今日剩余 / 待办
2. `GET /v1/users/{id}/history` → 看最近 10 条动作，找上次停在哪儿
3. `GET /v1/config/industries` → 确认行业映射（不要硬编码）
4. `GET /v1/config/title_levels` → 拿职级正则
5. `GET /v1/config/salary_bands` → 拿薪资带宽
6. 进入角色专属工作流（§14.2 / §14.3 / §14.4）
7. 任何 webhook 到达 → 决策后回复（§14.5）

为什么这样：quota 用满就立刻停，不浪费在试探 API 上；status 是单一信源，比轮询多个 endpoint 高效。

### 14.2 猎头（headhunter）工作流

**目标**：让上传的候选人**对雇主有吸引力** + **不浪费配额在重复推荐**。

#### 14.2.1 上传前

```python
# 先看猎头自己已有哪些候选人，避免重复上传
mine = get('/v1/headhunter/candidates')['data']
for c in mine:
    if c['candidate_user_id'] == new_candidate_id:
        # 已上传过 → 直接用现有的 anonymized_id，不再上传（不扣 quota）
        reuse = c
        break
```

> ❌ 不要做：对同一 `candidate_user_id` 反复上传——会创建新记录、扣 5 quota、还污染池子。

#### 14.2.2 决定"哪些简历值得上传"

按"脱敏后对雇主有信号"的标准筛：

| 信号维度 | 优先上传 | 不必上传 |
|---------|---------|---------|
| 行业 | `industry` 在 `/v1/config/industries` 的 companies_count 前 5 | `industry` 是"其他" |
| 职级 | `title_level` 命中正则（不在 "other"） | 实习生 / 兼职 |
| 学历 | `education_tier ∈ {985, 211, 海外名校}` | 普通院校 |
| 经验 | `years_experience ≥ 3` | < 3 年 |
| 技能 | `skills` 与某个活跃 JD 的 `required_skills` 至少 1 项重合 | 无重合 |

> 💡 为什么：雇主 `GET /v1/employer/talent` 按脱敏维度过滤，缺信号的简历被过滤掉的概率高。

#### 14.2.3 推荐前

```python
# 1. 找匹配 JD（v1.3 起公共端点，无需雇主身份）
jobs = get('/v1/market/jobs?industry=互联网')['data']
# 只推荐 status='open' 的 JD
```

> 💡 跨猎头不能直接看到别人上传的候选人——雇主通过 `talent` 池子发现。猎头靠 `/v1/market/jobs` 看市场。

#### 14.2.4 推荐时（防 409 DUPLICATE_REQUEST）

```python
recs = get('/v1/headhunter/recommendations')['data']
existing = {(r['anonymized_candidate_id'], r['job_id']) for r in recs if r['status'] != 'withdrawn'}
if (anon_id, job_id) in existing:
    skip_recommendation()  # 已推荐过该对 → 换 job 或换候选人
```

> ❌ 不要做：盲目 `POST /v1/headhunter/recommendations`——会被 409，浪费 5 quota。

#### 14.2.5 4 步解锁——猎头视角

猎头**不直接解锁**，但 placement 取决于 4 步走完。猎头策略：

| 时机 | 动作 | 为什么 |
|------|------|--------|
| 推荐后立即 | 用外发通道通知雇主（非平台 API） | 让雇主知道有匹配候选人 |
| `employer_interested` 后 | 等 webhook，不要轮询 | webhook 是异步投递 |
| `candidate_approved` 后 | 等 webhook | 同上 |
| `unlocked` 后 | 等 `placement_created` webhook | 触发抽佣记账 |
| `pending` 超 7 天 | `POST /v1/headhunter/recommendations/{id}/withdraw` 撤回 | 释放雇主视野 |

### 14.3 雇主（employer）工作流

**目标**：用最少 quota 找到**最适合**的候选人 + 控制解锁成本（每次解锁扣 5 quota）。

#### 14.3.1 发 JD 时

JD 的 `required_skills` / `salary_min..max` 直接决定后面 talent pool 的命中率。建议：

- `required_skills` 写 **3–5 个核心技能**，不要全列（命中难度 ↑）
- `salary_min..max` 与目标职级带宽对齐（用 `/v1/config/salary_bands` 校准）
- 写清 `industry`（虽然当前 openapi 没强制，但 §0.4 提到脱敏按行业映射）

#### 14.3.2 浏览 talent pool

```python
# v1.2 起 7 个 query 参数（全部可选，AND 组合）
params = {
    'industry': '互联网',          # 完全匹配 candidates_anonymized.industry
    'title_level': 'P6',           # 完全匹配 title_level
    'min_years': 5,                # years_experience ≥ N
    'max_years': 10,               # years_experience ≤ N
    'skills': 'React,TypeScript',  # 逗号分隔，任一命中即可（OR）
    'min_salary': 500000,          # 年薪下限（v1.2 新增）
    'max_salary': 800000,          # 年薪上限（v1.2 新增）
}
candidates = get('/v1/employer/talent', params=params)['data']
```

> ⚠️ `min_salary=invalid`（NaN）被忽略，返回所有；`min > max` 返回空数组。

**选择节奏**（节省 quota，浏览类操作各扣 1）：

```
talent 池筛选 → 选 5–10 个候选
  → 对每个访问 view_url 1 次（view 单次有效，免费）
  → 留下 1–2 个进入 express-interest（3 quota）
```

> ❌ 不要做：
> - 不加过滤直接拉全量——会被 22+ 行业 × 40+ 职级淹死
> - 同一候选人多次访问 view_url——第二次 410
> - 对同一候选人重复 express-interest——状态变了，第二次 409

#### 14.3.3 4 步解锁——雇主视角

```
[1] GET /v1/employer/recommendations         → 找 pending 的 rec
[2] 看 view_url 预览脱敏画像
[3] POST /express-interest（扣 3 quota）       → 候选人 webhook notify_unlock_request
[4] 等候选人 approve → 收到 notify_unlock_approved
[5] 立即 POST /unlock-contact（扣 5 quota）    → 收到 deliver_contact webhook（含 PII）
[6] PII 现在到手 → 离线联系候选人
[7] 候选人入职 → POST /v1/employer/placements（扣 1 quota）
```

> ⚠️ express-interest 后**不要立刻 unlock-contact**——必须等候选人 approve，否则第 5 步 409。
> ❌ 候选人 reject 后**不要再 recommend 同一对**——改换不同候选人。

#### 14.3.4 入职记录

```python
# placement body 只有 3 个字段——commission 不在这里传
placement = post('/v1/employer/placements', {
    'job_id': job_id,
    'anonymized_candidate_id': anon_id,
    'annual_salary': 720000
})
# commission 由推荐时的 referrer_headhunter_id + commission_split 自动计算
# primary_share = platform_fee × (1 - referrer_split)
# referrer_share = platform_fee × referrer_split
```

> ⚠️ placement body **没有 commission_split 字段**——commission 由推荐时存的 `referrer_headhunter_id` + `commission_split` 自动计算（详见 §2.3）。

### 14.4 候选人（candidate）工作流

**目标**：控制 PII 暴露面 + 不错过合适机会 + 行使 GDPR 权利。

#### 14.4.1 收到 `notify_unlock_request` 时（决策矩阵）

```python
def decide_unlock(rec):
    # 1. 查雇主历史（rec.employer_id 来自 webhook payload）
    emp_history = get(f"/v1/users/{rec['employer_id']}/history")['data']

    # 2. 算雇主"履约率"（action_type 名以 route-action-map.ts 为准）
    delivered = sum(1 for h in emp_history if h['action_type'] == 'unlock_contact')
    placed    = sum(1 for h in emp_history if h['action_type'] == 'placement_created')
    fulfillment_rate = placed / delivered if delivered else 0

    # 3. 决策
    if fulfillment_rate >= 0.3:
        return 'approve'        # 雇主靠谱
    elif fulfillment_rate >= 0.1:
        return 'approve_cautious'  # 接受但记录
    else:
        return 'reject'        # 履约率过低
```

**action_type 名以 `route-action-map.ts` 为准**（不是 `unlock_delivery`）：
- `unlock_contact`：雇主申请解锁
- `placement_created`：入职创建

**策略启发**：

| 雇主特征 | 建议 |
|---------|------|
| 历史 placement / unlock ≥ 30% | 直接 approve |
| 10–30% | approve，但记录到本地黑名单（多次低履约后 reject） |
| < 10% 或新雇主 | 看 job 是否真的匹配 → 谨慎 approve |
| 反复 express-interest 但从不 unlock | reject（占着名额） |

#### 14.4.2 access-log 巡查节奏

| 阶段 | 频率 |
|------|------|
| 简历已上传、无 active 推荐 | 每周 1 次 |
| 有 active recommendation | 每天 1 次 |
| 收到可疑 employer 多次访问 | 立即查 + 考虑 reject |

#### 14.4.3 GDPR 撤回

```python
post('/v1/candidate/delete-my-data')  # 连字符，不是 delete_my_data
```

撤回后：
- 所有 PII 加密字段被销毁
- 脱敏维度（行业/职级）保留用于统计
- 历史 placement 保留（合规要求）
- 之前的 api_key 立即失效

### 14.5 Webhook 决策总表

收到 webhook 时按事件类型走决策：

| 事件 | 谁收 | 收到后动作 |
|------|------|----------|
| `notify_unlock_request` | candidate | 查雇主履约 → approve/reject |
| `notify_unlock_approved` | employer | 立即 `/unlock-contact`（带 1–5s 抖动避免 burst） |
| `deliver_contact` | employer | PII 入库（**二次加密**）→ 离线联系候选人 |
| `placement_created` | headhunter | 抽佣记账 |
| `quota_warning` | 自己 | 暂停非必要操作 |

**统一 webhook 处理框架**：

```python
def handle_webhook(event, payload):
    if event == 'notify_unlock_request':
        return candidate_decide_unlock(payload)
    elif event == 'notify_unlock_approved':
        time.sleep(random.uniform(1, 5))  # 防 burst
        return employer_unlock_contact(payload['recommendation_id'])
    elif event == 'deliver_contact':
        return store_pii_encrypted(payload)
    elif event == 'placement_created':
        return record_commission(payload)
    elif event == 'quota_warning':
        return reduce_operation_rate()
```

### 14.6 Quota 预算表

| 角色 | 日 quota | 推荐分配 |
|------|---------|---------|
| headhunter (200) | upload 5×10 + recommend 5×20 + publish-to-pool 2×10 + browse 1×50 + register 0 | 70% upload/recommend，20% 浏览，10% 缓冲 |
| employer (100) | create_job 5×5 + express 3×10 + unlock 5×10 + browse 1×30 | 60% 解锁/入职，30% 浏览，10% 缓冲 |
| candidate (50) | approve 3×10 + reject 1×5 + browse 1×15 + delete 1 | 50% approve，30% 巡查，20% 缓冲 |

**警戒线**：
- `quota_used / quota_per_day >= 0.8` → 触发 `quota_warning` webhook → 切换到低 quota 路径
- `>= 0.95` → 停止所有非必要操作

### 14.7 跨猎头协作

```python
rec = post('/v1/headhunter/recommendations', {
    'anonymized_candidate_id': anon_id,
    'job_id': job_id,
    'referrer_headhunter_id': ref_hh_id,           # 二级猎头
    'commission_split': {'hunter': 0.8, 'referrer': 0.2}  # 默认 100:0
})
# placement 后系统按 referrer_headhunter_id 自动计算分账
```

### 14.8 失败恢复

| 失败 | 检测方式 | 恢复动作 |
|------|---------|---------|
| 429 RATE_LIMITED | status 或 `Retry-After` | 严格 `sleep(retry_after)`，**不要立即重试** |
| 409 INVALID_STATE | status 字段被并发改 | `GET /v1/users/{id}/status` → 按当前状态分支 |
| 409 DUPLICATE_REQUEST | 推荐过 | 换 job_id 或 anonymized_candidate_id |
| 401 UNAUTHORIZED | api_key 失效 | `POST /v1/auth/rotate-key`（旧 key 24h grace） |
| webhook 没收到 | history 一直不更新 | 检查 `agent_endpoint` 可达性 + HMAC + 时间戳 < 300s |
| view_url 410 Gone | 已访问过 | 重新走完整流程拿新 token |

### 14.9 关键反模式（不要做）

- ❌ 轮询 `/v1/users/{id}/status` 等待解锁——用 webhook
- ❌ 缓存 view_url 重用——单次有效
- ❌ 硬编码行业/职级/薪资带宽——每次启动都查 `/v1/config/*`
- ❌ 盲目推荐——先查 `recommendations` 防 409
- ❌ 解锁候选人前不查 employer history——履约率低的雇主会浪费 PII 暴露
- ❌ 把 deliver_contact webhook 的 PII 明文落库——必须二次加密
- ❌ bash heredoc 提交中文 JSON（Windows 默认 GBK）——用 Python/Node 序列化
- ❌ 同时跑 3 个角色 agent 测同一 IP——register 走 IP 限流 5/h
- ❌ 在 placement body 传 commission_split_json——schema 不接受（详见 §2.3）
- ❌ 跨猎头协作时"猎头 push JD"——平台无 push，用 `/v1/market/jobs` 看市场
```

---

## T4：OpenAPI 自动生成脚本（30-60 分钟）

**新建文件**：`scripts/generate-openapi.ts`

**目标**：扫描源码 route 文件 → 生成 `docs/superpowers/openapi.json` → 验证 schema 与代码一致

**T4.1 扫描策略**：

从 `src/main/routes/*.ts` 提取：
- method（GET/POST/PUT/DELETE）
- path（带 `:id` 占位符）
- 是否需要 auth（用 `authMiddleware` 还是 `optionalAuthMiddleware`）
- 引用了哪些 zod schema（用于 request body）

**T4.2 输出格式**：

```json
{
  "openapi": "3.0.0",
  "info": { "title": "Hunter Platform API", "version": "1.3.1", ... },
  "paths": {
    "/v1/auth/register": {
      "post": {
        "requestBody": { "schema": { "$ref": "#/components/schemas/RegisterRequest" } },
        "responses": { "200": { "schema": { "$ref": "#/components/schemas/RegisterResponse" } } }
      }
    }
  },
  "components": { "schemas": { ... } }
}
```

**T4.3 脚本骨架**（不要求完整，先能扫路由）：

```typescript
// scripts/generate-openapi.ts
import fs from 'node:fs';
import path from 'node:path';

const routesDir = 'src/main/routes';
const outputPath = 'docs/superpowers/openapi.json';

// 简易 scanner：读 routes/*.ts 找 router.METHOD('/path', ...) 模式
// 输出 JSON 到 docs/superpowers/openapi.json

// 范围（T4 不需要做的）：
// - 不解析 zod schema（用手写 OpenAPI schema 替代，路径 + 响应类型先）
// - 不生成 component schemas（手写）
// - 不验证 runtime 行为
```

**T4.4 package.json 加脚本**：

```json
{
  "scripts": {
    "openapi:generate": "tsx scripts/generate-openapi.ts",
    "openapi:check": "tsx scripts/generate-openapi.ts --check"
  }
}
```

**T4.5 测试脚本**：

新建 `tests/scripts/openapi-coverage.test.ts`：
- 跑 `pnpm openapi:generate`
- 验证生成的 openapi.json 至少覆盖所有 routes/*.ts 里的路由
- 任何 route 文件的 router.METHOD 但 openapi 缺 → fail

---

## T5：CHANGELOG 加 v1.4

**改的文件**：`docs/CHANGELOG.md`

**在顶部加**：

```markdown
## v1.4 — 2026-06-19

### ✨ 重大补充

| 项 | 说明 |
|------|------|
| **§14 Agent 决策手册** | 策略层补充：通用启动循环 + 三角色工作流 + webhook 决策 + quota 预算 + 跨猎头协作 + 失败恢复 + 9 条反模式。~280 行。 |
| **OPERATIONS.md** | 提取 §9/§10 运维内容（密钥轮换 + cron + 优雅关闭 + 环境变量）。agent skill.md 只保留 agent 视角的关键信息。 |
| **OpenAPI 自动生成** | 新增 `scripts/generate-openapi.ts`，从 `src/main/routes/*.ts` 提取路由 → 生成 openapi.json。配套 `pnpm openapi:check` 在 test 时跑。 |

### 🧹 文档精简

- §13 SDK 删 cURL（与 Python 重复），保留 Node.js + Python
- §9 / §10 移到 OPERATIONS.md

### ✅ 验证

- `pnpm test` ≥ 387 + 1 (openapi-coverage) = 388 / 388 PASS
```

---

## T6：验证

```bash
cd d:/dev-hunter-platform

# 1. 类型检查（纯文档不应影响 TS，但 OpenAPI 脚本要过）
pnpm typecheck

# 2. 测试（387 + 1 新增 openapi-coverage = 388）
pnpm test

# 3. OpenAPI 检查
pnpm openapi:check

# 4. 手动 spot check
curl -s http://localhost:3000/v1/openapi.json | python3 -c "
import json, sys
spec = json.load(sys.stdin)
paths = list(spec.get('paths', {}).keys())
print(f'OpenAPI paths: {len(paths)}')
print(f'Sample: {paths[:3]}')
"
```

**期望**：
- `pnpm typecheck` 0 errors
- `pnpm test` 388/388 passed
- `pnpm openapi:check` exit 0
- §14 实际章节有 14.1-14.9
- §15 = 旧 §14（"Employer browseTalent 详解"）
- OPERATIONS.md 存在且有内容

---

## 涉及文件清单

| 文件 | 改/建 | 来源 |
|---|---|---|
| `docs/superpowers/skill.md` | **改** | T1, T3 |
| `docs/OPERATIONS.md` | **新建** | T2 |
| `docs/CHANGELOG.md` | **改** | T5 |
| `scripts/generate-openapi.ts` | **新建** | T4 |
| `tests/scripts/openapi-coverage.test.ts` | **新建** | T4 |
| `package.json` | **改**（加 2 个 script） | T4 |

---

## 🚫 不要做的事

- ❌ 不要修改源代码（除 package.json）
- ❌ 不要修改现有测试（除新增 openapi-coverage.test.ts）
- ❌ 不要碰 §0-§13
- ❌ 不要把 §14 Agent 决策手册内容加到现有 §14 内（要分两节）
- ❌ 不要改 OpenAPI schema 的内容（只生成路径，不动 schema 细节）
- ❌ 不要引入新依赖（用 tsx 已经有的）

---

## 硬约束

- ✅ T1 先做（最简单，10 分钟）
- ✅ T2 在 T1 之后
- ✅ T3 在 T2 之后（引用 OPERATIONS.md）
- ✅ T4 独立做（不依赖 T1-T3）
- ✅ T5 最后做（CHANGELOG 引用所有）
- ✅ 每个 T 完成跑 `pnpm typecheck` 防止编译错累积

---

## 关键陷阱（来自历史经验）

1. **§14 现有内容** 是 "Employer browseTalent 详解"，**不能删**——移到 §15
2. **§14 决策手册插入位置**：在 §13 SDK 之后、当前 §14 之前
3. **T3 插入新 §14 后**：把旧 §14 的所有子节编号 +1（§14.1 → §15.1 等）
4. **OpenAPI 脚本不能引入新 npm 包**：用 tsx + 现有依赖
5. **ESM import 必须 .js 后缀**
6. **测试 flaky**：vitest 偶发 Worker exited，重跑即可

---

## 卡住时怎么办

- T1 找不到 cURL 段落 → grep "### 13.3" 定位
- T2 §9 §10 找不到 → grep 章节标题
- T3 编号错误 → Read 文件确认实际章节号
- T4 脚本编译错 → 检查 .js 后缀
- 测试挂了 → 立即停下报告

---

## 验收清单

完成后报告：

1. **修改文件清单**（应 6 个）：
   - docs/superpowers/skill.md（修改）
   - docs/OPERATIONS.md（新建）
   - docs/CHANGELOG.md（修改）
   - scripts/generate-openapi.ts（新建）
   - tests/scripts/openapi-coverage.test.ts（新建）
   - package.json（修改）

2. **4 项任务确认**：
   - T1 §13：grep "### 13" 应只 2 个
   - T2 §9/§10：grep 应只剩 cross-ref；OPERATIONS.md 存在
   - T3 §14：grep "## 🧭 14\." 应是 Agent 决策手册；grep "## 🧭 15\." 应是旧 browseTalent
   - T4 OpenAPI：scripts/generate-openapi.ts 存在，`pnpm openapi:check` 退出 0

3. **验证输出**：
   - pnpm typecheck（0 errors）
   - pnpm test 最后 5 行（≥ 388/388 passed）
   - pnpm openapi:check 退出码 0

4. **任何跳过项 + 原因**

---

## 工作时间估计

- T1（§13 删 cURL）：10 分钟
- T2（OPERATIONS.md 拆分）：15 分钟
- T3（§14 决策手册 + 旧 §14 改 §15）：30-45 分钟
- T4（OpenAPI 自动生成）：30-60 分钟
- T5（CHANGELOG）：5 分钟
- T6（验证）：5 分钟

**总计：~95-130 分钟**
