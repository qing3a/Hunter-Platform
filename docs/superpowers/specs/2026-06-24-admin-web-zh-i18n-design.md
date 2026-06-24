# Hunter Platform — Admin Web 中文化设计 (zh-CN)

> **For agentic workers:** 这是 design spec，配套 implementation plan 在 `docs/superpowers/plans/2026-06-24-admin-web-zh-i18n-plan.md`。

**Goal:** 把 `admin-web/` 所有用户可见的英文 UI 字符串硬编码改成中文,让管理员以母语使用,无需理解英文术语。同时把当前 working tree 中的路由修复一起 commit(避免半成品滞留)。

**Architecture:** 不引入 i18n 库、不重构组件结构、不动 CSS。直接替换字符串字面量。`StatusBadge` 加一个 `STATUS_LABELS` 映射表把 API 返回的英文 status 值翻译成中文展示。`format.ts` 的 `relativeTime` 函数返回中文格式。`index.html` 改 `<html lang>` 和 `<title>`。

**Tech Stack:** 现有 React 18 + react-router-dom v6 + TypeScript,无新依赖。`pnpm test` 跑 vitest 验证。

---

## 1. 背景与动机

### 1.1 为什么需要中文化

admin-web 是平台管理员后台,目前所有 UI 都是英文:
- 5 个页面(Dashboard / Users / Candidates / Audit / Profile)
- 1 个登录页
- 9 个组件(Layout / Pagination / SearchBar / Table / MetricCard / StatusBadge / AuditJsonDrawer / AuditDiffView / PrivateRoute)
- 1 个 utility(`format.ts` 的 `relativeTime`)
- 1 个 HTML 入口

管理员(用户本人)反映看英文很费劲,需要不停对照术语,降低操作效率和准确性。

### 1.2 设计原则

- **零依赖、零重构**:不引入 `react-i18next` 等 i18n 库,不动组件结构,不改 CSS,不重命名 prop
- **覆盖完整**:所有用户可见英文都翻,不留半中半英
- **后端不变**:数据库 / API 字段 / status 枚举值不动,仅前端展示时翻译
- **可回滚**:一个 commit,revert 即恢复英文

### 1.3 非目标

- ❌ 引入 i18n 库 / 多语言切换
- ❌ 改动 API 返回值或后端 schema
- ❌ 改动路由 path(`/users` 仍是英文,basename `/admin` 不动)
- ❌ 重构组件 prop 命名 / 文件结构
- ❌ 本地化日期数字格式(后端返回 ISO 8601 字符串直接展示,不调 `toLocaleString`)

---

## 2. 翻译范围与术语对照

### 2.1 导航 / 品牌 / 通用 UI

| EN | 中文 |
|---|---|
| Hunter Admin (品牌名) | 猎头管理后台 |
| Hunter Platform Admin (登录页标题) | 猎头中介管理后台 |
| Dashboard | 仪表盘 |
| Users | 用户 |
| Candidates | 候选人 |
| Audit | 审计 |
| Profile | 我的 |
| Logout | 退出登录 |
| Email | 邮箱 |
| Password | 密码 |
| Sign in | 登录 |
| Signing in... | 登录中... |
| Loading... | 加载中... |
| No data | 暂无数据 |
| Close | 关闭 |
| Search | 搜索 |
| Search... (placeholder) | 搜索... |
| {label}: all (过滤项默认) | 全部 |

### 2.2 列表头 / 表单 label

| EN | 中文 |
|---|---|
| ID | ID |
| Name | 姓名 |
| Email | 邮箱 |
| Role | 角色 |
| Status | 状态 |
| Quota | 配额 |
| Created / Created At | 创建时间 |
| Source | 来源 |
| Time | 时间 |
| Actor | 操作人 |
| Action | 操作 |
| Target | 目标 |
| Reason | 原因 |
| User | 用户 |
| Capability | 能力 |
| Duration | 耗时 |
| Admin | 管理员 |
| Success | 结果 |
| IP | IP |

### 2.3 Dashboard 指标卡 + 区块标题

| EN | 中文 |
|---|---|
| Total Users | 用户总数 |
| Total Candidates | 候选人总数 |
| Today New Users | 今日新增用户 |
| vs prior days in trend below | 下方趋势图显示每日对比 |
| Open Placements | 进行中的合作 |
| User Growth — Last 30 Days | 用户增长 — 最近 30 天 |
| 30 days ago | 30 天前 |
| today | 今天 |
| More Stats | 更多统计 |
| Total Jobs | 职位总数 |
| Open Jobs | 开放职位 |
| Daily Quota Used | 今日已用配额 |
| Webhook Dead Letters | Webhook 死信 |

### 2.4 过滤项 options

| EN (Users 角色) | 中文 |
|---|---|
| Candidate | 候选人 |
| Headhunter | 猎头 |
| Employer | 雇主 |

| EN (Users 状态) | 中文 |
|---|---|
| Active | 正常 |
| Suspended | 已暂停 |
| Deleted | 已删除 |

| EN (Candidates 状态) | 中文 |
|---|---|
| Pending | 待处理 |
| Unlocked | 已解锁 |
| Locked | 已锁定 |

### 2.5 Audit 页

| EN | 中文 |
|---|---|
| Admin Actions | 管理员操作 |
| User Actions | 用户操作 |
| Login Events | 登录事件 |
| All events | 全部事件 |
| Success only | 仅成功 |
| Failure only | 仅失败 |
| Search by actor email/id... | 按操作人邮箱/ID 搜索... |
| No admin actions recorded | 暂无管理员操作记录 |
| No user actions recorded | 暂无用户操作记录 |
| No login events recorded | 暂无登录事件记录 |

### 2.6 Profile 页

| EN | 中文 |
|---|---|
| ID: | ID: |
| Email: | 邮箱: |
| Role: | 角色: |
| Status: | 状态: |
| Created: | 创建时间: |
| API Key | API 密钥 |
| ⚠️ Rotate will invalidate the current key. | ⚠️ 轮换将使当前密钥失效。 |
| Rotate API Key | 轮换 API 密钥 |
| New key: | 新密钥: |
| Rotate API key? Current key will be invalidated. | 确认轮换 API 密钥?当前密钥将失效。 |
| API key rotated. New key saved to localStorage. | API 密钥已轮换。新密钥已保存到 localStorage。 |
| Failed: | 失败: |

### 2.7 Pagination

| EN | 中文 |
|---|---|
| Showing X-Y of N | 显示 X-Y 共 N 条 |
| ← Prev | 上一页 |
| Next → | 下一页 |
| Page N | 第 N 页 |

### 2.8 relativeTime(format.ts)

| EN | 中文 |
|---|---|
| just now | 刚刚 |
| in the future | 未来 |
| {n}m ago | {n} 分钟前 |
| {n}h ago | {n} 小时前 |
| {n}d ago | {n} 天前 |
| {n}mo ago | {n} 个月前 |
| {n}y ago | {n} 年前 |

---

## 3. StatusBadge 状态映射

`STATUS_LABELS` 加在 `src/components/StatusBadge.tsx` 内部(`const STATUS_LABELS: Record<string, string> = { ... }`)。组件渲染时先 `STATUS_LABELS[lower(value)] ?? value`。

| value (from API) | 中文 | 颜色 (沿用现有) |
|---|---|---|
| active | 正常 | 绿 |
| suspended | 已暂停 | 黄 |
| deleted | 已删除 | 灰 |
| success | 成功 | 绿 |
| error | 失败 | 红 |
| pending | 待处理 | 黄 |
| pending_payment | 待支付 | 黄 |
| in_pool | 候选池中 | 蓝 |
| paid | 已支付 | 绿 |
| unlocked | 已解锁 | 绿 |
| locked | 已锁定 | 红 |
| (其他) | 原样显示 | (按 default 颜色) |

颜色逻辑(green/yellow/red/gray/blue)保留现有,仅改文字。

---

## 4. 文件改动清单

### 4.1 源代码(14 个文件 + 1 个 HTML)

1. `admin-web/index.html` — `<html lang="zh-CN">` + `<title>猎头中介管理后台</title>`
2. `admin-web/src/components/Layout.tsx` — brand + 5 nav + Logout
3. `admin-web/src/components/Pagination.tsx` — 4 strings
4. `admin-web/src/components/SearchBar.tsx` — 按钮 + placeholder 默认
5. `admin-web/src/components/Table.tsx` — Loading + No data 默认
6. `admin-web/src/components/AuditJsonDrawer.tsx` — Close
7. `admin-web/src/components/StatusBadge.tsx` — 加 STATUS_LABELS 表
8. `admin-web/src/lib/format.ts` — relativeTime 7 个分支
9. `admin-web/src/pages/LoginPage.tsx` — 4 strings
10. `admin-web/src/pages/DashboardPage.tsx` — 8 metric labels + 2 h2 + 副标题
11. `admin-web/src/pages/UsersPage.tsx` — 标题 + placeholder + 过滤 + 列头 + 空态
12. `admin-web/src/pages/CandidatesPage.tsx` — 同上
13. `admin-web/src/pages/AuditPage.tsx` — 标题 + 3 tab + 3 sub-table strings
14. `admin-web/src/pages/ProfilePage.tsx` — 标题 + 5 label + API Key section + confirm/alert

### 4.2 测试断言(3 个文件)

| 文件 | 改动 |
|---|---|
| `admin-web/tests/lib/format.test.ts` | relativeTime 期望值改中文 |
| `admin-web/tests/components/UsersList.test.tsx` | `'Next →'` / `'Page 1'` / `Showing 1-20 of 47` 改中文 |
| `admin-web/tests/components/CandidatesList.test.tsx` | 同上 |

其他 test 文件(`Audit*` / `api/*`)断言的字符串是 prop 传入或在 mock data 里,不需要改。

---

## 5. 不改的东西

- **API 路径**:`/v1/admin/...` 保持不变
- **路由 path**:`/users` / `/candidates` / `/audit` / `/profile` / `/login` 保持不变
- **basename**:`/admin` 保持不变
- **API 字段名**:`user_type` / `status` / `action_type` 等保持英文(后端不变)
- **数据库 status 枚举**:不动,仅前端展示翻译
- **CSS / 样式**:`styles.css` 完全不动
- **依赖**:`package.json` 不动
- **TypeScript 类型**:不动

---

## 6. 验收

1. `cd admin-web && pnpm test` → **41/41 tests pass**
2. `pnpm build` → 构建成功(无 type error)
3. 浏览器手动验证(已运行):
   - 登录页 → 中文
   - Dashboard → 8 个指标中文 + 图表 label 中文
   - Users / Candidates / Audit / Profile → 全中文
   - StatusBadge 显示中文(对至少一个已知状态值的 row 验证)
4. 路由切换正常(吸收上次路由 bug 修复一起提交)
5. `git log` 看到此 spec 对应的 1 个 commit

---

## 7. 流程

1. 从 main 拉新分支:`feature/admin-web-zh-i18n`
2. 在新分支上:
   - 把当前 working tree 中的路由修复 stash 暂存(可选,直接在新分支继续也行)
   - 应用本设计的所有改动
   - 1 个 commit:`feat(admin-web): 中文化所有用户可见 UI`
3. 跑 `pnpm test` 验证
4. **不部署**(只本地测试),等用户决定是否合并