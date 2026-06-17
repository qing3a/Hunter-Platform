import { useEffect, useState } from 'react';

interface AdminCandidate {
  id: string;
  source_headhunter_id: string;
  industry: string | null;
  title_level: string | null;
  years_experience: number | null;
  salary_range: string | null;
  education_tier: string | null;
  is_public_pool: number;
  unlock_status: string;
  created_at: string;
}

export default function CandidateAudit(): JSX.Element {
  const [list, setList] = useState<AdminCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = async () => {
    setError(null); setInfo(null);
    const res = await window.api.admin.candidates.list({ in_pool: true });
    if (res.ok) setList(res.data);
    else setError(res.error?.message ?? 'load failed');
  };

  useEffect(() => { void load(); }, []);

  const remove = async (id: string) => {
    if (!confirm(`Remove ${id} from public pool?`)) return;
    const res = await window.api.admin.candidates.removeFromPool(id);
    if (res.ok) { setInfo('Removed'); await load(); }
    else setError(res.error?.message ?? 'remove failed');
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>候选人审核（公开池）</h1>
      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}
      <div className="card">
        <table>
          <thead><tr><th>ID</th><th>行业</th><th>职级</th><th>年限</th><th>薪资</th><th>学历</th><th>解锁状态</th><th>操作</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td><code>{c.id}</code></td>
                <td>{c.industry}</td>
                <td>{c.title_level}</td>
                <td>{c.years_experience}</td>
                <td>{c.salary_range}</td>
                <td>{c.education_tier}</td>
                <td>{c.unlock_status}</td>
                <td><button className="danger" onClick={() => remove(c.id)}>下架</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}