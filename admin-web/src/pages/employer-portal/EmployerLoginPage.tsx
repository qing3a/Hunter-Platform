import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { employerAuth } from '../../api/employer';
import { setSession } from '../../lib/candidate-session';
import { OtpInput } from '../../components/candidate-portal/OtpInput';

/**
 * Employer Panel — login screen (Phase 3c, Task 4).
 *
 * Mirrors the PM / hunter portals' two-step OTP flow, but:
 *  - passes `user_type='employer'` to `/v1/candidate-portal/auth/otp/*`
 *    so the verify step auto-creates an `employer` user (see Task 1b,
 *    commit e6084f7 — same discriminator pattern as the PM portal);
 *  - writes a session with `role: 'employer'` so `RequireEmployerAuth`
 *    accepts it;
 *  - redirects unconditionally to `/admin/employer/dashboard` after a
 *    successful verify (mirrors the PM portal's redirect to
 *    `/admin/pm/projects` and the hunter portal's redirect to
 *    `/hunter/workspace` — there is no profile-completion onboarding
 *    gate on the employer side either).
 *
 * No shell layout is rendered here: the employer-portal chrome (sidebar,
 * tab bar, top bar) ships with Task 17's EmployerMobileLayout, and reusing
 * `HunterMobileLayout` would leak the hunter brand. The login card stands
 * alone for now.
 */
export function EmployerLoginPage() {
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
      const res = await employerAuth.requestOtp(email);
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
      const res = await employerAuth.verifyOtp(email, code);
      // profile_complete is always false for employer users today (no
      // onboarding step), but we still pass the value verbatim so the
      // CandidateSession contract is satisfied — guards in later tasks
      // can branch on it.
      setSession({
        api_key: res.api_key,
        user_id: res.user_id,
        profile_complete: res.profile_complete,
        email,
        role: 'employer',
      });
      navigate('/admin/employer/dashboard');
    } catch (err: any) {
      setError(err.message || '验证码错误');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="hp-login">
      <h1>{step === 'email' ? '雇主登录' : '输入验证码'}</h1>

      {step === 'email' ? (
        <form onSubmit={handleRequestOtp}>
          <input
            type="email"
            required
            placeholder="雇主邮箱地址"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="hp-input"
            autoFocus
            data-testid="employer-email-input"
          />
          <button
            type="submit"
            disabled={loading}
            className="hp-btn-primary"
            data-testid="employer-request-otp"
          >
            {loading ? '发送中...' : '获取验证码'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp}>
          <p className="hp-login-hint">
            验证码已发送至 <strong>{email}</strong>
          </p>
          {devCode && (
            <p className="hp-login-dev" data-testid="employer-dev-code">
              🔧 开发模式验证码: <code>{devCode}</code>
            </p>
          )}
          <OtpInput onChange={setCode} />
          <button
            type="submit"
            disabled={loading || code.length < 6}
            className="hp-btn-primary"
            data-testid="employer-verify-otp"
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
        <div className="hp-error" data-testid="employer-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}