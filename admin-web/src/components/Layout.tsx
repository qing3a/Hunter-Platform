import { NavLink, useNavigate } from 'react-router-dom';
import { clearToken } from '../lib/auth';

export default function Layout({ children, adminName }: { children: React.ReactNode; adminName: string }) {
  const navigate = useNavigate();
  const logout = () => {
    clearToken();
    navigate('/admin/login');
  };
  const linkStyle = ({ isActive }: { isActive: boolean }) => ({
    color: 'white',
    textDecoration: 'none',
    padding: '10px 16px',
    borderRadius: 4,
    display: 'block',
    background: isActive ? 'rgba(255,255,255,0.2)' : 'transparent',
  });
  return (
    <>
      <aside className="sidebar">
        <div className="sidebar__brand">猎头管理后台</div>
        <nav className="sidebar__nav">
          <NavLink to="/admin" end style={linkStyle}>仪表盘</NavLink>
          <NavLink to="/admin/users" style={linkStyle}>用户</NavLink>
          <NavLink to="/admin/candidates" style={linkStyle}>候选人</NavLink>
          <NavLink to="/admin/jobs" style={linkStyle}>职位</NavLink>
          <NavLink to="/admin/recommendations" style={linkStyle}>推荐</NavLink>
          <NavLink to="/admin/webhooks/dead-letter" style={linkStyle}>Webhook 死信</NavLink>
          <NavLink to="/admin/settings" style={linkStyle} data-testid="nav-settings">设置</NavLink>
          <NavLink to="/admin/placements" style={linkStyle}>Placements</NavLink>
          <NavLink to="/admin/audit" style={linkStyle}>审计</NavLink>
          <NavLink to="/admin/profile" style={linkStyle}>我的</NavLink>
        </nav>
        <div className="sidebar__footer">
          <div className="sidebar__user">{adminName}</div>
          <button className="btn btn-danger sidebar__logout" onClick={logout}>退出登录</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </>
  );
}