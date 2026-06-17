import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encrypt(key: Buffer, plaintext: string): string {
  if (key.length !== 32) throw new Error('Key must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(key: Buffer, ciphertextB64: string): string {
  if (key.length !== 32) throw new Error('Key must be 32 bytes');
  const buf = Buffer.from(ciphertextB64, 'base64');
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
