import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { listAdminLog, listActionHistory, listLoginEvents, type AdminLogRow, type ActionHistoryRow, type LoginEventRow } from '../api/audit';
import { formatDate } from '../lib/format';
import StatusBadge from '../components/StatusBadge';
import Pagination from '../components/Pagination';
import AuditJsonDrawer from '../components/AuditJsonDrawer';

type Tab = 'admin' | 'user' | 'login';

export default function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = (searchParams.get('tab') as Tab) || 'admin';

  return (
    <Layout adminName="Admin">
      <h2>Audit</h2>
      <nav className="tabs" style={{ marginBottom: 16, borderBottom: '1px solid #ddd' }}>
        {(['admin', 'user', 'login'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setSearchParams({ tab: t })}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderBottom: tab === t ? '2px solid #0066cc' : '2px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              fontWeight: tab === t ? 'bold' : 'normal',
            }}
          >
            {t === 'admin' ? 'Admin Actions' : t === 'user' ? 'User Actions' : 'Login Events'}
          </button>
        ))}
      </nav>
      {tab === 'admin' && <AdminActionsTab />}
      {tab === 'user' && <UserActionsTab />}
      {tab === 'login' && <LoginEventsTab />}
    </Layout>
  );
}

function AdminActionsTab() {
  const [page, setPage] = useState(1);
  const [actor, setActor] = useState('');
  const [data, setData] = useState<AdminLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAdminLog({ page, pageSize: 20, actor: actor || undefined });
      setData(res.data);
      setTotal(res.pagination.total);
    } finally { setLoading(false); }
  }, [page, actor]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <div>
      <input
        type="text"
        placeholder="Search by actor email/id..."
        value={actor}
        onChange={e => { setActor(e.target.value); setPage(1); }}
        style={{ marginBottom: 12, padding: 6, width: 300 }}
      />
      {loading ? <p>Loading...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>Time</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Actor</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Action</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Target</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 12, textAlign: 'center', color: '#888' }}>No admin actions recorded</td></tr>
            ) : data.map(row => (
              <tr key={row.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{formatDate(row.created_at)}</td>
                <td style={{ padding: 8 }}>{row.actor}</td>
                <td style={{ padding: 8 }}><code>{row.action_type}</code></td>
                <td style={{ padding: 8 }}>{row.target_type ? `${row.target_type}:${row.target_id}` : '—'}</td>
                <td style={{ padding: 8 }}>{row.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} />
    </div>
  );
}

function UserActionsTab() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ActionHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState<{ open: boolean; title: string; json: string | null }>({ open: false, title: '', json: null });

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listActionHistory({ page, pageSize: 20 });
      setData(res.data);
      setTotal(res.pagination.total);
    } finally { setLoading(false); }
  }, [page]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <div>
      {loading ? <p>Loading...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>Time</th>
              <th style={{ padding: 8, textAlign: 'left' }}>User</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Capability</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Status</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 12, textAlign: 'center', color: '#888' }}>No user actions recorded</td></tr>
            ) : data.map(row => (
              <tr key={row.id} style={{ borderTop: '1px solid #eee', cursor: 'pointer' }} onClick={() => setDrawer({ open: true, title: `${row.capability_name} @ ${formatDate(row.created_at)}`, json: row.response_summary_json })}>
                <td style={{ padding: 8 }}>{formatDate(row.created_at)}</td>
                <td style={{ padding: 8 }}>{row.user_id}</td>
                <td style={{ padding: 8 }}><code>{row.capability_name}</code></td>
                <td style={{ padding: 8 }}><StatusBadge status={row.status} /></td>
                <td style={{ padding: 8 }}>{row.duration_ms != null ? `${row.duration_ms}ms` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} />
      <AuditJsonDrawer
        open={drawer.open}
        onClose={() => setDrawer({ open: false, title: '', json: null })}
        title={drawer.title}
        json={drawer.json}
      />
    </div>
  );
}

function LoginEventsTab() {
  const [page, setPage] = useState(1);
  const [successFilter, setSuccessFilter] = useState<'' | '1' | '0'>('');
  const [data, setData] = useState<LoginEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listLoginEvents({
        page, pageSize: 20,
        success: successFilter ? (Number(successFilter) as 0 | 1) : undefined,
      });
      setData(res.data);
      setTotal(res.pagination.total);
    } finally { setLoading(false); }
  }, [page, successFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <div>
      <select value={successFilter} onChange={e => { setSuccessFilter(e.target.value as '' | '1' | '0'); setPage(1); }} style={{ marginBottom: 12, padding: 6 }}>
        <option value="">All events</option>
        <option value="1">Success only</option>
        <option value="0">Failure only</option>
      </select>
      {loading ? <p>Loading...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>Time</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Email</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Admin</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Success</th>
              <th style={{ padding: 8, textAlign: 'left' }}>IP</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 12, textAlign: 'center', color: '#888' }}>No login events recorded</td></tr>
            ) : data.map(row => (
              <tr key={row.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{formatDate(row.created_at)}</td>
                <td style={{ padding: 8 }}>{row.email}</td>
                <td style={{ padding: 8 }}>{row.admin_user_id ?? '—'}</td>
                <td style={{ padding: 8 }}>
                  <StatusBadge status={row.success === 1 ? 'success' : 'error'} />
                </td>
                <td style={{ padding: 8 }}>{row.ip ?? '—'}</td>
                <td style={{ padding: 8 }}>{row.failure_reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} />
    </div>
  );
}