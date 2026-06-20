# Hunter Platform

猎头中介 API 平台。候选人、猎头、雇主三类用户通过自己的 Agent 接入平台 API，完成招聘协作。

## 启动

```bash
pnpm install
pnpm api:dev      # 启动 API 服务（默认 / 主交付模式）
```

服务监听 `http://localhost:3000`（端口由 `.env` 的 `PORT` 控制，默认 3000）。

`.env` 必须包含以下字段：

- `PLATFORM_ENCRYPTION_KEY`（base64 编码 32 字节）
- `WEBHOOK_HMAC_SECRET`（≥16 字符）
- `ADMIN_PASSWORD_HASH`（bcrypt 哈希，≥20 字符）

## API 文档

Claude / 其他 Agent 通过以下 endpoint 接入：

- `GET http://localhost:3000/v1/skill.md` — 完整 skill 文档
- `GET http://localhost:3000/v1/openapi.json` — OpenAPI 3.0 spec
- `GET http://localhost:3000/v1/health` — 健康检查

## 设计文档

- [docs/superpowers/specs/2026-06-17-hunter-platform-design.md](docs/superpowers/specs/2026-06-17-hunter-platform-design.md)
- [docs/superpowers/specs/2026-06-18-reposition-to-api-first-design.md](docs/superpowers/specs/2026-06-18-reposition-to-api-first-design.md)
- [docs/superpowers/specs/2026-06-18-action-history-and-industry-map-design.md](docs/superpowers/specs/2026-06-18-action-history-and-industry-map-design.md)

## 测试

```bash
pnpm test            # vitest run (unit + integration)
```

## 构建产物

```bash
pnpm build           # tsc → out/main/
pnpm start           # node --env-file=.env out/main/index.js
```

## 运维 / 管理

通过 `POST /v1/admin/*` HTTP 端点管理平台。需要 `ADMIN_PASSWORD_HASH` 环境变量配置管理员密码（bcrypt 哈希）。详见 [docs/superpowers/skill.md §X](docs/superpowers/skill.md)。