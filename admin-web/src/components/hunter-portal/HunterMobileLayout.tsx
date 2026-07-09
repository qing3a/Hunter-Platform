import { NavLink, useNavigate } from 'react-router-dom';
import { getSession, clearSession } from '../../lib/candidate-session';

interface HunterMobileLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export function HunterMobileLayout({ children, title }: HunterMobileLayoutProps) {
  const session = getSession();
  const navigate = useNavigate();

  return (
    <div className="hp-layout">
      <header className="hp-topbar">
        <div className="hp-brand">Hunter · 工作台</div>
        {title && <div className="hp-title">{title}</div>}
        {session && (
          <button
            className="hp-logout"
            onClick={() => { clearSession(); navigate('/hunter/login'); }}
          >
            退出
          </button>
        )}
      </header>
      <main className="hp-main">{children}</main>
      {session && (
        <nav className="hp-tabbar">
          <NavLink to="/hunter/workspace" className="hp-tab">🏠 工作台</NavLink>
          <NavLink to="/hunter/candidates" className="hp-tab">👥 候选</NavLink>
          <NavLink to="/hunter/kanban" className="hp-tab">📊 看板</NavLink>
          <NavLink to="/hunter/tasks" className="hp-tab">✅ 任务</NavLink>
          <NavLink to="/hunter/settings" className="hp-tab">⚙️ 我的</NavLink>
        </nav>
      )}
    </div>
  );
}
