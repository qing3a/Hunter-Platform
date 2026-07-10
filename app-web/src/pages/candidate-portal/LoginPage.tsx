import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { otp } from '../../api/candidate-portal';
import { setSession } from '../../lib/candidate-session';
import { OtpInput } from '../../components/candidate-portal/OtpInput';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';

export function LoginPage() {
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
      const res = await otp.request(email);
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
      const res = await otp.verify(email, code);
      setSession({ api_key: res.api_key, user_id: res.user_id, profile_complete: res.profile_complete, email });
      navigate(res.profile_complete ? '/candidate/home' : '/candidate/profile');
    } catch (err: any) {
      setError(err.message || '验证码错误');
    } finally {
      setLoading(false);
    }
  }

  return (
    <MobileLayout>
      <div className="cp-login">
        <h1>{step === 'email' ? '登录 / 注册' : '输入验证码'}</h1>

        {step === 'email' ? (
          <form onSubmit={handleRequestOtp}>
            <input
              type="email" required placeholder="邮箱地址"
              value={email} onChange={e => setEmail(e.target.value)}
              className="cp-input" autoFocus
            />
            <button type="submit" disabled={loading} className="cp-btn-primary">
              {loading ? '发送中...' : '获取验证码'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp}>
            <p className="cp-login-hint">验证码已发送至 <strong>{email}</strong></p>
            {devCode && (
              <p className="cp-login-dev">
                🔧 开发模式验证码: <code>{devCode}</code>
              </p>
            )}
            <OtpInput onChange={setCode} />
            <button type="submit" disabled={loading || code.length < 6} className="cp-btn-primary">
              {loading ? '验证中...' : '登录'}
            </button>
            <button type="button" onClick={() => setStep('email')} className="cp-btn-link">
              ← 换邮箱
            </button>
          </form>
        )}

        {error && <div className="cp-error">{error}</div>}
      </div>
    </MobileLayout>
  );
}