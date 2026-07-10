import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import Skeleton from '../components/Skeleton';
import ConfigEditModal from '../components/ConfigEditModal';
import { listConfig, updateConfig, type ConfigEntry } from '../api/config';
import { useToast } from '@hunter-platform/shared-web/lib';
import { relativeTime } from '@hunter-platform/shared-web/lib';

export default function SettingsPage() {
  const toast = useToast();
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editEntry, setEditEntry] = useState<ConfigEntry | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    listConfig()
      .then(setEntries)
      .catch(err => toast.push({ type: 'error', message: err.message }))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (key: string, value: unknown, reason: string) => {
    await updateConfig(key, value, reason);
    toast.push({ type: 'success', message: `已保存 ${key}` });
    load();
  };

  return (
    <Layout adminName="Admin">
      <h1>Settings — Config</h1>

      {loading ? <Skeleton variant="row" count={5} /> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>Key</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Value</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Updated</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Updated By</th>
              <th style={{ padding: 8, textAlign: 'left' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.key} data-testid={`config-row-${e.key}`} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}><code>{e.key}</code></td>
                <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>{JSON.stringify(e.value)}</td>
                <td style={{ padding: 8 }}>{relativeTime(e.updated_at)}</td>
                <td style={{ padding: 8 }}>{e.updated_by_admin_user_id ?? '—'}</td>
                <td style={{ padding: 8 }}>
                  <button onClick={() => { setEditEntry(e); setModalOpen(true); }} className="btn btn-sm" data-testid={`config-edit-${e.key}`}>编辑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button onClick={() => { setEditEntry(null); setModalOpen(true); }} className="btn btn-primary" data-testid="config-new" style={{ marginTop: 16 }}>+ New Key</button>

      <ConfigEditModal
        open={modalOpen}
        entry={editEntry}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
      />
    </Layout>
  );
}
