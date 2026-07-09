import { Navigate, useLocation } from 'react-router-dom';
import { getSession, getRole } from '../../lib/candidate-session';

/**
 * Employer Panel — route guard (Phase 3c, Task 4).
 *
 * Mirrors `RequirePMAuth`: bounces to `/admin/employer/login` when no
 * session, and to `/candidate/login` (with `reason: 'wrong_portal'`) when
 * the user is signed in under a different role. The only role that passes
 * through is `employer`.
 *
 * The redirect target on success is the post-login landing — for the
 * employer portal that's `/admin/employer/dashboard` (mirrors the PM
 * portal's `/admin/pm/projects` redirect and the hunter portal's
 * `/hunter/workspace` redirect).
 */
export function RequireEmployerAuth({ children }: { children: React.ReactNode }) {
  const session = getSession();
  const role = getRole();
  const location = useLocation();

  if (!session) {
    return (
      <Navigate to="/admin/employer/login" state={{ from: location }} replace />
    );
  }

  // A legacy candidate session (no role field) or any non-employer role —
  // including 'headhunter', 'pm', and 'candidate' — is treated as "wrong
  // portal". Bounce to the candidate portal instead of silently rendering
  // employer-only UI.
  if (role !== 'employer') {
    return (
      <Navigate
        to="/candidate/login"
        state={{ from: location, reason: 'wrong_portal' }}
        replace
      />
    );
  }

  return <>{children}</>;
}