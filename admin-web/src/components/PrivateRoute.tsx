import { Navigate } from 'react-router-dom';
import { getToken } from '../lib/auth';

export default function PrivateRoute({ children }: { children: React.ReactNode }) {
  return getToken() ? <>{children}</> : <Navigate to="/admin/login" replace />;
}
