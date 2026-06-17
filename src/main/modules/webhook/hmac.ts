import crypto from 'node:crypto';

const MAX_TIMESTAMP_SKEW_SECONDS = 300;

/**
 * 签名格式：sha256(secret, `${timestamp}.${body}`) → hex
 */
export function sign(secret: string, body: string, timestamp: string): string {
  const data = `${timestamp}.${body}`;
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * 验证：恒定时间比较 + 时间戳窗口检查
 * ⚠️ 修复了 P1 Bug#9（时序攻击）：用 crypto.timingSafeEqual
 */
export function verify(secret: string, body: string, timestamp: string, signature: string): boolean {
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  const expected = sign(secret, body, timestamp);

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
