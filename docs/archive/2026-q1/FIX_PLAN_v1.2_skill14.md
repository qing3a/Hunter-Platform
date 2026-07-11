# skill.md §14 追加执行计划（修正版）

> **任务**：在 `docs/superpowers/skill.md` 末尾追加 §14 "Agent Playbook"。  
> **依据**：参考 `C:\Users\Administrator\Desktop\hunter-skill-design.md` 的结构，**修正其实 6 处事实错误**，用核实过的代码事实填充。  
> **目标**：补全 skill.md 的"策略层"（何时做什么），不重复 §11 Day-1 / §12 决策启发的内容。

---

## 上下文

- 服务跑在 `http://localhost:3000`，源码 `D:\dev\hunter-platform`
- 当前 skill.md 已有 13 节 + 附录 A–G，**§14 不存在**，本任务追加在末尾
- skill.md 总长 ~31KB / 749 行，加完 §14 预计 +250 行
- 风格：emoji 标题 + ⚠️ 关键提示 + 表 + 代码示例 + ❌ 反模式

---

## ⚠️ 必须修正的事实错误（来自 design.md）

> 这些是 design.md 的事实错误，**不能复制**，必须替换为代码核实的事实。

### 错 1：talent query 参数
| 错的 | 对的（来自 `src/main/routes/employer.ts:78-83`） |
|------|---------------------------------------------------|
| `industry, title_level, salary_max` | `industry, title_level, **min_years, max_years, skills**`（**5 个**，无 salary_max） |

### 错 2：placement commission 流程（**最严重**）
| 错的（design §14.3.4 / §14.7） | 对的（来自 `src/main/modules/commission/handler.ts:createPlacement`） |
|------|------|
| placement body 传 `commission_split_json: {primary_headhunter_id, referrer_headhunter_id, primary_share_pct, referrer_share_pct}` | placement body 只有 `{anonymized_candidate_id, job_id, annual_salary}`；commission 自动按推荐时存的 `referrer_headhunter_id` 计算，**客户端不传** |
| 推荐时携带 referrer，placement 时再分账 | **推荐时**就传 `referrer_headhunter_id` 写入 recommendation，**placement 时**系统读这个字段计算 `platform_fee / primary_share / referrer_share` |
| platform_fee = 600000 × 0.20 | 实际是 `platform_fee = annual_salary × 0.20`（但比例可在 constants 查） |

### 错 3：action_type 命名
| 错的（design §14.4.1） | 对的（来自 `src/main/modules/audit/route-action-map.ts`） |
|------|------|
| `unlock_delivery` | `unlock_contact`（handler 内部）→ webhook 事件是 `deliver_contact` |
| 候选人决策时查 `action_type='unlock_delivery'` | 查 `deliver_contact`（webhook）或 `unlock_contact`（audit） |

### 错 4：webhook 事件名混用
| 错的 | 对的（来自 `src/shared/types.ts:119-124`） |
|------|------|
| 同时提到 `unlock_approved_by_candidate` 和 `notify_unlock_approved` | **5 个事件全名**：<br>`notify_unlock_request`（employer→candidate）<br>`notify_unlock_approved`（candidate→employer，v0.3.1 新增）<br>`deliver_contact`（PII 解密后给 employer）<br>`placement_created`（employer→headhunter）<br>`quota_warning`（quota 80% 时给本人）<br>⚠️ 注意：skill.md 当前写的是 `unlock_approved_by_candidate`，**这是错的**，应改为 `notify_unlock_approved` |

### 错 5："猎头推送 recommendations 给雇主"
| 错的 | 对的 |
|------|------|
| §14.3 step 1 "收到 headhunter 的 recommendations 推送（外部通道）" | 猎头推荐后状态变 `pending`，**雇主自己** `GET /v1/employer/recommendations` 查（不是 headhunter push）。这才是 hunter 平台的真实机制 |

### 错 6：decision 函数中 `employer_id` 来源
| 错的 | 对的（需查 webhook payload） |
|------|------|
| 决策函数接收 `employer_id` 参数 | webhook payload 字段需查 `src/main/modules/employer/handler.ts:152-180` 的实际 sendWebhook 调用 |

---

## ✅ 必须保留（design.md 中正确且有价值的）

以下结构思路完全对，**保留并修正细节**：

| 设计章节 | 价值 | 保留 |
|---|---|---|
| §14.1 通用工作循环（先 status → history → config） | 高 | ✅ 保留 |
| §14.2 猎头工作流（上传前查已有、推荐前查重复、防 409） | 高 | ✅ 保留 |
| §14.3 雇主工作流（query 过滤、talent→view_url→express-interest 节奏） | 高 | ✅ 保留 + 修 query 参数 |
| §14.4 候选人决策（查雇主履约率） | 高 | ✅ 保留 + 修 action_type 名 |
| §14.5 webhook 决策表 | 高 | ✅ 保留 + 修事件名 |
| §14.6 quota 预算表 | 中 | ✅ 保留 |
| §14.7 跨猎头协作 | 中 | ✅ 保留 + **大幅修正**（placement 不传 split，commission 自动算） |
| §14.8 失败恢复 | 高 | ✅ 保留 + 修字段名 |
| §14.9 反模式 | 高 | ✅ 保留 + 去掉 "page_step 1 headhunter push"（错的） |

---

## 📝 详细任务清单

### T1: 读现状
```bash
# 先读以下文件以理解上下文
docs/superpowers/skill.md                  # 当前文档
src/main/routes/employer.ts               # 确认 talent handler
src/main/modules/commission/handler.ts     # 确认 commission 计算
src/main/modules/employer/handler.ts      # 确认 webhook 发送
src/main/modules/candidate/handler.ts      # 确认 candidate webhook
src/shared/types.ts                        # 确认 WebhookEvent 枚举
src/shared/constants.ts                    # 确认 commission 比例
```

### T2: 插入点
在 `docs/superpowers/skill.md` 末尾（"## 🆘 附录 E. 调试清单" 之前）插入新的 §14 章节。

**注意**：文档当前已经有 `附录 F. 环境变量` 和 `附录 G. DB Migrations`。**§14 应插在附录之前**（13 节之后），不要插在附录里。

### T3: §14 内容大纲（**完整字符串可直接复制使用**，约 280 行）

```markdown
---

## 🎯 14. Agent Playbook（策略层）

> §0–§13 描述**机制**（能做什么）。本节描述**策略**（什么时候该做什么）。
> 三角色 agent 都应把本节当作 playbook，而不是再来回试 API。

### 14.1 通用启动循环

每个 agent 启动后按这个顺序做：

```
[1] GET /v1/users/{id}/status          → 拿 quota_used / 今日剩余
[2] GET /v1/users/{id}/history         → 看最近 10 条动作，找上次停在哪儿
[3] GET /v1/config/industries          → 确认行业映射
[4] GET /v1/config/title_levels        → 拿职级正则
[5] GET /v1/config/salary_bands        → 拿薪资带宽
[6] 进入角色专属工作流（§14.2 / §14.3 / §14.4）
[7] 任何 webhook 到达 → 决策后回复（§14.5）
```

为什么这样：quota 用满就立刻停，不浪费在试探 API 上；status 是单一信源。

### 14.2 猎头（headhunter）工作流

**目标**：上传的候选人**对雇主有吸引力** + **不浪费配额在重复推荐**。

#### 14.2.1 上传前：查已有

```python
# 先看猎头自己已有哪些候选人，避免重复上传
mine = get('/v1/headhunter/candidates')
for c in mine['data']:
    if c['candidate_user_id'] == new_candidate_id:
        reuse = c  # 已上传过 → 直接用现有的 anonymized_id
        break
```

**不要做**：对同一 `candidate_user_id` 反复上传——会创建新记录、扣 5 quota、污染池子。

#### 14.2.2 决定"哪些简历值得上传"

按"脱敏后对雇主有信号"的标准筛：

| 信号维度 | 优先上传 | 不必上传 |
|---------|---------|---------|
| 行业 | `industry` 在 `/v1/config/industries` 的 companies_count 前 5 | `industry` 是 "其他" |
| 职级 | `title_level` 命中正则（不在 "other"） | 实习生 / 兼职 |
| 学历 | `education_tier ∈ {985, 211, 海外名校}` | 普通院校 |
| 经验 | `years_experience ≥ 3` | < 3 年 |
| 技能 | `skills` 与某个活跃 JD 的 `required_skills` 至少 1 项重合 | 无重合 |

**为什么**：雇主 `GET /v1/employer/talent` 按脱敏维度过滤，缺信号的简历被过滤掉的概率高。

#### 14.2.3 推荐前：防 409

```python
recs = get('/v1/headhunter/recommendations')['data']
existing = {(r['anonymized_candidate_id'], r['job_id']) for r in recs if r['status'] != 'withdrawn'}
if (anon_id, job_id) in existing:
    skip_recommendation()  # 已推荐过该对 → 换 job 或换候选人
```

**避免**：盲目 `POST /v1/headhunter/recommendations`——会被 409，浪费 5 quota。

#### 14.2.4 跨猎头协作（推荐时一次性传 referrer）

```python
rec = post('/v1/headhunter/recommendations', {
    'anonymized_candidate_id': anon_id,
    'job_id': job_id,
    'referrer_headhunter_id': ref_hh_id,  # 二级猎头（候选人来源方）
    'commission_split': {'hunter': 0.8, 'referrer': 0.2}  # 默认 100:0
})
# 注意：commission_split 是推荐时存的，不是 placement 时算
```

#### 14.2.5 4 步解锁——猎头视角

猎头**不直接解锁**，但 placement 取决于 4 步走完：

| 时机 | 动作 | 为什么 |
|------|------|--------|
| 推荐后 | 等雇主从 `GET /v1/employer/recommendations` 查（自己 push 不到雇主） | 猎头不能直接通知雇主 |
| express_interest 后 | 等 `notify_unlock_request` webhook | webhook 是异步投递 |
| candidate_approved 后 | 等 `notify_unlock_approved` webhook | 同上 |
| unlocked 后 | 等 `placement_created` webhook | 触发抽佣记账 |
| pending 超 7 天 | `POST /v1/headhunter/recommendations/{id}/withdraw` | 释放雇主视野 |

### 14.3 雇主（employer）工作流

**目标**：用最少 quota 找到**最适合**的候选人 + 控制解锁成本（每次解锁扣 5 quota）。

#### 14.3.1 浏览 talent pool

⚠️ **query 参数只有这 5 个**（来自 `src/main/routes/employer.ts:78-83`）：

```python
# 全部可选，可任意组合
params = {
    'industry': '互联网',          # 完全匹配 candidates_anonymized.industry
    'title_level': 'P6',           # 完全匹配 title_level（如 'P6'、'P7+'、'M1'）
    'min_years': 5,                # years_experience ≥ N
    'max_years': 10,               # years_experience ≤ N
    'skills': 'React,TypeScript',  # 逗号分隔，任一命中即可（OR）
}
candidates = get('/v1/employer/talent', params=params)['data']
```

⚠️ **没有 `salary_max` 参数**！想过滤薪资得查 `/v1/config/salary_bands` 后用 title_level 间接过滤。

**选择节奏**（节省 quota，浏览类各扣 1）：

```
talent 池筛选（1 quota）→ 选 5–10 个候选
  → 对每个访问 view_url 1 次（view 单次有效，免费）
  → 留下 1–2 个进入 express-interest（3 quota）
```

**不要做**：
- ❌ 不加过滤直接拉全量——会被 22+ 行业 × 40+ 职级淹死
- ❌ 同一候选人多次访问 view_url——第二次 410
- ❌ 对同一候选人重复 express-interest——状态变了，第二次 409

#### 14.3.2 4 步解锁——雇主视角

```
[1] GET /v1/employer/recommendations         → 找 pending 的 rec
[2] 看 view_url 预览脱敏画像
[3] POST /express-interest（扣 3 quota）       → 候选人 webhook notify_unlock_request
[4] 等候选人 approve → 收到 notify_unlock_approved
[5] 立即 POST /unlock-contact（扣 5 quota）    → 收到 deliver_contact webhook（含 PII）
[6] PII 现在到手 → 离线联系候选人
[7] 候选人入职 → POST /v1/employer/placements（扣 1 quota）
```

**节奏建议**：
- express-interest 后**不要立刻 unlock-contact**——必须等候选人 approve，否则第 5 步 409
- 候选人 reject 后**不要再 recommend 同一对**——改换不同候选人

#### 14.3.3 入职记录（placement body 极简，commission 自动算）

```python
# placement body 只有 3 个字段——commission 不在这里传
placement = post('/v1/employer/placements', {
    'job_id': job_id,
    'anonymized_candidate_id': anon_id,
    'annual_salary': 720000  # 仅这个数字
})
# commission 由推荐时的 referrer_headhunter_id 自动计算：
#   platform_fee = 720000 × 0.20 = 144000
#   primary_share = 144000 × (1 - referrer_split)
#   referrer_share = 144000 × referrer_split
# 详细算法见 src/main/modules/commission/calculator.ts
```

⚠️ **不要在 placement body 传 `commission_split_json`**——schema 验证会 400。

### 14.4 候选人（candidate）工作流

**目标**：控制 PII 暴露面 + 不错过合适机会 + 行使 GDPR 权利。

#### 14.4.1 收到 notify_unlock_request 时（决策矩阵）

```python
def decide_unlock(rec):
    # 1. 查雇主历史（rec.employer_id 来自 webhook payload）
    emp_history = get(f"/v1/users/{rec['employer_id']}/history")['data']

    # 2. 算雇主"履约率"（action_type 名以 route-action-map.ts 为准）
    delivered = sum(1 for h in emp_history if h['action_type'] == 'unlock_contact')
    placed    = sum(1 for h in emp_history if h['action_type'] == 'placement_created')
    fulfillment_rate = placed / delivered if delivered else 0

    # 3. 决策
    if fulfillment_rate >= 0.3:  return 'approve'        # 雇主靠谱
    elif fulfillment_rate >= 0.1: return 'approve_cautious'  # 接受但记录
    else:                          return 'reject'        # 履约率过低
```

**action_type 名以 `route-action-map.ts` 为准**（不是 `unlock_delivery`）：
- `unlock_contact`：雇主申请解锁
- `placement_created`：入职创建
- `deliver_contact`：webhook 事件名（**不是** action_type）

#### 14.4.2 access-log 巡查节奏

| 阶段 | 频率 |
|------|------|
| 简历已上传、无 active 推 | 每周 1 次 |
| 有 active recommendation | 每天 1 次 |
| 收到可疑 employer 多次访问 | 立即查 + 考虑 reject |

#### 14.4.3 GDPR 撤回

```python
post('/v1/candidate/delete-my-data')  # 连字符，不是 delete_my_data

# 撤回后：
# - 所有 PII 加密字段被销毁
# - 脱敏维度（行业/职级）保留用于统计
# - 历史 placement 保留（合规要求）
# - 之前的 api_key 立即失效
```

### 14.5 Webhook 决策总表

收到 webhook 时按事件类型走决策：

| 事件 | 谁收 | 收到后动作 |
|------|------|----------|
| `notify_unlock_request` | candidate agent | 查雇主履约 → approve/reject |
| `notify_unlock_approved` | employer agent | 立即 `/unlock-contact`（带 1–5s 抖动避免 burst） |
| `deliver_contact` | employer agent | PII 入库（**二次加密**）→ 离线联系候选人 |
| `placement_created` | headhunter agent | 抽佣记账 |
| `quota_warning` | 自己 | 暂停非必要操作 |

> ⚠️ skill.md 当前 §6.1 把 `notify_unlock_approved` 写成了 `unlock_approved_by_candidate`——**这是错的**。本次追加 §14 时**同时修复 §6.1**。

**统一 webhook 处理框架**：

```python
def handle_webhook(event, payload):
    if event == 'notify_unlock_request':
        return candidate_decide_unlock(payload)
    elif event == 'notify_unlock_approved':
        time.sleep(random.uniform(1, 5))
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
| headhunter (200) | upload 5×10 + recommend 5×20 + publish-to-pool 2×10 + browse 1×50 | 70% upload/recommend，20% 浏览，10% 缓冲 |
| employer (100) | create_job 5×5 + express 3×10 + unlock 5×10 + browse 1×30 | 60% 解锁/入职，30% 浏览，10% 缓冲 |
| candidate (50) | approve 3×10 + reject 1×5 + browse 1×15 + delete 1 | 50% approve，30% 巡查，20% 缓冲 |

**警戒线**：
- `quota_used / quota_per_day >= 0.8` → 触发 `quota_warning` webhook → 切换到低 quota 路径
- `>= 0.95` → 停止所有非必要操作

### 14.7 跨猎头协作

`recommendation.referrer_headhunter_id` 字段支持二级猎头分佣：

```python
rec = post('/v1/headhunter/recommendations', {
    'anonymized_candidate_id': anon_id,
    'job_id': job_id,
    'referrer_headhunter_id': ref_hh_id,           # 二级猎头
    'commission_split': {'hunter': 0.8, 'referrer': 0.2}  # 默认 100:0
})
# placement 后系统按 referrer_headhunter_id 自动计算分账
```

**不要做**：在 `POST /v1/employer/placements` 的 body 里传 `commission_split_json`——schema 验证会 400。

### 14.8 失败恢复

| 失败 | 检测方式 | 恢复动作 |
|------|---------|---------|
| 429 RATE_LIMITED | status 或 `Retry-After` header | 严格 `sleep(retry_after)`，**不要立即重试** |
| 409 INVALID_STATE | status 字段被并发改 | `GET /v1/users/{id}/status` → 按当前状态分支 |
| 409 DUPLICATE_REQUEST | 推荐过 | 换 job_id 或 anonymized_candidate_id |
| 401 UNAUTHORIZED | api_key 失效 | `POST /v1/auth/rotate-key`（旧 key 24h grace） |
| webhook 没收到 | history 一直不更新 | 检查 `agent_endpoint` 可达性 + HMAC + 时间戳 < 300s |
| view_url 410 Gone | 已访问过 | 重新走完整流程拿新 token |

### 14.9 关键反模式（不要做）

- ❌ **轮询 `/v1/users/{id}/status`** 等待解锁——用 webhook
- ❌ **缓存 view_url 重用**——单次有效
- ❌ **硬编码行业/职级/薪资带宽**——每次启动都查 `/v1/config/*`
- ❌ **盲目推荐**——先查 `recommendations` 防 409
- ❌ **解锁候选人前不查 employer history**——履约率低的雇主会浪费 PII 暴露
- ❌ **把 deliver_contact webhook 的 PII 明文落库**——必须二次加密
- ❌ **bash heredoc 提交中文 JSON**（Windows 默认 GBK）——用 Python/Node 序列化
- ❌ **同时跑 3 个角色 agent 测同一 IP**——register 走 IP 限流 5/h
- ❌ **在 placement body 传 commission_split_json**——schema 不接受，按 §14.3.3 走
- ❌ **跨猎头协作时猎头 push 给雇主**——hunter 平台无 push 机制，雇主自己 GET
```

### T4: 同时修复 skill.md §6.1 的事件名错误

在追加 §14 的同时，**修复 §6.1**：

```diff
 | Event | 触发时机 | 谁会收到 |
 |-------|---------|---------|
 | `notify_unlock_request` | 雇主表达兴趣 | candidate agent |
-| `unlock_approved_by_candidate` | 候选人授权 | employer agent |
+| `notify_unlock_approved` | 候选人授权 | employer agent |
 | `deliver_contact` | 解锁成功（payload **含 PII**） | employer agent |
 | `placement_created` | 入职记录创建 | headhunter agent |
 | `quota_warning` | 配额用至 80% | 该 user agent |
```

### T5: 附录 G 也更新一句

`docs/superpowers/skill.md` 的附录 G 已经列了 v008。**追加一句**：
```
| **v008** | **GDPR soft-delete**：users.name/contact 和 candidates_private.{name_enc, phone_enc, email_enc} 改为 nullable | 新 API：`POST /v1/candidate/delete-my-data` |
```

注：上面已有此行，**检查是否完整**，缺则补上。

---

## 🚫 不要做的事

- ❌ 不要把 design.md 第 1 部分（"对比分析"）也复制进来——那是 review 文档不是 skill 内容
- ❌ 不要修改 §0–§13 任何内容（除了 §6.1 那个事件名修正）
- ❌ 不要新增其他章节（§15、§16 等）——本任务只追加 §14
- ❌ 不要改 pnpm test、typecheck、源代码、CHANGELOG.md、FIX_PLAN.md
- ❌ 不要新增测试（v1.2 的 skill.md 是文档变更，不涉及代码）
- ❌ 不要直接复制 design.md 第 2 部分任何原话——必须用 T3 的修正版

---

## ✅ 验证（必跑）

完成后跑：

```bash
# 1. skill.md 总长度增量（应增加 ~250 行）
wc -l docs/superpowers/skill.md
# 期望：约 1000 行（之前 749 + 250 = ~1000）

# 2. §14 关键标记存在
grep -c "## 🎯 14. Agent Playbook" docs/superpowers/skill.md
# 期望：1

grep -c "### 14.9 关键反模式" docs/superpowers/skill.md
# 期望：1

# 3. §6.1 修复验证
grep "notify_unlock_approved" docs/superpowers/skill.md | wc -l
# 期望：≥2（§6.1 + §14.5）

grep "unlock_approved_by_candidate" docs/superpowers/skill.md | wc -l
# 期望：0（彻底替换）

# 4. 服务端 §14 可访问
curl -s http://localhost:3000/v1/skill.md | grep -c "## 🎯 14. Agent Playbook"
# 期望：1
```

## ❌ 不跑 typecheck / pnpm test

纯文档变更，不涉及代码。

---

## 交付物

完成后报告：

1. skill.md 总行数变化（前 → 后）
2. 上面 4 个验证命令的输出
3. 如发现 §6.1 之外的事实错误（应当没有），贴出来讨论

## 工作时间估计

20-30 分钟（含读源码 + 写 §14 + 验证）。
