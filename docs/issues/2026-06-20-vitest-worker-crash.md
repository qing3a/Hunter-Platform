# ISSUE: vitest worker 偶发崩溃导致测试文件报告不全

> **Status**: Open
> **Date**: 2026-06-20
> **Severity**: Medium (cosmetic — no test correctness impact, but CI noise)
> **Affects**: `pnpm test` on Windows (MINGW64) when running > ~80 test files

---

## 现象

跑 `pnpm test` 时，`Test Files` 和 `Tests` 计数偶尔会少 1-5 个：

```
 Test Files  11 passed (12)        ← 期望 12，但只跑了 11
      Tests  97 passed (101)       ← 期望 101，少 4
     Errors  1 error               ← Worker exited unexpectedly
```

每次跑结果不同——少 0 个 / 少 4 个 / 少 5 个 都见过。崩溃发生在随机的 worker，不是固定文件。**单独跑任何单个文件 100% 通过**。

## 最小复现

```bash
cd D:/dev/hunter-platform
# 跑 5 次，至少 1 次会出现 worker 崩溃
for i in 1 2 3 4 5; do
  echo "=== Run $i ==="
  pnpm test 2>&1 | tail -5
done
```

**期望**：5 次结果都显示 `Test Files X passed (X)`（无 missing）
**实际**：5 次中至少 1 次出现 `(N+1)`，且有 `Worker exited unexpectedly` 错误

## 影响

- **不影响测试正确性**：单独跑每个文件都过
- **影响 CI 噪音**：在 CI 上看到 "1 error" 容易让人以为有 bug
- **影响覆盖率统计**：少跑的 4-5 个文件本次不被计入覆盖率

## 已排除的可能性

- [x] **不是测试代码 bug** — 单独跑 100% 通过
- [x] **不是某次具体改动引入** — 改动前后崩溃模式相同（108/116 vs 143/148）
- [x] **不是 OOM** — 内存使用正常
- [x] **不是端口冲突** — supertest 用 in-process app，不占端口
- [x] **不是文件描述符耗尽** — Windows handles 充足

## 临时绕过

```bash
# 方案 A：串行跑（牺牲速度换稳定）
pnpm vitest run --pool=forks --poolOptions.forks.singleFork=true

# 方案 B：单线程（更慢但更稳）
pnpm vitest run --no-isolate --pool=threads --poolOptions.threads.singleThread=true
```

**实测**：`--singleFork` 跑 4.65s 完成，无崩溃。

## 推测根因

`tinypool@1.1.1`（vitest 2.1.9 用的 worker 池）在 Windows + MINGW64 环境下的子进程管理有问题。Worker 子进程可能：
- 父进程 stdin 关闭时无法优雅退出
- 并行度高时 IPC 消息丢失
- 某个测试的清理代码（`afterAll`）在 worker fork 时撞上

## 排查建议

1. **升级 vitest** — 当前 v2.1.9，最新 v3.x 可能修了
2. **升级 tinypool** — `pnpm update tinypool` 看看
3. **加 `--bail` 减少并行** — `pnpm test -- --bail=1` 快速定位是哪个 worker 崩
4. **用 GitHub Actions 复现** — 确认是 Windows 特有还是普遍
5. **看 vitest issue tracker** — 搜 "worker exited unexpectedly windows"

## 优先级

**P2** — 知道绕过方法，不阻塞 release。可以合并后单独修。

## 关联

- 本次会话发现于：IPC → HTTP admin 迁移后的全量回归
- 不阻塞：18 个 admin 测试 + 2 个 regression 测试单独跑都过
- 工作区未提交的相关改动：`package.json` (dev 脚本) + `src/main/index.ts` (冗余日志清理)
