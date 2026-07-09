const KEY = 'hp_candidate_session';

export interface CandidateSession {
  api_key: string;
  user_id: string;
  profile_complete: boolean;
  email?: string;
  /** Optional role identifier. 'headhunter' for hunter portal; absent for candidates. */
  role?: 'candidate' | 'headhunter' | 'pm' | 'employer';
}

export function getSession(): CandidateSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(session: CandidateSession): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}

export function getAuthHeader(): string | null {
  const s = getSession();
  return s ? `Bearer ${s.api_key}` : null;
}

/** Return the current session's role, or null if not logged in. */
export function getRole(): CandidateSession['role'] | null {
  const s = getSession();
  return s ? s.role : null;
}
