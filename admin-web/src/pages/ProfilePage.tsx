import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { apiFetch } from '../api/client';
import { setToken } from '../lib/auth';

type Me = { id: string; name: string; email: string; role: string; status: string; created_at: string };

export default function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [newKey, setNewKey] = useState('');

  useEffect(() => {
    apiFetch<Me>('me').then(setMe).catch(() => {});
  }, []);

  const rotateKey = async () => {
    if (!confirm('确认轮换 API 密钥?当前密钥将失效。')) return;
    try {
      const data = await apiFetch<{ api_key: string }>('auth/rotate-key', { method: 'POST' });
      setNewKey(data.api_key);
      setToken(data.api_key);
      alert('API 密钥已轮换。新密钥已保存到 localStorage。');
    } catch (err: any) {
      alert('失败: ' + err.message);
    }
  };

  if (!me) return <Layout adminName="..."><p>加载中...</p></Layout>;

  return (
    <Layout adminName={me.name}>
      <h1>我的</h1>
      <div className="card">
        <p><strong>ID:</strong> {me.id}</p>
        <p><strong>邮箱:</strong> {me.email}</p>
        <p><strong>角色:</strong> {me.role}</p>
        <p><strong>状态:</strong> {me.status}</p>
        <p><strong>创建时间:</strong> {me.created_at}</p>
      </div>
      <div className="card">
        <h2>API 密钥</h2>
        <p>⚠️ 轮换将使当前密钥失效。</p>
        <button className="btn" onClick={rotateKey}>轮换 API 密钥</button>
        {newKey && (
          <p style={{ marginTop: 12 }}>
            <strong>新密钥:</strong> <code>{newKey}</code><br/>
            <small>已自动保存到 localStorage.</small>
          </p>
        )}
      </div>
    </Layout>
  );
}
