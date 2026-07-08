import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { setToken } from '../lib/auth';

type LoginResp = { admin_user_id: string; name: string; email: string; role: string; api_key: string };

// Dev/localhost 预填 email + password (匹配本地 .env 的 SEED_ADMIN_PASSWORD),方便调试登录流程。
// Production 域名 (非 localhost/127.0.0.1) 不预填 (安全: client-side 不暴露 password)。
// 用 hostname 不用 import.meta.env.DEV 因为 dev 3000 serve 的也是 build 过的文件
// (import.meta.env.DEV 在 build 时替换为 false),所以 build 时间常量不能用。
const IS_LOCAL = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const DEV_DEFAULTS = IS_LOCAL
  ? { email: 'admin@qing3.top', password: 'local-test-pwd-12345' }
  : { email: '', password: '' };

export default function LoginPage() {
  const [email, setEmail] = useState(DEV_DEFAULTS.email);
  const [password, setPassword] = useState(DEV_DEFAULTS.password);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiFetch<LoginResp>('auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(data.api_key);
      navigate('/admin');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>猎头中介管理后台</h1>
      <form onSubmit={submit} className="card" style={{ maxWidth: 400 }}>
        <label>邮箱</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <label>密码</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        {error && <div className="error">{error}</div>}
        <button type="submit" className="btn" disabled={loading} style={{ marginTop: 12 }}>
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  );
}
