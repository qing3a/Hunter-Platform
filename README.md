# Hunter Platform

猎头中介 API 平台。候选人、猎头、雇主三类用户通过自己的 Agent 接入平台 API，完成招聘协作。

> R1.C2 已发布：长会话 + 多角色认证。每个用户拥有全部 3 个角色（`candidate` / `hr` / `pm`），可通过 `POST /v1/auth/login` 拿 `sess_*` token，用 `X-Active-Role` 切换活跃角色。旧 `hp_live_*` API key 仍然可用。详见 [docs/superpowers/specs/2026-07-11-session-and-multirole-design.md](docs/superpowers/specs/2026-07-11-session-and-multirole-design.md)。

**纯 API 模式**（v1.0+）—— 服务端只暴露 HTTP API，无桌面客户端、无 Electron。详情见 [docs/superpowers/specs/2026-06-18-reposition-to-api-first-design.md](docs/superpowers/specs/2026-06-18-reposition-to-api-first-design.md)。

## 部署形态

```
┌─────────────────────┐        ┌──────────────────────┐        ┌─────────────────────┐
│  用户 Agent A       │  HTTP  │                      │  HTTP  │  平台管理 AI        │
│  (候选人 / 雇主 /   │ ─────► │   hunter-platform    │ ◄───── │  (服务器侧运维)     │
│   猎头的客户端 AI)  │ ◄───── │   (HTTP API only)    │        │  通过 /v1/admin/*  │
└─────────────────────┘        └──────────────────────┘        └─────────────────────┘
                                       ▲
                                       │ 同机部署
                                       ▼
                              ┌──────────────────────┐
                              │   SQLite / 文件存储  │
                              └──────────────────────┘
```

**两层用户，三种角色**：
- **数据层用户**：候选人、雇主、猎头，每个角色有自己的 Agent 调 HTTP API
- **管理层用户**：服务器上的"平台管理 AI"通过 `/v1/admin/*` 端点做运维
- 所有交互都是 HTTP，零 IPC、零桌面客户端

## 启动

```bash
pnpm install
pnpm dev          # 启动开发服务（无 watch，进程树最干净）
pnpm dev:watch    # 同上 + 改 .ts 自动重启
```

服务监听 `http://localhost:3000`（端口由 `.env` 的 `PORT` 控制，默认 3000）。

`.env` 必须包含以下字段：

- `PLATFORM_ENCRYPTION_KEY`（base64 编码 32 字节）
- `WEBHOOK_HMAC_SECRET`（≥16 字符）
- `ADMIN_PASSWORD_HASH`（bcrypt 哈希，≥20 字符）

## Demo 数据（dev 用）

`tmp/seed-v4-demo.ts` 注入 10 个模拟雇主（`demo_emp_*`）+ 30 个模拟岗位（`demo_j_*`），用于让首页（`GET /`）有真实数据展示。

```bash
node --import tsx tmp/seed-v4-demo.ts   # 幂等：再次执行会清掉旧 demo 数据重新插入
```

**显示规则**：
- **dev 模式**（默认 `NODE_ENV=development`）：首页显示 demo 数据
- **prod 模式**（`NODE_ENV=production`）：首页自动过滤 demo 数据（landing page SQL 加 `id NOT LIKE 'demo_%'`），但 API 端点仍可查询 demo 数据用于 agent 测试

**demo 数据 vs 真实数据边界**：demo 雇主是 seed 脚本插入的占位用户，与真实注册的雇主是两套身份。任何 4 步解锁流程（approve-unlock / unlock-contact）只能在同一雇主身份下走通——demo 雇主下的推荐不能由真实雇主操作（RBAC 正确拒绝 `403 FORBIDDEN`）。

## API 文档

Claude / 其他 Agent 通过以下 endpoint 接入：

- `GET http://localhost:3000/v1/skill.md` — 完整 skill 文档（Agent 对接必读）
- `GET http://localhost:3000/v1/openapi.json` — OpenAPI 3.0 spec
- `GET http://localhost:3000/v1/health` — 健康检查

## 设计文档

- [docs/superpowers/specs/2026-06-17-hunter-platform-design.md](docs/superpowers/specs/2026-06-17-hunter-platform-design.md)
- [docs/superpowers/specs/2026-06-18-reposition-to-api-first-design.md](docs/superpowers/specs/2026-06-18-reposition-to-api-first-design.md)
- [docs/superpowers/specs/2026-06-18-action-history-and-industry-map-design.md](docs/superpowers/specs/2026-06-18-action-history-and-industry-map-design.md)

## 测试

```bash
pnpm test            # vitest run (unit + integration)
# 冒烟客户端示例（详见 examples/README.md）
npx tsx examples/hunter-client.ts
```

## 构建产物（生产部署）

```bash
pnpm build           # tsc → out/main/
pnpm start           # node --env-file=.env out/main/index.js
```

`pnpm dev` 和 `pnpm start` 的进程树形状完全一致（都是 `node` 直接跑），所以 dev 通过 = prod 通过。

## 运维 / 管理

通过 `/v1/admin/*` HTTP 端点管理平台，需要 `Authorization: Bearer <ADMIN_PASSWORD>`。详见 [docs/superpowers/skill.md §X](docs/superpowers/skill.md)。