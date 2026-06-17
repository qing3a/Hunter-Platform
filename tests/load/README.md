# Load Testing (k6)

性能压测脚本，对应 spec §15.2。

## Prereqs

- 安装 k6：`winget install k6 --source winget`（或 `choco install k6`、macOS：`brew install k6`）
- 启动 API 服务：`pnpm api:dev`

## 准备 API Key

```bash
# 注册 employer 拿 api_key
curl -X POST http://localhost:3000/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"user_type":"employer","name":"loadtest","contact":"loadtest@x.com"}'
# 复制返回的 api_key

# 注册 headhunter 拿 api_key（upload-candidate 需要）
curl -X POST http://localhost:3000/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"user_type":"headhunter","name":"hunter-loadtest","contact":"h@x.com"}'
# 复制 api_key
```

## 运行

```bash
# 1. 500 并发 browse_talent (p99 < 200ms)
API_KEY=hp_live_xxx k6 run tests/load/browse-talent.js

# 2. 50 并发 upload_candidate (p99 < 1s)
HUNTER_KEY=hp_live_yyy CANDIDATE_ID=<某个 candidate_user_id> k6 run tests/load/upload-candidate.js

# 3. 100/min webhook (p99 < 2s)
WEBHOOK_TARGET=http://localhost:3000/v1/webhook/inbound k6 run tests/load/webhook.js

# 4. 200/s rate limit burst (验证 429)
API_KEY=hp_live_xxx k6 run tests/load/rate-limit.js
```

## Targets (per spec §15.2)

| Scenario | Target | Pass Criteria |
|----------|--------|---------------|
| browse_talent 500 concurrent | p99 < 200ms | threshold violation → fail |
| upload_candidate 50 concurrent | p99 < 1s | threshold violation → fail |
| webhook 100/min | p99 < 2s | threshold violation → fail |
| rate_limit 1s bucket | 429 returned | assertion fail |

## 监控

跑压测时另开终端观察 Prometheus 指标：

```bash
# 端点
curl http://localhost:3000/metrics
# 看 hunter_http_request_duration_seconds + hunter_quota_used
```

## CI 集成

k6 失败时 exit code != 0，可在 CI 加：

```bash
k6 run tests/load/browse-talent.js || exit 1
```
