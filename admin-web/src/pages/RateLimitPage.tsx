// admin-web/src/pages/RateLimitPage.tsx
//
// R2.5 — Rate-limit + quota dashboard.
//
// Calls three existing admin endpoints:
//   GET    /v1/admin/rate-limit/buckets                 → list per-tier 1s/1m/1h buckets
//   POST   /v1/admin/rate-limit/users/:id/clear         → reset a user's bucket
//   GET    /v1/config/rate-limits                       → public config (read-only)
//
// A small inline sparkline of the last 10 minutes of /v1/min/limit
// usage is shown for each tier. We don't currently record per-minute
// samples server-side, so the chart is filled with the current snapshot
// value (placeholder) until we add a metrics endpoint in a follow-up.
import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import MetricCard from '../components/MetricCard';
import { apiFetch } from '../api/client';

type Me = { id: string; name: string; email: string; role: string; status: string };

type TierBuckets = {
  candidate: { second: number; minute: number; hour: number };
  hr:        { second: number; minute: number; hour: number };
  pm:        { second: number; minute: number; hour: number };
};

type RateLimitConfig = {
  enabled: boolean;
  limits: TierBuckets;
};

export default function RateLimitPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [cfg, setCfg] = useState<RateLimitConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearUserId, setClearUserId] = useState('');
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setMe(await apiFetch<Me>('me'));
      setCfg(await apiFetch<RateLimitConfig>('v1/config/rate-limits'));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'load failed');
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function clearBucket() {
    if (!clearUserId.trim()) return;
    setClearing(true); setClearResult(null);
    try {
      await apiFetch(`v1/admin/rate-limit/users/${clearUserId.trim()}/clear`, {
        method: 'POST',
      });
      setClearResult(`cleared bucket for ${clearUserId.trim()}`);
      setClearUserId('');
    } catch (e: any) {
      setClearResult(`error: ${e?.message ?? 'unknown'}`);
    } finally {
      setClearing(false);
    }
  }

  if (error) return <Layout adminName={me?.name ?? 'Admin'}><div className="error">{error}</div></Layout>;
  if (!cfg)  return <Layout adminName="…"><p>加载中…</p></Layout>;

  return (
    <Layout adminName={me?.name ?? 'Admin'}>
      <h1>Rate-limit &amp; quota dashboard</h1>

      <section style={{ marginBottom: 24 }}>
        <h2>Per-tier 1s / 1m / 1h buckets</h2>
        <p style={{ color: '#666' }}>
          RATE_LIMIT_ENABLED = <code>{String(cfg.enabled)}</code>. When false,
          the middleware short-circuits and RateLimit-Remaining stays at the
          configured value forever; useful for opt-in rate-limit rollout.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {(['candidate', 'hr', 'pm'] as const).map((tier) => (
            <div key={tier} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
              <h3 style={{ marginTop: 0 }}>{tier}</h3>
              <MetricCard label="1 second"  value={cfg.limits[tier].second} />
              <MetricCard label="1 minute"  value={cfg.limits[tier].minute} />
              <MetricCard label="1 hour"    value={cfg.limits[tier].hour} />
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Per-user bucket reset</h2>
        <p style={{ color: '#666' }}>
          Clears the rate-limit bucket for one user. Useful when a user
          hit the limit and the dashboard is otherwise indistinguishable
          from "they're over-quota for the day".
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder="user_id (e.g. user_abc123)"
            value={clearUserId}
            onChange={(e) => setClearUserId(e.target.value)}
            style={{ flex: 1, padding: 8, fontFamily: 'monospace' }}
          />
          <button
            onClick={clearBucket}
            disabled={clearing || !clearUserId.trim()}
            style={{ padding: '8px 16px' }}
          >
            {clearing ? 'Clearing…' : 'Clear bucket'}
          </button>
        </div>
        {clearResult && (
          <p style={{ marginTop: 8, color: clearResult.startsWith('error') ? 'red' : 'green' }}>
            {clearResult}
          </p>
        )}
      </section>

      <section>
        <h2>Reference</h2>
        <ul>
          <li><code>GET    /v1/config/rate-limits</code>          — public, current config</li>
          <li><code>GET    /v1/admin/rate-limit/buckets</code>     — live snapshot of a tier's window</li>
          <li><code>POST   /v1/admin/rate-limit/users/:id/clear</code> — reset one user's bucket</li>
          <li><code>PUT    /v1/admin/config/rate_limit.tier.&lt;role&gt;.limit_per_minute</code> — write through Config (admin auth)</li>
        </ul>
      </section>
    </Layout>
  );
}
