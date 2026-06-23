// Mask PII for admin views. Admins can suspend users (and thus see full name via
// /v1/admin/users), but the candidates list is a discovery view — partial masks
// keep the UI readable while reducing accidental over-disclosure.
//
// maskName('Alice')    → 'A***ce'
// maskName('Bo')       → 'B*'
// maskName('')         → ''
// maskEmail('a@x.com') → 'a***@***.com'

export function maskName(name: string): string {
  if (!name) return '';
  if (name.length <= 2) return name[0] + '*';
  if (name.length <= 4) return name[0] + '***';
  return name[0] + '***' + name.slice(-2);
}

export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '';
  const atIdx = email.indexOf('@');
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  const maskedLocal = local.length <= 1 ? local : local[0] + '***';
  // Mask the domain too: keep first char of domain, mask rest, keep TLD
  const dotIdx = domain.lastIndexOf('.');
  if (dotIdx < 0) {
    return `${maskedLocal}@***`;
  }
  const tld = domain.slice(dotIdx);
  return `${maskedLocal}@***${tld}`;
}