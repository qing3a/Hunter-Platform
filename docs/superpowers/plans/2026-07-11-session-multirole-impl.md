# Session Token + Multi-Role Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session token auth + multi-role + X-Active-Role to enable ow-recruit M6 integration, while keeping existing apikey auth working.

**Architecture:** Dual-track auth (apikey OR session). New `user_role` table gives each user all 3 roles (pm/hr/candidate); `session` table tracks long-lived auth with `active_role`. `X-Active-Role` header switches active role within session. RBAC enforced via `roleGate` middleware.

**Tech Stack:** Existing stack: Node.js + Express + better-sqlite3 + Zod + Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-11-session-and-multirole-design.md`

---

## Working tree rules

- Branch from `main` → `feature/session-multirole`
- Use `git add <exact-path>` for files YOU create/modify. NEVER `-A`/`-u`/`.`
- Worktree discipline: don't touch unrelated WIP files

---

## Task 0: Pre-flight (5 min)

- [ ] **Step 1: Verify baseline**

```bash
cd D:/dev/hunter-platform
git checkout main
git pull origin main
pnpm exec tsc --build        # expect exit 0
pnpm test 2>&1 | tail -5     # expect baseline pass count
```

Expected: tsc exit 0; tests pass.

- [ ] **Step 2: Create feature branch**

```bash
git checkout -b feature/session-multirole
```

---

## Task 1: Migration v031 + SQL (10 min)

**Files:**
- Create: `src/main/db/migrations/v031_session_and_multirole.sql`

- [ ] **Step 1: Write the migration SQL**

Create file with content:

```sql
-- Migration v031: session token + multi-role (R1.C2)
-- See docs/superpowers/specs/2026-07-11-session-and-multirole-design.md §3

CREATE TABLE user_role (
  user_id    TEXT NOT NULL REFERENCES user(id),
  role       TEXT NOT NULL CHECK (role IN ('pm','hr','candidate')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);
CREATE INDEX idx_user_role_user ON user_role(user_id);

CREATE TABLE session (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES user(id),
  active_role  TEXT NOT NULL CHECK (active_role IN ('pm','hr','candidate')),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at   TEXT,
  ip_address   TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_session_user    ON session(user_id);
CREATE INDEX idx_session_expires ON session(expires_at);

-- Remap legacy user_type values
UPDATE user SET user_type = 'hr' WHERE user_type = 'headhunter';
UPDATE user SET user_type = 'pm' WHERE user_type = 'employer';

-- Backfill: every existing user gets all 3 roles
INSERT INTO user_role (user_id, role, granted_at)
SELECT id, 'pm',        datetime('now') FROM user;
INSERT INTO user_role (user_id, role, granted_at)
SELECT id, 'hr',        datetime('now') FROM user;
INSERT INTO user_role (user_id, role, granted_at)
SELECT id, 'candidate', datetime('now') FROM user;
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/migration-v031.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';

describe('migration v031: session + user_role', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(':memory:');
    // Bootstrap minimal schema (mimics prior migrations)
    db.exec(`
      CREATE TABLE user (
        id TEXT PRIMARY KEY,
        user_type TEXT NOT NULL CHECK (user_type IN ('pm','hr','candidate','headhunter','employer')),
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.exec(`INSERT INTO user (id, user_type, name, created_at) VALUES ('u1', 'headhunter', 'Alice', '2026-01-01');`);
    db.exec(`INSERT INTO user (id, user_type, name, created_at) VALUES ('u2', 'employer', 'Bob', '2026-01-01');`);
    db.exec(`INSERT INTO user (id, user_type, name, created_at) VALUES ('u3', 'candidate', 'Carol', '2026-01-01');`);
    // Load v031
    const sql = require('node:fs').readFileSync('src/main/db/migrations/v031_session_and_multirole.sql', 'utf8');
    db.exec(sql);
  });
  afterAll(() => db.close());

  it('remaps headhunter→hr and employer→pm', () => {
    expect(db.prepare(`SELECT user_type FROM user WHERE id='u1'`).get()).toEqual({ user_type: 'hr' });
    expect(db.prepare(`SELECT user_type FROM user WHERE id='u2'`).get()).toEqual({ user_type: 'pm' });
    expect(db.prepare(`SELECT user_type FROM user WHERE id='u3'`).get()).toEqual({ user_type: 'candidate' });
  });

  it('backfills all 3 roles for every user', () => {
    const rows = db.prepare(`SELECT user_id, role FROM user_role ORDER BY user_id, role`).all();
    expect(rows).toEqual([
      { user_id: 'u1', role: 'pm' },
      { user_id: 'u1', role: 'hr' },
      { user_id: 'u1', role: 'candidate' },
      { user_id: 'u2', role: 'pm' },
      { user_id: 'u2', role: 'hr' },
      { user_id: 'u2', role: 'candidate' },
      { user_id: 'u3', role: 'pm' },
      { user_id: 'u3', role: 'hr' },
      { user_id: 'u3', role: 'candidate' },
    ]);
  });

  it('creates session table', () => {
    const cols = db.prepare(`PRAGMA table_info(session)`).all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('user_id');
    expect(colNames).toContain('active_role');
    expect(colNames).toContain('expires_at');
    expect(colNames).toContain('revoked_at');
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/migration-v031.test.ts`
Expected: PASS (3 tests pass)

- [ ] **Step 4: Commit**

```bash
git add src/main/db/migrations/v031_session_and_multirole.sql tests/integration/migration-v031.test.ts
git commit -m "feat(db): migration v031 — session table + user_role + role backfill"
```

---

## Task 2: user-role repository (15 min)

**Files:**
- Create: `src/main/db/repositories/user-roles.ts`
- Test: `tests/unit/user-roles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/user-roles.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

describe('user-roles repo', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);`);
    db.exec(`INSERT INTO user VALUES ('u1','Alice','2026-01-01'), ('u2','Bob','2026-01-01');`);
  });

  it('grantRole adds a role', async () => {
    const { userRolesRepo } = await import('../../../src/main/db/repositories/user-roles.js');
    userRolesRepo.grant(db, 'u1', 'pm', '2026-01-01');
    const roles = userRolesRepo.list(db, 'u1');
    expect(roles).toEqual(['pm']);
  });

  it('grantRole is idempotent (PRIMARY KEY conflict ignored)', async () => {
    const { userRolesRepo } = await import('../../../src/main/db/repositories/user-roles.js');
    userRolesRepo.grant(db, 'u1', 'pm', '2026-01-01');
    userRolesRepo.grant(db, 'u1', 'pm', '2026-01-02');  // second insert should not throw
    const roles = userRolesRepo.list(db, 'u1');
    expect(roles).toEqual(['pm']);
  });

  it('grantAll adds all 3 roles', async () => {
    const { userRolesRepo } = await import('../../../src/main/db/repositories/user-roles.js');
    userRolesRepo.grantAll(db, 'u1', '2026-01-01');
    expect(userRolesRepo.list(db, 'u1').sort()).toEqual(['candidate', 'hr', 'pm']);
  });

  it('revoke removes a role', async () => {
    const { userRolesRepo } = await import('../../../src/main/db/repositories/user-roles.js');
    userRolesRepo.grantAll(db, 'u1', '2026-01-01');
    userRolesRepo.revoke(db, 'u1', 'pm');
    expect(userRolesRepo.list(db, 'u1').sort()).toEqual(['candidate', 'hr']);
  });

  it('isInRole returns true/false correctly', async () => {
    const { userRolesRepo } = await import('../../../src/main/db/repositories/user-roles.js');
    userRolesRepo.grant(db, 'u1', 'pm', '2026-01-01');
    expect(userRolesRepo.isInRole(db, 'u1', 'pm')).toBe(true);
    expect(userRolesRepo.isInRole(db, 'u1', 'hr')).toBe(false);
    expect(userRolesRepo.isInRole(db, 'u2', 'pm')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/user-roles.test.ts`
Expected: FAIL with "Cannot find module '../../../src/main/db/repositories/user-roles.js'"

- [ ] **Step 3: Implement the repo**

Create `src/main/db/repositories/user-roles.ts`:

```typescript
import type Database from 'better-sqlite3';

export type Role = 'pm' | 'hr' | 'candidate';
export const ALL_ROLES: Role[] = ['pm', 'hr', 'candidate'];

export const userRolesRepo = {
  grant(db: Database.Database, userId: string, role: Role, grantedAt: string) {
    db.prepare(
      `INSERT OR IGNORE INTO user_role (user_id, role, granted_at) VALUES (?, ?, ?)`,
    ).run(userId, role, grantedAt);
  },

  grantAll(db: Database.Database, userId: string, grantedAt: string) {
    for (const role of ALL_ROLES) {
      this.grant(db, userId, role, grantedAt);
    }
  },

  revoke(db: Database.Database, userId: string, role: Role) {
    db.prepare(`DELETE FROM user_role WHERE user_id = ? AND role = ?`).run(userId, role);
  },

  list(db: Database.Database, userId: string): Role[] {
    const rows = db.prepare(`SELECT role FROM user_role WHERE user_id = ?`).all(userId) as Array<{ role: Role }>;
    return rows.map(r => r.role);
  },

  isInRole(db: Database.Database, userId: string, role: Role): boolean {
    const row = db.prepare(`SELECT 1 AS x FROM user_role WHERE user_id = ? AND role = ?`).get(userId, role);
    return !!row;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/user-roles.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/db/repositories/user-roles.ts tests/unit/user-roles.test.ts
git commit -m "feat(repo): user-roles repo (grantAll, list, isInRole, revoke)"
```

---

## Task 3: session repository + service (20 min)

**Files:**
- Create: `src/main/db/repositories/sessions.ts`
- Create: `src/main/modules/auth/session.ts` (service: createSession/resolveSession/revokeSession/refreshSession)
- Test: `tests/unit/sessions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/sessions.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

const SESSION_TTL_HOURS = 24 * 7;  // 1 week (168h), per spec D4

describe('session repo + service', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);`);
    db.exec(`INSERT INTO user VALUES ('u1','Alice','2026-01-01');`);
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, active_role TEXT NOT NULL,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT NOT NULL,
        revoked_at TEXT, ip_address TEXT, user_agent TEXT
      );
    `);
    db.exec(`CREATE TABLE user_role (user_id TEXT NOT NULL, role TEXT NOT NULL, granted_at TEXT NOT NULL, PRIMARY KEY (user_id, role));`);
    db.exec(`INSERT INTO user_role VALUES ('u1','pm','2026-01-01'),('u1','hr','2026-01-01'),('u1','candidate','2026-01-01');`);
  });

  it('createSession returns a session with 168h TTL', async () => {
    const { sessionService } = await import('../../../src/main/modules/auth/session.js');
    const s = sessionService.create(db, 'u1', 'pm', '1.2.3.4', 'agent/1.0');
    expect(s.id).toMatch(/^sess_[a-zA-Z0-9]{32}$/);
    expect(s.user_id).toBe('u1');
    expect(s.active_role).toBe('pm');
    const hours = (new Date(s.expires_at).getTime() - new Date(s.created_at).getTime()) / 3_600_000;
    expect(hours).toBeCloseTo(SESSION_TTL_HOURS, 0);
  });

  it('resolveSession returns active session + roles', async () => {
    const { sessionService } = await import('../../../src/main/modules/auth/session.js');
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const r = sessionService.resolve(db, s.id);
    expect(r).toMatchObject({
      session_id: s.id,
      user_id: 'u1',
      active_role: 'pm',
      available_roles: expect.arrayContaining(['pm', 'hr', 'candidate']),
    });
  });

  it('resolveSession returns null if expired', async () => {
    const { sessionService } = await import('../../../src/main/modules/auth/session.js');
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    db.prepare(`UPDATE session SET expires_at = ? WHERE id = ?`).run('2020-01-01T00:00:00Z', s.id);
    expect(sessionService.resolve(db, s.id)).toBeNull();
  });

  it('resolveSession returns null if revoked', async () => {
    const { sessionService } = await import('../../../src/main/modules/auth/session.js');
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    sessionService.revoke(db, s.id);
    expect(sessionService.resolve(db, s.id)).toBeNull();
  });

  it('resolveSession switches active_role when requested and valid', async () => {
    const { sessionService } = await import('../../../src/main/modules/auth/session.js');
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const r = sessionService.resolve(db, s.id, 'hr');
    expect(r?.active_role).toBe('hr');
  });

  it('resolveSession returns null if requested role not in available_roles', async () => {
    const { sessionService } = await import('../../../src/main/modules/auth/session.js');
    db.exec(`DELETE FROM user_role WHERE user_id = 'u1' AND role = 'hr';`);
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    expect(sessionService.resolve(db, s.id, 'hr')).toBeNull();
  });

  it('refreshSession extends expiry by 168h (sliding window)', async () => {
    const { sessionService } = await import('../../../src/main/modules/auth/session.js');
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const originalExpiry = s.expires_at;
    // advance "now" by pretending the test is at a later time
    await new Promise(r => setTimeout(r, 5));
    const refreshed = sessionService.refresh(db, s.id);
    expect(refreshed.expires_at >= originalExpiry).toBe(true);
  });

  it('refreshSession can switch role', async () => {
    const { sessionService } = await import('../../../src/main/modules/auth/session.js');
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const r = sessionService.refresh(db, s.id, 'hr');
    expect(r.active_role).toBe('hr');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/sessions.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement sessions repo**

Create `src/main/db/repositories/sessions.ts`:

```typescript
import type Database from 'better-sqlite3';

export type SessionRow = {
  id: string;
  user_id: string;
  active_role: 'pm' | 'hr' | 'candidate';
  created_at: string;
  expires_at: string;
  last_used_at: string;
  revoked_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
};

export const sessionsRepo = {
  insert(db: Database.Database, row: SessionRow) {
    db.prepare(`
      INSERT INTO session (id, user_id, active_role, created_at, expires_at, last_used_at, revoked_at, ip_address, user_agent)
      VALUES (@id, @user_id, @active_role, @created_at, @expires_at, @last_used_at, @revoked_at, @ip_address, @user_agent)
    `).run(row);
  },

  findActive(db: Database.Database, id: string): SessionRow | undefined {
    return db.prepare(`SELECT * FROM session WHERE id = ? AND revoked_at IS NULL`).get(id) as SessionRow | undefined;
  },

  updateLastUsed(db: Database.Database, id: string, lastUsedAt: string, activeRole: string) {
    db.prepare(`UPDATE session SET last_used_at = ?, active_role = ? WHERE id = ?`).run(lastUsedAt, activeRole, id);
  },

  updateExpiry(db: Database.Database, id: string, expiresAt: string, activeRole: string) {
    db.prepare(`UPDATE session SET expires_at = ?, active_role = ?, last_used_at = ? WHERE id = ?`).run(expiresAt, activeRole, new Date().toISOString(), id);
  },

  revoke(db: Database.Database, id: string) {
    db.prepare(`UPDATE session SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).run(new Date().toISOString(), id);
  },
};
```

- [ ] **Step 4: Implement session service**

Create `src/main/modules/auth/session.ts`:

```typescript
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { sessionsRepo, type SessionRow } from '../../db/repositories/sessions.js';
import { userRolesRepo, type Role } from '../../db/repositories/user-roles.js';

export const SESSION_TTL_HOURS = 24 * 7;  // 168h = 1 week, per spec D4
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;

function generateSessionId(): string {
  let body = '';
  while (body.length < 32) {
    body += crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, '');
  }
  return 'sess_' + body.slice(0, 32);
}

export type ResolvedSession = {
  session_id: string;
  user_id: string;
  active_role: Role;
  available_roles: Role[];
};

export const sessionService = {
  create(db: Database.Database, userId: string, activeRole: Role, ip: string | null, userAgent: string | null) {
    const id = generateSessionId();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    sessionsRepo.insert(db, {
      id, user_id: userId, active_role: activeRole,
      created_at: now, expires_at: expiresAt, last_used_at: now,
      revoked_at: null, ip_address: ip, user_agent: userAgent,
    });
    return { id, user_id: userId, active_role: activeRole, expires_at: expiresAt };
  },

  resolve(db: Database.Database, sessionId: string, requestedRole?: string): ResolvedSession | null {
    const row = sessionsRepo.findActive(db, sessionId);
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;

    const availableRoles = userRolesRepo.list(db, row.user_id) as Role[];
    const targetRole = (requestedRole ?? row.active_role) as Role;
    if (!availableRoles.includes(targetRole)) return null;

    sessionsRepo.updateLastUsed(db, sessionId, new Date().toISOString(), targetRole);

    return {
      session_id: row.id,
      user_id: row.user_id,
      active_role: targetRole,
      available_roles: availableRoles,
    };
  },

  refresh(db: Database.Database, sessionId: string, newActiveRole?: string): { session_id: string; active_role: Role; expires_at: string } | null {
    const row = sessionsRepo.findActive(db, sessionId);
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;

    const availableRoles = userRolesRepo.list(db, row.user_id) as Role[];
    const targetRole = (newActiveRole ?? row.active_role) as Role;
    if (!availableRoles.includes(targetRole)) return null;

    const newExpiry = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    sessionsRepo.updateExpiry(db, sessionId, newExpiry, targetRole);
    return { session_id: sessionId, active_role: targetRole, expires_at: newExpiry };
  },

  revoke(db: Database.Database, sessionId: string): void {
    sessionsRepo.revoke(db, sessionId);
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/sessions.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add src/main/db/repositories/sessions.ts src/main/modules/auth/session.ts tests/unit/sessions.test.ts
git commit -m "feat(auth): session repo + service (create/resolve/refresh/revoke, 168h TTL)"
```

---

## Task 4: Dual-track auth middleware (20 min)

**Files:**
- Modify: `src/main/middleware/auth.ts` (or wherever `authMiddleware` lives — find via `grep -rn "authMiddleware" src/main/`)
- Test: `tests/integration/auth-middleware-dual.test.ts`

- [ ] **Step 1: Find current authMiddleware location**

```bash
cd D:/dev/hunter-platform
grep -rln "authMiddleware\|export.*AuthedUser\|export.*AuthenticatedUser" src/main/ | head -5
```

Read the file to understand current shape. Identify what `req.user` looks like today.

- [ ] **Step 2: Write the failing test**

Create `tests/integration/auth-middleware-dual.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { authMiddleware } from '../../../src/main/middleware/auth.js';

describe('dual-track authMiddleware', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeAll(async () => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, created_at TEXT);`);
    db.exec(`CREATE TABLE user_role (user_id TEXT NOT NULL, role TEXT NOT NULL, granted_at TEXT, PRIMARY KEY (user_id, role));`);
    db.exec(`CREATE TABLE api_key (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_hash TEXT NOT NULL, prefix TEXT NOT NULL, created_at TEXT, revoked_at TEXT);`);
    db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, active_role TEXT NOT NULL, created_at TEXT, expires_at TEXT, last_used_at TEXT, revoked_at TEXT, ip_address TEXT, user_agent TEXT);`);
    db.exec(`INSERT INTO user VALUES ('u1','Alice','2026-01-01');`);
    db.exec(`INSERT INTO user_role VALUES ('u1','pm','2026-01-01'),('u1','hr','2026-01-01'),('u1','candidate','2026-01-01');`);
    // bcrypt hash of 'secret-key' (precomputed for tests)
    db.prepare(`INSERT INTO api_key VALUES ('k1','u1','$2b$10$abcdefghijklmnopqrstuv','hp_test','2026-01-01', NULL)`).run();

    app = express();
    app.get('/whoami', authMiddleware(db), (req, res) => res.json(req.user));
  });
  afterAll(() => db.close());

  it('rejects when no Authorization header', async () => {
    const r = await request(app).get('/whoami');
    expect(r.status).toBe(401);
  });

  it('rejects unknown token format', async () => {
    const r = await request(app).get('/whoami').set('Authorization', 'Bearer garbage_xxx');
    expect(r.status).toBe(401);
  });

  it('resolves session token and exposes active_role', async () => {
    const { sessionService } = await import('../../../src/main/modules/auth/session.js');
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const r = await request(app).get('/whoami').set('Authorization', `Bearer ${s.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: 'u1',
      active_role: 'pm',
      auth_method: 'session',
      roles: expect.arrayContaining(['pm', 'hr', 'candidate']),
    });
  });

  it('switches active_role via X-Active-Role header (session)', async () => {
    const { sessionService } = await import('../../../src/main/modules/auth/session.js');
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const r = await request(app).get('/whoami').set('Authorization', `Bearer ${s.id}`).set('X-Active-Role', 'hr');
    expect(r.body.active_role).toBe('hr');
  });

  it('rejects X-Active-Role not in user.available_roles', async () => {
    const { sessionService } = await import('../../../src/main/modules/auth/session.js');
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const r = await request(app).get('/whoami').set('Authorization', `Bearer ${s.id}`).set('X-Active-Role', 'pm').set('X-Active-Role', 'fake_role');
    // 403: invalid role
  });
  // Note: additional cases (apikey path, 401 vs 403) added by subagent based on actual middleware impl
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/auth-middleware-dual.test.ts`
Expected: FAIL — likely either can't compile (AuthedUser type mismatch) or runtime failure on missing fields.

- [ ] **Step 4: Refactor middleware to dual-track**

Read current `src/main/middleware/auth.ts`. Modify so that:

1. `Authorization: Bearer sess_*` → use `sessionService.resolve()`
2. `Authorization: Bearer hp_live_*` → use existing apikey lookup (unchanged path)
3. Both paths populate `req.user` with shape:
   ```typescript
   type AuthedUser = {
     id: string;
     name: string;
     roles: Role[];
     active_role: Role;
     auth_method: 'session' | 'apikey';
     session_id?: string;
   };
   ```
4. `X-Active-Role` header:
   - session path: pass to `sessionService.resolve(token, requestedRole)` — server validates
   - apikey path: ignore / 400 (apikey doesn't support role switching)
5. Backward compat: keep populating `req.user.user_type` with remapped value (pm/hr/candidate)

Implementation guidance (concrete code blocks): see existing middleware — adapt to add session branch before apikey branch.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/auth-middleware-dual.test.ts`
Expected: PASS

- [ ] **Step 6: Run full existing test suite to ensure no regressions**

Run: `pnpm test 2>&1 | tail -10`
Expected: same pass count as baseline (no regressions)

- [ ] **Step 7: Commit**

```bash
git add src/main/middleware/auth.ts tests/integration/auth-middleware-dual.test.ts
git commit -m "feat(auth): dual-track middleware (session + apikey) with X-Active-Role"
```

---

## Task 5: Modify register endpoint (auto-grant 3 roles) (10 min)

**Files:**
- Modify: `src/main/modules/register/handler.ts`
- Modify: `src/main/routes/auth.ts` (if response shape needs update)

- [ ] **Step 1: Find register handler**

```bash
grep -rln "createRegisterHandler\|register/handler" src/main/ | head -5
```

Read current handler to understand:
- What it inserts into `user` and `api_key`
- What it returns
- Where the response shape is defined

- [ ] **Step 2: Modify register handler to grant 3 roles**

In `src/main/modules/register/handler.ts`, after the `user` and `api_key` INSERT statements, add:

```typescript
import { userRolesRepo } from '../../db/repositories/user-roles.js';

// ... existing code that inserts into user and api_key ...

// Auto-grant all 3 roles (per spec D3)
userRolesRepo.grantAll(db, userId, new Date().toISOString());
```

If the handler is in a transaction, the grantAll goes inside the transaction.

- [ ] **Step 3: Update register response to include available_roles**

Find the register response schema (likely `RegisterResponseSchema` in `src/main/schemas/auth.ts`). Add:

```typescript
available_roles: z.array(z.enum(['pm', 'hr', 'candidate'])),
```

Find the respond() call in auth.ts and include `available_roles: userRolesRepo.list(db, user.id)`.

- [ ] **Step 4: Write failing test (if not already covered)**

Add to `tests/integration/auth-register.test.ts`:

```typescript
it('register response includes available_roles with all 3', async () => {
  const r = await request(app).post('/v1/auth/register').send({ user_type: 'pm', name: 'Test' });
  expect(r.body.data.available_roles.sort()).toEqual(['candidate', 'hr', 'pm']);
});

it('register accepts legacy user_type "headhunter" and remaps to hr', async () => {
  const r = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'Test2' });
  expect(r.status).toBe(200);
  expect(r.body.data.user_type).toBe('hr');
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/auth-register.test.ts`
Expected: PASS

- [ ] **Step 6: Run full suite**

Run: `pnpm test 2>&1 | tail -5`
Expected: no regressions

- [ ] **Step 7: Commit**

```bash
git add src/main/modules/register/handler.ts src/main/schemas/auth.ts src/main/routes/auth.ts tests/integration/auth-register.test.ts
git commit -m "feat(register): auto-grant 3 roles + available_roles in response"
```

---

## Task 6: POST /v1/auth/login endpoint (15 min)

**Files:**
- Modify: `src/main/routes/auth.ts` (add login route)
- Modify: `src/main/schemas/auth.ts` (add LoginResponseSchema)

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/auth-login.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { createAuthRouter } from '../../../src/main/routes/auth.js';

describe('POST /v1/auth/login', () => {
  let db: Database.Database;
  let app: express.Express;
  const apiKey = 'hp_live_testkey1234567890';
  const apiKeyHash = bcrypt.hashSync('secret', 10);

  beforeAll(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, created_at TEXT, quota_per_day INTEGER DEFAULT 100, status TEXT DEFAULT 'active');`);
    db.exec(`CREATE TABLE user_role (user_id TEXT NOT NULL, role TEXT NOT NULL, granted_at TEXT, PRIMARY KEY (user_id, role));`);
    db.exec(`CREATE TABLE api_key (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_hash TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE, created_at TEXT, revoked_at TEXT);`);
    db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, active_role TEXT NOT NULL, created_at TEXT, expires_at TEXT, last_used_at TEXT, revoked_at TEXT, ip_address TEXT, user_agent TEXT);`);
    db.exec(`INSERT INTO user VALUES ('u1','Alice','2026-01-01',100,'active');`);
    db.exec(`INSERT INTO user_role VALUES ('u1','pm','2026-01-01'),('u1','hr','2026-01-01'),('u1','candidate','2026-01-01');`);
    db.prepare(`INSERT INTO api_key VALUES ('k1','u1',?,?, '2026-01-01', NULL)`).run(apiKeyHash, apiKey.substring(0, 12));

    app = express();
    app.use(express.json());
    app.use('/v1/auth', createAuthRouter(db, false));
  });
  afterAll(() => db.close());

  it('returns session_id + active_role + available_roles + expires_at', async () => {
    const r = await request(app).post('/v1/auth/login').send({ api_key: apiKey });
    expect(r.status).toBe(200);
    expect(r.body.data.session_id).toMatch(/^sess_[a-zA-Z0-9]{32}$/);
    expect(r.body.data.active_role).toBe('pm');
    expect(r.body.data.available_roles.sort()).toEqual(['candidate', 'hr', 'pm']);
    expect(r.body.data.expires_at).toBeTruthy();
  });

  it('accepts active_role in request body', async () => {
    const r = await request(app).post('/v1/auth/login').send({ api_key: apiKey, active_role: 'hr' });
    expect(r.body.data.active_role).toBe('hr');
  });

  it('rejects active_role not in user.available_roles', async () => {
    const r = await request(app).post('/v1/auth/login').send({ api_key: apiKey, active_role: 'fake' });
    expect(r.status).toBe(403);
  });

  it('returns 401 for invalid api_key', async () => {
    const r = await request(app).post('/v1/auth/login').send({ api_key: 'hp_live_wrong' });
    expect(r.status).toBe(401);
  });

  it('returns 401 for missing api_key', async () => {
    const r = await request(app).post('/v1/auth/login').send({});
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/auth-login.test.ts`
Expected: FAIL with 404 (login route not yet defined)

- [ ] **Step 3: Implement login route**

In `src/main/routes/auth.ts`, add after the existing `/register` route:

```typescript
import { sessionService } from '../modules/auth/session.js';
import { userRolesRepo } from '../db/repositories/user-roles.js';

const LoginSchema = z.object({
  api_key: z.string().min(1),
  active_role: z.enum(['pm', 'hr', 'candidate']).optional(),
});

// Inside createAuthRouter, after the register route:
router.post('/login', (req, res, next) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });

    // Look up user via apikey (mirror existing apikey middleware logic)
    const apiKeyHash = bcrypt.hashSync(parsed.data.api_key, 10);  // WRONG: this re-hashes input. Use proper lookup.
    // ACTUAL: use existing api-key lookup helper (probably in modules/auth/api-key.ts)
    const user = lookupUserByApiKey(db, parsed.data.api_key);  // helper to find via prefix+verify
    if (!user) throw Errors.unauthorized();

    const availableRoles = userRolesRepo.list(db, user.id);
    const targetRole = parsed.data.active_role ?? availableRoles[0];
    if (!availableRoles.includes(targetRole)) {
      throw Errors.forbidden(`Role '${targetRole}' not in user's available roles`);
    }

    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ?? req.socket.remoteAddress ?? null;
    const ua = req.headers['user-agent']?.toString() ?? null;
    const session = sessionService.create(db, user.id, targetRole, ip, ua);

    res.locals.userIdForAudit = user.id;
    res.locals.ahTargetType = 'session';
    res.locals.ahTargetId = session.id;
    res.locals.ahResSummary = { action: 'session_created', active_role: targetRole };

    respond(res, LoginResponseSchema, {
      ok: true,
      data: {
        session_id: session.id,
        user_id: user.id,
        name: user.name,
        active_role: targetRole,
        available_roles: availableRoles,
        expires_at: session.expires_at,
      },
    });
  } catch (e) { next(e); }
});
```

**Note**: The exact apikey lookup helper depends on existing code. Find it via:
```bash
grep -rln "verifyApiKey\|lookupApiKey\|apiKeyLookup" src/main/modules/auth/
```

Use the existing helper. Don't re-implement bcrypt verification.

- [ ] **Step 4: Add LoginResponseSchema**

In `src/main/schemas/auth.ts`:

```typescript
export const LoginResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    session_id: z.string(),
    user_id: z.string(),
    name: z.string(),
    active_role: z.enum(['pm', 'hr', 'candidate']),
    available_roles: z.array(z.enum(['pm', 'hr', 'candidate'])),
    expires_at: z.string(),
  }),
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/auth-login.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/main/routes/auth.ts src/main/schemas/auth.ts tests/integration/auth-login.test.ts
git commit -m "feat(auth): POST /v1/auth/login — returns session_id + active_role"
```

---

## Task 7: POST /v1/auth/refresh endpoint (10 min)

**Files:**
- Modify: `src/main/routes/auth.ts`
- Modify: `src/main/schemas/auth.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/auth-refresh.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { createAuthRouter } from '../../../src/main/routes/auth.js';
import { sessionService } from '../../../src/main/modules/auth/session.js';

describe('POST /v1/auth/refresh', () => {
  let db: Database.Database;
  let app: express.Express;
  let sessionId: string;

  beforeAll(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, created_at TEXT, status TEXT DEFAULT 'active');`);
    db.exec(`CREATE TABLE user_role (user_id TEXT NOT NULL, role TEXT NOT NULL, granted_at TEXT, PRIMARY KEY (user_id, role));`);
    db.exec(`CREATE TABLE api_key (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_hash TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE, created_at TEXT, revoked_at TEXT);`);
    db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, active_role TEXT NOT NULL, created_at TEXT, expires_at TEXT, last_used_at TEXT, revoked_at TEXT, ip_address TEXT, user_agent TEXT);`);
    db.exec(`INSERT INTO user VALUES ('u1','Alice','2026-01-01','active');`);
    db.exec(`INSERT INTO user_role VALUES ('u1','pm','2026-01-01'),('u1','hr','2026-01-01'),('u1','candidate','2026-01-01');`);
    db.prepare(`INSERT INTO api_key VALUES ('k1','u1',?,'hp_test','2026-01-01', NULL)`).run(bcrypt.hashSync('secret', 10));
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    sessionId = s.id;

    app = express();
    app.use(express.json());
    app.use('/v1/auth', createAuthRouter(db, false));
  });
  afterAll(() => db.close());

  it('returns new expires_at', async () => {
    const r = await request(app).post('/v1/auth/refresh').set('Authorization', `Bearer ${sessionId}`);
    expect(r.status).toBe(200);
    expect(r.body.data.session_id).toBe(sessionId);
    expect(r.body.data.active_role).toBe('pm');
    expect(r.body.data.expires_at).toBeTruthy();
  });

  it('switches active_role', async () => {
    const r = await request(app).post('/v1/auth/refresh').set('Authorization', `Bearer ${sessionId}`).send({ active_role: 'hr' });
    expect(r.body.data.active_role).toBe('hr');
  });

  it('rejects active_role not in user.available_roles', async () => {
    const r = await request(app).post('/v1/auth/refresh').set('Authorization', `Bearer ${sessionId}`).send({ active_role: 'fake' });
    expect(r.status).toBe(403);
  });

  it('returns 401 if session revoked', async () => {
    sessionService.revoke(db, sessionId);
    const r = await request(app).post('/v1/auth/refresh').set('Authorization', `Bearer ${sessionId}`);
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/auth-refresh.test.ts`
Expected: FAIL (refresh route not defined)

- [ ] **Step 3: Implement refresh route**

In `src/main/routes/auth.ts`:

```typescript
import { authMiddleware } from '../modules/auth/middleware.js';

const RefreshSchema = z.object({
  active_role: z.enum(['pm', 'hr', 'candidate']).optional(),
});

router.post('/refresh', authMiddleware(db), (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user || user.auth_method !== 'session') throw Errors.unauthorized('Session required');
    const sessionId = user.session_id;

    const parsed = RefreshSchema.safeParse(req.body);
    if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });

    const result = sessionService.refresh(db, sessionId, parsed.data.active_role);
    if (!result) throw Errors.unauthorized('Session invalid or role not allowed');

    res.locals.ahTargetType = 'session';
    res.locals.ahTargetId = result.session_id;
    res.locals.ahResSummary = { action: 'session_refreshed', active_role: result.active_role };

    respond(res, RefreshResponseSchema, {
      ok: true,
      data: result,
    });
  } catch (e) { next(e); }
});
```

- [ ] **Step 4: Add RefreshResponseSchema**

```typescript
export const RefreshResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    session_id: z.string(),
    active_role: z.enum(['pm', 'hr', 'candidate']),
    expires_at: z.string(),
  }),
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/auth-refresh.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/main/routes/auth.ts src/main/schemas/auth.ts tests/integration/auth-refresh.test.ts
git commit -m "feat(auth): POST /v1/auth/refresh — sliding window + optional role switch"
```

---

## Task 8: POST /v1/auth/logout endpoint (5 min)

**Files:**
- Modify: `src/main/routes/auth.ts`
- Modify: `src/main/schemas/auth.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/auth-logout.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { createAuthRouter } from '../../../src/main/routes/auth.js';
import { sessionService } from '../../../src/main/modules/auth/session.js';

describe('POST /v1/auth/logout', () => {
  let db: Database.Database;
  let app: express.Express;
  let sessionId: string;

  beforeAll(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, created_at TEXT, status TEXT DEFAULT 'active');`);
    db.exec(`CREATE TABLE user_role (user_id TEXT NOT NULL, role TEXT NOT NULL, granted_at TEXT, PRIMARY KEY (user_id, role));`);
    db.exec(`CREATE TABLE api_key (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_hash TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE, created_at TEXT, revoked_at TEXT);`);
    db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, active_role TEXT NOT NULL, created_at TEXT, expires_at TEXT, last_used_at TEXT, revoked_at TEXT, ip_address TEXT, user_agent TEXT);`);
    db.exec(`INSERT INTO user VALUES ('u1','Alice','2026-01-01','active');`);
    db.exec(`INSERT INTO user_role VALUES ('u1','pm','2026-01-01');`);
    db.prepare(`INSERT INTO api_key VALUES ('k1','u1',?,'hp_test','2026-01-01', NULL)`).run(bcrypt.hashSync('secret', 10));
    sessionId = sessionService.create(db, 'u1', 'pm', null, null).id;

    app = express();
    app.use(express.json());
    app.use('/v1/auth', createAuthRouter(db, false));
  });
  afterAll(() => db.close());

  it('revokes the session', async () => {
    const r = await request(app).post('/v1/auth/logout').set('Authorization', `Bearer ${sessionId}`);
    expect(r.status).toBe(200);
    expect(sessionService.resolve(db, sessionId)).toBeNull();
  });

  it('is idempotent', async () => {
    const r = await request(app).post('/v1/auth/logout').set('Authorization', `Bearer ${sessionId}`);
    expect(r.status).toBe(200);
  });

  it('rejects without auth', async () => {
    const r = await request(app).post('/v1/auth/logout');
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/auth-logout.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement logout route**

```typescript
router.post('/logout', authMiddleware(db), (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user?.auth_method === 'session' && user.session_id) {
      sessionService.revoke(db, user.session_id);
      res.locals.ahTargetType = 'session';
      res.locals.ahTargetId = user.session_id;
      res.locals.ahResSummary = { action: 'session_revoked' };
    }
    respond(res, z.object({ ok: z.literal(true) }), { ok: true });
  } catch (e) { next(e); }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/auth-logout.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/routes/auth.ts tests/integration/auth-logout.test.ts
git commit -m "feat(auth): POST /v1/auth/logout — revokes session, idempotent"
```

---

## Task 8.5: Modify rotate-key to accept session token (5 min)

**Files:**
- Modify: `src/main/routes/auth.ts` (rotate-key handler)

- [ ] **Step 1: Write failing test**

Append to `tests/integration/auth-rotate-key.test.ts`:

```typescript
it('accepts session token for rotate-key', async () => {
  const r = await request(app).post('/v1/auth/rotate-key').set('Authorization', `Bearer ${sessionId}`);
  expect(r.status).toBe(200);
  expect(r.body.data.new_api_key).toMatch(/^hp_live_/);
});

it('still accepts apikey for rotate-key (backward compat)', async () => {
  const r = await request(app).post('/v1/auth/rotate-key').set('Authorization', `Bearer ${apiKey}`);
  expect(r.status).toBe(200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/auth-rotate-key.test.ts`
Expected: second test passes (existing behavior); first test should already work because `authMiddleware` accepts both. If it fails, debug.

- [ ] **Step 3: Verify behavior**

The existing `rotate-key` route already uses `authMiddleware(db)` (Task 4 made it dual-track). After Task 4, session token auth works automatically.

If first test fails because rotate-key calls a quota function that requires `user.id` directly (not via session), update the handler to extract `user.id` from the resolved auth user (which works for both auth methods):

```typescript
// In rotate-key handler:
const userId = user.id;  // works for both session and apikey paths
const qResult = quota.tryConsume(userId, 1);
// ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/auth-rotate-key.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/integration/auth-rotate-key.test.ts src/main/routes/auth.ts
git commit -m "feat(auth): rotate-key accepts both apikey and session token"
```

---

## Task 9: WebSocket auth — session + role (15 min)

**Files:**
- Modify: `src/main/ws.ts` (or wherever WS handler lives)
- Test: `tests/integration/ws-auth-session.test.ts`

- [ ] **Step 1: Find current WS handler**

```bash
grep -rln "WebSocketServer\|ws://\|new WS" src/main/ | head -5
```

Read it to understand current apikey-on-querystring parsing.

- [ ] **Step 2: Write the failing test**

Create `tests/integration/ws-auth-session.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { sessionService } from '../../../src/main/modules/auth/session.js';
import { startWSServer } from '../../../src/main/ws.js';  // or wherever the start fn is

describe('WS auth via session+role', () => {
  let db: Database.Database;
  let wsServer: any;
  let port: number;

  beforeAll(async () => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, created_at TEXT, status TEXT DEFAULT 'active');`);
    db.exec(`CREATE TABLE user_role (user_id TEXT NOT NULL, role TEXT NOT NULL, granted_at TEXT, PRIMARY KEY (user_id, role));`);
    db.exec(`CREATE TABLE api_key (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_hash TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE, created_at TEXT, revoked_at TEXT);`);
    db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, active_role TEXT NOT NULL, created_at TEXT, expires_at TEXT, last_used_at TEXT, revoked_at TEXT, ip_address TEXT, user_agent TEXT);`);
    db.exec(`INSERT INTO user VALUES ('u1','Alice','2026-01-01','active');`);
    db.exec(`INSERT INTO user_role VALUES ('u1','pm','2026-01-01'),('u1','hr','2026-01-01'),('u1','candidate','2026-01-01');`);
    wsServer = await startWSServer(db, 0);  // bind to ephemeral port
    port = wsServer.port;
  });
  afterAll(() => wsServer.close());

  it('accepts ?session=&role= connection', async () => {
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const ws = await connect(`ws://localhost:${port}/v1/events?session=${s.id}&role=hr`);
    ws.close();
  });

  it('rejects invalid session (close 4001)', async () => {
    const ws = await connectWithError(`ws://localhost:${port}/v1/events?session=sess_invalid&role=pm`);
    expect(ws.closeCode).toBe(4001);
  });

  it('rejects role not in available_roles', async () => {
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    db.prepare(`DELETE FROM user_role WHERE user_id='u1' AND role='hr'`).run();
    const ws = await connectWithError(`ws://localhost:${port}/v1/events?session=${s.id}&role=hr`);
    expect(ws.closeCode).toBe(4001);
  });

  it('still accepts ?key= (backward compat)', async () => {
    const ws = await connect(`ws://localhost:${port}/v1/events?key=hp_live_xxx`);
    ws.close();
  });
});
```

**Note**: helper functions `connect` / `connectWithError` are local test helpers (use `ws` npm package). The `startWSServer` signature depends on existing code; adapt.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/ws-auth-session.test.ts`
Expected: FAIL (WS doesn't accept session param)

- [ ] **Step 4: Modify WS handler**

In WS `connection` handler, BEFORE the apikey lookup branch, add:

```typescript
const sessionToken = url.searchParams.get('session');
const requestedRole = url.searchParams.get('role');

if (sessionToken) {
  const resolved = sessionService.resolve(db, sessionToken, requestedRole ?? undefined);
  if (!resolved) {
    ws.close(4001, 'unauthorized');
    return;
  }
  connectionState = {
    user_id: resolved.user_id,
    active_role: resolved.active_role,
    auth_method: 'session',
    session_id: resolved.session_id,
  };
  // continue with existing subscribe handler
} else {
  // existing apikey path
  const key = url.searchParams.get('key');
  // ... existing logic ...
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/ws-auth-session.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/ws.ts tests/integration/ws-auth-session.test.ts
git commit -m "feat(ws): session+role auth via ?session=&role= query params"
```

---

## Task 10: roleGate middleware + per-endpoint role gates (20 min)

**Files:**
- Create: `src/main/modules/auth/role-gate.ts`
- Modify: `src/main/routes/*.ts` (apply roleGate to specific routes per spec §7.2)
- Test: `tests/integration/auth-rbac.test.ts`

- [ ] **Step 1: Implement roleGate middleware**

Create `src/main/modules/auth/role-gate.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { Errors } from '../../errors.js';
import type { Role } from '../../db/repositories/user-roles.js';

export function roleGate(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) return next(Errors.unauthorized());
    if (!allowedRoles.includes(user.active_role)) {
      return next(Errors.forbidden(`Role '${user.active_role}' not allowed; need one of: ${allowedRoles.join(', ')}`));
    }
    next();
  };
}
```

- [ ] **Step 2: Apply roleGate to specific routes per spec §7.2**

In each route file, find the relevant endpoints and add `roleGate(...)` AFTER `authMiddleware(db)`:

| File | Endpoints | roleGate |
|---|---|---|
| `src/main/routes/candidate.ts` | `/v1/candidate/*` | `roleGate('candidate')` |
| `src/main/routes/headhunter.ts` | `/v1/headhunter/*`, `/v1/jobs` (HR view) | `roleGate('hr')` |
| `src/main/routes/employer.ts` | `/v1/employer/*`, `/v1/employer/matches` | `roleGate('pm')` |
| `src/main/routes/pm.ts` | `/v1/pm/*` (if exists) | `roleGate('pm')` |
| `src/main/routes/candidate-portal.ts` | `/v1/candidate/applications` etc. | `roleGate('candidate')` |
| `src/main/routes/commission.ts` | `/v1/commission/*` | `roleGate('pm', 'hr')` |
| `src/main/routes/headhunter-workspace.ts` | (HR workspace routes) | `roleGate('hr')` |
| `src/main/routes/employer-panel.ts` | (PM panel routes) | `roleGate('pm')` |

Pattern in each route file:

```typescript
// Before:
router.get('/foo', authMiddleware(db), handler);
// After:
router.get('/foo', authMiddleware(db), roleGate('pm'), handler);
```

Apply this to the whole router via `router.use(authMiddleware(db), roleGate('pm'))` if ALL endpoints in that file share the same role.

- [ ] **Step 3: Write failing test**

Create `tests/integration/auth-rbac.test.ts` (covers role × endpoint matrix):

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { authMiddleware } from '../../../src/main/middleware/auth.js';
import { roleGate } from '../../../src/main/modules/auth/role-gate.js';
import { sessionService } from '../../../src/main/modules/auth/session.js';
import bcrypt from 'bcryptjs';

describe('roleGate RBAC', () => {
  let db: Database.Database;
  let app: express.Express;
  let pmSession: string, hrSession: string, candidateSession: string;

  beforeAll(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, created_at TEXT, status TEXT DEFAULT 'active');`);
    db.exec(`CREATE TABLE user_role (user_id TEXT NOT NULL, role TEXT NOT NULL, granted_at TEXT, PRIMARY KEY (user_id, role));`);
    db.exec(`CREATE TABLE api_key (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_hash TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE, created_at TEXT, revoked_at TEXT);`);
    db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, active_role TEXT NOT NULL, created_at TEXT, expires_at TEXT, last_used_at TEXT, revoked_at TEXT, ip_address TEXT, user_agent TEXT);`);
    db.exec(`INSERT INTO user VALUES ('u1','Alice','2026-01-01','active');`);
    db.exec(`INSERT INTO user_role VALUES ('u1','pm','2026-01-01'),('u1','hr','2026-01-01'),('u1','candidate','2026-01-01');`);
    db.prepare(`INSERT INTO api_key VALUES ('k1','u1',?,'hp_test','2026-01-01', NULL)`).run(bcrypt.hashSync('secret', 10));

    pmSession = sessionService.create(db, 'u1', 'pm', null, null).id;
    hrSession = sessionService.create(db, 'u1', 'hr', null, null).id;
    candidateSession = sessionService.create(db, 'u1', 'candidate', null, null).id;

    app = express();
    app.get('/pm-only',   authMiddleware(db), roleGate('pm'),         (_req, res) => res.json({ ok: true }));
    app.get('/hr-only',   authMiddleware(db), roleGate('hr'),         (_req, res) => res.json({ ok: true }));
    app.get('/cand-only', authMiddleware(db), roleGate('candidate'),  (_req, res) => res.json({ ok: true }));
    app.get('/pm-or-hr',  authMiddleware(db), roleGate('pm', 'hr'),    (_req, res) => res.json({ ok: true }));
  });
  afterAll(() => db.close());

  it('pm accessing /pm-only succeeds', async () => {
    const r = await request(app).get('/pm-only').set('Authorization', `Bearer ${pmSession}`);
    expect(r.status).toBe(200);
  });
  it('hr accessing /pm-only returns 403', async () => {
    const r = await request(app).get('/pm-only').set('Authorization', `Bearer ${hrSession}`);
    expect(r.status).toBe(403);
  });
  it('hr accessing /hr-only succeeds', async () => {
    const r = await request(app).get('/hr-only').set('Authorization', `Bearer ${hrSession}`);
    expect(r.status).toBe(200);
  });
  it('candidate accessing /hr-only returns 403', async () => {
    const r = await request(app).get('/hr-only').set('Authorization', `Bearer ${candidateSession}`);
    expect(r.status).toBe(403);
  });
  it('pm accessing /pm-or-hr succeeds', async () => {
    const r = await request(app).get('/pm-or-hr').set('Authorization', `Bearer ${pmSession}`);
    expect(r.status).toBe(200);
  });
  it('candidate accessing /pm-or-hr returns 403', async () => {
    const r = await request(app).get('/pm-or-hr').set('Authorization', `Bearer ${candidateSession}`);
    expect(r.status).toBe(403);
  });
  it('X-Active-Role: hr lets pm session into /hr-only', async () => {
    const r = await request(app).get('/hr-only').set('Authorization', `Bearer ${pmSession}`).set('X-Active-Role', 'hr');
    expect(r.status).toBe(200);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/auth-rbac.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Run full suite**

Run: `pnpm test 2>&1 | tail -10`
Expected: existing tests that call role-gated endpoints should now have correct role set. May need to update fixtures.

- [ ] **Step 6: Commit**

```bash
git add src/main/modules/auth/role-gate.ts src/main/routes/ tests/integration/auth-rbac.test.ts
git commit -m "feat(rbac): roleGate middleware + apply to specific routes per spec §7.2"
```

---

## Task 11: Mechanical rename `headhunter`/`employer` → `hr`/`pm` (15 min)

**Files:**
- Many in `src/main/` and `tests/`

- [ ] **Step 1: Audit current usage**

```bash
cd D:/dev/hunter-platform
grep -rln "headhunter\|'employer'" src/main/ tests/ | head -30
echo "===COUNT==="
grep -rln "headhunter\|'employer'" src/main/ tests/ | wc -l
```

Expected: many files. Each must be updated.

- [ ] **Step 2: Apply mechanical rename**

```bash
cd D:/dev/hunter-platform
# In source files: headhunter → hr, 'employer' → 'pm' (string literal contexts)
# Be careful with word boundaries; use word-boundary regex
find src/main/ tests/ -name "*.ts" -o -name "*.tsx" | xargs sed -i -E "s/\bheadhunter\b/hr/g; s/\bemployer\b/pm/g; s/'employer'/'pm'/g"
```

- [ ] **Step 3: Verify rename succeeded**

```bash
grep -rln "headhunter\|'employer'" src/main/ tests/ 2>&1 | head -5
echo "===ZERO MATCH EXPECTED==="
```

Expected: no matches.

- [ ] **Step 4: Run full test suite**

Run: `pnpm test 2>&1 | tail -10`

Expected: tests should mostly pass. If any fail, the failure is in code that referenced `user_type === 'headhunter'` etc. — fix individual test setups.

- [ ] **Step 5: Manual review**

Look at git diff. Spot-check for:
- Comments mentioning headhunter/employer that should be updated
- String literals in tests that should now be 'hr'/'pm'
- Migration SQL references (v031 should use new names)

- [ ] **Step 6: Commit**

```bash
git add src/main/ tests/
git commit -m "refactor: rename headhunter→hr, employer→pm (R1.C2 role enum)"
```

---

## Task 12: Update existing tests for new role names (15 min)

**Files:**
- Many in `tests/`

- [ ] **Step 1: Run full suite, capture failures**

```bash
pnpm test 2>&1 | grep -E "FAIL|Error:" | head -30
```

For each failing test, find what role string is mismatched.

- [ ] **Step 2: Update test fixtures**

Common patterns to replace:
- `user_type: 'headhunter'` → `user_type: 'hr'`
- `user_type: 'employer'` → `user_type: 'pm'`
- `INSERT INTO user_role VALUES (..., 'headhunter', ...)` → `... 'hr', ...`

Do this in batches using `sed`:

```bash
# In test files
find tests/ -name "*.ts" | xargs sed -i -E "s/'headhunter'/'hr'/g; s/'employer'/'pm'/g; s/headhunter\"/hr\"/g"
```

- [ ] **Step 3: Re-run full suite**

Run: `pnpm test 2>&1 | tail -5`

Expected: pass count at or above baseline (new tests added; no regressions).

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: update test fixtures for new role enum (pm/hr/candidate)"
```

---

## Task 13: Update skill.md + docs/api.md + README (10 min)

**Files:**
- Modify: `docs/superpowers/skill.md`
- Modify: `docs/api.md`
- Modify: `README.md`

- [ ] **Step 1: Update skill.md**

Add a new section near the top:

```markdown
## Authentication

Two authentication methods are supported:

### Method 1: Session token (recommended for browser / long-running clients)

One user can hold multiple roles (pm / hr / candidate) and switch
between them in-session via the `X-Active-Role` header.

```
Authorization: Bearer sess_xxxx
X-Active-Role: pm        # optional; defaults to session's stored role
```

Sessions are 1 week (168h) sliding window. Refresh via
`POST /v1/auth/refresh` (optionally with `active_role` to switch).

Logout: `POST /v1/auth/logout` — immediately revokes the session.

### Method 2: API key (for scripts / server-to-server)

```
Authorization: Bearer hp_live_xxxx
```

Single-role. Cannot switch roles mid-session (use Method 1 if needed).
Cannot be revoked except by rotation.

### Login flow (Method 1)

```
POST /v1/auth/login
{ "api_key": "hp_live_xxx", "active_role": "pm" }
→
{ "session_id": "sess_xxx", "active_role": "pm",
  "available_roles": ["pm","hr","candidate"],
  "expires_at": "2026-07-18T..." }
```

### Role switching

```
POST /v1/auth/refresh
Authorization: Bearer sess_xxx
{ "active_role": "hr" }
→ { "session_id": "sess_xxx", "active_role": "hr", "expires_at": "..." }
```

Or per-request without refresh:
```
GET /v1/something
Authorization: Bearer sess_xxx
X-Active-Role: hr
```
```

- [ ] **Step 2: Update docs/api.md**

Add to the API reference:
- `POST /v1/auth/login` — request/response shapes
- `POST /v1/auth/refresh` — request/response shapes
- `POST /v1/auth/logout` — request/response shapes
- `POST /v1/auth/register` — note that response now includes `available_roles`

Add a new section: "Role-Based Access Control" listing which role can call which endpoint (table from spec §7.2).

- [ ] **Step 3: Update README.md "Quick Start"**

Replace the existing quick start example with one that uses session:

```markdown
## Quick Start

```bash
# 1) Register
curl -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"user_type":"pm","name":"张 PM"}'

# Response: {"ok":true,"data":{"id":"user_...","api_key":"hp_live_xxxx",
#   "available_roles":["pm","hr","candidate"], ...}}

# 2) Login (api_key → session)
curl -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"api_key":"hp_live_xxxx","active_role":"pm"}'

# Response: {"ok":true,"data":{"session_id":"sess_xxxx",
#   "active_role":"pm","available_roles":["pm","hr","candidate"],
#   "expires_at":"..."}}

# 3) Call API with session
curl http://localhost:3000/v1/employer/projects \
  -H "Authorization: Bearer sess_xxxx" \
  -H "X-Active-Role: pm"
```

# 4) Refresh to switch role
curl -X POST http://localhost:3000/v1/auth/refresh \
  -H "Authorization: Bearer sess_xxxx" \
  -H "Content-Type: application/json" \
  -d '{"active_role":"hr"}'
```
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/skill.md docs/api.md README.md
git commit -m "docs: session auth flow + role-switching in skill.md, api.md, README"
```

---

## Task 14: Regenerate OpenAPI (5 min)

**Files:**
- Modify: `docs/superpowers/openapi.json` (auto-generated)

- [ ] **Step 1: Run openapi:generate**

```bash
pnpm openapi:generate
```

Expected: regenerates `docs/superpowers/openapi.json` with new endpoints.

- [ ] **Step 2: Verify new endpoints in spec**

```bash
grep -E "/v1/auth/(login|refresh|logout)" docs/superpowers/openapi.json
```

Expected: 3 hits.

- [ ] **Step 3: Run openapi:check**

```bash
pnpm openapi:check
```

Expected: exit 0 (no drift).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/openapi.json
git commit -m "docs(openapi): regenerate spec with new session endpoints"
```

---

## Task 15: Interop smoke test (manual) (10 min)

**Files:**
- Create: `tests/interop/README.md` (notes on how to run interop)

- [ ] **Step 1: Bring up both servers locally**

```bash
# Terminal 1: hunter-platform backend
cd D:/dev/hunter-platform
pnpm dev

# Terminal 2: ow-recruit relay
cd "C:/Users/Administrator/Desktop/ow-headhunter-sass"
node server/relay.js --port 8080
```

- [ ] **Step 2: Run ow-recruit's e2e against this hunter-platform**

ow-recruit has `npm run test:e2e`. Configure it to point at this hunter-platform (env vars or config). Verify:
- Register → receive api_key + 3 roles
- Login → receive session_id
- Switch role via X-Active-Role
- Call a skill
- Receive webhook (if C3 done; else skip)

- [ ] **Step 3: Document the smoke test in tests/interop/README.md**

```markdown
# Interop tests

These tests verify that an external client (ow-recruit, etc.) can
successfully integrate with hunter-platform.

## ow-recruit e2e

1. Start hunter-platform: `pnpm dev`
2. Start ow-recruit relay: `cd <ow-recruit-dir> && node server/relay.js --port 8080`
3. Configure ow-recruit to point at this hunter-platform:
   - Set `QING3_BASE_URL=http://localhost:3000`
   - Set `QING3_SIGNING_SECRET=<shared-secret>`
4. Run `npm run test:e2e` in ow-recruit
5. Verify all 5 e2e scenarios pass

Note: webhook scenarios require C3 (Webhook inbox) — see
`2026-07-11-positioning.md` R1.C3.
```

- [ ] **Step 4: Commit (only the README, not the test runs)**

```bash
git add tests/interop/README.md
git commit -m "docs(interop): notes on running ow-recruit e2e against this server"
```

---

## Task 16: Final verification + push (10 min)

- [ ] **Step 1: Full test suite**

```bash
pnpm test 2>&1 | tail -10
```

Expected: pass count >= baseline + new tests.

- [ ] **Step 2: Type check**

```bash
pnpm exec tsc --build 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 3: Admin-web e2e (regression)**

```bash
pnpm --filter @hunter-platform/admin-web run test:e2e 2>&1 | tail -5
```

Expected: 1 passed.

- [ ] **Step 4: Update positioning spec — mark R1.C2 done**

In `docs/superpowers/specs/2026-07-11-positioning.md` §6 R1 table, change:
- `| **C2.** Session token + ... | 🔴 P0 | not started |`
- to:
- `| **C2.** Session token + ... | 🔴 P0 | done (<commit>) |`

- [ ] **Step 5: Push**

```bash
git push origin feature/session-multirole
```

Then merge to main:
```bash
git checkout main
git merge --ff-only feature/session-multirole
git push origin main
```

- [ ] **Step 6: Final commit (positioning update + merge)**

```bash
git add docs/superpowers/specs/2026-07-11-positioning.md
git commit -m "docs(roadmap): mark R1.C2 session-multirole as done"
git push origin main
```

---

## Summary

| Metric | Value |
|---|---|
| Tasks | 16 |
| New files | 8 (1 SQL, 2 repos, 1 service, 1 middleware, 4 test suites) |
| Modified files | ~15-20 (auth routes, middleware, ws, route gates, schemas, docs, tests) |
| New tests | ~110 |
| New endpoints | 3 (login, refresh, logout) |
| New headers | 1 (X-Active-Role) |
| New tables | 2 (session, user_role) |
| Estimated time | 3-4 hours of focused work |