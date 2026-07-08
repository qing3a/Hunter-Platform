/**
 * 候选人门户专用限流:
 *  - OTP 请求: 每 IP 60s 5 次 + 每邮箱 60s 1 次
 *  - 使用内存滑动窗口 (MVP); 后续可替换 Redis
 */

interface Bucket { count: number; resetAt: number; }
const ipBuckets = new Map<string, Bucket>();
const emailBuckets = new Map<string, Bucket>();

const IP_WINDOW_MS = 60_000;
const IP_LIMIT = 5;
const EMAIL_WINDOW_MS = 60_000;
const EMAIL_LIMIT = 1;

export function checkOtpRequestLimit(ip: string, email: string): { ok: boolean; reason?: string; retryAfterMs?: number } {
  const now = Date.now();

  // IP 限制
  const ipBucket = ipBuckets.get(ip);
  if (ipBucket && ipBucket.resetAt > now && ipBucket.count >= IP_LIMIT) {
    return { ok: false, reason: 'IP_RATE_LIMITED', retryAfterMs: ipBucket.resetAt - now };
  }
  if (!ipBucket || ipBucket.resetAt <= now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
  } else {
    ipBucket.count++;
  }

  // 邮箱限制
  const emailBucket = emailBuckets.get(email);
  if (emailBucket && emailBucket.resetAt > now && emailBucket.count >= EMAIL_LIMIT) {
    return { ok: false, reason: 'EMAIL_RATE_LIMITED', retryAfterMs: emailBucket.resetAt - now };
  }
  if (!emailBucket || emailBucket.resetAt <= now) {
    emailBuckets.set(email, { count: 1, resetAt: now + EMAIL_WINDOW_MS });
  } else {
    emailBucket.count++;
  }

  return { ok: true };
}

// 测试用: 重置 bucket
export function __resetRateLimits(): void {
  ipBuckets.clear();
  emailBuckets.clear();
}
