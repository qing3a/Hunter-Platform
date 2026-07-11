import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

describe('user-roles repo', () => {
  let db: InstanceType<typeof DatabaseSync>;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE user_role (user_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('pm','hr','candidate')), granted_at TEXT NOT NULL, PRIMARY KEY (user_id, role));`);
  });

  it('grant adds a role', async () => {
    const { userRolesRepo } = await import('../../src/main/db/repositories/user-roles');
    userRolesRepo.grant(db, 'u1', 'pm', '2026-01-01');
    expect(userRolesRepo.list(db, 'u1')).toEqual(['pm']);
  });

  it('grant is idempotent (PRIMARY KEY conflict ignored)', async () => {
    const { userRolesRepo } = await import('../../src/main/db/repositories/user-roles');
    userRolesRepo.grant(db, 'u1', 'pm', '2026-01-01');
    userRolesRepo.grant(db, 'u1', 'pm', '2026-01-02');
    expect(userRolesRepo.list(db, 'u1')).toEqual(['pm']);
  });

  it('grantAll adds all 3 roles', async () => {
    const { userRolesRepo } = await import('../../src/main/db/repositories/user-roles');
    userRolesRepo.grantAll(db, 'u1', '2026-01-01');
    expect(userRolesRepo.list(db, 'u1').sort()).toEqual(['candidate', 'hr', 'pm']);
  });

  it('revoke removes a role', async () => {
    const { userRolesRepo } = await import('../../src/main/db/repositories/user-roles');
    userRolesRepo.grantAll(db, 'u1', '2026-01-01');
    userRolesRepo.revoke(db, 'u1', 'pm');
    expect(userRolesRepo.list(db, 'u1').sort()).toEqual(['candidate', 'hr']);
  });

  it('isInRole returns true/false correctly', async () => {
    const { userRolesRepo } = await import('../../src/main/db/repositories/user-roles');
    userRolesRepo.grant(db, 'u1', 'pm', '2026-01-01');
    expect(userRolesRepo.isInRole(db, 'u1', 'pm')).toBe(true);
    expect(userRolesRepo.isInRole(db, 'u1', 'hr')).toBe(false);
  });

  it('list returns empty array for unknown user', async () => {
    const { userRolesRepo } = await import('../../src/main/db/repositories/user-roles');
    expect(userRolesRepo.list(db, 'unknown')).toEqual([]);
  });
});
