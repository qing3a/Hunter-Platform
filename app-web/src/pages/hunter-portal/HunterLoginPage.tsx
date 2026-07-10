import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { otp } from '../../api/candidate-portal';
import { setSession } from '../../lib/candidate-session';
import { OtpInput } from '../../components/candidate-portal/OtpInput';
import { HunterMobileLayout } from '../../components/hunter-portal/HunterMobileLayout';

/**
 * Hunter Portal — login screen (Phase 3a / Task 11).
 *
 * Mirrors the candidate portal's two-step OTP flow, but:
 *  - passes `user_type='headhunter'` to the same `/v1/candidate-portal/auth/otp/*`
 *    endpoints so the verify step auto-creates a `headhunter` user instead of
 *    a `candidate`;
 *  - after a successful verify, writes a session with `role: 'headhunter'`
 *    so `RequireHunterAuth` (and future portal-side guards) accept it;
 *  - redirects unconditionally to `/hunter/workspace` — the hunter portal has
 *    no profile-completion onboarding step to gate on (unlike the candidate
 *    flow which bounces to `/candidate/profile` first).
 */
export function HunterLoginPage() {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await otp.request(email, 'headhunter');
      if (res.dev_code) setDevCode(res.dev_code);
      setStep('otp');
    } catch (err: any) {
      setError(err.message || '发送失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await otp.verify(email, code, 'headhunter');
      // profile_complete is always false for headhunters (the backend
      // hardcodes it), but we still pass the value verbatim so the
      // CandidateSession contract is satisfied.
      setSession({
        api_key: res.api_key,
        user_id: res.user_id,
        profile_complete: res.profile_complete,
        email,
        role: 'headhunter',
      });
      navigate('/hunter/workspace');
    } catch (err: any) {
      setError(err.message || '验证码错误');
    } finally {
      setLoading(false);
    }
  }

  return (
    <HunterMobileLayout title="猎头登录">
      <div className="hp-login">
        <h1>{step === 'email' ? '猎头登录' : '输入验证码'}</h1>

        {step === 'email' ? (
          <form onSubmit={handleRequestOtp}>
            <input
              type="email" required placeholder="猎头邮箱地址"
              value={email} onChange={e => setEmail(e.target.value)}
              className="hp-input" autoFocus
              data-testid="hunter-email-input"
            />
            <button
              type="submit" disabled={loading}
              className="hp-btn-primary"
              data-testid="hunter-request-otp"
            >
              {loading ? '发送中...' : '获取验证码'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp}>
            <p className="hp-login-hint">验证码已发送至 <strong>{email}</strong></p>
            {devCode && (
              <p className="hp-login-dev" data-testid="hunter-dev-code">
                🔧 开发模式验证码: <code>{devCode}</code>
              </p>
            )}
            <OtpInput onChange={setCode} />
            <button
              type="submit"
              disabled={loading || code.length < 6}
              className="hp-btn-primary"
              data-testid="hunter-verify-otp"
            >
              {loading ? '验证中...' : '登录'}
            </button>
            <button
              type="button"
              onClick={() => setStep('email')}
              className="hp-btn-link"
            >
              ← 换邮箱
            </button>
          </form>
        )}

        {error && (
          <div className="hp-error" data-testid="hunter-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </HunterMobileLayout>
  );
}
