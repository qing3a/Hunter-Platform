const TOKEN_KEY = 'hunter_admin_api_key';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(key: string): void {
  localStorage.setItem(TOKEN_KEY, key);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
