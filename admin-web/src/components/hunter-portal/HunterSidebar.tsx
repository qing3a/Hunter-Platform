import { NavLink, useNavigate } from 'react-router-dom';
import { getSession, clearSession } from '../../lib/candidate-session';

export function HunterSidebar() {
  const session = getSession();
  const navigate = useNavigate();

  return (
    <aside className="hp-sidebar">
      <div className="hp-sidebar-brand">Hunter</div>
      <nav className="hp-sidebar-nav">
        <NavLink to="/hunter/workspace" className="hp-sidebar-link">🏠 工作台</NavLink>
        <NavLink to="/hunter/candidates" className="hp-sidebar-link">👥 候选人</NavLink>
        <NavLink to="/hunter/kanban" className="hp-sidebar-link">📊 看板</NavLink>
        <NavLink to="/hunter/tasks" className="hp-sidebar-link">✅ 任务</NavLink>
        <NavLink to="/hunter/settings" className="hp-sidebar-link">⚙️ 我的</NavLink>
      </nav>
      {session && (
        <button
          className="hp-sidebar-logout"
          onClick={() => { clearSession(); navigate('/hunter/login'); }}
        >
          退出
        </button>
      )}
    </aside>
  );
}
