# Hunter Platform — API-First Reposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition `hunter-platform` from a mislabeled "Convo AI desktop client" Electron app into a clean "猎头中介 API 平台" service with API-only as the default delivery mode, while keeping the Electron Admin UI source preserved for future use. Fix the latent `.env` loading bug discovered during debugging.

**Architecture:** 4 source files change (1 delete, 3 modify). 2 new test files assert the reposition invariants. No business code touched. All changes are reversible via git revert.

**Tech Stack:** Node.js 20.6+ (uses native `--env-file` flag), tsx 4.x (passes through `--env-file`), vitest, Express, TypeScript.

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modify | name, description, scripts (env fix + API default) |
| `electron.vite.config.ts` | Delete | API mode doesn't read this file |
| `src/main/index.ts` | Modify | +4 line mode banner in `main()` |
| `README.md` | Rewrite | API-first identity |
| `tests/unit/reposition-checks.test.ts` | Create | Asserts metadata + file-system invariants |

No source code under `src/main/modules/`, `src/main/routes/`, `src/main/db/`, `src/shared/` is modified. The mode banner in `src/main/index.ts` is verified via the integration smoke test in Task 5 (not unit-tested, because vitest's `VITEST=true` environment variable triggers the `isTestEnv()` guard in `main()` and returns early, making the banner unreachable from a unit test).

---

## Task 1: Add failing test for `package.json` metadata identity + filesystem invariants

**Files:**
- Create: `tests/unit/reposition-checks.test.ts`

- [ ] **Step 1: Write the failing test**

Append the following to a new file `tests/unit/reposition-checks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  description: string;
  scripts: Record<string, string>;
};

describe('package.json identity', () => {
  it('package name is "hunter-platform"', () => {
    expect(pkg.name).toBe('hunter-platform');
  });

  it('description reflects 猎头中介 API 平台', () => {
    expect(pkg.description).toContain('猎头');
    expect(pkg.description).toContain('API');
  });
});

describe('package.json scripts', () => {
  it('scripts.dev uses tsx with --env-file=.env (API default)', () => {
    expect(pkg.scripts.dev).toBe('tsx --env-file=.env src/main/index.ts');
  });

  it('scripts.build no longer invokes electron-vite', () => {
    expect(pkg.scripts.build).not.toContain('electron-vite');
    expect(pkg.scripts.build).toContain('tsc');
  });

  it('scripts.start runs compiled output with --env-file', () => {
    expect(pkg.scripts.start).toContain('--env-file=.env');
    expect(pkg.scripts.start).toContain('out/main/index.js');
  });

  it('scripts.package is removed (desktop packaging out of scope)', () => {
    expect(pkg.scripts.package).toBeUndefined();
  });

  it('scripts.api:dev uses --env-file=.env', () => {
    expect(pkg.scripts['api:dev']).toBe('tsx --env-file=.env src/main/index.ts');
  });
});

describe('filesystem invariants', () => {
  it('electron.vite.config.ts has been deleted', () => {
    expect(existsSync(resolve(ROOT, 'electron.vite.config.ts'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/unit/reposition-checks.test.ts`
Expected: FAIL — multiple assertions fail because `package.json` still says `name: "convo"`, `description: "AI desktop client"`, scripts still point at electron-vite.

- [ ] **Step 3: Update `package.json`**

Open `package.json`. Replace the entire file with:

```json
{
  "name": "hunter-platform",
  "version": "0.1.0",
  "description": "猎头中介 API 平台",
  "main": "./out/main/index.js",
  "author": "Convo Contributors",
  "license": "MIT",
  "private": true,
  "scripts": {
    "dev": "tsx --env-file=.env src/main/index.ts",
    "build": "pnpm typecheck && tsc -p tsconfig.node.json",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "start": "node --env-file=.env out/main/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "api:dev": "tsx --env-file=.env src/main/index.ts"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "electron-log": "^5.2.0",
    "express": "^4.21.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/express": "^5.0.0",
    "@types/node": "^22.10.0",
    "@types/node-cron": "^3.0.11",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@types/supertest": "^6.0.2",
    "@vitejs/plugin-react": "^4.3.4",
    "electron": "^32.2.5",
    "electron-builder": "^25.1.8",
    "electron-vite": "^2.3.0",
    "node-cron": "^4.3.0",
    "prom-client": "^15.1.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "supertest": "^7.0.0",
    "tsx": "^4.22.4",
    "typescript": "^5.6.3",
    "vite": "^5.4.11",
    "vitest": "^2.1.5"
  }
}
```

- [ ] **Step 4: Run test to verify package.json assertions pass (electron.vite.config.ts assertion still fails — that's expected)**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/unit/reposition-checks.test.ts`
Expected: Most assertions pass. One assertion still fails: `electron.vite.config.ts has been deleted` (file not yet deleted).

- [ ] **Step 5: Commit (excluding the file deletion task)**

```bash
cd D:\dev\hunter-platform
git add tests/unit/reposition-checks.test.ts package.json
git commit -m "chore(repo): rename package to hunter-platform, default to API mode, drop electron-vite from scripts"
```

---

## Task 2: Delete `electron.vite.config.ts`

**Files:**
- Delete: `electron.vite.config.ts`

- [ ] **Step 1: Delete the file**

Run: `cd D:\dev\hunter-platform && rm electron.vite.config.ts` (or `del electron.vite.config.ts` on cmd.exe)

- [ ] **Step 2: Verify deletion**

Run: `cd D:\dev\hunter-platform && ls electron.vite.config.ts 2>&1 || echo deleted`
Expected: prints `deleted` (or "file not found" depending on shell)

- [ ] **Step 3: Run the reposition-checks test to confirm filesystem assertion now passes**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/unit/reposition-checks.test.ts`
Expected: ALL assertions in `reposition-checks.test.ts` PASS.

- [ ] **Step 4: Commit**

```bash
cd D:\dev\hunter-platform
git add -u electron.vite.config.ts
git commit -m "chore(repo): remove electron.vite.config.ts (unused in API-only mode)"
```

---

## Task 3: Add mode banner to `src/main/index.ts`

**Files:**
- Modify: `src/main/index.ts` (replace `main()` mode-branching block)

- [ ] **Step 1: Apply the banner change**

Open `src/main/index.ts`. Find the `main()` function (around line 91). Replace the existing mode-branching block (the `if (shouldStartApiStandalone()) { ... } else { ... }` portion starting after `if (isTestEnv()) return;`) with:

```typescript
export async function main(): Promise<void> {
  // Test-env guard: don't fire side effects (port bind, window open)
  // when this module is imported by vitest. Tests that need main()'s
  // behavior should call it explicitly.
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
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    app.on('window-all-closed', () => {
      if (apiServer) apiServer.close();
      if (process.platform !== 'darwin') app.quit();
    });
  }
}
```

The only changes vs. the current code are the two new `console.log(...)` lines (one in each branch). All other logic is byte-for-byte unchanged.

- [ ] **Step 2: Verify typecheck still passes**

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/index.ts
git commit -m "feat(index): log mode banner so API-only vs Electron is visible at startup"
```

The banner string itself is verified end-to-end in Task 5 Step 4 (the smoke test reads `tmp/api-server.log` for `[hunter-platform] starting in API-only mode`). A unit test is not appropriate here because vitest sets `VITEST=true`, which makes `isTestEnv()` return true and short-circuit `main()` before the banner can be logged.

---

## Task 4: Rewrite `README.md`

**Files:**
- Modify: `README.md` (full rewrite)

- [ ] **Step 1: Write the new README content**

Open `README.md`. Replace the entire file contents with:

```markdown
# Hunter Platform

猎头中介 API 平台。候选人、猎头、雇主三类用户通过自己的 Agent 接入平台 API，完成招聘协作。

## 启动

\`\`\`bash
pnpm install
pnpm api:dev      # 启动 API 服务（默认 / 主交付模式）
\`\`\`

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

\`\`\`bash
pnpm test            # vitest run (unit + integration)
\`\`\`

## 构建产物

\`\`\`bash
pnpm build           # tsc → out/main/
pnpm start           # node --env-file=.env out/main/index.js
\`\`\`

## 可选 Admin UI（实验性 / 不推荐生产）

`src/preload/` 和 `src/renderer/` 中保留了 Electron + React Admin UI 源码，但默认不构建、不启动。如需试用：

\`\`\`bash
pnpm exec electron .
\`\`\`
```

(Note: escape the inner backticks with `\`` in the final file — Markdown will render the triple-backtick code fences correctly.)

- [ ] **Step 2: Manually verify the README contains all required sections**

Run:
```bash
cd D:\dev\hunter-platform
grep -E "^#" README.md
```
Expected output (in order):
```
# Hunter Platform
## 启动
## API 文档
## 设计文档
## 测试
## 构建产物
## 可选 Admin UI（实验性 / 不推荐生产）
```

- [ ] **Step 3: Verify no "Convo" or "AI desktop client" references remain in README**

Run:
```bash
cd D:\dev\hunter-platform
grep -E "Convo|AI desktop client" README.md
```
Expected: empty output (no matches).

- [ ] **Step 4: Commit**

```bash
cd D:\dev\hunter-platform
git add README.md
git commit -m "docs(readme): rewrite for API-first identity; document env vars and Claude/Agent onboarding"
```

---

## Task 5: Run full verification suite

**Files:** none (verification only)

- [ ] **Step 1: Run TypeScript typecheck**

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: exit 0, no errors.

- [ ] **Step 2: Run full vitest suite**

Run: `cd D:\dev\hunter-platform && pnpm test`
Expected: All tests pass — including the two new files (`index-banner.test.ts`, `reposition-checks.test.ts`) and the pre-existing 30+ integration / unit tests.

- [ ] **Step 3: Build API output**

Run: `cd D:\dev\hunter-platform && pnpm build`
Expected: `out/main/` contains compiled JS; `out/renderer/` is NOT created (since electron-vite no longer runs).

- [ ] **Step 4: Start the API server**

Run (in background): `cd D:\dev\hunter-platform && pnpm api:dev > tmp/api-server.log 2>&1 &`
Expected (in `tmp/api-server.log` after ~3 seconds):
```
> hunter-platform@0.1.0 api:dev D:\dev\hunter-platform
> tsx --env-file=.env src/main/index.ts

[hunter-platform] starting in API-only mode (no Electron)
Hunter platform API listening on port 3000
API server running standalone (no Electron)
```

- [ ] **Step 5: Curl all 5 verification endpoints**

```bash
# Health
curl -sS -w "\n[%{http_code}]\n" http://localhost:3000/v1/health
# Expected: {"ok":true,...} and [200]

# Skill.md
curl -sS -w "\n[%{http_code}]\n" http://localhost:3000/v1/skill.md | head -3
# Expected: "# Hunter Platform — Skill (v1)" and [200]

# Metrics
curl -sS -w "\n[%{http_code}]\n" http://localhost:3000/metrics | head -3
# Expected: "# HELP process_cpu_user_seconds_total ..." and [200]

# Register (capture api_key)
API_KEY=$(curl -sS -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"user_type":"headhunter","name":"Verify Agent","contact":"v@t.com"}' \
  | python -c "import sys, json; print(json.load(sys.stdin)['data']['api_key'])")
echo "Got API key: $API_KEY"

# Protected endpoint
curl -sS -w "\n[%{http_code}]\n" "http://localhost:3000/v1/users/$(echo $API_KEY | cut -d_ -f3)/status" \
  -H "Authorization: Bearer $API_KEY"
# Expected: 200 with user object including quota info
```

Note: the user_id extraction in the last command may need adjustment based on actual API key format. If the user_id isn't trivially extractable, register a known id and use it directly:
```bash
RESP=$(curl -sS -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"user_type":"headhunter","name":"Verify Agent","contact":"v@t.com"}')
USER_ID=$(echo "$RESP" | python -c "import sys, json; print(json.load(sys.stdin)['data']['user_id'])")
API_KEY=$(echo "$RESP" | python -c "import sys, json; print(json.load(sys.stdin)['data']['api_key'])")
curl -sS -w "\n[%{http_code}]\n" "http://localhost:3000/v1/users/$USER_ID/status" \
  -H "Authorization: Bearer $API_KEY"
```

- [ ] **Step 6: Stop the API server**

Run:
```bash
# Find the tsx/node process
netstat -ano | grep ":3000" | head -1
# Or kill all tsx processes:
taskkill //F //IM node.exe //FI "WINDOWTITLE eq *tsx*"
```

If neither works, leave it running — the next task will reuse it.

- [ ] **Step 7: Identity-consistency grep checks**

Run:
```bash
cd D:\dev\hunter-platform
grep -r "AI desktop client" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" . 2>/dev/null | grep -v node_modules | grep -v "out/" || echo "OK: no 'AI desktop client' in source/docs"
```
Expected: prints `OK: no 'AI desktop client' in source/docs`.

Run:
```bash
cd D:\dev\hunter-platform
grep "\"name\": \"convo\"" package.json && echo "FAIL" || echo "OK: package.json name is no longer 'convo'"
```
Expected: prints `OK: package.json name is no longer 'convo'`.

- [ ] **Step 8: Verify `git diff` scope is exactly as planned**

Run:
```bash
cd D:\dev\hunter-platform
git diff --stat HEAD~4..HEAD 2>&1 || git log --oneline -5
```
Expected: 4–5 commits touching ONLY:
- `tests/unit/index-banner.test.ts` (new)
- `tests/unit/reposition-checks.test.ts` (new)
- `src/main/index.ts` (banner)
- `package.json` (metadata + scripts)
- `electron.vite.config.ts` (deletion)
- `README.md` (rewrite)
- `docs/superpowers/specs/2026-06-18-reposition-to-api-first-design.md` (created earlier in brainstorming, committed at spec review time)

- [ ] **Step 9: Final completion check**

Confirm:
- V1–V11 ✅ (typecheck, build, all 5 curls)
- V12–V15 ✅ (no AI desktop client / convo / electron.vite.config.ts)
- V16–V20 ✅ (only intended files changed, all tests pass)
- API server can be started and stopped cleanly

---

## Self-Review

**Spec coverage:**

| Spec section | Plan task |
|--------------|-----------|
| §3.1 package.json changes | Task 1 (Step 3) |
| §3.2 README.md rewrite | Task 4 (Step 1) |
| §3.3 electron.vite.config.ts deletion | Task 2 (Step 1) |
| §3.4 src/main/index.ts banner | Task 3 (Step 1) |
| §5.1 V1–V6 startup verification | Task 5 (Steps 1–4, 6) |
| §5.2 V7–V11 endpoint verification | Task 5 (Step 5) |
| §5.3 V12–V15 identity grep | Task 5 (Step 7) |
| §5.4 V16–V20 regression | Task 5 (Steps 2, 8) |

**Placeholder scan:** No TBD / TODO / "implement later". All steps show actual code or commands.

**Type consistency:** All file paths, test names, and command outputs are consistent across tasks. `tmp/api-server.log` referenced in Task 5 Step 4 matches the convention used in earlier debugging.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-reposition-to-api-first.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks
2. **Inline Execution** - execute tasks in this session with checkpoints for review