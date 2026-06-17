import { useEffect, useState } from 'react';

interface Placement {
  id: string;
  job_id: string;
  candidate_user_id: string;
  primary_headhunter_id: string;
  referrer_headhunter_id: string | null;
  annual_salary: number;
  platform_fee: number;
  primary_share: number;
  referrer_share: number;
  status: 'pending_payment' | 'paid' | 'cancelled';
  created_at: string;
}

interface Summary {
  pending_count: number; paid_count: number; total_paid_amount: number;
  total_platform_revenue: number; total_hunter_payout: number;
}

export default function CommissionBilling(): JSX.Element {
  const [list, setList] = useState<Placement[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = async () => {
    setError(null); setInfo(null);
    const [r1, r2] = await Promise.all([
      window.api.admin.placements.list({}),
      window.api.admin.placements.summary(),
    ]);
    if (r1.ok) setList(r1.data); else setError(r1.error?.message);
    if (r2.ok) setSummary(r2.data); else setError(r2.error?.message);
  };

  useEffect(() => { void load(); }, []);

  const markPaid = async (id: string) => {
    if (!confirm(`Mark ${id} as paid?`)) return;
    const r = await window.api.admin.placements.markPaid(id);
    if (r.ok) { setInfo(`Marked ${id} as paid`); await load(); }
    else setError(r.error?.message);
  };

  const cancel = async (id: string) => {
    if (!confirm(`Cancel ${id}?`)) return;
    const r = await window.api.admin.placements.cancel(id);
    if (r.ok) { setInfo(`Cancelled ${id}`); await load(); }
    else setError(r.error?.message);
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>佣金账单</h1>
      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}
      {summary && (
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <div className="stat"><div className="label">待结算</div><div className="value">{summary.pending_count}</div></div>
          <div className="stat"><div className="label">已结算</div><div className="value">{summary.paid_count}</div></div>
          <div className="stat"><div className="label">平台收入</div><div className="value">¥{summary.total_platform_revenue.toLocaleString()}</div></div>
          <div className="stat"><div className="label">猎头已付</div><div className="value">¥{summary.total_hunter_payout.toLocaleString()}</div></div>
        </div>
      )}
      <div className="card">
        <button onClick={load}>刷新</button>
        <table>
          <thead><tr><th>ID</th><th>职位</th><th>候选人</th><th>猎头</th><th>年薪</th><th>平台费</th><th>猎头分成</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td><code>{p.id}</code></td>
                <td><code>{p.job_id.slice(0, 12)}</code></td>
                <td><code>{p.candidate_user_id.slice(0, 12)}</code></td>
                <td><code>{p.primary_headhunter_id.slice(0, 12)}</code></td>
                <td>¥{p.annual_salary.toLocaleString()}</td>
                <td>¥{p.platform_fee.toLocaleString()}</td>
                <td>¥{(p.primary_share + p.referrer_share).toLocaleString()}</td>
                <td>{p.status}</td>
                <td>
                  {p.status === 'pending_payment' && (
                    <>
                      <button onClick={() => markPaid(p.id)}>标记已付</button>
                      <button className="danger" style={{ marginLeft: 4 }} onClick={() => cancel(p.id)}>取消</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}