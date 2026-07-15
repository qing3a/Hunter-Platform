/**
 * 邮件服务 — 仅用于候选人门户 OTP 传递。
 *
 * 替代方案：
 *  - 方案 A (开发/测试)：console.log 输出 OTP，零基础设施
 *  - 方案 B (生产)：不发送邮件，由站内信 (/v1/notifications/*) 承担通知职责
 *
 * 不再接入 SMTP / 第三方邮件服务（评估后放弃，详见
 * docs/superpowers/specs/2026-06-24-in-site-notifications-design.md §1.2）。
 */
export interface EmailService {
  sendOtp(email: string, code: string, ttlSeconds: number): Promise<void>;
}

export function createEmailService(opts: { consoleOnly: boolean }): EmailService {
  return {
    async sendOtp(email, code, ttlSeconds) {
      if (opts.consoleOnly) {
        console.log(`[DEV ONLY] OTP for ${email}: ${code} (expires in ${ttlSeconds}s)`);
        return;
      }
      // 生产环境不发送邮件：OTP 仅在开发模式 console 输出；
      // 生产通知走站内信 (/v1/notifications/*)，见 notification 模块。
      throw new Error('Email sending is not supported; use in-site notifications instead');
    },
  };
}
