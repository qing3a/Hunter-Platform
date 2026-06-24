import { NavLink, useNavigate } from 'react-router-dom';
import { clearToken } from '../lib/auth';

export default function Layout({ children, adminName }: { children: React.ReactNode; adminName: string }) {
  const navigate = useNavigate();
  const logout = () => {
    clearToken();
    navigate('/login');
  };
  const navStyle = ({ isActive }: { isActive: boolean }) => ({
    color: 'white',
    textDecoration: 'none',
    padding: '8px 12px',
    borderRadius: 4,
    background: isActive ? 'rgba(255,255,255,0.2)' : 'transparent',
  });
  return (
    <>
      <nav className="nav">
        <strong>猎头管理后台</strong>
        <NavLink to="/" end style={navStyle}>仪表盘</NavLink>
        <NavLink to="/users" style={navStyle}>用户</NavLink>
        <NavLink to="/candidates" style={navStyle}>候选人</NavLink>
        <NavLink to="/audit" style={navStyle}>审计</NavLink>
        <NavLink to="/profile" style={navStyle}>我的</NavLink>
        <div className="spacer" />
        <span>{adminName}</span>
        <button className="btn btn-danger" onClick={logout} style={{ marginLeft: 12 }}>退出登录</button>
      </nav>
      <div className="container">{children}</div>
    </>
  );
}