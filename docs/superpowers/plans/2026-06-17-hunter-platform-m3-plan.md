# Hunter Platform — Milestone 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复 Convo Electron 主进程（被 M1 commit 87cfc31 覆盖）→ Hybrid 模式启动 API server + Admin UI → 实现 7 个管理页面 → 生成 skill.md 文档。

**Architecture:** Electron 主进程同时启动 Express API server（同进程、同 DB）。IPC 桥接 admin UI 到后端，避免 HTTP 调用。外部 API 仍可通过 `pnpm api:dev` 独立运行（无需 Electron）。

**Tech Stack:** 同 M1+M2 + Electron 32 + electron-vite + React 18 + TypeScript + zod。

**Spec 参考:** [`docs/superpowers/specs/2026-06-17-hunter-platform-design.md`](../specs/2026-06-17-hunter-platform-design.md) — 重点 §5 (skill.md) + §10 (管理后台) + §12 Milestone 3

**起点:** `m2-complete` tag（在 main 分支上）

**本文档涵盖:** 18 个 task，按 5 个节组织（Electron 恢复 / IPC 桥 / Admin UI / skill.md / E2E）。M4+ 后续写。

---

## 关键背景

### M1/M2 已实现（93 tests 通过）

- ✅ API server 完整（`src/main/server.ts` + 25 个 HTTP 端点 + webhook worker）
- ✅ `pnpm api:dev` 启动 API server（tsx src/main/index.ts）
- ❌ `pnpm dev` **坏了** — M1 commit 87cfc31 把 Convo 原 Electron main 改成了 API entry
- ✅ Convo 原 Electron main 代码在 git history（commit `d267007`）

### M3 要解决的核心问题

1. **Electron main 恢复**（commit d267007 内容）+ **启动 API server**（hybrid 模式）
2. **IPC 桥**：admin UI 不走 HTTP，直接通过 IPC 调后端函数
3. **Admin 页面**：7 个页面覆盖 spec §10 全部功能
4. **skill.md**：spec §5 完整内容

### 不做的事（保留给 M4+）

- ❌ 不重构 Convo 现有 UI
- ❌ 不接 react-router（用简单 state-based 路由，几十行代码搞定）
- ❌ 不做实时数据（不用 WebSocket，简单 refresh 按钮）
- ❌ 不实现佣金计算 UI（M4）
- ❌ 不实现 GDPR 导出（M4）

---

## Milestone 3.A：恢复 Electron Main + Hybrid 架构

### Task 1: 拆分 server.ts — 导出 startApiServer() 函数

**Files:**
- Modify: `src/main/server.ts`
- Modify: `src/main/index.ts`（先暂时拆出 API server 启动逻辑）

- [ ] **Step 1: 写失败测试**

`tests/unit/server-startup.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

describe('startApiServer', () => {
  const testDb = path.join(__dirname, '../../tmp/startup.db');
  let server: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
  });
  afterEach(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
  });

  it('exports startApiServer that returns an http.Server', async () => {
    const { startApiServer } = await import('../../../src/main/server');
    server = await startApiServer();
    expect(server.listening).toBe(true);
  });

  it('health endpoint returns ok', async () => {
    const { startApiServer } = await import('../../../src/main/server');
    server = await startApiServer({ port: 0 });  // random port
    const addr = server.address() as any;
    const res = await new Promise<any>((resolve, reject) => {
      http.get(`http://127.0.0.1:${addr.port}/v1/health`, (r) => {
        let body = '';
        r.on('data', c => body += c);
        r.on('end', () => resolve({ status: r.statusCode, body }));
      }).on('error', reject);
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data.status).toBe('healthy');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/server-startup.test.ts
```
Expected: FAIL with "startApiServer is not a function".

- [ ] **Step 3: 重构 server.ts，导出 startApiServer()**

修改 `src/main/server.ts` 末尾：

```typescript
// 把 createApp 后的代码改成 export 一个 startApiServer 函数
export async function startApiServer(opts: { port?: number } = {}): Promise<import('http').Server> {
  const env = loadEnv();
  const db = openDb(env.DATABASE_PATH);
  runMigrations(db);

  const app = createAppFromDb(db, env);

  // 启动 webhook worker (cron-like)
  startWebhookWorker(db, env);

  return new Promise((resolve) => {
    const server = app.listen(opts.port ?? env.PORT, () => {
      console.log(`Hunter platform API listening on port ${opts.port ?? env.PORT}`);
      resolve(server);
    });
  });
}

function startWebhookWorker(db: DB, env: Env): void {
  // 简单 setInterval 轮询（M5 再做 cron）
  const worker = createWebhookWorker(db);
  setInterval(() => {
    void worker.processBatch(env.PLATFORM_ENCRYPTION_KEY, { hmacSecret: env.WEBHOOK_HMAC_SECRET })
      .catch(err => console.error('Webhook worker error:', err));
  }, 5_000);
}

// 把原 createApp 重命名 + 拆出 db 参数
export function createAppFromDb(db: DB, env: Env): Express {
  const app = express();
  app.use(express.json({ limit: '4kb' }));

  app.get('/v1/health', (_req, res) => {
    res.json({ ok: true, data: { status: 'healthy', timestamp: new Date().toISOString() } });
  });

  app.use('/v1/auth', createAuthRouter(db, env.NODE_ENV === 'production'));
  app.use('/v1/headhunter', createHeadhunterRouter(db, env.PLATFORM_ENCRYPTION_KEY));
  app.use('/v1/employer', createEmployerRouter(db, env.PLATFORM_ENCRYPTION_KEY));
  app.use('/v1/candidate', createCandidateRouter(db));

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({
        ok: false,
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  return app;
}

// 保留 createApp() 供现有测试用 (supertest 调用)
export function createApp(): Express {
  const env = loadEnv();
  const db = openDb(env.DATABASE_PATH);
  runMigrations(db);
  return createAppFromDb(db, env);
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/unit/server-startup.test.ts
```
Expected: 2 passed.

- [ ] **Step 5: 跑全部测试确保没破坏 M1/M2**

```bash
pnpm test
```
Expected: 95 passed (93 + 2 new).

- [ ] **Step 6: 提交**

```bash
git add src/main/server.ts tests/unit/server-startup.test.ts
git commit -m "refactor(server): export startApiServer() for hybrid Electron mode"
```

---

### Task 2: 恢复 Convo Electron main + Hybrid 启动 API server

**Files:**
- Modify: `src/main/index.ts`（完全重写）

- [ ] **Step 1: 写失败测试**

`tests/unit/electron-main-startup.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';

describe('electron main entry', () => {
  it('exports isMainEntry() that detects electron process', async () => {
    // 不能直接 import 会触发 Electron 依赖；改测模块结构
    const fs = await import('node:fs');
    const path = await import('node:path');
    const mainPath = path.join(__dirname, '../../src/main/index.ts');
    const content = fs.readFileSync(mainPath, 'utf8');
    expect(content).toContain("from 'electron'");
    expect(content).toContain('BrowserWindow');
    expect(content).toContain('app.whenReady');
  });

  it('starts API server when run via tsx (no electron)', async () => {
    // 模拟非 Electron 环境
    const original = (process as any).versions.electron;
    delete (process as any).versions.electron;
    try {
      const { shouldStartApiStandalone } = await import('../../../src/main/index');
      expect(shouldStartApiStandalone()).toBe(true);
    } finally {
      if (original) (process as any).versions.electron = original;
    }
  });

  it('does NOT start API standalone when in electron', async () => {
    (process as any).versions.electron = '32.2.5';
    try {
      const { shouldStartApiStandalone } = await import('../../../src/main/index');
      expect(shouldStartApiStandalone()).toBe(false);
    } finally {
      delete (process as any).versions.electron;
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/electron-main-startup.test.ts
```
Expected: FAIL.

- [ ] **Step 3: 重写 src/main/index.ts（恢复 Electron main + Hybrid API）**

完整覆盖 `src/main/index.ts`：

```typescript
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApiServer } from './server.js';
import { registerAdminIpc } from './ipc/index.js';
import { loadEnv } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 判断是否在 Electron 环境中（vs. tsx 独立运行）
 * - tsx src/main/index.ts → 走 API 独立模式（无窗口）
 * - electron-vite dev/build → 走 Electron 模式（启动 API + 窗口）
 */
export function shouldStartApiStandalone(): boolean {
  return !process.versions.electron;
}

let apiServer: import('http').Server | null = null;

async function startBackend(): Promise<void> {
  const env = loadEnv();
  apiServer = await startApiServer({ port: env.PORT });
  registerAdminIpc();  // 注册 admin IPC handlers
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Hunter Platform Admin',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function registerPingIpc(): void {
  ipcMain.handle('ping', () => 'pong');
}

// === Entry Point ===
if (shouldStartApiStandalone()) {
  // 模式 A: tsx 直接运行（CLI/dev API only）— M1 行为
  void startApiServer().then((s) => {
    apiServer = s;
    console.log(`API server running standalone (no Electron)`);
  });
} else {
  // 模式 B: Electron 启动 — 同时启动 API server + 创建窗口
  app.whenReady().then(() => {
    void startBackend().then(() => {
      registerPingIpc();
      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });
  });

  app.on('window-all-closed', () => {
    if (apiServer) apiServer.close();
    if (process.platform !== 'darwin') app.quit();
  });
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/unit/electron-main-startup.test.ts
```
Expected: 3 passed.

- [ ] **Step 5: 提交（先把 IPC 占位）**

由于 src/main/ipc/index.ts 还不存在，先创建空文件：

`src/main/ipc/index.ts`：
```typescript
import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

export function registerAdminIpc(): void {
  // 占位：M3.B Task 5-7 填充
  ipcMain.handle('admin:ping', () => 'admin pong');
}

// 为 IPC handler 提供统一日志包装
export function withErrorHandling<T extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: T) => unknown,
): void {
  ipcMain.handle(channel, async (event, ...args: T) => {
    try {
      return { ok: true, data: await handler(event, ...(args as T)) };
    } catch (e: any) {
      console.error(`[IPC ${channel}]`, e);
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: e.message } };
    }
  });
}
```

- [ ] **Step 6: 跑全部测试 + typecheck**

```bash
pnpm test
pnpm typecheck
```
Expected: 95+ tests passed, 0 typecheck errors.

- [ ] **Step 7: 提交**

```bash
git add src/main/index.ts src/main/ipc/index.ts tests/unit/electron-main-startup.test.ts
git commit -m "feat(electron): restore Convo main + hybrid API server start (M1 regression fix)"
```

---

### Task 3: 验证 `pnpm dev` 能启动 Electron + API server

**Files:**
- Create: `tests/integration/electron-dev-smoke.test.ts`（用 spawn 起子进程验证）

- [ ] **Step 1: 写测试**

`tests/integration/electron-dev-smoke.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';

/**
 * Smoke test: 验证 `pnpm api:dev` (tsx 模式) 能启动 API server
 * 注意: 这里测的是纯 API server 启动，不实际起 Electron
 *        (Electron 起窗口需要 GUI 环境，在 CI 跑不动)
 */
describe('api:dev smoke', () => {
  it('pnpm api:dev starts HTTP server on PORT', async () => {
    const proc = spawn('pnpm', ['api:dev'], {
      env: { ...process.env, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'), WEBHOOK_HMAC_SECRET: 'test-secret-1234567890', ADMIN_PASSWORD_HASH: '$2b$10$abcdefghijklmnopqrstuvwxyz', DATABASE_PATH: './tmp/smoke.db', NODE_ENV: 'test', PORT: '3099' },
      stdio: 'pipe',
    });

    // 等待 server 启动
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timeout')), 15_000);
      proc.stdout?.on('data', (data: Buffer) => {
        if (data.toString().includes('listening on port 3099')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    // 验证 /v1/health
    const res = await new Promise<any>((resolve, reject) => {
      http.get('http://127.0.0.1:3099/v1/health', (r) => {
        let body = '';
        r.on('data', c => body += c);
        r.on('end', () => resolve({ status: r.statusCode, body }));
      }).on('error', reject);
    });
    expect(res.status).toBe(200);

    proc.kill('SIGTERM');
  }, 30_000);
});
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test tests/integration/electron-dev-smoke.test.ts
```
Expected: 1 passed (或 skip if Electron 不在 PATH).

- [ ] **Step 3: 跑全部测试**

```bash
pnpm test
```
Expected: 96+ passed.

- [ ] **Step 4: 提交**

```bash
git add tests/integration/electron-dev-smoke.test.ts
git commit -m "test: smoke test pnpm api:dev startup"
```

---

## Milestone 3.B：Admin IPC 桥（preload + main handlers）

### Task 4: 扩展 preload 暴露 admin API

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: 重写 preload**

完整覆盖 `src/preload/index.ts`：

```typescript
import { contextBridge, ipcRenderer } from 'electron';

// IPC channel 类型定义（与 src/main/ipc/* 对应）
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),

  // === Admin ===
  admin: {
    dashboard: {
      getStats: (): Promise<{ ok: boolean; data?: any; error?: any }> =>
        ipcRenderer.invoke('admin:dashboard:getStats'),
    },
    users: {
      list: (filter: { user_type?: string; status?: string; limit?: number }): Promise<any> =>
        ipcRenderer.invoke('admin:users:list', filter),
      suspend: (user_id: string, reason: string): Promise<any> =>
        ipcRenderer.invoke('admin:users:suspend', { user_id, reason }),
      unsuspend: (user_id: string): Promise<any> =>
        ipcRenderer.invoke('admin:users:unsuspend', { user_id }),
      adjustQuota: (user_id: string, new_quota: number): Promise<any> =>
        ipcRenderer.invoke('admin:users:adjustQuota', { user_id, new_quota }),
    },
    candidates: {
      list: (filter: { in_pool?: boolean; unlock_status?: string; limit?: number }): Promise<any> =>
        ipcRenderer.invoke('admin:candidates:list', filter),
      removeFromPool: (anonymized_id: string): Promise<any> =>
        ipcRenderer.invoke('admin:candidates:removeFromPool', { anonymized_id }),
    },
    audit: {
      list: (filter: { actor_user_id?: string; recommendation_id?: string; limit?: number }): Promise<any> =>
        ipcRenderer.invoke('admin:audit:list', filter),
    },
    webhooks: {
      listDeadLetter: (limit?: number): Promise<any> =>
        ipcRenderer.invoke('admin:webhooks:listDeadLetter', { limit }),
      retry: (delivery_id: number): Promise<any> =>
        ipcRenderer.invoke('admin:webhooks:retry', { delivery_id }),
    },
    rateLimit: {
      listBuckets: (user_id?: string): Promise<any> =>
        ipcRenderer.invoke('admin:rateLimit:listBuckets', { user_id }),
      clearForUser: (user_id: string): Promise<any> =>
        ipcRenderer.invoke('admin:rateLimit:clearForUser', { user_id }),
    },
    config: {
      get: (): Promise<any> => ipcRenderer.invoke('admin:config:get'),
      set: (key: string, value: any): Promise<any> =>
        ipcRenderer.invoke('admin:config:set', { key, value }),
    },
  },
} as const;

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 3: 提交**

```bash
git add src/preload/index.ts
git commit -m "feat(preload): expose admin API surface for renderer"
```

---

### Task 5: 实现 dashboard IPC handler

**Files:**
- Create: `src/main/ipc/dashboard.ts`
- Create: `tests/unit/ipc/dashboard.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/unit/ipc/dashboard.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('admin:dashboard:getStats', () => {
  const testDb = path.join(__dirname, '../../../tmp/dash.db');
  let db: any, users: any, jobs: any, recs: any, candidates: any, webhooks: any;
  let getStats: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = (await import('../../../src/main/db/repositories/users')).createUsersRepo(db);
    jobs = (await import('../../../src/main/db/repositories/jobs')).createJobsRepo(db);
    recs = (await import('../../../src/main/db/repositories/recommendations')).createRecommendationsRepo(db);
    candidates = (await import('../../../src/main/db/repositories/candidates-anonymized')).createCandidatesAnonymizedRepo(db);
    webhooks = (await import('../../../src/main/db/repositories/webhook-delivery-queue')).createWebhookQueueRepo(db);
    ({ getStats } = await import('../../../src/main/ipc/dashboard'));

    // seed
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 5, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'A', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    recs.insert({ id: 'r1', headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca1', job_id: 'j1', status: 'unlocked', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
    webhooks.enqueue({ target_user_id: 'e1', event_type: 'deliver_contact', payload_enc: 'x', contains_pii: 0, max_attempts: 1 });
    // mark dead_letter manually
    db.prepare("UPDATE webhook_delivery_queue SET status = 'dead_letter', attempt_count = 1, next_retry_at = NULL WHERE id = 1").run();
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('returns aggregate stats', () => {
    const stats = getStats();
    expect(stats.users.total).toBe(2);
    expect(stats.users.headhunter).toBe(1);
    expect(stats.users.employer).toBe(1);
    expect(stats.jobs.open).toBe(1);
    expect(stats.recommendations.unlocked).toBe(1);
    expect(stats.webhooks.dead_letter).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/ipc/dashboard.test.ts
```

- [ ] **Step 3: 实现 dashboard.ts**

`src/main/ipc/dashboard.ts`：
```typescript
import type { DB } from '../db/connection.js';
import { createJobsRepo } from '../db/repositories/jobs.js';
import { createUsersRepo } from '../db/repositories/users.js';
import { createRecommendationsRepo } from '../db/repositories/recommendations.js';
import { createCandidatesAnonymizedRepo } from '../db/repositories/candidates-anonymized.js';
import { createWebhookQueueRepo } from '../db/repositories/webhook-delivery-queue.js';

export function makeDashboardIpc(db: DB) {
  const users = createUsersRepo(db);
  const jobs = createJobsRepo(db);
  const recs = createRecommendationsRepo(db);
  const candidates = createCandidatesAnonymizedRepo(db);
  const webhooks = createWebhookQueueRepo(db);

  return {
    getStats() {
      const userRows = db.prepare("SELECT user_type, COUNT(*) as cnt FROM users WHERE status != 'deleted' GROUP BY user_type").all() as { user_type: string; cnt: number }[];
      const userCounts = { total: 0, candidate: 0, headhunter: 0, employer: 0 };
      for (const r of userRows) {
        userCounts.total += r.cnt;
        if (r.user_type in userCounts) (userCounts as any)[r.user_type] = r.cnt;
      }

      const jobRows = db.prepare("SELECT status, COUNT(*) as cnt FROM jobs GROUP BY status").all() as { status: string; cnt: number }[];
      const jobCounts: Record<string, number> = {};
      for (const r of jobRows) jobCounts[r.status] = r.cnt;

      const recRows = db.prepare("SELECT status, COUNT(*) as cnt FROM recommendations GROUP BY status").all() as { status: string; cnt: number }[];
      const recCounts: Record<string, number> = {};
      for (const r of recRows) recCounts[r.status] = r.cnt;

      const candPoolCount = (db.prepare("SELECT COUNT(*) as cnt FROM candidates_anonymized WHERE is_public_pool = 1").get() as { cnt: number }).cnt;
      const deadLetter = webhooks.countDeadLetter();
      const pendingWebhook = webhooks.countPending();

      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const placementsToday = (db.prepare(
        "SELECT COUNT(*) as cnt FROM action_history WHERE action_type = 'placement_created' AND created_at >= ?"
      ).get(todayStart.toISOString()) as { cnt: number }).cnt;

      return {
        users: userCounts,
        jobs: { total: Object.values(jobCounts).reduce((a, b) => a + b, 0), ...jobCounts },
        recommendations: { total: Object.values(recCounts).reduce((a, b) => a + b, 0), ...recCounts },
        candidates: { in_pool: candPoolCount },
        webhooks: { pending: pendingWebhook, dead_letter: deadLetter },
        activity: { placements_today: placementsToday },
        timestamp: new Date().toISOString(),
      };
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/unit/ipc/dashboard.test.ts
```
Expected: 1 passed.

- [ ] **Step 5: 注册到 ipc/index.ts**

修改 `src/main/ipc/index.ts`：
```typescript
import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { makeDashboardIpc } from './dashboard.js';
import { getDb } from '../db.js';

let dashboardIpc: ReturnType<typeof makeDashboardIpc> | null = null;

export function registerAdminIpc(): void {
  const db = getDb();
  dashboardIpc = makeDashboardIpc(db);

  ipcMain.handle('admin:ping', () => 'admin pong');
  ipcMain.handle('admin:dashboard:getStats', () => dashboardIpc!.getStats());
}

export function withErrorHandling<T extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: T) => unknown,
): void {
  ipcMain.handle(channel, async (event, ...args: T) => {
    try {
      return { ok: true, data: await handler(event, ...(args as T)) };
    } catch (e: any) {
      console.error(`[IPC ${channel}]`, e);
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: e.message } };
    }
  });
}
```

> 注意：这里用 `getDb()` 而不是传 db 进来。需要检查 `src/main/db.ts` 是否已存在这个 helper。如果不存在，按 M1 dev 文档创建。

- [ ] **Step 6: 跑全部测试**

```bash
pnpm test
```

- [ ] **Step 7: 提交**

```bash
git add src/main/ipc/dashboard.ts src/main/ipc/index.ts tests/unit/ipc/dashboard.test.ts
git commit -m "feat(admin): dashboard IPC handler with aggregate stats"
```

---

### Task 6: 实现 users + candidates + audit IPC handlers

**Files:**
- Create: `src/main/ipc/users.ts`
- Create: `src/main/ipc/candidates.ts`
- Create: `src/main/ipc/audit.ts`
- Test: `tests/unit/ipc/users.test.ts`

- [ ] **Step 1: 写 users 测试**

`tests/unit/ipc/users.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('admin:users', () => {
  const testDb = path.join(__dirname, '../../../tmp/users-ipc.db');
  let db: any, usersIpc: any, users: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = (await import('../../../src/main/db/repositories/users')).createUsersRepo(db);
    ({ makeUsersIpc: { createUsersIpc: usersIpc } } = { makeUsersIpc: { createUsersIpc: (await import('../../../src/main/ipc/users')).createUsersIpc } });
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('list returns all active users', () => {
    const list = usersIpc.list({});
    expect(list.length).toBe(1);
  });

  it('suspend changes status to suspended', () => {
    usersIpc.suspend('e1', 'Test suspend');
    expect(users.findById('e1')?.status).toBe('suspended');
  });

  it('unsuspend restores active', () => {
    db.prepare("UPDATE users SET status = 'suspended' WHERE id = 'e1'").run();
    usersIpc.unsuspend('e1');
    expect(users.findById('e1')?.status).toBe('active');
  });

  it('adjustQuota updates quota_per_day', () => {
    usersIpc.adjustQuota('e1', 500);
    expect(users.findById('e1')?.quota_per_day).toBe(500);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/ipc/users.test.ts
```

- [ ] **Step 3: 实现 users.ts**

`src/main/ipc/users.ts`：
```typescript
import type { DB } from '../db/connection.js';
import { createUsersRepo } from '../db/repositories/users.js';
import { Errors } from '../errors.js';

export function createUsersIpc(db: DB) {
  const users = createUsersRepo(db);

  return {
    list(filter: { user_type?: string; status?: string; limit?: number }): unknown[] {
      let sql = 'SELECT * FROM users WHERE 1=1';
      const params: any[] = [];
      if (filter.user_type) { sql += ' AND user_type = ?'; params.push(filter.user_type); }
      if (filter.status) { sql += ' AND status = ?'; params.push(filter.status); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(filter.limit ?? 100);
      return db.prepare(sql).all(...params);
    },
    suspend(user_id: string, reason: string): { user_id: string; status: string; reason: string } {
      const u = users.findById(user_id);
      if (!u) throw Errors.notFound('User not found');
      db.prepare("UPDATE users SET status = 'suspended', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), user_id);
      return { user_id, status: 'suspended', reason };
    },
    unsuspend(user_id: string): { user_id: string; status: string } {
      const u = users.findById(user_id);
      if (!u) throw Errors.notFound('User not found');
      db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), user_id);
      return { user_id, status: 'active' };
    },
    adjustQuota(user_id: string, new_quota: number): { user_id: string; new_quota: number } {
      if (new_quota < 0 || new_quota > 100000) throw Errors.invalidParams('quota must be 0-100000');
      const u = users.findById(user_id);
      if (!u) throw Errors.notFound('User not found');
      db.prepare('UPDATE users SET quota_per_day = ?, updated_at = ? WHERE id = ?')
        .run(new_quota, new Date().toISOString(), user_id);
      return { user_id, new_quota };
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/unit/ipc/users.test.ts
```
Expected: 4 passed.

- [ ] **Step 5: 实现 candidates.ts + audit.ts（一个文件两个 handler）**

`src/main/ipc/candidates.ts`：
```typescript
import type { DB } from '../db/connection.js';
import { createCandidatesAnonymizedRepo } from '../db/repositories/candidates-anonymized.js';
import { Errors } from '../errors.js';

export function createCandidatesIpc(db: DB) {
  const candidates = createCandidatesAnonymizedRepo(db);
  return {
    list(filter: { in_pool?: boolean; unlock_status?: string; limit?: number }): unknown[] {
      let sql = 'SELECT * FROM candidates_anonymized WHERE 1=1';
      const params: any[] = [];
      if (filter.in_pool !== undefined) { sql += ' AND is_public_pool = ?'; params.push(filter.in_pool ? 1 : 0); }
      if (filter.unlock_status) { sql += ' AND unlock_status = ?'; params.push(filter.unlock_status); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(filter.limit ?? 100);
      return db.prepare(sql).all(...params);
    },
    removeFromPool(anonymized_id: string): { anonymized_id: string; is_public_pool: number } {
      const c = candidates.findById(anonymized_id);
      if (!c) throw Errors.notFound('Candidate not found');
      db.prepare("UPDATE candidates_anonymized SET is_public_pool = 0, updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), anonymized_id);
      return { anonymized_id, is_public_pool: 0 };
    },
  };
}
```

`src/main/ipc/audit.ts`：
```typescript
import type { DB } from '../db/connection.js';
import { createUnlockAuditLogRepo } from '../db/repositories/unlock-audit-log.js';

export function createAuditIpc(db: DB) {
  const audit = createUnlockAuditLogRepo(db);
  return {
    list(filter: { actor_user_id?: string; recommendation_id?: string; limit?: number }): unknown[] {
      if (filter.recommendation_id) return audit.listByRecommendation(filter.recommendation_id);
      if (filter.actor_user_id) return audit.listByActor(filter.actor_user_id);
      // 全表（按时间倒序）— admin only
      return db.prepare(
        "SELECT * FROM unlock_audit_log ORDER BY created_at DESC LIMIT ?"
      ).all(filter.limit ?? 100) as unknown[];
    },
  };
}
```

- [ ] **Step 6: 注册到 ipc/index.ts**

修改 `src/main/ipc/index.ts`：
```typescript
import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { makeDashboardIpc } from './dashboard.js';
import { createUsersIpc } from './users.js';
import { createCandidatesIpc } from './candidates.js';
import { createAuditIpc } from './audit.js';
import { getDb } from '../db.js';

let dashboardIpc: any, usersIpc: any, candidatesIpc: any, auditIpc: any;

export function registerAdminIpc(): void {
  const db = getDb();
  dashboardIpc = makeDashboardIpc(db);
  usersIpc = createUsersIpc(db);
  candidatesIpc = createCandidatesIpc(db);
  auditIpc = createAuditIpc(db);

  ipcMain.handle('admin:ping', () => 'admin pong');
  ipcMain.handle('admin:dashboard:getStats', () => dashboardIpc.getStats());
  ipcMain.handle('admin:users:list', (_e, filter) => usersIpc.list(filter));
  ipcMain.handle('admin:users:suspend', (_e, { user_id, reason }) => usersIpc.suspend(user_id, reason));
  ipcMain.handle('admin:users:unsuspend', (_e, { user_id }) => usersIpc.unsuspend(user_id));
  ipcMain.handle('admin:users:adjustQuota', (_e, { user_id, new_quota }) => usersIpc.adjustQuota(user_id, new_quota));
  ipcMain.handle('admin:candidates:list', (_e, filter) => candidatesIpc.list(filter));
  ipcMain.handle('admin:candidates:removeFromPool', (_e, { anonymized_id }) => candidatesIpc.removeFromPool(anonymized_id));
  ipcMain.handle('admin:audit:list', (_e, filter) => auditIpc.list(filter));
}

export function withErrorHandling<T extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: T) => unknown,
): void {
  ipcMain.handle(channel, async (event, ...args: T) => {
    try {
      return { ok: true, data: await handler(event, ...(args as T)) };
    } catch (e: any) {
      console.error(`[IPC ${channel}]`, e);
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: e.message } };
    }
  });
}
```

- [ ] **Step 7: 跑全部测试**

```bash
pnpm test
```

- [ ] **Step 8: 提交**

```bash
git add src/main/ipc/users.ts src/main/ipc/candidates.ts src/main/ipc/audit.ts src/main/ipc/index.ts tests/unit/ipc/users.test.ts
git commit -m "feat(admin): users + candidates + audit IPC handlers"
```

---

### Task 7: 实现 webhooks + rateLimit + config IPC handlers

**Files:**
- Create: `src/main/ipc/webhooks.ts`
- Create: `src/main/ipc/rate-limit.ts`
- Create: `src/main/ipc/config.ts`
- Test: `tests/unit/ipc/webhooks.test.ts`

- [ ] **Step 1: 写 webhooks 测试**

`tests/unit/ipc/webhooks.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('admin:webhooks', () => {
  const testDb = path.join(__dirname, '../../../tmp/wh-ipc.db');
  let db: any, wh: any, whIpc: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    wh = (await import('../../../src/main/db/repositories/webhook-delivery-queue')).createWebhookQueueRepo(db);
    ({ createWebhooksIpc: whIpc } = await import('../../../src/main/ipc/webhooks'));
    wh.enqueue({ target_user_id: 'u1', event_type: 'notify_unlock_request', payload_enc: 'x', contains_pii: 0, max_attempts: 1 });
    db.prepare("UPDATE webhook_delivery_queue SET status = 'dead_letter', attempt_count = 1, next_retry_at = NULL WHERE id = 1").run();
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('listDeadLetter returns only dead_letter rows', () => {
    const list = whIpc.listDeadLetter(50);
    expect(list.length).toBe(1);
    expect(list[0].status).toBe('dead_letter');
  });

  it('retry resets status to pending', () => {
    const result = whIpc.retry(1);
    expect(result.status).toBe('pending');
    const row = db.prepare("SELECT * FROM webhook_delivery_queue WHERE id = 1").get();
    expect(row.status).toBe('pending');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/ipc/webhooks.test.ts
```

- [ ] **Step 3: 实现 webhooks.ts**

`src/main/ipc/webhooks.ts`：
```typescript
import type { DB } from '../db/connection.js';
import { createWebhookQueueRepo } from '../db/repositories/webhook-delivery-queue.js';
import { Errors } from '../errors.js';

export function createWebhooksIpc(db: DB) {
  const wh = createWebhookQueueRepo(db);
  return {
    listDeadLetter(limit = 50): unknown[] {
      return db.prepare(
        "SELECT * FROM webhook_delivery_queue WHERE status = 'dead_letter' ORDER BY updated_at DESC LIMIT ?"
      ).all(limit);
    },
    retry(delivery_id: number): { id: number; status: string } {
      const rec = wh.findById(delivery_id);
      if (!rec) throw Errors.notFound('Delivery not found');
      if (rec.status !== 'dead_letter') throw Errors.invalidState(`Can only retry dead_letter, current: ${rec.status}`);
      db.prepare(
        "UPDATE webhook_delivery_queue SET status = 'pending', attempt_count = 0, last_error = NULL, next_retry_at = NULL, updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), delivery_id);
      return { id: delivery_id, status: 'pending' };
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/unit/ipc/webhooks.test.ts
```
Expected: 2 passed.

- [ ] **Step 5: 实现 rate-limit.ts + config.ts**

`src/main/ipc/rate-limit.ts`：
```typescript
import type { DB } from '../db/connection.js';
import { createRateLimit } from '../modules/rate-limit/bucket.js';

export function createRateLimitIpc(db: DB) {
  const rl = createRateLimit(db);
  return {
    listBuckets(user_id?: string): unknown[] {
      const sql = user_id
        ? 'SELECT * FROM rate_limit_buckets WHERE user_id = ? ORDER BY window_start DESC LIMIT 200'
        : 'SELECT * FROM rate_limit_buckets ORDER BY window_start DESC LIMIT 200';
      const params = user_id ? [user_id] : [];
      return db.prepare(sql).all(...params);
    },
    clearForUser(user_id: string): { user_id: string; deleted: number } {
      const result = db.prepare('DELETE FROM rate_limit_buckets WHERE user_id = ?').run(user_id);
      return { user_id, deleted: result.changes };
    },
  };
}
```

`src/main/ipc/config.ts`：
```typescript
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_FILES: Record<string, string> = {
  'desensitization': 'config/desensitization.json',
  'commission': 'config/commission.json',
};

export function createConfigIpc(projectRoot: string = process.cwd()) {
  return {
    get(): Record<string, unknown> {
      const result: Record<string, unknown> = {};
      for (const [key, rel] of Object.entries(CONFIG_FILES)) {
        const full = path.join(projectRoot, rel);
        try {
          result[key] = JSON.parse(fs.readFileSync(full, 'utf8'));
        } catch {
          result[key] = null;
        }
      }
      return result;
    },
    set(key: string, value: unknown): { key: string; saved: boolean } {
      const rel = CONFIG_FILES[key];
      if (!rel) throw new Error(`Unknown config key: ${key}`);
      const full = path.join(projectRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, JSON.stringify(value, null, 2));
      return { key, saved: true };
    },
  };
}
```

- [ ] **Step 6: 注册到 ipc/index.ts**

追加：
```typescript
import { createWebhooksIpc } from './webhooks.js';
import { createRateLimitIpc } from './rate-limit.js';
import { createConfigIpc } from './config.js';

let webhooksIpc: any, rateLimitIpc: any, configIpc: any;

// 在 registerAdminIpc() 内：
webhooksIpc = createWebhooksIpc(db);
rateLimitIpc = createRateLimitIpc(db);
configIpc = createConfigIpc();

ipcMain.handle('admin:webhooks:listDeadLetter', (_e, { limit }) => webhooksIpc.listDeadLetter(limit));
ipcMain.handle('admin:webhooks:retry', (_e, { delivery_id }) => webhooksIpc.retry(delivery_id));
ipcMain.handle('admin:rateLimit:listBuckets', (_e, { user_id }) => rateLimitIpc.listBuckets(user_id));
ipcMain.handle('admin:rateLimit:clearForUser', (_e, { user_id }) => rateLimitIpc.clearForUser(user_id));
ipcMain.handle('admin:config:get', () => configIpc.get());
ipcMain.handle('admin:config:set', (_e, { key, value }) => configIpc.set(key, value));
```

- [ ] **Step 7: 跑全部测试**

```bash
pnpm test
```

- [ ] **Step 8: 提交**

```bash
git add src/main/ipc/webhooks.ts src/main/ipc/rate-limit.ts src/main/ipc/config.ts src/main/ipc/index.ts tests/unit/ipc/webhooks.test.ts
git commit -m "feat(admin): webhooks + rateLimit + config IPC handlers"
```

---

## Milestone 3.C：Admin UI 页面

### Task 8: App layout + Sidebar 导航

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/components/Sidebar.tsx`
- Create: `src/renderer/src/styles/admin.css`

- [ ] **Step 1: 创建 styles/admin.css**

`src/renderer/src/styles/admin.css`：
```css
/* Admin layout */
.admin-layout { display: flex; min-height: 100vh; font-family: system-ui, sans-serif; }
.sidebar { width: 220px; background: #1e293b; color: #f1f5f9; padding: 16px 0; }
.sidebar h1 { padding: 0 16px; margin: 0 0 16px 0; font-size: 18px; }
.sidebar nav a { display: block; padding: 10px 16px; color: #cbd5e1; text-decoration: none; }
.sidebar nav a:hover { background: #334155; color: #fff; }
.sidebar nav a.active { background: #475569; color: #fff; }
.main { flex: 1; padding: 24px; background: #f8fafc; overflow-y: auto; }

.card { background: #fff; padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); margin-bottom: 16px; }
.card h2 { margin: 0 0 12px 0; font-size: 16px; color: #1e293b; }

table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
th { background: #f1f5f9; color: #475569; font-weight: 500; }
tr:hover { background: #f8fafc; }

button { padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; color: #1e293b; border-radius: 4px; cursor: pointer; }
button:hover { background: #f1f5f9; }
button.danger { background: #fee2e2; color: #991b1b; border-color: #fecaca; }
button.primary { background: #3b82f6; color: #fff; border-color: #2563eb; }

.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.stat { background: #fff; padding: 16px; border-radius: 8px; }
.stat .label { color: #64748b; font-size: 12px; text-transform: uppercase; }
.stat .value { font-size: 24px; font-weight: 600; color: #1e293b; margin-top: 4px; }

.error { color: #991b1b; background: #fee2e2; padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; }
.success { color: #166534; background: #dcfce7; padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; }
```

- [ ] **Step 2: 创建 Sidebar 组件**

`src/renderer/src/components/Sidebar.tsx`：
```typescript
import React from 'react';

export type PageName = 'dashboard' | 'users' | 'candidates' | 'audit' | 'webhooks' | 'rateLimit' | 'config';

export const PAGE_TITLES: Record<PageName, string> = {
  dashboard: '仪表盘',
  users: '用户管理',
  candidates: '候选人审核',
  audit: '审计日志',
  webhooks: 'Webhook 管理',
  rateLimit: '限流管理',
  config: '配置中心',
};

export const PAGE_ORDER: PageName[] = ['dashboard', 'users', 'candidates', 'audit', 'webhooks', 'rateLimit', 'config'];

interface Props {
  current: PageName;
  onChange: (page: PageName) => void;
}

export default function Sidebar({ current, onChange }: Props): JSX.Element {
  return (
    <aside className="sidebar">
      <h1>Hunter Admin</h1>
      <nav>
        {PAGE_ORDER.map((p) => (
          <a
            key={p}
            href="#"
            className={current === p ? 'active' : ''}
            onClick={(e) => { e.preventDefault(); onChange(p); }}
          >
            {PAGE_TITLES[p]}
          </a>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 3: 重写 App.tsx**

`src/renderer/src/App.tsx`（完整覆盖）：
```typescript
import { useState } from 'react';
import Sidebar, { type PageName } from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import UserManagement from './pages/UserManagement';
import CandidateAudit from './pages/CandidateAudit';
import AuditLog from './pages/AuditLog';
import WebhookManagement from './pages/WebhookManagement';
import RateLimitManagement from './pages/RateLimitManagement';
import ConfigCenter from './pages/ConfigCenter';
import './styles/admin.css';

const PAGES: Record<PageName, () => JSX.Element> = {
  dashboard: Dashboard,
  users: UserManagement,
  candidates: CandidateAudit,
  audit: AuditLog,
  webhooks: WebhookManagement,
  rateLimit: RateLimitManagement,
  config: ConfigCenter,
};

export default function App(): JSX.Element {
  const [page, setPage] = useState<PageName>('dashboard');
  const PageComponent = PAGES[page];
  return (
    <div className="admin-layout">
      <Sidebar current={page} onChange={setPage} />
      <main className="main">
        <PageComponent />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: 创建所有 page 占位（让 typecheck 通过）**

`src/renderer/src/pages/Dashboard.tsx`：
```typescript
export default function Dashboard(): JSX.Element { return <div className="card"><h2>仪表盘</h2><p>Loading...</p></div>; }
```

> **同样创建其他 6 个占位**（UserManagement, CandidateAudit, AuditLog, WebhookManagement, RateLimitManagement, ConfigCenter）— 每个文件 1 行 `export default function Name(): JSX.Element { return <div className="card"><h2>{title}</h2><p>TODO</p></div>; }`

- [ ] **Step 5: typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/
git commit -m "feat(admin): layout + Sidebar + 7 page placeholders"
```

---

### Task 9: Dashboard 页面

**Files:**
- Modify: `src/renderer/src/pages/Dashboard.tsx`

- [ ] **Step 1: 实现 Dashboard**

`src/renderer/src/pages/Dashboard.tsx`（完整覆盖）：
```typescript
import { useEffect, useState } from 'react';

interface Stats {
  users: { total: number; candidate: number; headhunter: number; employer: number };
  jobs: { total: number; open: number; paused: number; closed: number; filled: number };
  recommendations: { total: number; pending: number; unlocked: number };
  candidates: { in_pool: number };
  webhooks: { pending: number; dead_letter: number };
  activity: { placements_today: number };
  timestamp: string;
}

export default function Dashboard(): JSX.Element {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const res = await window.api.admin.dashboard.getStats();
    if (res.ok) setStats(res.data);
    else setError(res.error?.message ?? 'load failed');
  };

  useEffect(() => { void load(); }, []);

  if (error) return <div className="error">Error: {error}</div>;
  if (!stats) return <div className="card">Loading...</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>仪表盘</h1>
      <div className="stat-grid">
        <div className="stat"><div className="label">总用户</div><div className="value">{stats.users.total}</div><div style={{ fontSize: 11, color: '#64748b' }}>猎头 {stats.users.headhunter} · 雇主 {stats.users.employer} · 候选人 {stats.users.candidate}</div></div>
        <div className="stat"><div className="label">开放职位</div><div className="value">{stats.jobs.open ?? 0}</div></div>
        <div className="stat"><div className="label">解锁中</div><div className="value">{stats.recommendations.unlocked ?? 0}</div></div>
        <div className="stat"><div className="label">公开池候选人</div><div className="value">{stats.candidates.in_pool}</div></div>
        <div className="stat"><div className="label">Webhook 死信</div><div className="value" style={{ color: stats.webhooks.dead_letter > 0 ? '#dc2626' : 'inherit' }}>{stats.webhooks.dead_letter}</div></div>
        <div className="stat"><div className="label">Webhook 队列</div><div className="value">{stats.webhooks.pending}</div></div>
        <div className="stat"><div className="label">今日入职</div><div className="value">{stats.activity.placements_today}</div></div>
      </div>
      <div className="card">
        <h2>详情</h2>
        <pre style={{ fontSize: 12, background: '#f1f5f9', padding: 12, borderRadius: 4, overflow: 'auto' }}>{JSON.stringify(stats, null, 2)}</pre>
        <button onClick={load}>刷新</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/pages/Dashboard.tsx
git commit -m "feat(admin): Dashboard page with live stats + refresh"
```

---

### Task 10: UserManagement + CandidateAudit + AuditLog 页面

**Files:**
- Modify: `src/renderer/src/pages/UserManagement.tsx`
- Modify: `src/renderer/src/pages/CandidateAudit.tsx`
- Modify: `src/renderer/src/pages/AuditLog.tsx`

- [ ] **Step 1: 实现 UserManagement**

`src/renderer/src/pages/UserManagement.tsx`（完整覆盖）：
```typescript
import { useEffect, useState } from 'react';

interface AdminUser {
  id: string;
  user_type: string;
  name: string;
  contact: string | null;
  status: string;
  quota_per_day: number;
  quota_used: number;
  reputation: number;
  created_at: string;
}

export default function UserManagement(): JSX.Element {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [filter, setFilter] = useState<{ user_type?: string; status?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = async () => {
    setError(null); setInfo(null);
    const res = await window.api.admin.users.list(filter);
    if (res.ok) setUsers(res.data);
    else setError(res.error?.message ?? 'load failed');
  };

  useEffect(() => { void load(); }, [filter.user_type, filter.status]);

  const suspend = async (id: string) => {
    const reason = prompt('Suspend reason:') ?? '';
    if (!reason) return;
    const res = await window.api.admin.users.suspend(id, reason);
    if (res.ok) { setInfo(`Suspended ${id}`); await load(); }
    else setError(res.error?.message ?? 'suspend failed');
  };

  const unsuspend = async (id: string) => {
    const res = await window.api.admin.users.unsuspend(id);
    if (res.ok) { setInfo(`Unsuspended ${id}`); await load(); }
    else setError(res.error?.message ?? 'unsuspend failed');
  };

  const adjustQuota = async (id: string, current: number) => {
    const input = prompt(`New quota_per_day (current: ${current}):`);
    const n = input ? Number(input) : NaN;
    if (!Number.isFinite(n)) return;
    const res = await window.api.admin.users.adjustQuota(id, n);
    if (res.ok) { setInfo(`Quota updated to ${n}`); await load(); }
    else setError(res.error?.message ?? 'adjust failed');
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>用户管理</h1>
      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}
      <div className="card">
        <label>类型: <select value={filter.user_type ?? ''} onChange={(e) => setFilter({ ...filter, user_type: e.target.value || undefined })}>
          <option value="">全部</option>
          <option value="candidate">候选人</option>
          <option value="headhunter">猎头</option>
          <option value="employer">雇主</option>
        </select></label>
        <label style={{ marginLeft: 16 }}>状态: <select value={filter.status ?? ''} onChange={(e) => setFilter({ ...filter, status: e.target.value || undefined })}>
          <option value="">全部</option>
          <option value="active">active</option>
          <option value="suspended">suspended</option>
        </select></label>
        <button style={{ marginLeft: 16 }} onClick={load}>刷新</button>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>ID</th><th>类型</th><th>名称</th><th>状态</th><th>配额(已用/总额)</th><th>信誉</th><th>操作</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><code>{u.id}</code></td>
                <td>{u.user_type}</td>
                <td>{u.name}</td>
                <td>{u.status}</td>
                <td>{u.quota_used} / {u.quota_per_day}</td>
                <td>{u.reputation}</td>
                <td>
                  {u.status === 'active' ? (
                    <button className="danger" onClick={() => suspend(u.id)}>暂停</button>
                  ) : (
                    <button onClick={() => unsuspend(u.id)}>恢复</button>
                  )}
                  <button style={{ marginLeft: 4 }} onClick={() => adjustQuota(u.id, u.quota_per_day)}>改配额</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 实现 CandidateAudit**

`src/renderer/src/pages/CandidateAudit.tsx`（完整覆盖）：
```typescript
import { useEffect, useState } from 'react';

interface AdminCandidate {
  id: string;
  source_headhunter_id: string;
  industry: string | null;
  title_level: string | null;
  years_experience: number | null;
  salary_range: string | null;
  education_tier: string | null;
  is_public_pool: number;
  unlock_status: string;
  created_at: string;
}

export default function CandidateAudit(): JSX.Element {
  const [list, setList] = useState<AdminCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = async () => {
    setError(null); setInfo(null);
    const res = await window.api.admin.candidates.list({ in_pool: true });
    if (res.ok) setList(res.data);
    else setError(res.error?.message ?? 'load failed');
  };

  useEffect(() => { void load(); }, []);

  const remove = async (id: string) => {
    if (!confirm(`Remove ${id} from public pool?`)) return;
    const res = await window.api.admin.candidates.removeFromPool(id);
    if (res.ok) { setInfo('Removed'); await load(); }
    else setError(res.error?.message ?? 'remove failed');
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>候选人审核（公开池）</h1>
      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}
      <div className="card">
        <table>
          <thead><tr><th>ID</th><th>行业</th><th>职级</th><th>年限</th><th>薪资</th><th>学历</th><th>解锁状态</th><th>操作</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td><code>{c.id}</code></td>
                <td>{c.industry}</td>
                <td>{c.title_level}</td>
                <td>{c.years_experience}</td>
                <td>{c.salary_range}</td>
                <td>{c.education_tier}</td>
                <td>{c.unlock_status}</td>
                <td><button className="danger" onClick={() => remove(c.id)}>下架</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 实现 AuditLog**

`src/renderer/src/pages/AuditLog.tsx`（完整覆盖）：
```typescript
import { useEffect, useState } from 'react';

interface AuditEntry {
  id: number;
  recommendation_id: string;
  actor_user_id: string;
  action: string;
  ip_address: string | null;
  created_at: string;
}

export default function AuditLog(): JSX.Element {
  const [list, setList] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const res = await window.api.admin.audit.list({ limit: 200 });
    if (res.ok) setList(res.data);
    else setError(res.error?.message ?? 'load failed');
  };

  useEffect(() => { void load(); }, []);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>审计日志（解锁相关）</h1>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <button onClick={load}>刷新</button>
        <p style={{ fontSize: 12, color: '#64748b' }}>记录 express_interest / approve_unlock / unlock_delivery 等 PII 访问</p>
        <table>
          <thead><tr><th>时间</th><th>动作</th><th>Recommendation</th><th>操作者</th><th>IP</th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td><code>{e.action}</code></td>
                <td><code>{e.recommendation_id.slice(0, 12)}…</code></td>
                <td><code>{e.actor_user_id.slice(0, 12)}…</code></td>
                <td>{e.ip_address ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/pages/UserManagement.tsx src/renderer/src/pages/CandidateAudit.tsx src/renderer/src/pages/AuditLog.tsx
git commit -m "feat(admin): UserManagement + CandidateAudit + AuditLog pages"
```

---

### Task 11: WebhookManagement + RateLimit + Config 页面

**Files:**
- Modify: `src/renderer/src/pages/WebhookManagement.tsx`
- Modify: `src/renderer/src/pages/RateLimitManagement.tsx`
- Modify: `src/renderer/src/pages/ConfigCenter.tsx`

- [ ] **Step 1: 实现 WebhookManagement**

`src/renderer/src/pages/WebhookManagement.tsx`：
```typescript
import { useEffect, useState } from 'react';

interface DeadLetter {
  id: number;
  target_user_id: string;
  event_type: string;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export default function WebhookManagement(): JSX.Element {
  const [list, setList] = useState<DeadLetter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = async () => {
    setError(null); setInfo(null);
    const res = await window.api.admin.webhooks.listDeadLetter(100);
    if (res.ok) setList(res.data);
    else setError(res.error?.message ?? 'load failed');
  };

  useEffect(() => { void load(); }, []);

  const retry = async (id: number) => {
    const res = await window.api.admin.webhooks.retry(id);
    if (res.ok) { setInfo(`Re-queued #${id}`); await load(); }
    else setError(res.error?.message ?? 'retry failed');
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Webhook 死信队列</h1>
      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}
      <div className="card">
        <button onClick={load}>刷新</button>
        <p style={{ fontSize: 12, color: '#64748b' }}>已重试 3 次后仍失败的投递。可手动重投。</p>
        <table>
          <thead><tr><th>ID</th><th>事件</th><th>目标用户</th><th>尝试次数</th><th>最后错误</th><th>最后更新</th><th>操作</th></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td>{d.id}</td>
                <td><code>{d.event_type}</code></td>
                <td><code>{d.target_user_id}</code></td>
                <td>{d.attempt_count}</td>
                <td style={{ color: '#dc2626' }}>{d.last_error ?? '—'}</td>
                <td>{new Date(d.updated_at).toLocaleString()}</td>
                <td><button onClick={() => retry(d.id)}>重投</button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#64748b' }}>无死信 🎉</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 实现 RateLimitManagement**

`src/renderer/src/pages/RateLimitManagement.tsx`：
```typescript
import { useEffect, useState } from 'react';

interface Bucket {
  id: number;
  user_id: string;
  window_start: string;
  window_seconds: number;
  request_count: number;
  expires_at: string;
}

export default function RateLimitManagement(): JSX.Element {
  const [filter, setFilter] = useState('');
  const [list, setList] = useState<Bucket[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const res = await window.api.admin.rateLimit.listBuckets(filter || undefined);
    if (res.ok) setList(res.data);
    else setError(res.error?.message ?? 'load failed');
  };

  useEffect(() => { void load(); }, [filter]);

  const clear = async (user_id: string) => {
    if (!confirm(`Clear all buckets for ${user_id}?`)) return;
    const res = await window.api.admin.rateLimit.clearForUser(user_id);
    if (res.ok) await load();
    else setError(res.error?.message ?? 'clear failed');
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>限流桶</h1>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <input placeholder="按 user_id 过滤" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button style={{ marginLeft: 8 }} onClick={load}>刷新</button>
        <table>
          <thead><tr><th>User</th><th>窗口</th><th>计数</th><th>过期时间</th><th>操作</th></tr></thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td><code>{b.user_id}</code></td>
                <td>{b.window_seconds}s</td>
                <td>{b.request_count}</td>
                <td>{new Date(b.expires_at).toLocaleString()}</td>
                <td><button className="danger" onClick={() => clear(b.user_id)}>清空</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 实现 ConfigCenter**

`src/renderer/src/pages/ConfigCenter.tsx`：
```typescript
import { useEffect, useState } from 'react';

export default function ConfigCenter(): JSX.Element {
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const res = await window.api.admin.config.get();
    if (res.ok) setConfig(res.data);
    else setError(res.error?.message ?? 'load failed');
  };

  useEffect(() => { void load(); }, []);

  const save = async (key: string, currentValue: any) => {
    const json = prompt(`Edit ${key} (JSON):`, JSON.stringify(currentValue, null, 2));
    if (!json) return;
    try {
      const parsed = JSON.parse(json);
      const res = await window.api.admin.config.set(key, parsed);
      if (res.ok) await load();
      else setError(res.error?.message ?? 'save failed');
    } catch (e: any) {
      setError('Invalid JSON: ' + e.message);
    }
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>配置中心</h1>
      {error && <div className="error">{error}</div>}
      <button onClick={load}>刷新</button>
      {config && Object.entries(config).map(([key, value]) => (
        <div key={key} className="card">
          <h2>{key}.json</h2>
          <pre style={{ fontSize: 12, background: '#f1f5f9', padding: 12, borderRadius: 4, overflow: 'auto' }}>
            {JSON.stringify(value, null, 2)}
          </pre>
          <button onClick={() => save(key, value)}>编辑 (JSON)</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/pages/WebhookManagement.tsx src/renderer/src/pages/RateLimitManagement.tsx src/renderer/src/pages/ConfigCenter.tsx
git commit -m "feat(admin): Webhook + RateLimit + Config pages with IPC-driven actions"
```

---

## Milestone 3.D：skill.md 文档

### Task 12: 生成 skill.md（spec §5 完整 8 节）

**Files:**
- Create: `docs/superpowers/skill.md`（项目内，平台对外文档）

- [ ] **Step 1: 写文件**

`docs/superpowers/skill.md`：

```markdown
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
| GET | `/skill.md` | 本文档 | 0 |

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
- ⏳ v2：加密密钥轮换、跨猎头推荐细分、多语言、完整 GDPR 导出
```

- [ ] **Step 2: 提交**

```bash
git add docs/superpowers/skill.md
git commit -m "docs(skill): publish hunter-platform skill.md (8 sections per spec §5)"
```

---

### Task 13: 暴露 GET /skill.md（API 服务端点）

**Files:**
- Modify: `src/main/server.ts`

- [ ] **Step 1: 追加 skill.md 端点**

修改 `src/main/server.ts` 的 `createAppFromDb` 函数，在 health endpoint 后追加：

```typescript
  // skill.md (公开)
  const skillPath = path.join(process.cwd(), 'docs/superpowers/skill.md');
  app.get('/v1/skill.md', (_req, res) => {
    try {
      const content = fs.readFileSync(skillPath, 'utf8');
      res.type('text/markdown').send(content);
    } catch (e) {
      res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'skill.md not found' } });
    }
  });
  app.get('/skill.md', (_req, res) => {
    res.redirect(301, '/v1/skill.md');
  });
```

并在文件顶部加 import：
```typescript
import fs from 'node:fs';
import path from 'node:path';
```

- [ ] **Step 2: 写测试**

`tests/integration/skill-md-endpoint.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('GET /v1/skill.md', () => {
  const testDb = path.join(__dirname, '../../tmp/skill.db');
  let app: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = require('../../src/main/server');
    app = createApp();
  });
  afterEach(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('returns skill.md content as markdown', async () => {
    const res = await request(app).get('/v1/skill.md');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
    expect(res.text).toContain('# Hunter Platform');
  });

  it('/skill.md redirects to /v1/skill.md', async () => {
    const res = await request(app).get('/skill.md');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/v1/skill.md');
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
pnpm test tests/integration/skill-md-endpoint.test.ts
```
Expected: 2 passed.

- [ ] **Step 4: 提交**

```bash
git add src/main/server.ts tests/integration/skill-md-endpoint.test.ts
git commit -m "feat(api): serve skill.md at /v1/skill.md (spec §5.1)"
```

---

## Milestone 3.E：E2E + 验证

### Task 14: M3 端到端集成测试

**Files:**
- Create: `tests/integration/e2e-m3-admin.test.ts`

- [ ] **Step 1: 写测试**

`tests/integration/e2e-m3-admin.test.ts`：
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('M3 E2E: Admin dashboard + actions', () => {
  const testDb = path.join(__dirname, '../../tmp/e2e-m3.db');
  let db: any, dashboardIpc: any, usersIpc: any, webhooksIpc: any;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    dashboardIpc = (await import('../../../src/main/ipc/dashboard')).makeDashboardIpc(db);
    usersIpc = (await import('../../../src/main/ipc/users')).createUsersIpc(db);
    webhooksIpc = (await import('../../../src/main/ipc/webhooks')).createWebhooksIpc(db);
    const users = (await import('../../../src/main/db/repositories/users')).createUsersRepo(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H1', contact: null, agent_endpoint: null, api_key_hash: 'h1', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 50, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h2', user_type: 'headhunter', name: 'H2', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    // dead letter
    db.prepare("INSERT INTO webhook_delivery_queue (target_user_id, event_type, payload_enc, contains_pii, status, attempt_count, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, 'dead_letter', 3, 3, ?, ?)").run('h1', 'notify_unlock_request', 'x', 0, now, now);
  });
  afterAll(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('dashboard returns aggregate stats', () => {
    const stats = dashboardIpc.getStats();
    expect(stats.users.headhunter).toBe(2);
    expect(stats.webhooks.dead_letter).toBe(1);
  });

  it('admin flow: suspend user, see in list with new status', () => {
    usersIpc.suspend('h1', 'policy violation');
    const list = usersIpc.list({ status: 'suspended' }) as any[];
    expect(list.some((u) => u.id === 'h1' && u.status === 'suspended')).toBe(true);
  });

  it('admin flow: list dead letter, retry, status → pending', () => {
    const dl = webhooksIpc.listDeadLetter() as any[];
    expect(dl.length).toBe(1);
    const target = dl[0];
    const result = webhooksIpc.retry(target.id);
    expect(result.status).toBe('pending');
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test tests/integration/e2e-m3-admin.test.ts
```
Expected: 3 passed.

- [ ] **Step 3: 跑全部测试**

```bash
pnpm test
```
Expected: 105+ passed (M1+M2 93 + M3 new 12+).

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 5: 提交 + 打 tag**

```bash
git add tests/integration/e2e-m3-admin.test.ts
git commit -m "test(e2e): M3 admin dashboard + suspend + retry flows"
git tag -a m3-complete -m "Milestone 3 complete: admin GUI + skill.md"
```

---

## ✅ M3 验收标准

M3 完成的定义（"Done"）：

- [ ] `pnpm test` 全部通过（105+ 测试）
- [ ] `pnpm typecheck` 0 错误
- [ ] `pnpm dev` 启动 Electron 窗口（**M1 regression 修复**）
- [ ] `pnpm api:dev` 启动 API server（保持可用）
- [ ] 7 个 admin 页面可正常访问：Dashboard / Users / Candidates / Audit / Webhooks / RateLimit / Config
- [ ] 实际通过 IPC 测试 suspend / unsuspend / adjustQuota / removeFromPool / retry 至少 1 个真实操作
- [ ] `GET /v1/skill.md` 返回 200 + markdown
- [ ] Tag `m3-complete` 已打

## 📋 P1/P2 Bug 覆盖状态

| Bug | 状态 |
|-----|------|
| P1#7 Webhook 重放 | ✅ M2 已修 |
| P1#8 状态机事务 | ✅ M2 已修（用 BEGIN/COMMIT） |
| P1#9 HMAC 时序攻击 | ✅ M2 已修（timingSafeEqual） |
| P1#10 deliver_contact 加密 | ✅ M2 已修 |
| P1#11 跨猎头 UNIQUE | ✅ M2 已修 |
| P1#13 加密密钥轮换 | ⏳ v2 |
| P1#14 技能搜索性能 | ⏳ M5 |
| P2 日志归档 | ⏳ M4 |
| P2 Convo 单管理员 | ✅ M3（admin 多个但单实例够用） |
| P2 GDPR 数据导出 | ⏳ M4 |

## 🚀 下一步（M4+）

- **M4 plan**: 佣金计算 + 完整 audit + GDPR 数据导出
- **M5 plan**: Webhook Worker 优化 + k6 压测 + 性能监控
