import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { setToken } from '../lib/auth';

type LoginResp = { admin_user_id: string; name: string; email: string; role: string; api_key: string };

// Dev 模式预填 email + password (匹配本地 .env 的 SEED_ADMIN_PASSWORD),方便调试登录流程。
// Production build 安全考虑: import.meta.env.PROD=false → DEV_DEFAULTS 退化为 {email:'', password:''},
// Vite + minifier 会把整个 if 分支 tree-shake 掉。prod build JS 中不出现 'local-test-pwd-12345' 字面量。
// Dev `pnpm dev` (vite) 启用 DEV=true → 预填;生产 `node out/main/index.js` → DEV=false → 空表单。
const DEV_DEFAULTS = import.meta.env.DEV
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
