/**
 * MVP email service. 两种模式:
 *  - console (开发): console.log 完整 OTP 供测试
 *  - real (生产): TODO — 接 SMTP/SendGrid/Mailgun (Phase 1 后)
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
      // TODO Phase 2: implement real SMTP / SendGrid
      throw new Error('Real email sending not yet implemented');
    },
  };
}