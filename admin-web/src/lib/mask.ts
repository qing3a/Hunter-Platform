// Mirror of src/main/lib/mask.ts (frontend copy — admin-web/ is a separate
// Vite project with its own bundle). Used when DISPLAYING backend data
// that's already masked, but also for any future local masking.

export function maskName(name: string): string {
  if (!name) return '';
  if (name.length <= 2) return name[0] + '*';
  if (name.length === 3) return name[0] + '*' + name[2];
  if (name.length === 4) return name[0] + '***';
  return name[0] + '***' + name.slice(-2);
}

export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '';
  const atIdx = email.indexOf('@');
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  const maskedLocal = local.length <= 1 ? local : local[0] + '***';
  const dotIdx = domain.lastIndexOf('.');
  if (dotIdx < 0) return `${maskedLocal}@***`;
  const tld = domain.slice(dotIdx);
  return `${maskedLocal}@***${tld}`;
}