## v0.3.1 — Misc Fixes (2026-06-19)

**功能新增**:
- `POST /v1/candidate/recommendations/:id/approve-unlock` 后，employer 端会收到新 webhook 事件 `notify_unlock_approved`（payload: recommendation_id / anonymized_candidate_id / candidate_user_id / approved_at，不含 PII）

**文档补充**:
- `view_url` 字段在 skill.md 新增"视图链接"章节

**API 变更**:
- Job 对象的 `requirements` 字段已从 API 表面删除。客户端不要再依赖该字段。
- 请求 `Content-Type` 校验：非 GET 请求必须为 `application/json`（含或不含 charset 都行，**默认 utf-8** per RFC 8259）或 `application/json; charset=utf-8`。`charset=gbk` 等错误编码返回 400 `INVALID_CHARSET`。

**质量改进**:
- `SCHOOL_TIERS` 扩到完整 39 所 985（之前只 6 所，其他 985 校会错误地映射为 "普通"）

---

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
