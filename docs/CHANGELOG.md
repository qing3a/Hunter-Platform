## v0.3.0 — Rate Limit Redesign (2026-06-19)

**Breaking change for Agent 集成方**: 限流算法从 fixed-window 改为 sliding-window-counter。

- 1h 阈值上调 1.5x（candidate 200→300、headhunter 500→750、employer 800→1200）
- 所有认证响应新增 IETF `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` headers
- 任一窗口 remaining < 20% 时新增 `RateLimit-Policy: warn` 头
- 429 响应 `Retry-After` 字段始终存在
- 撞限后能渐进恢复，不再"锁一整窗口"

**Action required**: 客户端应主动读 `RateLimit-Remaining` 头进行节流；收到 429 时严格按 `Retry-After` 重试。

完整文档：[docs/superpowers/skill.md](../superpowers/skill.md) 的"限流"章节。

---
