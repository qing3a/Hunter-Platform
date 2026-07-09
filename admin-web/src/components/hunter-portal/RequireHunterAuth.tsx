import { Navigate, useLocation } from 'react-router-dom';
import { getSession, getRole } from '../../lib/candidate-session';

export function RequireHunterAuth({ children }: { children: React.ReactNode }) {
  const session = getSession();
  const role = getRole();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/hunter/login" state={{ from: location }} replace />;
  }

  // A legacy candidate session (no role field) or a non-headhunter role
  // is treated as "wrong portal" — bounce to the candidate portal instead
  // of silently rendering hunter-only UI.
  if (role !== 'headhunter') {
    return <Navigate to="/candidate/login" state={{ from: location, reason: 'wrong_portal' }} replace />;
  }

  return <>{children}</>;
}
