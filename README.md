# Hunter Platform

猎头中介 API 平台。候选人、猎头、雇主三类用户通过自己的 Agent 接入平台 API，完成招聘协作。

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
npx tsx examples/reference-agent/src/index.ts   # 37 端点冒烟
```

## 构建产物（生产部署）

```bash
pnpm build           # tsc → out/main/
pnpm start           # node --env-file=.env out/main/index.js
```

`pnpm dev` 和 `pnpm start` 的进程树形状完全一致（都是 `node` 直接跑），所以 dev 通过 = prod 通过。

## 运维 / 管理

通过 `/v1/admin/*` HTTP 端点管理平台，需要 `Authorization: Bearer <ADMIN_PASSWORD>`。详见 [docs/superpowers/skill.md §X](docs/superpowers/skill.md)。