import { useEffect, useState, useCallback } from 'react';
import { useUrlParam } from '../hooks/useUrlParam';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { listAdminLog, listActionHistory, listLoginEvents, type AdminLogRow, type ActionHistoryRow, type LoginEventRow } from '../api/audit';
import { formatDate } from '@hunter-platform/shared-web/lib';
import StatusBadge from '../components/StatusBadge';
import Pagination from '../components/Pagination';
import AuditJsonDrawer from '../components/AuditJsonDrawer';

type Tab = 'admin' | 'user' | 'login';

export default function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = (searchParams.get('tab') as Tab) || 'admin';

  return (
    <Layout adminName="Admin">
      <h2>审计</h2>
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
            {t === 'admin' ? '管理员操作' : t === 'user' ? '用户操作' : '登录事件'}
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
  const [actor, setActor] = useUrlParam<string>('actor', '');
  const [page, setPage] = useUrlParam<number>('page', 1,
    (v) => v && /^\d+$/.test(v) ? Math.max(1, parseInt(v, 10)) : null);
  const [data, setData] = useState<AdminLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState<{ open: boolean; title: string; json: string | null }>({
    open: false, title: '', json: null,
  });

  const fetch = useCallback(async (a: string | undefined = actor) => {
    setLoading(true);
    try {
      const res = await listAdminLog({ page, pageSize: 20, actor: a || undefined });
      setData(res.data);
      setTotal(res.pagination.total);
    } finally { setLoading(false); }
  }, [page, actor]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <div>
      <input
        type="text"
        placeholder="按操作人邮箱/ID 搜索..."
        value={actor}
        onChange={e => { const v = e.target.value; setActor(v); setPage(1); fetch(v); }}
        style={{ marginBottom: 12, padding: 6, width: 300 }}
      />
      {loading ? <p>加载中...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>时间</th>
              <th style={{ padding: 8, textAlign: 'left' }}>操作人</th>
              <th style={{ padding: 8, textAlign: 'left' }}>操作</th>
              <th style={{ padding: 8, textAlign: 'left' }}>目标</th>
              <th style={{ padding: 8, textAlign: 'left' }}>原因</th>
              <th style={{ padding: 8, textAlign: 'left' }}>详情</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 12, textAlign: 'center', color: '#888' }}>暂无管理员操作记录</td></tr>
            ) : data.map(row => (
              <tr key={row.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{formatDate(row.created_at)}</td>
                <td style={{ padding: 8 }}>{row.actor}</td>
                <td style={{ padding: 8 }}><code>{row.action_type}</code></td>
                <td style={{ padding: 8 }}>{row.target_type ? `${row.target_type}:${row.target_id}` : '—'}</td>
                <td style={{ padding: 8 }}>{row.reason ?? '—'}</td>
                <td style={{ padding: 8 }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => setDrawer({
                      open: true,
                      title: `${row.action_type} @ ${formatDate(row.created_at)}`,
                      json: row.details_json,  // AuditJsonDrawer handles string|null
                    })}
                    data-testid={`admin-log-detail-${row.id}`}
                  >
                    详情
                  </button>
                </td>
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
      {loading ? <p>加载中...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>时间</th>
              <th style={{ padding: 8, textAlign: 'left' }}>用户</th>
              <th style={{ padding: 8, textAlign: 'left' }}>能力</th>
              <th style={{ padding: 8, textAlign: 'left' }}>状态</th>
              <th style={{ padding: 8, textAlign: 'left' }}>耗时</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 12, textAlign: 'center', color: '#888' }}>暂无用户操作记录</td></tr>
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
        <option value="">全部事件</option>
        <option value="1">仅成功</option>
        <option value="0">仅失败</option>
      </select>
      {loading ? <p>加载中...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>时间</th>
              <th style={{ padding: 8, textAlign: 'left' }}>邮箱</th>
              <th style={{ padding: 8, textAlign: 'left' }}>管理员</th>
              <th style={{ padding: 8, textAlign: 'left' }}>结果</th>
              <th style={{ padding: 8, textAlign: 'left' }}>IP</th>
              <th style={{ padding: 8, textAlign: 'left' }}>原因</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 12, textAlign: 'center', color: '#888' }}>暂无登录事件记录</td></tr>
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
