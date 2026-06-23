import { NavLink, useNavigate } from 'react-router-dom';
import { clearToken } from '../lib/auth';

export default function Layout({ children, adminName }: { children: React.ReactNode; adminName: string }) {
  const navigate = useNavigate();
  const logout = () => {
    clearToken();
    navigate('/admin/login');
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
        <strong>Hunter Admin</strong>
        <NavLink to="/admin/" style={navStyle}>Dashboard</NavLink>
        <NavLink to="/admin/users" style={navStyle}>Users</NavLink>
        <NavLink to="/admin/candidates" style={navStyle}>Candidates</NavLink>
        <NavLink to="/admin/profile" style={navStyle}>Profile</NavLink>
        <div className="spacer" />
        <span>{adminName}</span>
        <button className="btn btn-danger" onClick={logout} style={{ marginLeft: 12 }}>Logout</button>
      </nav>
      <div className="container">{children}</div>
    </>
  );
}