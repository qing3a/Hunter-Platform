# v1.4.1 跨度合并发布 — 执行 AI 提示词

> **用法**：复制本文件全文 → 粘到新 AI 会话开头。

---

## 1. 任务

执行 Hunter Platform v1.4.1 跨度合并发布：1 个 commit + annotated tag v1.4.1 + push + GitHub Release。

**你不是来设计的**。设计已锁定。按 plan 逐步执行、严格验证、失败就停。

## 2. 必读

- **计划**（**主执行手册**）：`docs/superpowers/plans/2026-06-20-v141-changelog-wrapup-plan.md`（~600 行，10 个 task）
- 设计：`docs/superpowers/specs/2026-06-20-v141-changelog-wrapup-design.md`（理解背景）

## 3. 必需 skill

`superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。

## 4. 铁律

1. 按 plan 10 个 task 逐步执行，不修改 plan，不重新设计
2. 4 件套验证（test/typecheck/openapi:check/build）必须全过才能 commit
3. 任何失败立即停下告诉用户，不静默吞错
4. 1 个 commit 装全部（跨度合并），不拆分
5. 不跑 `pnpm openapi:generate` 重生成
6. tag 必须是 annotated + 名字 `v1.4.1` + tagger `ZCode`
7. **Task 9 push 之前必须向用户二次确认**

## 5. 6 道验证门（必须全过）

| 门 | 通过条件 |
|----|---------|
| Test | 391/391 |
| Typecheck | 0 errors |
| OpenAPI check | OK |
| Build | 成功 + `out/main/index.js` 存在 |
| Git | commit + annotated tag 都在 |
| Push + Release | 远端 tag + GitHub Release 都在 |

## 6. 何时停下问用户

- 任何验证失败 / 命令报错 / 数字不一致
- Task 9 push 前（问："即将 push v1.4.1 到 qing3a/Hunter-Platform，确认？")
- plan 中"停下来告诉用户"的地方

## 7. 失败回滚

| 阶段 | 命令 |
|------|------|
| commit 失败 | `git reset --soft HEAD~1` + `git restore --staged .` |
| tag 失败 | `git tag -d v1.4.1` |
| push 后撤回 | `git push origin :v1.4.1` + `git revert HEAD` + `git push origin main` |
| Release 后撤回 | `gh release delete v1.4.1 --yes` |

## 8. 汇报

- 每个 task 完：`✅ Task N 完成 + 实际数字`
- 全部完：`🎉 完成 + commit SHA / tag SHA / release URL / 6 道门状态`

## 9. 开始

读完 spec + plan 后回 `已读，准备开始 Task 1`，然后跑 `pnpm test`。
