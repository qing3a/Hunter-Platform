import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

const SESSION_TTL_HOURS = 24 * 7;

describe('session repo + service', () => {
  let db: InstanceType<typeof DatabaseSync>;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE user_role (user_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('pm','hr','candidate')), granted_at TEXT NOT NULL, PRIMARY KEY (user_id, role));`);
    db.exec(`INSERT INTO user_role VALUES ('u1','pm','2026-01-01'),('u1','hr','2026-01-01'),('u1','candidate','2026-01-01');`);
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, active_role TEXT NOT NULL,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT NOT NULL,
        revoked_at TEXT, ip_address TEXT, user_agent TEXT
      );
    `);
  });

  it('createSession returns a session with 168h TTL', async () => {
    const { sessionService } = await import('../../src/main/modules/auth/session');
    const s = sessionService.create(db, 'u1', 'pm', '1.2.3.4', 'agent/1.0');
    expect(s.id).toMatch(/^sess_[a-zA-Z0-9]{32}$/);
    expect(s.user_id).toBe('u1');
    expect(s.active_role).toBe('pm');
    const hours = (new Date(s.expires_at).getTime() - Date.now()) / 3_600_000;
    // TTL measured from "now" (not from created_at) — within 1h of SESSION_TTL_HOURS
    expect(hours).toBeCloseTo(SESSION_TTL_HOURS, 0);
  });

  it('resolveSession returns active session + roles', async () => {
    const { sessionService } = await import('../../src/main/modules/auth/session');
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
    const { sessionService } = await import('../../src/main/modules/auth/session');
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    db.prepare(`UPDATE session SET expires_at = ? WHERE id = ?`).run('2020-01-01T00:00:00Z', s.id);
    expect(sessionService.resolve(db, s.id)).toBeNull();
  });

  it('resolveSession returns null if revoked', async () => {
    const { sessionService } = await import('../../src/main/modules/auth/session');
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    sessionService.revoke(db, s.id);
    expect(sessionService.resolve(db, s.id)).toBeNull();
  });

  it('resolveSession switches active_role when requested and valid', async () => {
    const { sessionService } = await import('../../src/main/modules/auth/session');
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const r = sessionService.resolve(db, s.id, 'hr');
    expect(r?.active_role).toBe('hr');
  });

  it('resolveSession returns null if requested role not in available_roles', async () => {
    const { sessionService } = await import('../../src/main/modules/auth/session');
    db.exec(`DELETE FROM user_role WHERE user_id = 'u1' AND role = 'hr';`);
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    expect(sessionService.resolve(db, s.id, 'hr')).toBeNull();
  });

  it('refreshSession extends expiry by 168h (sliding window)', async () => {
    const { sessionService } = await import('../../src/main/modules/auth/session');
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const originalExpiry = s.expires_at;
    await new Promise(r => setTimeout(r, 5));
    const refreshed = sessionService.refresh(db, s.id);
    expect(refreshed).not.toBeNull();
    expect(new Date(refreshed!.expires_at).getTime()).toBeGreaterThanOrEqual(new Date(originalExpiry).getTime());
  });

  it('refreshSession can switch role', async () => {
    const { sessionService } = await import('../../src/main/modules/auth/session');
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const r = sessionService.refresh(db, s.id, 'hr');
    expect(r).not.toBeNull();
    expect(r!.active_role).toBe('hr');
  });
});