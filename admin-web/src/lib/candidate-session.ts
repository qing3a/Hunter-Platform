const KEY = 'hp_candidate_session';

export interface CandidateSession {
  api_key: string;
  user_id: string;
  profile_complete: boolean;
  email?: string;
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
