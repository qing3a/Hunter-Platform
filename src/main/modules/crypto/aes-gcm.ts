import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION_PREFIX = 'v1:';

/**
 * Encrypt plaintext with AES-256-GCM. Output format: `v1:<base64(iv||tag||ciphertext)>`.
 * The v1: prefix supports future key rotation (M5 P1#13) and version-specific decrypt.
 */
export function encrypt(key: Buffer, plaintext: string): string {
  if (key.length !== 32) throw new Error('Key must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return VERSION_PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

/**
 * Decrypt ciphertext. Requires the `v1:` prefix — bare base64 (legacy pre-M5 data) is rejected.
 * Future versions will look up the key by version prefix (multi-key rotation, v2 scope).
 */
export function decrypt(key: Buffer, ciphertext: string): string {
  if (key.length !== 32) throw new Error('Key must be 32 bytes');
  if (!ciphertext.startsWith(VERSION_PREFIX)) {
    throw new Error('Unsupported ciphertext format: missing v1: prefix');
  }
  const raw = ciphertext.slice(VERSION_PREFIX.length);
  const buf = Buffer.from(raw, 'base64');
  if (buf.length < 12 + 16 + 1) throw new Error('Ciphertext too short');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

export function zeroMemory(buf: Buffer | null | undefined): void {
  if (Buffer.isBuffer(buf)) buf.fill(0);
}
