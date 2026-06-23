import { Link, useNavigate } from 'react-router-dom';
import { clearToken } from '../lib/auth';

export default function Layout({ children, adminName }: { children: React.ReactNode; adminName: string }) {
  const navigate = useNavigate();
  const logout = () => {
    clearToken();
    navigate('/admin/login');
  };
  return (
    <>
      <nav className="nav">
        <strong>Hunter Admin</strong>
        <Link to="/admin/">Dashboard</Link>
        <Link to="/admin/profile">Profile</Link>
        <div className="spacer" />
        <span>{adminName}</span>
        <button className="btn btn-danger" onClick={logout} style={{ marginLeft: 12 }}>Logout</button>
      </nav>
      <div className="container">{children}</div>
    </>
  );
}
