/**
 * Credential storage for Hunter Platform API keys.
 *
 * Strategy:
 *   - api_key is loaded from one of (in priority order):
 *       1. HUNTER_PLATFORM_API_KEY env var (per-call override)
 *       2. ~/.hunter-platform/credentials.json (persistent)
 *       3. The api_key argument passed to the tool
 *   - The `register` tool returns a fresh api_key and persists it.
 *   - The `rotate_key` tool invalidates the old key and persists the new one.
 *
 * Storage path can be overridden via HUNTER_PLATFORM_CREDENTIALS_FILE env.
 *
 * File format (JSON):
 *   { "api_key": "hp_live_xxx...", "user_id": "user_xxx...", "user_type": "employer" }
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Credentials {
  api_key: string;
  user_id?: string;
  user_type?: 'candidate' | 'headhunter' | 'employer';
  base_url?: string;
}

const DEFAULT_DIR = path.join(os.homedir(), '.hunter-platform');
const DEFAULT_FILE = path.join(DEFAULT_DIR, 'credentials.json');

function getCredentialsPath(): string {
  return process.env.HUNTER_PLATFORM_CREDENTIALS_FILE ?? DEFAULT_FILE;
}

export function loadCredentials(): Credentials | null {
  // 1. Env var wins
  const envKey = process.env.HUNTER_PLATFORM_API_KEY;
  if (envKey) {
    return {
      api_key: envKey,
      user_id: process.env.HUNTER_PLATFORM_USER_ID,
      user_type: process.env.HUNTER_PLATFORM_USER_TYPE as Credentials['user_type'],
      base_url: process.env.HUNTER_PLATFORM_BASE_URL,
    };
  }

  // 2. Persistent file
  const file = getCredentialsPath();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Credentials;
    if (!parsed.api_key) return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Failed to read credentials from ${file}: ${(err as Error).message}`);
  }
}

export function saveCredentials(creds: Credentials): void {
  const file = getCredentialsPath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
}

export function clearCredentials(): void {
  const file = getCredentialsPath();
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/**
 * Resolve which api_key to use for a tool call.
 * Priority: explicit arg → env var → persistent file.
 */
export function resolveApiKey(explicit?: string): string | null {
  if (explicit) return explicit;
  const envKey = process.env.HUNTER_PLATFORM_API_KEY;
  if (envKey) return envKey;
  const creds = loadCredentials();
  return creds?.api_key ?? null;
}

export function resolveBaseUrl(explicit?: string): string {
  if (explicit) return explicit;
  const envUrl = process.env.HUNTER_PLATFORM_BASE_URL;
  if (envUrl) return envUrl;
  const creds = loadCredentials();
  return creds?.base_url ?? 'https://qing3.top';
}