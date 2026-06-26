import { useState } from 'react';
import Layout from '../components/Layout';

type Tab = 'config' | 'rate-limit' | 'webhooks';

const TAB_LABELS: Record<Tab, string> = {
  config: 'Config',
  'rate-limit': 'Rate-Limit',
  webhooks: 'Webhooks',
};

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  config: 'Business parameter config (key/value). Sub-E simplified: tab UI only.',
  'rate-limit': 'Rate-Limit settings (read-only via Config table rate_limit.* keys).',
  webhooks: 'Webhook subscription management (create/list/enable/disable/delete).',
};

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('config');

  return (
    <Layout adminName="Admin">
      <h1>Settings</h1>
      <div data-testid="settings-tabs" style={{ display: 'flex', gap: 8, borderBottom: '1px solid #ddd', marginBottom: 16 }}>
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button
            key={t}
            data-testid={`tab-${t}`}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px', border: 'none', background: 'transparent',
              borderBottom: tab === t ? '2px solid #1890ff' : '2px solid transparent',
              fontWeight: tab === t ? 'bold' : 'normal', cursor: 'pointer',
            }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div data-testid="settings-content" style={{ padding: 16, border: '1px solid #e0e0e0', borderRadius: 4, background: '#fafafa' }}>
        <h2 data-testid="settings-tab-title">{TAB_LABELS[tab]}</h2>
        <p data-testid="settings-tab-description">{TAB_DESCRIPTIONS[tab]}</p>
      </div>
    </Layout>
  );
}
