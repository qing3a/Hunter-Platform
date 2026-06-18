# MIMO Handoff — Rate Limit Redesign

## 项目信息
- **工作目录**：`D:\dev\hunter-platform`
- **Git 分支**：`main`（已 commit 完毕）
- **技术栈**：Node.js + Express + TypeScript + SQLite (better-sqlite3) + Zod + vitest

## 任务文件
- **Spec**（设计文档）：`D:\dev\hunter-platform\docs\superpowers\specs\2026-06-19-rate-limit-redesign.md`
- **Plan**（实施计划，TDD 任务分解）：`D:\dev\hunter-platform\docs\superpowers\plans\2026-06-19-rate-limit-redesign.md`

## 工作要求
1. **必读** spec 和 plan，按 plan 顺序执行 17 个 Task
2. 每个 Task 都是 TDD：先写失败测试 → 跑测试确认失败 → 写实现 → 跑测试通过 → commit
3. 每步都要 commit，commit message 用 plan 中给定的格式
4. 不要修改 plan 中已写好的代码示例
5. 遇到 plan 没覆盖的情况，先停下来问用户

## 验证清单
- `pnpm typecheck` 通过
- `pnpm test` 全部通过
- 启动 `pnpm api:dev`，curl 受保护 endpoint 应看到 `RateLimit-Limit: 20, 100, 750` 头

## 实施完成后报告
- 总共 commit 数
- 最终测试通过数
- 任何偏离 plan 的决策

## 注意事项
- 项目用 ESM（`import`/`export`），不要用 CommonJS `require`
- DB schema **不变**（复用 `rate_limit_buckets` 表）
- 旧的 `src/main/modules/rate-limit/bucket.ts` 保留（作为 feature flag 1 的回滚点）
- IP register 限流（5/h）**不在本次范围**
- Daily quota **不在本次范围**
