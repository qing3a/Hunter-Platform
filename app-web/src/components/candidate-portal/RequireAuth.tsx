import { Navigate, useLocation } from 'react-router-dom';
import { getSession } from '../../lib/candidate-session';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const session = getSession();
  const location = useLocation();
  if (!session) {
    return <Navigate to="/candidate/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
