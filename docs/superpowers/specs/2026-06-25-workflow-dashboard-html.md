# Workflow Terminal-State Dashboard HTML — Design Spec

**Date:** 2026-06-25  
**Status:** Draft (awaiting sign-off)  
**Author:** AI-assisted design (from user requirements)  
**Related:** `docs/superpowers/skill.md` §7 (existing view_url mechanism)

---

## 1. Goal

当外部 AI Agent 完成的操作达到 **工作流终态** 或 **任务里程碑** 时，Hunter Platform 在响应里附带 `dashboard_url`，Agent 把链接展示给最终用户。用户点击后看到一份视觉化 HTML 报告（不是 JSON），理解"任务完成 / 下一步建议"。

**关键设计约束**：
- ❌ 不是每步操作后都生成（仅终态 + 关键里程碑）
- ✅ 复用现有 view_url 机制（同一 `view_tokens` 表、同一 `/view/<type>/<id>?t=...` URL 形式）
- ✅ 服务端渲染 HTML（不是客户端 JS），开箱即用
- ✅ 多角色适配（候选人不应看到雇主视角，反之亦然）

---

## 2. Background：现有 view_url 机制回顾

通过分析 `src/main/modules/view/*`，现有机制：

| 组件 | 文件 | 职责 |
|------|------|------|
| `view_tokens` 表 | `src/main/db/migrations/v004_view_tokens.sql` | 存 token / user_id / view_type / view_id / expires_at |
| `view_type` 枚举 | `src/main/modules/view/route-view-map.ts:1` | `'candidate' \| 'recommendation' \| 'user-quota' \| 'audit'` |
| `ROUTE_VIEW_MAP` | `route-view-map.ts:9-26` | HTTP 路由 → view_type + JSONPath |
| `injector.ts` | `injector.ts:40-105` | 拦截 `res.json`，在 2xx 响应 `data` 里注入 `view_url` |
| `views-endpoint.ts` | `views-endpoint.ts:18-75` | 显式 POST `/v1/views/audit/:user_id` 等按需签发 |
| `handler.ts` | `handler.ts:37-77` | 路由 `/view/<type>/<id>?t=...`，按 type 拉数据、渲染模板、返回 HTML |
| 模板 | `templates/{candidate,recommendation,user-quota,audit,error}.js` | 5 个现有模板 |
| Token 属性 | `generate.ts:4` | 32 字节 hex / **7 天 TTL** / **多次有效**（commit 70573e9） |

**关键发现**：view_url 体系已经完整且稳定。本次扩展是 **新增 view_type 值 + 新增模板**，不动现有机制。

---

## 3. Design

### 3.1 触发场景（哪些操作产生 dashboard_url）

按"终态 vs 里程碑 vs 任务完成"分级：

#### Tier 1 — 工作流终态（最高优先级，必须有）

| 触发操作 | 终态 | dashboard_type | dashboard_url 含义 |
|---------|------|---------------|-------------------|
| `POST /v1/employer/placements` (当 `recommendation.status=unlocked`) | `placed` | `terminal-placed` | 🎉 候选人入职成功，佣金已记账 |
| `POST /v1/employer/recommendations/{id}/unlock-contact` | `unlocked` | `terminal-unlocked` | 🔓 联系方式已解密（解锁完成） |
| `POST /v1/candidate/recommendations/{id}/reject-unlock` | `rejected_candidate` | `terminal-rejected-candidate` | ❌ 候选人拒绝 |
| `POST /v1/employer/recommendations/{id}/express-interest` 后 employer 撤回（待实现，目前无 endpoint） | `rejected_employer` | `terminal-rejected-employer` | ⛔ 雇主关闭 |
| `POST /v1/headhunter/recommendations/{id}/withdraw` | `withdrawn` | `terminal-withdrawn` | ↩️ 猎头撤回 |
| `POST /v1/employer/jobs/{id}/claim` 后 job 进入 `filled`（待业务逻辑确认） | `filled` | `terminal-job-filled` | ✅ 职位招满 |
| `POST /v1/employer/jobs/{id}/reject` | `closed` | `terminal-job-closed` | 🚫 职位关闭 |

#### Tier 2 — 任务里程碑（应该有）

| 触发操作 | dashboard_type | dashboard_url 含义 |
|---------|---------------|-------------------|
| `POST /v1/auth/register` | `milestone-welcome` | 👋 欢迎 + API key 安全提示 |
| `POST /v1/auth/rotate-key` | `milestone-key-rotated` | 🔑 API key 已轮换（旧 key 失效） |
| `POST /v1/candidate/delete-my-data` | `milestone-gdpr-deleted` | 🗑️ GDPR 数据已清除 |
| `POST /v1/employer/placements` (when status was 'pending', not via recommendation) | `milestone-placement-created` | 📋 Placement 记录已创建 |
| `POST /v1/admin/placements/{id}/mark-paid` | `milestone-placement-paid` | 💰 佣金已标记到账 |
| `POST /v1/admin/placements/{id}/cancel` | `milestone-placement-cancelled` | ❌ Placement 已取消 |

#### Tier 3 — 软警告（可选，先不做）

- 配额 80% 警告（当前通过 webhook 推送）
- 跨猎头协作失败

**本 spec 范围**：Tier 1 + Tier 2 共 **13 个 dashboard_type**。

---

### 3.2 字段命名：复用 `view_url` 还是新加 `dashboard_url`？

**结论**：**新增 `dashboard_url` 字段**，与 `view_url` 并存。

理由：
| 选项 | 优点 | 缺点 |
|------|------|------|
| 复用 `view_url` | API 表面更小 | Agent 无法区分"原始资源查看" vs "完成庆祝页"；skill.md 要写模糊规则 |
| **新增 `dashboard_url`** | 语义清晰；Agent 看到 `dashboard_url` 就是"任务完成展示给用户" | 多一个字段 |

**Agent 规则**（写到 skill.md）：
> - 响应里有 `view_url`：可选展示（原始资源查看）
> - 响应里有 `dashboard_url`：**必须**在终端输出末尾展示（任务完成总结）

### 3.3 URL 形式

**复用** `/view/<view_type>/<view_id>?t=<token>` 路径，**只是 `view_type` 值不同**：

```
现有 view_url：  /view/recommendation/rec_xxx?t=abc...
新 dashboard_url：/view/terminal-placed/pl_xxx?t=abc...
```

Handler 接到新 view_type → 走新模板 → 返回 HTML。无需新路由。

### 3.4 数据模型

**复用 `view_tokens` 表**，无需新迁移。`view_type` 字段新增值即可：
```
view_type = 'terminal-placed' | 'terminal-unlocked' | ... | 'milestone-welcome' | ...
```

`view_id` 字段含义：
- `terminal-*` → 通常是 `placement.id` / `recommendation.id` / `job.id`
- `milestone-*` → 视情况而定（如 `milestone-key-rotated` 用 `user.id`）

---

## 4. HTML 模板设计

### 4.1 设计原则

| 原则 | 理由 |
|------|------|
| **服务端完整渲染**（不是客户端 SPA） | Agent 不依赖 JS；用户双击即可看 |
| **响应式 + 移动友好** | 用户可能在手机上看 |
| **暗色模式友好**（prefers-color-scheme） | 现代浏览器自动支持 |
| **打印样式**（@media print） | 方便存档 / 截图分享 |
| **中文优先 + 英文 fallback** | 项目用户多为中文，但 i18n 留给 v2 |
| **不引入 JS 框架** | 纯 HTML + CSS；如有图表用 inline SVG |
| **不使用外链字体/图标**（emoji 替代） | 离线可用，7 天 TTL 内可靠展示 |

### 4.2 通用模板骨架

所有 dashboard 共享：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{title}} — Hunter Platform</title>
  <style>
    :root {
      --bg: #fafafa; --fg: #1a1a1a; --muted: #6b7280;
      --primary: #4f46e5; --success: #10b981; --danger: #ef4444; --warning: #f59e0b;
      --card: #ffffff; --border: #e5e7eb;
    }
    @media (prefers-color-scheme: dark) {
      :root { --bg:#0a0a0a; --fg:#f3f4f6; --muted:#9ca3af; --card:#1f1f1f; --border:#374151; }
    }
    @media print { body { background: white; } .no-print { display: none; } }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
           max-width: 720px; margin: 0 auto; padding: 24px 16px; background: var(--bg); color: var(--fg); line-height: 1.6; }
    .hero { background: linear-gradient(135deg, var(--primary), #7c3aed); color: white;
            padding: 32px 24px; border-radius: 12px; margin-bottom: 24px; }
    .hero h1 { margin: 0 0 8px; font-size: 28px; }
    .hero p { margin: 0; opacity: 0.9; }
    .card { background: var(--card); border: 1px solid var(--border);
            border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    .card h2 { margin: 0 0 12px; font-size: 14px; color: var(--muted);
               text-transform: uppercase; letter-spacing: 0.05em; }
    .stat { display: flex; justify-content: space-between; padding: 8px 0;
            border-bottom: 1px solid var(--border); }
    .stat:last-child { border-bottom: none; }
    .stat-label { color: var(--muted); }
    .stat-value { font-weight: 600; text-align: right; max-width: 60%; }
    .next-steps { background: #eff6ff; border-left: 4px solid var(--primary);
                  padding: 16px; border-radius: 4px; margin-top: 16px; }
    @media (prefers-color-scheme: dark) { .next-steps { background: #1e3a8a33; } }
    .next-steps h3 { margin: 0 0 8px; color: var(--primary); font-size: 15px; }
    .next-steps ul { margin: 0; padding-left: 20px; }
    footer { text-align: center; color: var(--muted); margin-top: 32px; font-size: 13px; }
    a { color: var(--primary); }
  </style>
</head>
<body>
  {{hero}}
  {{cards}}
  {{next_steps}}
  <footer class="no-print">
    Hunter Platform · 本链接 7 天内多次有效 · 过期请重新发起操作
  </footer>
</body>
</html>
```

### 4.3 各 dashboard_type 内容设计

#### `terminal-placed`（最常用的成功页面）

```html
<section class="hero">
  <h1>🎉 候选人入职成功</h1>
  <p>推荐流程已闭环，佣金自动记账</p>
</section>

<div class="card">
  <h2>💰 佣金分账</h2>
  <div class="stat"><span class="stat-label">平台抽佣 (20%)</span><span class="stat-value">¥{{platform_fee}}</span></div>
  <div class="stat"><span class="stat-label">主猎头 ({{primary_split*100}}%)</span><span class="stat-value">¥{{primary_share}}</span></div>
  {{#if referrer_split}}
  <div class="stat"><span class="stat-label">分账猎头 ({{referrer_split*100}}%)</span><span class="stat-value">¥{{referrer_share}}</span></div>
  {{/if}}
</div>

<div class="card">
  <h2>📋 入职详情</h2>
  <div class="stat"><span class="stat-label">候选人</span><span class="stat-value">{{candidate_anonymized_id}}</span></div>
  <div class="stat"><span class="stat-label">职位</span><span class="stat-value">{{job_title}}</span></div>
  <div class="stat"><span class="stat-label">年薪</span><span class="stat-value">¥{{annual_salary}}</span></div>
  <div class="stat"><span class="stat-label">入职时间</span><span class="stat-value">{{created_at}}</span></div>
</div>

<div class="next-steps">
  <h3>📌 下一步</h3>
  <ul>
    <li>等待 admin 标记佣金到账（<code>POST /v1/admin/placements/:id/mark-paid</code>）</li>
    <li>查看完整时间线：<code>GET /v1/users/{{user_id}}/history</code></li>
    <li>跟踪所有 placement：<code>GET /v1/employer/placements</code></li>
  </ul>
</div>
```

#### `terminal-unlocked`（解锁完成）

```html
<section class="hero">
  <h1>🔓 联系方式已解密</h1>
  <p>PII 通过 webhook 投递；本页面仅展示状态</p>
</section>

<div class="card">
  <h2>👤 解锁信息</h2>
  <div class="stat"><span class="stat-label">候选人</span><span class="stat-value">{{anonymized_candidate_id}}</span></div>
  <div class="stat"><span class="stat-label">推荐 ID</span><span class="stat-value">{{recommendation_id}}</span></div>
  <div class="stat"><span class="stat-label">解锁时间</span><span class="stat-value">{{unlocked_at}}</span></div>
</div>

<div class="next-steps">
  <h3>📞 PII 在哪里？</h3>
  <ul>
    <li>平台通过 <code>deliver_contact</code> webhook 投递到你的 agent_endpoint</li>
    <li>检查 HMAC 签名（<code>X-Hunter-Signature</code>）+ 时间戳（<300s 偏移）</li>
    <li>注意：response body 里**不包含** PII——这是设计如此</li>
  </ul>
</div>
```

#### `terminal-rejected-candidate`（候选人拒绝）

```html
<section class="hero" style="background: linear-gradient(135deg, #ef4444, #b91c1c);">
  <h1>❌ 候选人拒绝解锁</h1>
  <p>同一 (候选人, job) 对不能再 recommend，需换候选人或换 job</p>
</section>

<div class="card">
  <h2>📋 拒绝详情</h2>
  <div class="stat"><span class="stat-label">推荐 ID</span><span class="stat-value">{{recommendation_id}}</span></div>
  <div class="stat"><span class="stat-label">拒绝时间</span><span class="stat-value">{{rejected_at}}</span></div>
</div>

<div class="next-steps">
  <h3>🔄 你可以</h3>
  <ul>
    <li>推荐**其他候选人**到这个 job</li>
    <li>把这个候选人推荐到**其他 job**</li>
    <li>查询雇主历史履约：<code>GET /v1/users/{{employer_id}}/history</code></li>
  </ul>
</div>
```

#### `milestone-welcome`（注册成功）

```html
<section class="hero">
  <h1>👋 欢迎加入 Hunter Platform</h1>
  <p>你的账号已创建</p>
</section>

<div class="card">
  <h2>🔑 API Key（重要）</h2>
  <div class="stat"><span class="stat-label">user_id</span><span class="stat-value">{{user_id}}</span></div>
  <div class="stat"><span class="stat-label">role</span><span class="stat-value">{{user_type}}</span></div>
</div>

<div class="next-steps" style="background: #fef3c7; border-left-color: #f59e0b;">
  <h3 style="color: #92400e;">⚠️ 立即保存你的 API Key</h3>
  <ul>
    <li>API key 只在注册时返回**一次**</li>
    <li>丢失后只能 <code>POST /v1/auth/rotate-key</code> 轮换（旧 key 立即失效）</li>
    <li>建议存到密钥管理器（如 1Password / Vault）</li>
  </ul>
</div>
```

#### `milestone-key-rotated`（API key 轮换）

类似 `milestone-welcome`，但强调旧 key 失效 + 提供新 key。

#### `milestone-gdpr-deleted`（GDPR 删除）

强调 PII 已清除 + 脱敏维度保留 + 历史 placement 不变。

#### `milestone-placement-created` / `paid` / `cancelled`

placement 视角的状态变更页，类似 `terminal-placed` 但更轻量。

---

## 5. API Changes

### 5.1 `view_type` 扩展

**文件**: `src/main/modules/view/route-view-map.ts`

```typescript
export type ViewType =
  | 'candidate' | 'recommendation' | 'user-quota' | 'audit'  // existing
  // Tier 1 - workflow terminals
  | 'terminal-placed' | 'terminal-unlocked'
  | 'terminal-rejected-candidate' | 'terminal-rejected-employer'
  | 'terminal-withdrawn'
  | 'terminal-job-filled' | 'terminal-job-closed'
  // Tier 2 - milestones
  | 'milestone-welcome' | 'milestone-key-rotated'
  | 'milestone-gdpr-deleted'
  | 'milestone-placement-created' | 'milestone-placement-paid'
  | 'milestone-placement-cancelled';
```

### 5.2 `ROUTE_VIEW_MAP` 新增条目

```typescript
export const ROUTE_VIEW_MAP: Record<string, ViewMapping> = {
  // ... existing entries ...

  // Tier 1 - workflow terminals
  'POST /v1/employer/recommendations/{id}/unlock-contact': {
    type: 'terminal-unlocked', idFrom: 'params.id',
    dashboardField: 'dashboard_url',  // <-- NEW
  },
  'POST /v1/candidate/recommendations/{id}/reject-unlock': {
    type: 'terminal-rejected-candidate', idFrom: 'params.id',
    dashboardField: 'dashboard_url',
  },
  'POST /v1/headhunter/recommendations/{id}/withdraw': {
    type: 'terminal-withdrawn', idFrom: 'params.id',
    dashboardField: 'dashboard_url',
  },
  'POST /v1/employer/jobs/{id}/reject': {
    type: 'terminal-job-closed', idFrom: 'params.id',
    dashboardField: 'dashboard_url',
  },
  // POST /placements 走的是 placement_repo.create 后的状态机，
  // 不在 ROUTE_VIEW_MAP 直接加；handler 内部根据 rec.status 决定注入 terminal-placed

  // Tier 2 - milestones
  'POST /v1/auth/register':           { type: 'milestone-welcome', idFrom: 'data.id', dashboardField: 'dashboard_url' },
  'POST /v1/auth/rotate-key':         { type: 'milestone-key-rotated', idFrom: 'data.id', dashboardField: 'dashboard_url' },
  'POST /v1/candidate/delete-my-data':{ type: 'milestone-gdpr-deleted', idFrom: 'params.id', dashboardField: 'dashboard_url' },
  'POST /v1/admin/placements/{id}/mark-paid': { type: 'milestone-placement-paid', idFrom: 'params.id', dashboardField: 'dashboard_url' },
  'POST /v1/admin/placements/{id}/cancel':    { type: 'milestone-placement-cancelled', idFrom: 'params.id', dashboardField: 'dashboard_url' },
};
```

**ViewMapping 扩展**：加一个可选字段 `dashboardField?: 'view_url' | 'dashboard_url'`（默认 `'view_url'`，保持向后兼容）。

### 5.3 `injector.ts` 扩展

`findMapping` 拿到 mapping 后，按 `mapping.dashboardField` 决定注入字段名：

```typescript
const fieldName = mapping.dashboardField ?? 'view_url';
(b.data as Record<string, unknown>)[fieldName] = url;
```

### 5.4 `handler.ts` 扩展

新增 switch case，每个 dashboard_type 对应一个 template render：

```typescript
switch (viewType) {
  // ... existing ...
  case 'terminal-placed': {
    const data = await sources.getPlacementForTerminalPlaced(id);
    if (!data) resourceMissing = true; else html = renderTerminalPlaced(data);
    break;
  }
  case 'terminal-unlocked': { /* ... */ }
  // ... 11 more cases
}
```

### 5.5 `ViewDataSources` 扩展

`handler.ts:11-16` 接口新增方法：

```typescript
export interface ViewDataSources {
  // ... existing ...
  // Tier 1
  getPlacementForTerminalPlaced(placementId: string): Promise<TerminalPlacedData | null>;
  getRecommendationForTerminalUnlocked(recId: string): Promise<TerminalUnlockedData | null>;
  getRecommendationForTerminalRejected(recId: string): Promise<TerminalRejectedData | null>;
  getRecommendationForTerminalWithdrawn(recId: string): Promise<TerminalWithdrawnData | null>;
  getJobForTerminalClosed(jobId: string): Promise<TerminalJobClosedData | null>;
  // Tier 2
  getUserForMilestoneWelcome(userId: string): Promise<MilestoneWelcomeData | null>;
  getUserForMilestoneKeyRotated(userId: string): Promise<MilestoneKeyRotatedData | null>;
  getUserForMilestoneGdprDeleted(userId: string): Promise<MilestoneGdprDeletedData | null>;
  getPlacementForMilestonePaid(placementId: string): Promise<MilestonePlacementPaidData | null>;
  getPlacementForMilestoneCancelled(placementId: string): Promise<MilestonePlacementCancelledData | null>;
}
```

每个方法从相应 repo 拉数据，组装成 template 需要的形状。

### 5.6 `templates/` 目录新增 11 个文件

- `templates/terminal-placed.js`
- `templates/terminal-unlocked.js`
- `templates/terminal-rejected-candidate.js`
- `templates/terminal-rejected-employer.js`（预留）
- `templates/terminal-withdrawn.js`
- `templates/terminal-job-filled.js`（预留）
- `templates/terminal-job-closed.js`
- `templates/milestone-welcome.js`
- `templates/milestone-key-rotated.js`
- `templates/milestone-gdpr-deleted.js`
- `templates/milestone-placement-created.js`
- `templates/milestone-placement-paid.js`
- `templates/milestone-placement-cancelled.js`

每个文件 export `render<DataType>(data): string` 函数。

### 5.7 无 schema 变更

- 无新数据库 migration（复用 `view_tokens` 表）
- 无新 HTTP 端点（复用 `/view/<type>/<id>?t=...`）
- 仅有 1 个新字段 `dashboardField` 在 ViewMapping 上（TypeScript 内部）

---

## 6. Skill.md Changes

### 6.1 新章节 `## 🖥️ 工作流 Dashboard`

插入到 §7 (view_url) 之后，作为 §7.5 或独立 §8。

```markdown
## 🖥️ 工作流 Dashboard（终态可视化）

完成关键工作流后，响应里会带 `dashboard_url` 字段：

```json
{
  "ok": true,
  "data": {
    "placement_id": "pl_xxx",
    "status": "placed",
    "dashboard_url": "https://qing3.top/view/terminal-placed/pl_xxx?t=abc..."
  }
}
```

Agent 应在终端输出**末尾**展示（不要塞进消息流）：

> ✅ 候选人入职成功！  
> 📊 完整报告：[查看 Dashboard](https://qing3.top/view/terminal-placed/pl_xxx?t=abc...)（7 天内多次有效）

### 触发条件

响应里出现 `dashboard_url` 时（Tier 1 + Tier 2）：

| 触发操作 | dashboard 类型 | 何时展示 |
|---------|---------------|---------|
| `POST /v1/auth/register` | `milestone-welcome` | ✅ 注册后必展示 |
| `POST /v1/auth/rotate-key` | `milestone-key-rotated` | ✅ 轮换后展示 |
| `POST /v1/candidate/delete-my-data` | `milestone-gdpr-deleted` | ✅ GDPR 删除后展示 |
| `POST /v1/employer/recommendations/{id}/unlock-contact` | `terminal-unlocked` | ✅ 解锁成功展示 |
| `POST /v1/candidate/recommendations/{id}/reject-unlock` | `terminal-rejected-candidate` | ✅ 候选人拒绝后展示 |
| `POST /v1/headhunter/recommendations/{id}/withdraw` | `terminal-withdrawn` | ✅ 撤回后展示 |
| `POST /v1/employer/jobs/{id}/reject` | `terminal-job-closed` | ✅ 关闭后展示 |
| `POST /v1/admin/placements/{id}/mark-paid` | `milestone-placement-paid` | ✅ 标记到账后展示 |
| `POST /v1/admin/placements/{id}/cancel` | `milestone-placement-cancelled` | ✅ 取消后展示 |
| `POST /v1/employer/placements`（自动导致 rec→placed）| `terminal-placed` | ✅ 入职成功后展示 |

### 不要做

- ❌ 把 `dashboard_url` 缓存或重复访问（虽然 7 天多次有效，但不要做"周期性刷新"）
- ❌ 把 `view_url` 和 `dashboard_url` 混淆（前者是"原始资源查看"，后者是"任务完成展示"）
- ❌ 在 GET 类响应里预期 `dashboard_url`（只读操作不触发）
- ❌ 用 webhook 投递 `dashboard_url`（用户已经主动调了 API，webhook 是异步链路）
- ❌ 在消息**正文**中嵌入 dashboard 内容（应保持链接，让用户决定何时打开）
```

### 6.2 §7 view_url 段落更新

加一句区分：

```markdown
> 💡 `view_url` 与 `dashboard_url` 的区别：
> - `view_url` → 原始资源查看（如候选人脱敏画像、推荐详情）。Agent 可选展示。
> - `dashboard_url` → 任务完成总结（如入职成功、解锁完成）。**Agent 必须**展示给用户。
```

---

## 7. Test Strategy

### 7.1 Unit tests

- `tests/unit/view/terminal-placed-template.test.ts` — snapshot test 模板输出
- `tests/unit/view/milestone-welcome-template.test.ts`
- ... 11 个模板对应 11 个 snapshot test
- `tests/unit/view/route-view-map.test.ts` — 验证所有新 view_type 注册

### 7.2 Integration tests

- `tests/integration/view/dashboard-injection.test.ts`
  - 注册账号 → 响应含 `dashboard_url` 字段（`milestone-welcome`）
  - 解锁推荐 → 响应含 `dashboard_url` 字段（`terminal-unlocked`）
  - 拒绝解锁 → 响应含 `dashboard_url` 字段（`terminal-rejected-candidate`）
  - 验证 token 写入 `view_tokens` 表
- `tests/integration/view/dashboard-endpoint.test.ts`
  - `GET /view/terminal-placed/pl_xxx?t=valid` → 200 + HTML
  - `GET /view/terminal-placed/pl_xxx?t=invalid` → 410
  - `GET /view/terminal-placed/pl_xxx?t=expired` → 410
  - `GET /view/terminal-placed/pl_xxx`（无 token） → 400
  - 多次访问同一 token → 都返回 200（多次有效）

### 7.3 E2E / Conformance tests

- 在 `tests/integration/skill-md-conformance/` 加 scenario：
  - "External agent registers then opens welcome dashboard" → 注册 → 抓 `dashboard_url` → 访问 → 验证 HTML 含"欢迎"
  - "External agent places candidate then opens placed dashboard" → 走完 4 步解锁 + placement → 验证 `dashboard_url`

### 7.4 视觉验证（手动）

- 浏览器打开各 dashboard，截图，验证移动端 / 暗色模式 / 打印样式
- 验证中文显示正确（避免字体回退导致乱码）

---

## 8. Out of Scope

明确**不做**的（避免范围蔓延）：

| 项目 | 原因 |
|------|------|
| Tier 3 软警告 dashboard（quota warning 等） | 已有 webhook 通道；dashboard 是用户主动操作的反馈，软警告走异步更合适 |
| 多语言 i18n | 中英混排已够；i18n 留 v2 |
| 客户端 JS 框架（React/Vue） | 服务端渲染满足需求；引入框架增加维护成本 |
| 数据导出（PDF / CSV） | 浏览器打印即可；CSV 走 API 不在 HTML 范围内 |
| 个性化主题（用户自定义颜色） | 服务端模板；定制化留 v2 |
| 实时数据（WebSocket / SSE 推送） | 7 天多次有效已够；实时性不是核心需求 |
| 把现有 `view_url` 改为 `dashboard_url` | 破坏向后兼容；保持两套共存 |

---

## 9. Migration / Backward Compatibility

### 9.1 向后兼容

- ✅ 现有 `view_url` 行为不变
- ✅ 现有 view_type 模板不变
- ✅ 现有 `/view/<type>/<id>?t=...` 路由不变
- ✅ 现有 `view_tokens` 表 schema 不变
- ✅ 现有 `/v1/views/*` 显式签发端点不变

唯一新增：**响应里多一个可选字段 `dashboard_url`**。Agent / 客户端忽略它即可。

### 9.2 回滚策略

- 改 `route-view-map.ts`：注释掉新增条目即可停发 `dashboard_url`
- 改 `handler.ts`：在 switch 里 default → 404，不渲染未知类型
- 模板文件可保留（无副作用）；只在测试失败时再删

### 9.3 数据库迁移

无。复用 `view_tokens` 表。如果未来 dashboard 需要保存静态快照（如终态详情快照），再加 migration。

---

## 10. Effort Estimate

| 模块 | 工作量 | 说明 |
|------|--------|------|
| route-view-map.ts 扩展 | 1h | 新 view_type + 新条目 |
| injector.ts 扩展 | 1h | 支持 `dashboardField` |
| handler.ts 扩展 | 2h | switch case + ViewDataSources |
| ViewDataSources 实现（11 个方法）| 3h | 拉数据 + 组装 |
| 11 个模板 | 6h | HTML + CSS；可借助 base.html 抽取 |
| Skill.md 更新 | 2h | §7.5 + §7 view_url 段落 |
| Unit tests（13 个 snapshot）| 2h | vitest snapshot |
| Integration tests（dashboard-injection + dashboard-endpoint）| 3h | vitest |
| Conformance scenarios | 2h | skill-md-conformance 加 2-3 个 case |
| 视觉验证 + 微调 | 2h | 浏览器 / 暗色 / 打印 |
| **总计** | **~24h** | **约 3 个工作日** |

风险：
- **中**：模板风格统一（11 个文件易风格漂移）→ 解决方案：先写 `templates/base.js` 抽取公共骨架
- **低**：schema 不变，回滚容易
- **低**：与现有 `view_url` 系统共存，无破坏性

---

## 11. Open Questions

需要在 sign-off 前确认：

1. **dashboard_url vs view_url 双字段**：用户已认同 `dashboard_url` 新字段。✅ 已决定
2. **Tier 3 软警告是否纳入**：本 spec 排除，建议下个迭代单独 spec。✅ 决定排除
3. **是否支持客户端 locale（语言切换）**：本 spec 排除，仅中文。✅ 决定排除
4. **是否需要在 dashboard 里展示 trace_id**：建议加（用户报错时方便反馈）。确认是否接受？
5. **模板是否需要包含数据来源链接**（"查看原始 API 响应"）：建议加 `<details>` 折叠。确认是否接受？

---

## 12. Sign-off Checklist

- [ ] Tier 1 + Tier 2 共 13 个 dashboard_type 列表确认
- [ ] `dashboard_url` 字段命名确认
- [ ] HTML 模板风格（hero + card + next-steps）确认
- [ ] Skill.md 新章节位置（§7.5 vs §8）确认
- [ ] Open Questions 4 + 5 已答
- [ ] 工作量预算（~24h）确认

---

## Appendix A. 文件结构总览

### 新增文件（11 个）

```
src/main/modules/view/
├── sources/
│   ├── terminal-sources.ts            # getPlacementForTerminalPlaced 等 5 个
│   └── milestone-sources.ts           # getUserForMilestoneWelcome 等 6 个
├── templates/
│   ├── base.js                        # 公共骨架（hero/card/next-steps）
│   ├── terminal-placed.js
│   ├── terminal-unlocked.js
│   ├── terminal-rejected-candidate.js
│   ├── terminal-rejected-employer.js
│   ├── terminal-withdrawn.js
│   ├── terminal-job-filled.js
│   ├── terminal-job-closed.js
│   ├── milestone-welcome.js
│   ├── milestone-key-rotated.js
│   ├── milestone-gdpr-deleted.js
│   ├── milestone-placement-created.js
│   ├── milestone-placement-paid.js
│   └── milestone-placement-cancelled.js

tests/
├── unit/view/
│   ├── templates/                     # 13 个 snapshot test
│   └── route-view-map.test.ts
└── integration/view/
    ├── dashboard-injection.test.ts
    └── dashboard-endpoint.test.ts

tests/integration/skill-md-conformance/
├── scenario-register-then-welcome-dashboard.test.ts
├── scenario-unlock-then-terminal-dashboard.test.ts
└── scenario-place-then-terminal-placed-dashboard.test.ts
```

### 修改文件（5 个）

```
src/main/modules/view/
├── route-view-map.ts          # +13 view_type + +13 ROUTE_VIEW_MAP 条目 + dashboardField 字段
├── injector.ts                # 支持 dashboardField 决定字段名
├── handler.ts                 # +13 switch case + ViewDataSources 接口扩展
└── generate.ts                # ViewType 类型扩展（如果集中类型）

docs/superpowers/skill.md     # +§7.5 章节（约 80 行）+ §7 view_url 段落补一句
```

### 未变更

```
src/main/db/migrations/*       # 无新 migration
src/main/server.ts             # 不需改（/view/* 路由已注册所有 type）
src/main/modules/view/view-token-repo.ts  # schema 不变
src/main/modules/view/views-endpoint.ts   # 不需改
```

---

## Appendix B. 示例 HTML 输出（`terminal-placed`）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>候选人入职成功 — Hunter Platform</title>
  <style>
    :root {
      --bg: #fafafa; --fg: #1a1a1a; --muted: #6b7280;
      --primary: #4f46e5;
      --card: #ffffff; --border: #e5e7eb;
    }
    @media (prefers-color-scheme: dark) {
      :root { --bg:#0a0a0a; --fg:#f3f4f6; --muted:#9ca3af; --card:#1f1f1f; --border:#374151; }
    }
    body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
           max-width: 720px; margin: 0 auto; padding: 24px 16px;
           background: var(--bg); color: var(--fg); line-height: 1.6; }
    .hero { background: linear-gradient(135deg, var(--primary), #7c3aed); color: white;
            padding: 32px 24px; border-radius: 12px; margin-bottom: 24px; }
    .hero h1 { margin: 0 0 8px; font-size: 28px; }
    .hero p { margin: 0; opacity: 0.9; }
    .card { background: var(--card); border: 1px solid var(--border);
            border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    .card h2 { margin: 0 0 12px; font-size: 14px; color: var(--muted);
               text-transform: uppercase; letter-spacing: 0.05em; }
    .stat { display: flex; justify-content: space-between; padding: 8px 0;
            border-bottom: 1px solid var(--border); }
    .stat:last-child { border-bottom: none; }
    .stat-label { color: var(--muted); }
    .stat-value { font-weight: 600; }
    .next-steps { background: #eff6ff; border-left: 4px solid var(--primary);
                  padding: 16px; border-radius: 4px; margin-top: 16px; }
    .next-steps h3 { margin: 0 0 8px; color: var(--primary); }
    .next-steps ul { margin: 0; padding-left: 20px; }
    footer { text-align: center; color: var(--muted); margin-top: 32px; font-size: 13px; }
  </style>
</head>
<body>
  <section class="hero">
    <h1>🎉 候选人入职成功</h1>
    <p>推荐流程已闭环，佣金自动记账</p>
  </section>

  <div class="card">
    <h2>💰 佣金分账</h2>
    <div class="stat"><span class="stat-label">平台抽佣 (20%)</span><span class="stat-value">¥12,000</span></div>
    <div class="stat"><span class="stat-label">主猎头 (80%)</span><span class="stat-value">¥48,000</span></div>
    <div class="stat"><span class="stat-label">分账猎头 (20%)</span><span class="stat-value">¥12,000</span></div>
  </div>

  <div class="card">
    <h2>📋 入职详情</h2>
    <div class="stat"><span class="stat-label">候选人</span><span class="stat-value">ca_a1b2c3d4</span></div>
    <div class="stat"><span class="stat-label">职位</span><span class="stat-value">高级前端工程师</span></div>
    <div class="stat"><span class="stat-label">年薪</span><span class="stat-value">¥600,000</span></div>
    <div class="stat"><span class="stat-label">入职时间</span><span class="stat-value">2026-06-25 14:32:11</span></div>
  </div>

  <div class="next-steps">
    <h3>📌 下一步</h3>
    <ul>
      <li>等待 admin 标记佣金到账（<code>POST /v1/admin/placements/pl_xxx/mark-paid</code>）</li>
      <li>查看完整时间线：<code>GET /v1/users/u_xxx/history</code></li>
      <li>跟踪所有 placement：<code>GET /v1/employer/placements</code></li>
    </ul>
  </div>

  <footer>
    Hunter Platform · 本链接 7 天内多次有效 · 过期请重新发起操作
  </footer>
</body>
</html>
```

---

## Appendix C. 参考 commit 模式

参考 `d91727f fix(docs): Agent onboarding P0 issues (5 fixes)` 风格，建议提交粒度：

```
1. feat(view): extend ViewType with terminal-* and milestone-* values
2. feat(view): add dashboardField to ViewMapping; support dual-injection
3. feat(view): add sources/ for terminal + milestone data fetching
4. feat(view): add 13 dashboard templates with shared base
5. feat(view): wire dashboard templates into handler switch
6. docs(skill): add §7.5 Workflow Dashboard section
7. test(view): add snapshot tests for 13 templates
8. test(integration): add dashboard-injection + dashboard-endpoint tests
9. test(conformance): add 3 scenarios covering welcome/unlock/placed dashboards
```