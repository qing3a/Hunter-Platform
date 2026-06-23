// Seed first admin if admin_users table is empty.
// Reads SEED_ADMIN_PASSWORD env var. Logs warning if neither table populated nor seed env set.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { DB } from '../db/connection.js';
import { createAdminUsersRepo } from '../db/repositories/admin-users.js';

const API_KEY_PREFIX_LEN = 18;
const BCRYPT_COST = 10;

async function generateAdminApiKey(): Promise<{ hash: string; key: string; prefix: string }> {
  const random = crypto.randomBytes(32).toString('hex');
  const key = `hp_admin_${random}`;
  const prefix = key.slice(0, API_KEY_PREFIX_LEN);
  const hash = await bcrypt.hash(key, BCRYPT_COST);
  return { hash, key, prefix };
}

export async function seedAdminIfEmpty(db: DB): Promise<void> {
  const repo = createAdminUsersRepo(db);
  if (repo.count() > 0) return;

  const seedPwd = process.env.SEED_ADMIN_PASSWORD;
  if (!seedPwd) {
    console.warn('[admin-seed] admin_users table is empty and SEED_ADMIN_PASSWORD env not set; no admin bootstrapped');
    return;
  }

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@qing3.top';
  const pwdHash = await bcrypt.hash(seedPwd, BCRYPT_COST);
  const { hash: keyHash, key: apiKey, prefix: keyPrefix } = await generateAdminApiKey();
  const now = new Date().toISOString();

  repo.insert({
    id: 'adm_default_seed',
    name: 'Default Admin',
    email,
    password_hash: pwdHash,
    api_key_hash: keyHash,
    api_key_prefix: keyPrefix,
    role: 'super',
    status: 'active',
    created_at: now,
    updated_at: now,
  });
  console.log(`[admin-seed] seeded default admin: ${email} (api_key not echoed for security; check logs of Web UI login to retrieve)`);
  // 注：api_key 只在生成时返回一次，重启后无法重看。运维应立即登录 Web UI 拿到新 key。
  // Production 流程：通过登录端点获取新 key（每次登录都 rotate）。
}
