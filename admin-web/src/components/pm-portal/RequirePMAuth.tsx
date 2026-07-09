import { Navigate, useLocation } from 'react-router-dom';
import { getSession, getRole } from '../../lib/candidate-session';

/**
 * PM Workbench — route guard (Phase 1 / Task 3).
 *
 * Mirrors `RequireHunterAuth`: bounces to `/admin/pm/login` when no session, and to
 * `/candidate/login` (with `reason: 'wrong_portal'`) when the user is signed
 * in under a different role. The only role that passes through is `pm`.
 *
 * Task 17 mounts the full `/admin/pm/*` route tree behind this guard.
 */
export function RequirePMAuth({ children }: { children: React.ReactNode }) {
  const session = getSession();
  const role = getRole();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/admin/pm/login" state={{ from: location }} replace />;
  }

  // A legacy candidate session (no role field) or any non-pm role — including
  // 'headhunter', 'candidate', and the reserved 'employer' — is treated as
  // "wrong portal". Bounce to the candidate portal instead of silently
  // rendering PM-only UI.
  if (role !== 'pm') {
    return <Navigate to="/candidate/login" state={{ from: location, reason: 'wrong_portal' }} replace />;
  }

  return <>{children}</>;
}
