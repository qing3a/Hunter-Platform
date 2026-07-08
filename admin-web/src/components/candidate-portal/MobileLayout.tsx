import { NavLink, useNavigate } from 'react-router-dom';
import { getSession, clearSession } from '../../lib/candidate-session';

interface MobileLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export function MobileLayout({ children, title }: MobileLayoutProps) {
  const session = getSession();
  const navigate = useNavigate();

  return (
    <div className="cp-layout">
      <header className="cp-topbar">
        <div className="cp-brand">Hunter · C 端</div>
        {title && <div className="cp-title">{title}</div>}
        {session && (
          <button
            className="cp-logout"
            onClick={() => { clearSession(); navigate('/candidate/login'); }}
          >
            退出
          </button>
        )}
      </header>
      <main className="cp-main">{children}</main>
      {session && (
        <nav className="cp-tabbar">
          <NavLink to="/candidate/home" className="cp-tab">🏠 推荐</NavLink>
          <NavLink to="/candidate/browse" className="cp-tab">🔍 浏览</NavLink>
          <NavLink to="/candidate/applications" className="cp-tab">📋 申请</NavLink>
          <NavLink to="/candidate/messages" className="cp-tab">💬 消息</NavLink>
          <NavLink to="/candidate/profile" className="cp-tab">👤 我的</NavLink>
        </nav>
      )}
    </div>
  );
}