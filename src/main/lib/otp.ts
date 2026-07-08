import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';

/** 生成 N 位数字 OTP (默认 6 位) */
export function generateOtp(length: number = 6): string {
  const max = 10 ** length;
  const min = 10 ** (length - 1);
  return String(randomInt(min, max));
}

/** bcrypt hash (cost=4, 与现有 auth api_key 一致) */
export function hashOtp(code: string): string {
  return bcrypt.hashSync(code, 4);
}

/** bcrypt verify */
export function verifyOtp(code: string, hash: string): boolean {
  return bcrypt.compareSync(code, hash);
}