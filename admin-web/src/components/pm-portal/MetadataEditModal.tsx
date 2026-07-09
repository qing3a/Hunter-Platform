import { useState } from 'react';
import type { Project } from '../../api/pm-portal';

interface Props {
  open: boolean;
  project: Project;
  onSave: (input: { name: string; target: string; budget_total: number; start_at: number; end_at: number; current_team: Array<{role:string;count:number}> }) => void;
  onClose: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const fromDateInput = (s: string) => new Date(s).getTime();

export function MetadataEditModal({ open, project, onSave, onClose }: Props) {
  const [name, setName] = useState(project.name);
  const [target, setTarget] = useState(project.target ?? '');
  const [budget, setBudget] = useState(String(project.budget_total ?? 0));
  const [start, setStart] = useState(toDateInput(project.start_at ?? Date.now()));
  const [end, setEnd] = useState(toDateInput(project.end_at ?? Date.now()));
  const [team, setTeam] = useState(JSON.stringify(project.current_team ?? []));

  if (!open) return null;

  return (
    <div className="pm-meta-modal-backdrop" data-testid="pm-meta-modal" onClick={onClose}>
      <div className="pm-meta-modal" onClick={(e) => e.stopPropagation()}>
        <header className="pm-meta-modal-header">
          <h3>📋 项目元数据</h3>
          <button className="pm-btn-secondary" onClick={onClose} data-testid="pm-meta-modal-close">✕ 关闭</button>
        </header>
        <p className="pm-meta-modal-hint">项目的基础信息 + 现状团队 + 时间线。修改后下次进入项目时仍会带这些默认值。</p>
        <label>项目名 <input value={name} onChange={(e) => setName(e.target.value)} data-testid="pm-meta-name" /></label>
        <label>目标（关键指标） <textarea value={target} onChange={(e) => setTarget(e.target.value)} data-testid="pm-meta-target" /></label>
        <label>总预算（万元） <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} data-testid="pm-meta-budget" /></label>
        <div className="pm-meta-modal-dates">
          <label>开始 <input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="pm-meta-start" /></label>
          <label>结束 <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="pm-meta-end" /></label>
        </div>
        <label>现有团队 (JSON) <textarea value={team} onChange={(e) => setTeam(e.target.value)} data-testid="pm-meta-team" /></label>
        <footer className="pm-meta-modal-footer">
          <button className="pm-btn-primary" data-testid="pm-meta-modal-save" onClick={() => onSave({
            name, target, budget_total: Number(budget) * 10000, start_at: fromDateInput(start), end_at: fromDateInput(end),
            current_team: JSON.parse(team),
          })}>💾 保存元数据</button>
        </footer>
      </div>
    </div>
  );
}
