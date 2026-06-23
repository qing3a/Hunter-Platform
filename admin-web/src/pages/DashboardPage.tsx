import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { apiFetch } from '../api/client';

type Me = { id: string; name: string; email: string; role: string; status: string; last_login_at: string | null; created_at: string };

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    apiFetch<Me>('me').then(setMe).catch(() => {});
  }, []);

  if (!me) return <Layout adminName="..."><p>Loading...</p></Layout>;

  return (
    <Layout adminName={me.name}>
      <h1>Welcome, {me.name}</h1>
      <p>Role: {me.role}</p>
      <p>Last login: {me.last_login_at ?? 'never'}</p>

      <h2 style={{ marginTop: 32 }}>Quick links</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div className="card">📊 <strong>Users</strong><br/><small>Sub-B</small></div>
        <div className="card">👥 <strong>Candidates</strong><br/><small>Sub-B</small></div>
        <div className="card">📜 <strong>Audit</strong><br/><small>Sub-D</small></div>
        <div className="card">📋 <strong>Action History</strong><br/><small>Sub-D</small></div>
      </div>
    </Layout>
  );
}
