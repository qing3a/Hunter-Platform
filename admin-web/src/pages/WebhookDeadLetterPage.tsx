import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import Skeleton from '../components/Skeleton';
import { listDeadLetter, retryDeadLetter, type DeadLetterRow } from '../api/webhooks';
import { useToast } from '../lib/toast';
import { relativeTime } from '../lib/format';

const EVENT_TYPE_OPTIONS = [
  { value: '', label: '全部 event_type' },
  { value: 'payment.succeeded', label: 'payment.succeeded' },
  { value: 'placement.created', label: 'placement.created' },
  { value: 'candidate.unlocked', label: 'candidate.unlocked' },
];

export default function WebhookDeadLetterPage() {
  const toast = useToast();
  const [rows, setRows] = useState<DeadLetterRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);
  const [eventType, setEventType] = useState('');
  const [minAttempts, setMinAttempts] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback((p: number) => {
    setLoading(true);
    listDeadLetter({
      page: p, pageSize: 20,
      event_type: eventType || undefined,
      min_attempt_count: minAttempts ? Number(minAttempts) : undefined,
      from: from || undefined, until: until || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .catch(err => toast.push({ type: 'error', message: err.message }))
      .finally(() => setLoading(false));
  }, [eventType, minAttempts, from, until, toast]);

  useEffect(() => { load(page); }, [load, page]);

  const handleRetry = async (id: number) => {
    try {
      await retryDeadLetter(id);
      toast.push({ type: 'success', message: '已加入重试队列' });
      load(page);
    } catch (err: any) {
      toast.push({ type: 'error', message: err.message ?? '重试失败' });
    }
  };

  return (
    <Layout adminName="Admin">
      <h1>Webhook 死信队列</h1>

      <div style={{ background: '#fafafa', border: '1px solid #e0e0e0', borderRadius: 4, padding: 16, marginBottom: 16, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Event Type</label>
          <select value={eventType} onChange={e => { setEventType(e.target.value); setPage(1); }} data-testid="filter-event-type" style={{ padding: '0 8px', height: 32, border: '1px solid #ccc', borderRadius: 4 }}>
            {EVENT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Min Attempts</label>
          <input type="number" min={0} value={minAttempts} onChange={e => { setMinAttempts(e.target.value); setPage(1); }} placeholder="≥ N" data-testid="filter-min-attempts" style={{ padding: '0 8px', height: 32, width: 100, border: '1px solid #ccc', borderRadius: 4 }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>从</label>
          <input type="date" value={from.slice(0, 10)} onChange={e => { setFrom(e.target.value ? e.target.value + 'T00:00:00Z' : ''); setPage(1); }} data-testid="filter-from" style={{ padding: '0 8px', height: 32, border: '1px solid #ccc', borderRadius: 4 }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>至</label>
          <input type="date" value={until.slice(0, 10)} onChange={e => { setUntil(e.target.value ? e.target.value + 'T23:59:59Z' : ''); setPage(1); }} data-testid="filter-until" style={{ padding: '0 8px', height: 32, border: '1px solid #ccc', borderRadius: 4 }} />
        </div>
        <button onClick={() => { setEventType(''); setMinAttempts(''); setFrom(''); setUntil(''); setPage(1); }} data-testid="filter-clear" style={{ height: 32, padding: '0 16px', background: '#fff', border: '1px solid #ccc', borderRadius: 4 }}>清除</button>
      </div>

      {loading ? <Skeleton variant="row" count={5} /> : rows.length === 0 ? (
        <div className="card">暂无死信</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>ID</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Event Type</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Target User</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Attempts</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Last Error</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Updated</th>
              <th style={{ padding: 8, textAlign: 'left' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} data-testid={`dead-letter-row-${r.id}`} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}><code>{r.id}</code></td>
                <td style={{ padding: 8 }}>{r.event_type}</td>
                <td style={{ padding: 8 }}>{r.target_user_id}</td>
                <td style={{ padding: 8 }}>{r.attempt_count}</td>
                <td style={{ padding: 8, color: '#a8071a', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.last_error ?? '—'}</td>
                <td style={{ padding: 8 }}>{relativeTime(r.updated_at)}</td>
                <td style={{ padding: 8 }}>
                  <button onClick={() => handleRetry(r.id)} className="btn btn-sm" data-testid={`retry-${r.id}`}>重试</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Pagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} onPageChange={setPage} />
    </Layout>
  );
}