# Reference Agent

A TypeScript script that exercises every endpoint documented in `docs/superpowers/skill.md`.

Use cases:
1. Contract test — validates docs match code
2. Reference implementation — shows real users how to call API
3. Smoke test — catches docs/code drift

## Run

```bash
# Terminal 1: start server
cd D:\dev\hunter-platform
pnpm api:dev

# Terminal 2: run agent
npx tsx examples/reference-agent/src/index.ts
```

## Output

```
🚀 Reference Agent — testing http://localhost:3000

--- Scenario 0: Public endpoints ---
  ✓ GET    /v1/health        → 200
  ...

============================================================
Summary: 27/27 passed, 0 failed
```

Exit code 0 if all pass, 1 otherwise.

## Coverage

27 endpoints: 8 public + 4 config + 1 auth + 6 user + 7 employer + 6 headhunter + 4 candidate + 2 view tokens. Each endpoint is called at least once with state validation.
