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
    if (!confirm('Rotate API key? Current key will be invalidated.')) return;
    try {
      const data = await apiFetch<{ api_key: string }>('auth/rotate-key', { method: 'POST' });
      setNewKey(data.api_key);
      setToken(data.api_key);
      alert('API key rotated. New key saved to localStorage.');
    } catch (err: any) {
      alert('Failed: ' + err.message);
    }
  };

  if (!me) return <Layout adminName="..."><p>Loading...</p></Layout>;

  return (
    <Layout adminName={me.name}>
      <h1>Profile</h1>
      <div className="card">
        <p><strong>ID:</strong> {me.id}</p>
        <p><strong>Email:</strong> {me.email}</p>
        <p><strong>Role:</strong> {me.role}</p>
        <p><strong>Status:</strong> {me.status}</p>
        <p><strong>Created:</strong> {me.created_at}</p>
      </div>
      <div className="card">
        <h2>API Key</h2>
        <p>⚠️ Rotate will invalidate the current key.</p>
        <button className="btn" onClick={rotateKey}>Rotate API Key</button>
        {newKey && (
          <p style={{ marginTop: 12 }}>
            <strong>New key:</strong> <code>{newKey}</code><br/>
            <small>已自动保存到 localStorage.</small>
          </p>
        )}
      </div>
    </Layout>
  );
}
