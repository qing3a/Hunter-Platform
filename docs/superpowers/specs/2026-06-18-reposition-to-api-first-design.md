# Hunter Platform — API-First Reposition Design

**状态**: Draft
**日期**: 2026-06-18
**作者**: brainstorming session (continuation of 2026-06-17 spec)
**前置文档**: [2026-06-17-hunter-platform-design.md](./2026-06-17-hunter-platform-design.md)

---

## 1. 概述

### 1.1 一句话定义

把 `hunter-platform`（package name 暂为 `convo`）从"看上去像 Convo AI 桌面客户端 + 内部塞了猎头 API"重新定义为"**猎头中介 API 服务**"，Electron Admin UI 退化为可选未来资产。同时修复 API 模式启动时环境变量未被加载的 bug。

### 1.2 触发原因

用户在 2026-06-18 想用 Claude Desktop（MCP）验证 API 可用性，启动 `pnpm api:dev` 时立即失败：

```
Invalid environment variables:
  - PLATFORM_ENCRYPTION_KEY: Required
  - WEBHOOK_HMAC_SECRET: Required
  - ADMIN_PASSWORD_HASH: Required
```

根因：`src/main/env.ts:33` 调用 `EnvSchema.safeParse(process.env)`，但**代码库全局无 `dotenv` 引用、无 `--env-file` 引用**——项目从未实现 `.env` 自动加载。

调试过程中同时确认了 `pnpm dev`（Electron 模式）会因 Electron 32 自带 Node 不含 `node:sqlite` 内置模块而崩溃。这强化了"Electron 不是 v1 主交付"的判断。

### 1.3 目标（Goals）

1. `pnpm api:dev` 能直接拉起 API 服务，零额外配置（仅依赖 `.env`）
2. `GET /v1/skill.md` 公开可访问，让 Claude / 其他 Agent 可自助接入
3. package.json / README 反映真实身份（猎头 API 平台），消除 Convo / AI desktop client 的歧义
4. 现有 16 个业务模块、5 个路由、3 个迁移、3 层测试**完全不动**

### 1.4 非目标（Non-Goals）

- 不实现 MCP wrapper（用户明确：Claude Desktop 自己读 skill.md 自助接入）
- 不重写 README 到完美状态（最小可读即可）
- 不删除 Electron 源码（保留 `src/preload/`、`src/renderer/`、`electron.vite.config.ts` 作为未来资产，本期不构建）
- 不解决 Electron 模式 `node:sqlite` 问题（API 模式不依赖 Electron）

### 1.5 与 NeverLand / 原 spec 的关系

无功能变更。本 spec 是纯**交付形态 / 元数据层**调整。业务规则仍以 [2026-06-17-hunter-platform-design.md](./2026-06-17-hunter-platform-design.md) 为准。

---

## 2. 架构总览

### 2.1 双模式保留

`src/main/index.ts` 的 `shouldStartApiStandalone()` 已在 M5 实现。本次不修改其逻辑，只在 console 输出加一行 mode banner：

| 模式 | 入口命令 | 行为 |
|------|---------|------|
| **API（v1 默认 / 本 spec 主交付）** | `pnpm api:dev` | tsx 启动 Express + cron + webhook worker + metrics refresh，不开 Electron 窗口 |
| **Electron（可选 / 未来）** | `pnpm exec electron .` | Express + BrowserWindow（Admin UI）+ preload bridge |

### 2.2 组件不变性

| 组件 | 行数（约） | 状态 |
|------|----------|------|
| `src/main/modules/` × 16 | ~3000 | 完全保留 |
| `src/main/routes/` × 5 | ~几百 | 完全保留 |
| `src/main/db/migrations/` × 3 + repositories | — | 完全保留 |
| `src/main/server.ts` | 161 | 完全保留 |
| `src/main/ipc/` | — | 保留（Electron 模式还需要） |
| `src/shared/` | — | 完全保留 |
| `src/main/index.ts` | 129 | 微调：加 console banner（约 +4 行） |
| `src/preload/index.ts` | ~几十 | **保留源码**，不构建 |
| `src/renderer/` × 16 | ~820 | **保留源码**，不构建 |
| `tests/` (unit + integration + load) | — | 完全保留 |
| `.gitignore` / `.editorconfig` / `.nvmrc` / `LICENSE` | — | 不动 |

---

## 3. 文件级变更

### 3.1 `package.json` — 修改

```diff
 {
-  "name": "convo",
-  "description": "AI desktop client",
+  "name": "hunter-platform",
+  "description": "猎头中介 API 平台",
   "main": "./out/main/index.js",
   "author": "Convo Contributors",
   ...
   "scripts": {
-    "dev": "electron-vite dev",
-    "build": "pnpm typecheck && electron-vite build",
+    "dev": "tsx --env-file=.env src/main/index.ts",
+    "build": "pnpm typecheck && tsc -p tsconfig.node.json",
-    "start": "electron-vite preview",
-    "package": "electron-vite build && electron-builder",
+    "start": "node --env-file=.env out/main/index.js",
-    "api:dev": "tsx src/main/index.ts"
+    "api:dev": "tsx --env-file=.env src/main/index.ts"
   }
```

**注意**：
- `dependencies` 不变（electron / react 仍可在 devDependencies）
- `devDependencies` 不变（保留 `electron`、`electron-vite`、`react`、`react-dom`、`@vitejs/plugin-react`、`electron-builder` 作为未来资产）
- `author` 字段保留不动（属于元数据清理，本期不处理）
- 新增 `--env-file=.env` 是关键修复，让 Node 20.6+ / tsx 4.x 在进程启动早期把 `.env` 注入 `process.env`

### 3.2 `README.md` — 重写

替换为以下内容：

```markdown
# Hunter Platform

猎头中介 API 平台。候选人、猎头、雇主三类用户通过自己的 Agent 接入平台 API，
完成招聘协作。

## 启动

\`\`\`bash
pnpm install
pnpm api:dev      # 启动 API 服务（默认 / 主交付模式）
\`\`\`

服务监听 `http://localhost:3000`（端口由 `.env` 的 `PORT` 控制，默认 3000）。

`.env` 必须包含以下字段（参见 `.env.example`，如不存在请手动创建）：

- `PLATFORM_ENCRYPTION_KEY`（base64 编码 32 字节）
- `WEBHOOK_HMAC_SECRET`（≥16 字符）
- `ADMIN_PASSWORD_HASH`（bcrypt 哈希，≥20 字符）

## API 文档

Claude / 其他 Agent 通过以下 endpoint 接入：

- `GET http://localhost:3000/v1/skill.md` — 完整 skill 文档
- `GET http://localhost:3000/v1/openapi.json` — OpenAPI 3.0 spec
- `GET http://localhost:3000/v1/health` — 健康检查

详见本地文件：
- [docs/superpowers/skill.md](docs/superpowers/skill.md)
- [docs/superpowers/openapi.json](docs/superpowers/openapi.json)

## 设计文档

- [docs/superpowers/specs/2026-06-17-hunter-platform-design.md](docs/superpowers/specs/2026-06-17-hunter-platform-design.md)
- [docs/superpowers/specs/2026-06-18-reposition-to-api-first-design.md](docs/superpowers/specs/2026-06-18-reposition-to-api-first-design.md)
- [docs/superpowers/specs/2026-06-18-action-history-and-industry-map-design.md](docs/superpowers/specs/2026-06-18-action-history-and-industry-map-design.md)

## 测试

\`\`\`bash
pnpm test            # vitest run (unit + integration)
\`\`\`

## 构建产物

\`\`\`bash
pnpm build           # tsc → out/main/
\`\`\`

`out/main/` 即可由 `node --env-file=.env out/main/index.js` 启动。

## 可选 Admin UI（实验性 / 不推荐生产）

`src/preload/` 和 `src/renderer/` 中保留了 Electron + React Admin UI 源码，但
默认不构建、不启动。如需试用：

\`\`\`bash
pnpm exec electron .
\`\`\`

后续可能拆分为独立仓库。
```

### 3.3 `electron.vite.config.ts` — 删除

API 模式不读此文件。删除后 `pnpm dev` 不会再误触发 electron-vite 构建。

### 3.4 `src/main/index.ts` — 微调

在 `main()` 开头加 banner（约 4 行）：

```typescript
export async function main(): Promise<void> {
  if (isTestEnv()) return;

  if (shouldStartApiStandalone()) {
    console.log('[hunter-platform] starting in API-only mode (no Electron)');
    apiServer = await startApiServer();
    console.log('API server running standalone (no Electron)');
  } else {
    console.log('[hunter-platform] starting in Electron mode (API + Admin UI)');
    await app.whenReady();
    await startBackend();
    registerPingIpc();
    createWindow();
    // ... rest unchanged
  }
}
```

逻辑零变化，只是把 mode 选择变成可见输出。

### 3.5 `docs/superpowers/specs/` — 新增本文档

仅新增本 spec。无修改其它 spec。

### 3.6 不变的部分（重申）

- `src/main/modules/`、`src/main/routes/`、`src/main/db/`、`src/main/server.ts`、`src/main/ipc/`、`src/shared/`、`src/preload/`、`src/renderer/`、`tests/`、`.gitignore`、`.editorconfig`、`.nvmrc`、`LICENSE` 全部**零变更**

---

## 4. 数据流 / 错误处理 / 测试（不变）

无变化。本 spec 只调整交付形态，业务行为完全继承 [2026-06-17 spec §4-§6](./2026-06-17-hunter-platform-design.md)。

---

## 5. 验证计划

### 5.1 启动验证

| # | 命令 | 预期 |
|---|------|------|
| V1 | `pnpm install` | 干净安装，无 error |
| V2 | `pnpm typecheck` | 0 error |
| V3 | `pnpm build` | `out/main/` 产出，无 `out/renderer/`（API 模式不构建 renderer） |
| V4 | `pnpm api:dev` | console 输出 `[hunter-platform] starting in API-only mode` + `API server listening on port 3000` |
| V5 | `node --env-file=.env out/main/index.js` | 同 V4，但跑产物 |
| V6 | `pnpm dev`（旧 `electron-vite dev`） | 失败不视为本 spec 范围失败（API 模式不依赖 Electron） |

### 5.2 端点验证（5 条 curl）

| # | curl | 预期 |
|---|------|------|
| V7 | `GET /v1/health` | 200 + `{"ok":true,"data":{"status":"healthy",...}}` |
| V8 | `GET /v1/skill.md` | 200 + markdown 全文 |
| V9 | `GET /metrics` | 200 + Prometheus 文本 |
| V10 | `POST /v1/auth/register` | 200 + `api_key` |
| V11 | `GET /v1/users/{id}/status`（Bearer） | 200 + user info |

### 5.3 身份一致性（grep）

| # | grep | 期望 |
|---|------|------|
| V12 | `grep -r "Convo" src/ docs/`（排除 node_modules） | 0 match（除 skill.md 注释中可能存在的历史提及） |
| V13 | `grep -r "AI desktop client" .` | 0 match |
| V14 | `grep "\"name\": \"convo\"" package.json` | 0 match |
| V15 | `ls electron.vite.config.ts` | 文件不存在 |

### 5.4 回归保险（git diff 范围）

| # | 检查 | 期望 |
|---|------|------|
| V16 | `git diff --stat` | 仅 4 文件改动：package.json、README.md、src/main/index.ts、新增 spec 文档；加删除 electron.vite.config.ts |
| V17 | `git diff src/main/modules/` | 空 |
| V18 | `git diff src/main/routes/` | 空 |
| V19 | `git diff tests/` | 空 |
| V20 | `pnpm test` | 全绿（unit + integration） |

### 5.5 完成判定

- V1–V11 全部 ✅
- V12–V15 全部 ✅
- V16–V20 全部 ✅
- 本 spec 文档已 self-review 且用户已 review

只有以上全部满足，才算"完成 reposition"。

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|-----|------|------|
| tsx 4.x 不识别 `--env-file` | 低 | API 启动失败 | V4 立即发现；fallback 是改 `api:dev` 为 `node --env-file=.env --import tsx src/main/index.ts` |
| `pnpm build` 不带 electron-vite 后路径解析错 | 低 | 构建失败 | V3 立即发现；`tsconfig.node.json` 已包含 main 路径 |
| 旧 README 信息（badge、contributors）丢失 | 中 | 信息回退 | 不强求完整；如需要可单独 PR |
| 未来启用 Electron Admin UI 时忘记重新加 deps | 低 | 浪费时间 | `package.json` devDependencies 保留所有 electron/react 依赖；README "可选 Admin UI" 段落说明启用方式 |
| `.env` 不存在时启动失败 | 中 | 用户首次体验差 | V4 立即发现；README 列出必需字段 |

---

## 7. 实现路径（写作计划输入）

按以下顺序执行（每步独立可验证）：

1. **T1**：删除 `electron.vite.config.ts`
2. **T2**：修改 `package.json`（name、description、scripts）
3. **T3**：微调 `src/main/index.ts` 加 banner
4. **T4**：重写 `README.md`
5. **T5**：跑 `pnpm typecheck`（V2）
6. **T6**：跑 `pnpm build`（V3）
7. **T7**：跑 `pnpm api:dev` + 5 条 curl 验证（V4–V11）
8. **T8**：跑 grep 检查身份一致性（V12–V15）
9. **T9**：跑 `pnpm test`（V20）
10. **T10**：`git diff --stat` 复核（V16–V19）

预计改动代码 < 30 行，文档 < 100 行。

---

## 8. 未来工作（Out of Scope）

- MCP wrapper server（用户明确不需要）
- Electron 模式下 `node:sqlite` 修复（API 模式不依赖）
- package.json `author` 字段更新为真实作者
- 单独的 API-only 仓库拆分（拆分路径见 brainstorming 方案 C）

---

## 9. 决策记录

| 选项 | 选择 | 理由 |
|------|-----|------|
| 删 Electron 源码 vs 保留 | **保留** | 已是已工作资产；删除为不可逆操作 |
| 删 Electron deps vs 保留 | **保留** | 未来启用 Admin UI 零回归 |
| 改 `pnpm dev` 默认 vs 保留 Electron | **改** | 与"API-first 主交付"目标一致 |
| 新增 dotenv 依赖 vs `--env-file` flag | **`--env-file` flag** | 零新依赖、零代码改动、零测试影响 |
| 写完整 README vs 最小可读 | **最小可读** | 避免信息回退争议 |
| 写 spec 文档 vs 跳过 | **写** | 用户 2026-06-18 决定；保留 brainstorm 流程可追溯性 |