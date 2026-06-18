const FORBIDDEN = ['name', 'phone', 'email', 'password', 'token', 'api_key', 'apikey'];

export function sanitizeSummary(obj: object | null | undefined): object | null {
  if (obj == null) return null;
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN.some(f => lower.includes(f.toLowerCase()))) {
      throw new Error(`PII key detected in action_history summary: "${key}"`);
    }
  }
  return obj;
}