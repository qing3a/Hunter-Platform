import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { setToken } from '../lib/auth';

type LoginResp = { admin_user_id: string; name: string; email: string; role: string; api_key: string };

// 仅 dev 模式预填 email (方便调试); password 永远不预填 (client-side 安全原则:
// 任何硬编码的 password 都会进 git 历史 + source map,即使是 dev build)。
// 用户每次 dev 登录手输 .env 里的 SEED_ADMIN_PASSWORD。
const DEV_DEFAULTS = import.meta.env.DEV
  ? { email: 'admin@qing3.top' }
  : { email: '' };

export default function LoginPage() {
  const [email, setEmail] = useState(DEV_DEFAULTS.email);
  const [password, setPassword] = useState('');  // 永远空字符串,密码由用户输入
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
      navigate('/');
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
