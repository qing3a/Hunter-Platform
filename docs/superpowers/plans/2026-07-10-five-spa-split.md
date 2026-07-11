> ⚠️ **ARCHIVED — DO NOT IMPLEMENT** (2026-07-11)
>
> Superseded by commit `c41167d` "cleanup: cut portal redundancy (~29876 lines)".
> The 5-SPA → 2-SPA architecture described here was reversed in a further cut:
> app-web's PM/candidate/hunter portal code was removed because
> `C:\Users\Administrator\Desktop\ow-headhunter-sass` already provides the
> PM/HR/Candidate UI as a separate client.
>
> hunter-platform is now API + admin-web only. For the new direction, see
> `docs/superpowers/specs/2026-07-01-product-positioning-standard.md`.
>
> **Preserved for historical reference only.**
>
> ---

# 5-SPA Split & Blank-Page Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前单 SPA `admin-web`（5 角色路由）拆成 5 个独立 Vite SPA（admin / pm / employer / candidate / hunter），用 pnpm workspaces 共享公共代码；同步复现并固化 `/admin/login` 空白问题的回归测试；删除两份离线静态 landing HTML；以"服务端模板为单一来源"重建 `out/`。

**Architecture:**
- **Monorepo 化**：根 `package.json` 加 `workspaces`，新增 5 个 SPA 包 + 1 个共享包
- **共享包 `shared-web`**：API 客户端、QueryClient factory、ToastProvider、纯工具库（不依赖 React 路由）
- **每个 SPA 独立 base**：admin-web → `/admin`、pm-web → `/admin/pm`、employer-web → `/admin/employer`、candidate-web → `/candidate`、hunter-web → `/hunter`（**URL 保持不变**，仅拆构建）
- **API server 多 mount**：`src/main/server.ts` 把 5 个 `out/<spa>` 静态目录分别挂到对应 URL 前缀，未匹配的前缀走 SPA fallback
- **空白页根因诊断**：Playwright headless 抓 console + network 失败，建立 `/admin/login` 回归基线
- **landing 收敛**：删 `hunter-platform-landing/` 和 `hunter-platform-landing-draft/`；以 `src/main/modules/view/templates/landing/`（端口 3000 渲染的 SSR 首页）为唯一来源

**Tech Stack:**
- 现有：Node 22 / pnpm 9 / TypeScript 5.6 / Vite 5 / React 18 / React Router 6 / TanStack Query 5 / Vitest 2 / Express 4
- 新增：`@playwright/test`（仅 devDep，admin-web 内）

**Spec:** 无（refactor，不引入新业务能力）

---

## Context & Background

### 用户报告的入口问题
- 2026-07-10：用户在浏览器打开 `http://localhost:5174/admin/login` 看到**空白页**
- curl 验证：服务端返回 **HTTP 200**（670 字节），HTML 正确，script src 是 `/admin/src/main.tsx`（vite base 重写生效）
- 服务端没问题 → "空白"几乎确定是**浏览器缓存**（commit `d7d398c` 把 `/admin/` 改成 `/admin` 之前的旧 HTML 仍可能驻留）
- 但**没有真浏览器复现证据** → Phase 0 用 Playwright 抓出真因

### 现状清单（验证后）
| 项 | 状态 |
|---|---|
| `admin-web/` typecheck (`tsc --noEmit`) | ✅ exit 0 |
| `admin-web/` 单元测试 | ✅ 1070/1070 |
| `admin-web/` 5 角色 LoginPage 文件 | ✅ 全部存在（58–136 行） |
| `/admin/login` 直访 | ✅ HTTP 200，HTML 正确 |
| `/admin/src/main.tsx` 编译产物 | ✅ HTTP 200，3896 字节 |
| `/candidate/login` 直访 | ❌ **HTTP 404**（vite `base:'/admin'` 不覆盖顶层路径） |
| `/hunter/login` 直访 | ❌ **HTTP 404**（同上） |
| `out/admin/` 产物 | ❌ **不存在** |
| `out/main/` mtime | 2026-06-27（落后 109 次 commit） |
| `hunter-platform-landing/` 引用 | ❌ 0 源码引用、0 server mount、纯 `file://` 静态稿 |
| `hunter-platform-landing-draft/` 引用 | ❌ 同上，且为更早版本 |

### 决定
按用户 2026-07-10 的回答：写 Playwright 诊断 → 删两份静态 HTML → 拆 5 SPA → 改代码 + README + 重 build out/。

---

## File Structure (目标态)

### 新增 / 删除

```
# 顶层
+ pnpm-workspace.yaml                          # pnpm workspace 定义
~ package.json                                 # 增 workspaces、增 scripts
- hunter-platform-landing/                     # 整目录删除
- hunter-platform-landing-draft/               # 整目录删除

# 5 个新 SPA
+ admin-web/                                   # 已存在，重构（base 保持 /admin）
~ admin-web/package.json                       # workspace 协议、改 name
~ admin-web/vite.config.ts                     # base:/admin 不变；删 historyApiFallback 不需要
~ admin-web/src/App.tsx                        # 删 PM/employer 路由组
~ admin-web/src/main.tsx                       # 删 portal-only imports
~ admin-web/src/components/PrivateRoute.tsx    # 保留
~ admin-web/src/pages/                         # 保留 admin/* 全部；删 PM/employer/candidate/hunter 子目录
+ pm-web/                                      # 新建
  + package.json
  + vite.config.ts
  + tsconfig.json
  + vitest.config.ts
  + index.html
  + src/main.tsx
  + src/App.tsx
  + src/components/RequirePMAuth.tsx           # 从 admin-web 搬过来
  + src/components/pm-portal/PMMobileLayout.tsx
  + src/pages/pm-portal/*.tsx                  # 9 个页面从 admin-web 搬
  + tests/...
+ employer-web/                                # 类比 pm-web
+ candidate-web/                               # 类比；base:/candidate
+ hunter-web/                                  # 类比；base:/hunter

# 共享包
+ shared-web/
  + package.json
  + src/api/                                   # 从 admin-web/src/api 搬（按需拆）
  + src/lib/query-client.ts
  + src/lib/toast.tsx
  + src/lib/mask.ts
  + src/lib/api-error.ts
  + src/lib/storage.ts
  + src/styles/shared.css
  + tests/...
```

### 后端改动

```
~ src/main/server.ts                           # 增 4 个 express.static 挂载 + SPA fallback 路由
~ src/main/routes/landing.ts                   # 文档：landing 页由 SSR 模板出，不依赖静态 HTML
```

### 测试新增

```
+ admin-web/tests/e2e/admin-login.spec.ts      # Phase 0 起的 Playwright 诊断
+ admin-web/playwright.config.ts
~ admin-web/package.json                       # 增 @playwright/test
```

### 文档

```
~ README.md                                    # 改写启动章节、加 Web UI 章节、删"纯 API 模式"段落
+ docs/superpowers/CHANGELOG.md                # 记录 v?.?.? 拆分变更
```

---

## 13 个 Phase（执行顺序）

> **重要**：每个 Phase 都要保证 codebase 处于"可运行"状态——任何一个 Phase 失败，回滚到上一个 Phase 都不应破坏 API server（端口 3000）。

### Phase 0: Playwright 空白页诊断

**目标**：用真浏览器复现 `/admin/login` 空白，建立基线；不修代码，只取证。

**关键文件**：
- `admin-web/package.json` — 增 `@playwright/test`、`test:e2e` 脚本
- `admin-web/playwright.config.ts` — 新建
- `admin-web/tests/e2e/admin-login.spec.ts` — 新建

**Task 0.1: 装 Playwright + 装 chromium**

```bash
cd admin-web
pnpm add -D @playwright/test
npx playwright install chromium --with-deps
```

**Task 0.2: 写 playwright.config.ts**（根 `admin-web/`）

```typescript
// admin-web/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    headless: true,
  },
  webServer: {
    command: 'pnpm dev',
    port: 5174,
    timeout: 60_000,
    reuseExistingServer: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

**Task 0.3: 写空白页诊断测试**（`admin-web/tests/e2e/admin-login.spec.ts`）

```typescript
// admin-web/tests/e2e/admin-login.spec.ts
//
// Phase 0: Reproduce "blank /admin/login" report from 2026-07-10.
// Curl showed the dev server returns 200 with correct HTML — this test
// runs a real headless browser to surface console errors and network
// failures, plus assert the React tree actually renders content.
import { test, expect } from '@playwright/test';

test.describe('/admin/login (Phase 0 diagnostic)', () => {
  test('returns 200 with no console errors and non-empty root', async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const networkErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`);
    });
    page.on('response', (resp) => {
      if (resp.status() >= 400) {
        networkErrors.push(`${resp.status()} ${resp.url()}`);
      }
    });

    const response = await page.goto('/admin/login', { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);

    // The script tag must be present and the root must contain rendered React content
    const scriptSrc = await page.locator('script[src*="main.tsx"]').getAttribute('src');
    expect(scriptSrc).toMatch(/\/admin\/src\/main\.tsx/);

    // Give React time to mount (StrictMode double-render takes a tick)
    await page.waitForSelector('#root *', { timeout: 5000 }).catch(() => {});
    const rootHtml = (await page.locator('#root').innerHTML()).trim();

    // Diagnostic output — do NOT fail the test on these yet, just record them
    console.log('=== Phase 0 diagnostic output ===');
    console.log('Console errors:', consoleErrors);
    console.log('Failed requests:', failedRequests);
    console.log('Network 4xx/5xx:', networkErrors);
    console.log('Root innerHTML length:', rootHtml.length);
    console.log('Root innerHTML preview:', rootHtml.slice(0, 200));
    console.log('=== end diagnostic ===');

    // Hard asserts (these are the regression we'll keep):
    expect(networkErrors.filter((e) => e.includes('/admin/src/'))).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(rootHtml.length).toBeGreaterThan(50);  // actual React content, not just <div id="root"></div>
  });
});
```

**Task 0.4: 跑诊断**

```bash
cd admin-web
pnpm test:e2e
```

**预期输出**（保留为基线）：
- 测试 PASSED 或 FAILED（取决于用户浏览器当时的真实状态）
- 控制台打印 `Root innerHTML length:` 数值——这是关键证据
- 如果 length < 50：确认是空白问题，转 Phase 2.5 修 vite config
- 如果 length > 50：报告"用户问题已自愈"，**Phase 0 即终结**

**Task 0.5: 提交**

```bash
git add admin-web/playwright.config.ts admin-web/tests/e2e/ admin-web/package.json pnpm-lock.yaml
git commit -m "test(e2e): add Phase 0 Playwright diagnostic for /admin/login"
```

---

### Phase 1: 删除离线静态 landing HTML

**目标**：`hunter-platform-landing/` 和 `hunter-platform-landing-draft/` 整目录删除；以 `src/main/modules/view/templates/landing/` 为唯一来源。

**Task 1.1: 确认 0 引用**（再次确认 Phase 0 没动到）

```bash
cd D:/dev/hunter-platform
grep -r "hunter-platform-landing" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.mjs" --include="*.js" --include="*.html" --include="*.css" -l 2>/dev/null
```

**预期**：只匹配到两个目录自己的 `orchestration-summary.json`（目录删了就没了）。**如果有任何外部引用，先停下来问用户。**

**Task 1.2: 删目录**

```bash
cd D:/dev/hunter-platform
rm -rf hunter-platform-landing/
rm -rf hunter-platform-landing-draft/
```

**Task 1.3: 验证**

```bash
ls hunter-platform-landing 2>&1  # 应报 No such file
ls hunter-platform-landing-draft 2>&1  # 应报 No such file
```

**Task 1.4: 更新 README 删除相关引用**（也属于 Phase 1，因为删了目录后 README 还在引用就矛盾）

```bash
grep -n "hunter-platform-landing" README.md 2>&1
```

如果有 → 删掉对应行；否则跳过。

**Task 1.5: 提交**

```bash
git add -A
git commit -m "chore: remove offline static landing HTML drafts (server-side template is source of truth)"
```

---

### Phase 2: pnpm workspaces 初始化

**目标**：根 `package.json` 加 `workspaces`，新增 `pnpm-workspace.yaml`，保证 `pnpm install` 在 monorepo 模式下工作；现有 `admin-web` 加入 workspace 但暂不拆。

**关键文件**：
- `pnpm-workspace.yaml` — 新建
- `package.json` — 增 `workspaces` 字段
- `admin-web/package.json` — 不动（先保持现状进 workspace）

**Task 2.1: 写 pnpm-workspace.yaml**

```yaml
# pnpm-workspace.yaml
packages:
  - 'admin-web'
  - 'pm-web'
  - 'employer-web'
  - 'candidate-web'
  - 'hunter-web'
  - 'shared-web'
```

> **重要**：先把所有 5 个 SPA + shared-web 都在 workspace 里声明，即使文件还没建。`pnpm install` 在缺包时会报错，但 TypeScript 不会受影响。

**Task 2.2: 改根 package.json**

在 `package.json` 顶层加：
```json
{
  "workspaces": ["admin-web", "pm-web", "employer-web", "candidate-web", "hunter-web", "shared-web"]
}
```

并加根级脚本：
```json
{
  "scripts": {
    "build:web": "pnpm -r --filter './shared-web' --filter './admin-web' --filter './pm-web' --filter './employer-web' --filter './candidate-web' --filter './hunter-web' run build",
    "dev:web": "concurrently -n admin,pm,employer,candidate,hunter -c blue,magenta,green,cyan,yellow \"pnpm --filter admin-web dev\" \"pnpm --filter pm-web dev\" \"pnpm --filter employer-web dev\" \"pnpm --filter candidate-web dev\" \"pnpm --filter hunter-web dev\"",
    "test:web": "pnpm -r --filter './admin-web' --filter './pm-web' --filter './employer-web' --filter './candidate-web' --filter './hunter-web' --filter './shared-web' run test"
  }
}
```

**Task 2.3: 安装 concurrently**

```bash
pnpm add -D -w concurrently
```

**Task 2.4: 验证 workspace 识别**

```bash
pnpm -r list --depth -1 2>&1 | head -20
```

**预期**：当前应该只看到 `admin-web` 在 workspace 列表里（其他 5 个包还不存在，会被 pnpm 警告，但不会 break root install）。

**Task 2.5: 提交**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "build: initialize pnpm workspaces for 5-SPA split"
```

---

### Phase 3: 提取共享包 `shared-web`

**目标**：把 `admin-web/src/api/`、`admin-web/src/lib/toast.tsx`、`admin-web/src/lib/query-client.ts`（或对应文件）抽到 `shared-web/`，admin-web 改成 `import from '@hunter-platform/shared-web'`。

**关键文件**：
- `shared-web/package.json` — 新建
- `shared-web/tsconfig.json` — 新建
- `shared-web/src/api/*.ts` — 从 admin-web 搬
- `shared-web/src/lib/{toast,query-client,mask,api-error,storage}.ts` — 从 admin-web 搬
- `shared-web/src/styles/shared.css` — 从 admin-web 抽
- `admin-web/package.json` — 增 `shared-web: workspace:*`
- `admin-web/src/**` — 全量改 import 路径

**Task 3.1: 建 shared-web 包骨架**

`shared-web/package.json`：
```json
{
  "name": "@hunter-platform/shared-web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./api": "./src/api/index.ts",
    "./lib": "./src/lib/index.ts",
    "./styles": "./src/styles/shared.css"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.101.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "typescript": "^5.6.2",
    "vitest": "^2.1.0"
  }
}
```

`shared-web/tsconfig.json`：
```json
{
  "extends": "../admin-web/tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

**Task 3.2: 盘点 admin-web 当前可共享的代码**

```bash
ls admin-web/src/api/
ls admin-web/src/lib/
ls admin-web/src/hooks/   # 看是否有通用 hooks
```

> 实际清单要执行这一步时由 agent 现场确认。本计划给出原则：
> - 纯工具（无 React 组件、无路由）：全搬
> - 通用 hook（如 `useDebounce`）：搬
> - 含 React Router 的 hook（如 `useAuth` 走 `<Routes>` 上下文）：**不搬**，留给各 SPA 自己做
> - 含 portal 专有逻辑（`useCandidateSession` 等）：不搬

**Task 3.3: 复制 + 删源文件**

```bash
# 复制到 shared-web
mkdir -p shared-web/src/{api,lib,styles}
cp -r admin-web/src/api/* shared-web/src/api/
cp -r admin-web/src/lib/toast.tsx shared-web/src/lib/
cp -r admin-web/src/lib/mask.ts shared-web/src/lib/   # 如果存在
# ... 其他搬过来的文件

# 从 admin-web 删
rm admin-web/src/api/*.ts
# 注意：如果 admin-web/src/api/index.ts 还在用，需要先改完 import 再删
```

**Task 3.4: 写 shared-web/src/index.ts 桶导出**

```typescript
// shared-web/src/index.ts
export * from './api';
export * from './lib';
export { default as sharedCss } from './styles/shared.css?url';
```

**Task 3.5: 改 admin-web 全部 import**

```bash
# 全文替换 import 路径
# 从：from '../api/xxx'  或  from './api/xxx'
# 改：from '@hunter-platform/shared-web/api/xxx'
# 用 codemod 或 sed，但务必人工检查
```

**实际命令**（仅示例，agent 必须自己 review diff）：
```bash
# 这一步需要 subagent 自己挑，不能机械替换
# 建议：先跑 admin-web typecheck，看哪些 import 断了，再针对性改
cd admin-web
pnpm typecheck 2>&1 | tee /tmp/typecheck-before.txt
# 然后批量改，改完再跑
pnpm typecheck 2>&1 | tee /tmp/typecheck-after.txt
# 期望：diff 体现 import 路径变化，但 0 错误
```

**Task 3.6: 跑全测试**

```bash
cd admin-web
pnpm test      # 应全过
pnpm typecheck # 应 0 错误
```

**Task 3.7: 提交**

```bash
git add -A
git commit -m "refactor(shared-web): extract API client and shared libs into workspace package"
```

---

### Phase 4: 重构 admin-web（仅保留 admin 角色）

**目标**：把 `admin-web/src/App.tsx` 里的 PM/employer/candidate/hunter 路由组删掉，admin-web 退化为只服务 `/admin/*` 路径下的管理员角色。

**关键文件**：
- `admin-web/src/App.tsx` — 删 PM/employer/candidate/hunter imports 和路由
- `admin-web/src/main.tsx` — 删 portal-only imports
- `admin-web/src/pages/` — 删 `pm-portal/`、`employer-portal/`、`candidate-portal/`、`hunter-portal/` 4 个子目录
- `admin-web/src/components/` — 删 `pm-portal/`、`employer-portal/`、`candidate-portal/`、`hunter-portal/` 4 个子目录、删 `Require*Auth` 系列

**Task 4.1: 用 git mv 隔离要搬走的代码**（不要直接删——Phase 5-8 要用）

```bash
# 这只是逻辑隔离，物理位置待 Phase 5-8 搬
# 在 admin-web/src/App.tsx 里注释掉非 admin 路由组即可
```

**Task 4.2: 改 App.tsx 只保留 admin 路由**

`admin-web/src/App.tsx`：
```typescript
// 只保留这些 import + Routes
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
// ... 其他 admin 页面
import PrivateRoute from './components/PrivateRoute';
import { ToastProvider } from '@hunter-platform/shared-web/lib';
import Toast from './components/Toast';

function AdminApp() {
  return (
    <Routes>
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
      <Route path="/admin/" element={<Navigate to="/admin" replace />} />
      {/* ... 其他 admin/* 路由 */}
      <Route path="/admin/*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
      <Toast />
    </ToastProvider>
  );
}
```

**Task 4.3: 跑测试 + typecheck**

```bash
cd admin-web
pnpm test
pnpm typecheck
```

**预期**：admin-web 测试集从 1070 个缩到约 600 个（删了 PM/employer/candidate/hunter 相关）。

**Task 4.4: dev server 验证 /admin/login 仍可用**

```bash
cd admin-web
pnpm dev &
sleep 5
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:5174/admin/login
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:5174/candidate/login  # 应 404
# 停止 dev server
kill %1 2>/dev/null
```

**Task 4.5: 提交**

```bash
git add admin-web/
git commit -m "refactor(admin-web): remove PM/employer/candidate/hunter route groups"
```

> **此 Phase 之后**：admin-web 自给自足；PM/employer/candidate/hunter 的代码还在 admin-web/src/ 下等待 Phase 5-8 搬家。

---

### Phase 5–8: 创建 4 个新 SPA（pm-web / employer-web / candidate-web / hunter-web）

> **这是 4 个并行的 phase**。本计划为 4 个 SPA 给出**统一的脚手架**。每个 SPA 的实际页面代码从 `admin-web/src/pages/<portal>/` 用 `git mv` 搬过来。

#### 通用脚手架模板（每个 SPA 都按这个建）

**`{spa}/package.json`**（以 `pm-web` 为例）：
```json
{
  "name": "@hunter-platform/pm-web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@hunter-platform/shared-web": "workspace:*",
    "@tanstack/react-query": "^5.101.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.2",
    "vite": "^5.4.6",
    "vitest": "^2.1.0"
  }
}
```

**`{spa}/vite.config.ts`**（以 `pm-web` 为例，base 改 `/admin/pm`）：
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // PM Workbench mounts at /admin/pm/* (URL unchanged from current).
  base: '/admin/pm',
  build: {
    outDir: path.resolve(__dirname, '../out/pm'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5175,  // admin=5174, pm=5175, employer=5176, candidate=5177, hunter=5178
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/admin/pm': {
        target: 'http://localhost:5175',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/admin\/pm/, ''),
      },
    },
  },
});
```

**`{spa}/tsconfig.json`**（参考 admin-web）+ **`{spa}/index.html`**（参考 admin-web）。

**`{spa}/src/main.tsx`**（以 PM 为例）：
```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import '@hunter-platform/shared-web/styles';
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
      {/* baseURL 已经是 /admin/pm，BrowserRouter 不需要 basename */}
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
```

> **关键点**：因为 vite `base: '/admin/pm'`，index.html 里的 `<script src="/src/main.tsx">` 会被 vite 重写为 `/admin/pm/src/main.tsx`；BrowserRouter **不需要 basename**（因为我们访问的就是 `/admin/pm/login`，不是 `/login`）。
>
> 但这样有个问题：刷新页面时，浏览器会向 `http://localhost:5175/admin/pm/login` 发请求，**但 dev server 监听的是 5175 端口**，vite 需要知道 `/admin/pm/*` 应该返回 index.html。**Phase 5.1 末尾的 vite.config.ts 已经有 proxy rewrite 处理了**——5174 的请求被代理到 5175 时会被改写。

#### Phase 5: pm-web

**关键文件**：
- `pm-web/` 整目录新建（按通用脚手架）
- 从 `admin-web/src/pages/pm-portal/` → `pm-web/src/pages/pm-portal/`（git mv）
- 从 `admin-web/src/components/pm-portal/` → `pm-web/src/components/pm-portal/`（git mv）
- 从 `admin-web/src/components/pm-portal/RequirePMAuth.tsx` → `pm-web/src/components/RequirePMAuth.tsx`（扁平化）

**Task 5.1**: 按通用脚手架建 `pm-web/` 6 个配置文件
**Task 5.2**: `git mv admin-web/src/pages/pm-portal → pm-web/src/pages/pm-portal`
**Task 5.3**: `git mv admin-web/src/components/pm-portal → pm-web/src/components/pm-portal`
**Task 5.4**: 改 `pm-web/src/App.tsx`，把 routes 里 `/admin/pm/` 前缀去掉（因为现在 base 就是 `/admin/pm`）
**Task 5.5**: `pnpm --filter pm-web install`
**Task 5.6**: `pnpm --filter pm-web test` + `pnpm --filter pm-web typecheck`
**Task 5.7**: dev server 探活：`curl http://localhost:5175/admin/pm/login → 200`
**Task 5.8**: 提交

#### Phase 6: employer-web

类比 Phase 5，端口 5176，base `/admin/employer`。

#### Phase 7: candidate-web

类比 Phase 5，端口 5177，base `/candidate`，需要：
- 保留 `RequireAuth`（OTP session）
- 从 `admin-web/src/pages/candidate-portal/` 搬
- `BrowserRouter` 仍然不需要 basename（因为 base 是 `/candidate`）

#### Phase 8: hunter-web

类比 Phase 5，端口 5178，base `/hunter`。

> **Phase 5–8 的统一验收**：5 个 dev server 全部能起；5 个角色的 `/login` 页面都返回 200；admin-web 旧的 `/candidate/login` 等返回 404（这正是我们要的）。

---

### Phase 9: API server 多 SPA mount

**目标**：`src/main/server.ts` 在 5 个路径前缀下分别挂 5 个 `out/<spa>`，未匹配的路径走 SSR 或 404。

**关键文件**：
- `src/main/server.ts` — 改 SPA mount 逻辑

**Task 9.1: 当前 mount 现状**

```bash
grep -n "out/admin\|express.static\|SPA\|fallback" src/main/server.ts | head -20
```

**Task 9.2: 改 server.ts**（伪代码，agent 必须 review 实际 server.ts）

```typescript
// 假设原代码有：
// app.use('/admin', express.static('out/admin'));
// app.get('/admin/*', (req, res) => res.sendFile('out/admin/index.html'));

// 改为：
const spaMounts: Array<[prefix: string, dir: string]> = [
  ['/admin', 'out/admin'],
  ['/admin/pm', 'out/pm'],
  ['/admin/employer', 'out/employer'],
  ['/candidate', 'out/candidate'],
  ['/hunter', 'out/hunter'],
];

for (const [prefix, dir] of spaMounts) {
  // 重要：prefix 长的先 mount（避免 /admin 抢走 /admin/pm 的请求）
  app.use(prefix, express.static(dir, { fallthrough: true, index: 'index.html' }));
}

// SPA fallback —— 命中 SPA mount 前缀但 express.static 没找到文件时返回 index.html
app.get(['/admin', '/admin/*', '/candidate', '/candidate/*', '/hunter', '/hunter/*'], (req, res) => {
  // 按最长前缀匹配选 out 目录
  const match = spaMounts
    .filter(([p]) => req.path === p || req.path.startsWith(p + '/'))
    .sort((a, b) => b[0].length - a[0].length)[0];
  if (match) {
    res.sendFile(path.resolve(match[1], 'index.html'));
  } else {
    res.status(404).send('Not Found');
  }
});
```

**Task 9.3: 写集成测试**

`tests/integration/spa-mounts.test.ts`：起 API server，依次 `GET /admin/login`、`GET /admin/pm/login`、`GET /admin/employer/login`、`GET /candidate/login`、`GET /hunter/login`，断言都返回 200 + HTML。

**Task 9.4: 跑测试**

```bash
pnpm test tests/integration/spa-mounts.test.ts
```

**Task 9.5: 提交**

```bash
git add src/main/server.ts tests/integration/spa-mounts.test.ts
git commit -m "feat(server): mount 5 built SPAs at /admin /admin/pm /admin/employer /candidate /hunter"
```

---

### Phase 10: Playwright 覆盖 5 个 SPA

**目标**：把 Phase 0 的诊断扩成 5 个 SPA 都覆盖的回归套件。

**关键文件**：
- `admin-web/tests/e2e/multi-spa-smoke.spec.ts` — 新建（**注意：放在 admin-web/ 下还是放独立 e2e 包？本计划选 admin-web/**）
- 或者为每个 SPA 各自加 `tests/e2e/`，但脚本维护成本高

**Task 10.1: 写 multi-spa 冒烟测试**

`admin-web/tests/e2e/multi-spa-smoke.spec.ts`：
```typescript
import { test, expect } from '@playwright/test';

const SPA_ROUTES: Array<[name: string, devUrl: string]> = [
  ['admin',     'http://localhost:5174/admin/login'],
  ['pm',        'http://localhost:5175/admin/pm/login'],
  ['employer',  'http://localhost:5176/admin/employer/login'],
  ['candidate', 'http://localhost:5177/candidate/login'],
  ['hunter',    'http://localhost:5178/hunter/login'],
];

for (const [name, url] of SPA_ROUTES) {
  test(`${name} login page renders`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const response = await page.goto(url, { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);

    await page.waitForSelector('#root *', { timeout: 5000 });
    const rootHtml = (await page.locator('#root').innerHTML()).trim();
    expect(rootHtml.length).toBeGreaterThan(50);
    expect(consoleErrors).toEqual([]);
  });
}
```

**Task 10.2: 写 playwright 总配置**（让 webServer 启 5 个 dev server）

`admin-web/playwright.config.ts` 改为：
```typescript
webServer: [
  { command: 'pnpm --filter admin-web dev',     port: 5174, reuseExistingServer: true },
  { command: 'pnpm --filter pm-web dev',        port: 5175, reuseExistingServer: true },
  { command: 'pnpm --filter employer-web dev',  port: 5176, reuseExistingServer: true },
  { command: 'pnpm --filter candidate-web dev', port: 5177, reuseExistingServer: true },
  { command: 'pnpm --filter hunter-web dev',    port: 5178, reuseExistingServer: true },
],
```

**Task 10.3: 跑**

```bash
cd admin-web
pnpm test:e2e
```

**Task 10.4: 提交**

```bash
git add admin-web/tests/e2e/multi-spa-smoke.spec.ts admin-web/playwright.config.ts
git commit -m "test(e2e): add multi-SPA smoke covering all 5 login pages"
```

---

### Phase 11: 改写 README

**目标**：消除"纯 API 模式"段落与现实的矛盾；加 Web UI 章节说明 5 个 dev server。

**Task 11.1: 找到需要改的段落**

```bash
grep -n "纯 API\|无桌面客户端\|无 Electron" README.md
```

**Task 11.2: 替换为新版块**

`README.md` 改写：
- **删除** "**纯 API 模式**（v1.0+）—— 服务端只暴露 HTTP API，无桌面客户端、无 Electron" 这一行
- **新增** "## Web UI（可选）" 章节：

```markdown
## Web UI（可选）

平台为 5 类角色提供独立 React SPA，前端用 pnpm workspace 组织：

| SPA | dev 端口 | base 路径 | 启动 |
|---|---|---|---|
| admin-web     | 5174 | `/admin`           | `pnpm --filter admin-web dev` |
| pm-web        | 5175 | `/admin/pm`        | `pnpm --filter pm-web dev` |
| employer-web  | 5176 | `/admin/employer`  | `pnpm --filter employer-web dev` |
| candidate-web | 5177 | `/candidate`       | `pnpm --filter candidate-web dev` |
| hunter-web    | 5178 | `/hunter`          | `pnpm --filter hunter-web dev` |

或者一次性起全部：`pnpm dev:web`（concurrently）。

**生产部署**：API server 在 `src/main/server.ts` 把 `out/{admin,pm,employer,candidate,hunter}` 5 个构建产物分别挂到上述路径。详见 `tests/integration/spa-mounts.test.ts`。

**主要交互仍由 HTTP API 驱动**——Web UI 只是给真人用的运营面板，AI Agent 通过 `/v1/*` + `skill.md` 接入仍然是平台的主要用户形态。
```

**Task 11.3: 提交**

```bash
git add README.md
git commit -m "docs: rewrite README Web UI section to match 5-SPA reality"
```

---

### Phase 12: 重新 build out/

**目标**：`out/main/` 重建（基于最新 src/main），并新增 5 个 `out/<spa>/`。

**Task 12.1: 删旧 out/main**

```bash
rm -rf out/
```

**Task 12.2: 根 build**

```bash
pnpm build && pnpm build:web
```

**Task 12.3: 验证 5 个 out/ 目录都存在**

```bash
ls -d out/admin out/pm out/employer out/candidate out/hunter out/main 2>&1
```

**预期**：6 个目录都存在。

**Task 12.4: API server 跑起来 + 5 个 URL 全 200**

```bash
pnpm start &
sleep 5
for url in /admin/login /admin/pm/login /admin/employer/login /candidate/login /hunter/login; do
  curl -sS -o /dev/null -w "$url → HTTP %{http_code}\n" "http://localhost:3000$url"
done
kill %1 2>/dev/null
```

**预期**：5 行都是 `200`。

**Task 12.5: 提交**

```bash
git add out/  # 注意：如果 .gitignore 不忽略 out/，需要把构建产物提交
# 视团队策略：如果 out/ 是构建产物不入 git，则不需要 add/commit
```

---

### Phase 13: 最终验证

**Task 13.1: 全量测试**

```bash
pnpm test
pnpm test:web
```

**Task 13.2: e2e 套件**

```bash
cd admin-web && pnpm test:e2e
```

**Task 13.3: 检查 CHANGELOG**

如果存在 `docs/CHANGELOG.md`，加一条 v?.?.? 记录说明 5-SPA 拆分；否则在 README 顶部加一行版本说明。

**Task 13.4: 写"完成报告"**

在 PR 描述里列出：
- 5 SPA 拆分前后文件数对比
- Phase 0 抓到的根因（如果是空白 → 浏览器缓存；如果是别的问题 → 详细说明）
- 删除的目录：`hunter-platform-landing/`, `hunter-platform-landing-draft/`
- 新增的目录：5 个 SPA + 1 个 shared-web

---

## Risks & Rollback

### 风险表

| 风险 | 严重度 | 缓解 |
|---|---|---|
| 5-SPA 拆分期间 admin-web 半残（PM 等路由不可用） | 中 | Phase 4 之后到 Phase 8 完成的窗口期内，PM/employer/candidate/hunter 角色都不可用。**先发预告给真用户**。 |
| 拆分破坏现有 1070 个测试 | 高 | Phase 3-8 每个 phase 结尾都跑 `pnpm test` 强制 0 失败；任意 phase 失败就 git revert 那一 phase |
| pnpm workspace 在 Windows + node22 的边角问题 | 中 | Phase 2 结尾跑 `pnpm -r list` 验证；遇到怪问题先看 .npmrc |
| shared-web 类型 import 死循环 | 中 | shared-web **不允许** import 任何 SPA 私有代码；Phase 3 结尾加 lint 规则（eslint no-restricted-imports） |
| API server mount 顺序错乱（`/admin` 抢走 `/admin/pm`） | 中 | Phase 9 显式按**长前缀优先**顺序注册；写 mount 顺序单元测试 |
| 浏览器缓存导致"修好了但用户看不到" | 中 | 在 release notes 写明"请硬刷 Ctrl+Shift+R 清缓存" |
| 拆分后 `out/` 体积膨胀（5 份 React + 5 份 React Query 等） | 低 | 短期可接受；中长期用 vite external + 共享 vendor chunk |
| dev proxy 在 Windows 上端口冲突 | 中 | Phase 8 结尾检查 5 个端口（5174-5178）空闲；遇到占用自动 +1 |

### 回滚策略

每个 Phase 是 1 个 commit。回滚 = `git revert <phase-commit>`，理论上应恢复到上一个 Phase 结束时的状态。

**全盘回滚**（如果拆分到一半决定放弃）：`git revert <Phase 4 commit>..HEAD --no-commit`，再 `git commit -m "revert: 5-SPA split"`，回到单 admin-web 状态。

---

## 强烈建议拆成子计划的部分

我**不建议**让一个 agent 一次性执行完 13 个 phase。建议拆为以下 5 个子计划（每个独立建 plan 文档）：

1. **`2026-07-10-spa-split-phase-0-1.md`**（Phase 0-1，~2h）
   - Playwright 诊断 + 删静态 HTML
   - 风险最低，独立完成价值高

2. **`2026-07-10-spa-split-shared-extraction.md`**（Phase 2-3，~1 天）
   - workspace 初始化 + shared-web 提取
   - 是后续所有 phase 的基础，必须做对

3. **`2026-07-10-spa-split-admin-refactor.md`**（Phase 4，~半天）
   - admin-web 瘦身
   - 与 Phase 5-8 强耦合，建议合在一起

4. **`2026-07-10-spa-split-four-new-spas.md`**（Phase 5-8，~3 天）
   - 4 个新 SPA 平行创建
   - 4 个 sub-agent 可并行执行

5. **`2026-07-10-spa-split-mount-and-verify.md`**（Phase 9-13，~1 天）
   - API server mount + e2e + README + out/ rebuild
   - 闭环验证

每个子计划应在它被启动时新建，并指回本 top-level plan 作为索引。

---

## Self-Review (按 writing-plans skill 要求)

### 1. Spec coverage
- ✅ Playwright 诊断：Phase 0 Task 0.1-0.5
- ✅ 删静态 HTML：Phase 1 Task 1.1-1.5
- ✅ pnpm workspace：Phase 2 Task 2.1-2.5
- ✅ shared-web 提取：Phase 3 Task 3.1-3.7
- ✅ admin-web 瘦身：Phase 4 Task 4.1-4.5
- ✅ 4 个新 SPA：Phase 5-8（每个含脚手架 + git mv + 验证 + 提交）
- ✅ API server mount：Phase 9 Task 9.1-9.5
- ✅ e2e 5 SPA：Phase 10 Task 10.1-10.4
- ✅ README：Phase 11 Task 11.1-11.3
- ✅ rebuild out/：Phase 12 Task 12.1-12.5
- ✅ 最终验证：Phase 13 Task 13.1-13.4

### 2. Placeholder scan
- ❌ "TBD" / "TODO" / "implement later"：无
- ⚠️ Phase 3 Task 3.2 有"实际清单要执行这一步时由 agent 现场确认"——这是**有意为之**的，因为动态盘点代码无法在 plan 阶段精确列出
- ⚠️ Phase 5-8 标记"类比 Phase 5"——每个 phase 仍给出独立 task 列表，不算 placeholders
- ⚠️ Phase 9 Task 9.2 改 server.ts 给的是伪代码——但附了"agent 必须 review 实际 server.ts"，不是漏写

### 3. Type consistency
- 所有 Phase 引用的文件路径一致（`admin-web/src/api/`、`shared-web/src/api/`、`pm-web/` 等）
- `BrowserRouter` 在 Phase 5-8 显式说明"不需要 basename"——避免后续 agent 加 basename
- `out/<spa>` 命名与 `vite.config.ts` 的 `outDir` 一致
- `base` 路径与 vite 重写、URL 一致

---

**End of plan.**
