import { useState, useEffect, useCallback } from 'react';
import { useUrlParam } from '../hooks/useUrlParam';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import Skeleton from '../components/Skeleton';
import ConfirmModal from '../components/ConfirmModal';
import StatusBadge from '../components/StatusBadge';
import { listPlacements, markPaid, cancelPlacement, type PlacementRow, type PlacementStatus } from '../api/placements';
import { useToast } from '@hunter-platform/shared-web/lib';
import { relativeTime } from '@hunter-platform/shared-web/lib';

const STATUS_OPTIONS = [
  { value: '', label: '全部 status' },
  { value: 'pending_payment', label: 'pending_payment' },
  { value: 'paid', label: 'paid' },
  { value: 'cancelled', label: 'cancelled' },
];

type ConfirmState =
  | { open: false }
  | { open: true; type: 'mark-paid' | 'cancel'; placement: PlacementRow };

export default function PlacementsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<PlacementRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useUrlParam<PlacementStatus | ''>('status', '');
  const [from, setFrom] = useUrlParam<string>('from', '');
  const [until, setUntil] = useUrlParam<string>('until', '');
  const [page, setPage] = useUrlParam<number>('page', 1,
    (v) => v && /^\d+$/.test(v) ? Math.max(1, parseInt(v, 10)) : null);
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false });

  const load = useCallback((p: number, s: PlacementStatus | '' | undefined = status, f: string | undefined = from, u: string | undefined = until) => {
    setLoading(true);
    listPlacements({
      page: p, pageSize: 20,
      status: s || undefined,
      from: f || undefined, until: u || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .catch(err => toast.push({ type: 'error', message: err.message }))
      .finally(() => setLoading(false));
  }, [status, from, until, toast]);

  useEffect(() => { load(page); }, [load, page]);

  const handleConfirm = async () => {
    if (!confirm.open) return;
    if (confirm.type === 'mark-paid') {
      await markPaid(confirm.placement.id);
      toast.push({ type: 'success', message: `已标记 ${confirm.placement.id} 为已付款` });
    } else {
      await cancelPlacement(confirm.placement.id);
      toast.push({ type: 'success', message: `已取消 ${confirm.placement.id}` });
    }
    load(page);
  };

  return (
    <Layout adminName="Admin">
      <h1>Placements</h1>

      <div style={{ background: '#fafafa', border: '1px solid #e0e0e0', borderRadius: 4, padding: 16, marginBottom: 16, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Status</label>
          <select value={status} onChange={e => { const v = e.target.value as any; setStatus(v); setPage(1); load(1, v || undefined, from || undefined, until || undefined); }} data-testid="filter-status" style={{ padding: '0 8px', height: 32, border: '1px solid #ccc', borderRadius: 4 }}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>从</label>
          <input type="date" value={from.slice(0, 10)} onChange={e => { setFrom(e.target.value ? e.target.value + 'T00:00:00Z' : ''); setPage(1); }} data-testid="filter-from" style={{ padding: '0 8px', height: 32, border: '1px solid #ccc', borderRadius: 4 }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>至</label>
          <input type="date" value={until.slice(0, 10)} onChange={e => { setUntil(e.target.value ? e.target.value + 'T23:59:59Z' : ''); setPage(1); }} data-testid="filter-until" style={{ padding: '0 8px', height: 32, border: '1px solid #ccc', borderRadius: 4 }} />
        </div>
        <button onClick={() => { setStatus(''); setFrom(''); setUntil(''); setPage(1); }} data-testid="filter-clear" style={{ height: 32, padding: '0 16px', background: '#fff', border: '1px solid #ccc', borderRadius: 4 }}>清除</button>
      </div>

      {loading ? <Skeleton variant="row" count={5} /> : rows.length === 0 ? (
        <div className="card">暂无 placement</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>ID</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Job</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Employer</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Status</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Salary</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Platform Fee</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Created</th>
              <th style={{ padding: 8, textAlign: 'left' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} data-testid={`placement-row-${r.id}`} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}><code>{r.id}</code></td>
                <td style={{ padding: 8 }}>{r.job_id}</td>
                <td style={{ padding: 8 }}>{r.employer_id}</td>
                <td style={{ padding: 8 }}><StatusBadge status={r.status} /></td>
                <td style={{ padding: 8, textAlign: 'right' }}>{r.annual_salary.toLocaleString()}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{r.platform_fee.toLocaleString()}</td>
                <td style={{ padding: 8 }}>{relativeTime(r.created_at)}</td>
                <td style={{ padding: 8 }}>
                  {r.status === 'pending_payment' && (
                    <>
                      <button onClick={() => setConfirm({ open: true, type: 'mark-paid', placement: r })} className="btn btn-sm btn-primary" data-testid={`mark-paid-${r.id}`}>标记已付款</button>{' '}
                      <button onClick={() => setConfirm({ open: true, type: 'cancel', placement: r })} className="btn btn-sm btn-danger" data-testid={`cancel-${r.id}`}>取消</button>
                    </>
                  )}
                  {r.status === 'paid' && <button disabled className="btn btn-sm">已付款</button>}
                  {r.status === 'cancelled' && <button disabled className="btn btn-sm">已取消</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Pagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} onPageChange={setPage} />

      <ConfirmModal
        open={confirm.open}
        title={confirm.open ? (confirm.type === 'mark-paid' ? '标记为已付款' : '取消 placement') : ''}
        message={confirm.open ? (confirm.type === 'mark-paid' ? '确认标记为已付款？这将触发佣金结算。' : '确认取消此 placement？这将无法撤销。') : ''}
        variant={confirm.open && confirm.type === 'cancel' ? 'danger' : 'primary'}
        confirmText={confirm.open && confirm.type === 'mark-paid' ? '确认已收款' : '确认'}
        onConfirm={handleConfirm}
        onClose={() => setConfirm({ open: false })}
      />
    </Layout>
  );
}