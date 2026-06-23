// Pure formatting helpers. No React, no fetch — easy to unit test.

/** ISO 8601 → "2026-06-24 12:34" (local timezone) */
export function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "3 days ago" / "2 hours ago" / "just now" */
export function relativeTime(iso: string, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return 'in the future';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

/** Status → CSS color name (matches styles.css classes if added). */
export function statusColor(status: string): 'green' | 'red' | 'yellow' | 'gray' {
  switch (status) {
    case 'active':
    case 'success':
    case 'paid':
    case 'unlocked':
      return 'green';
    case 'suspended':
    case 'cancelled':
    case 'error':
    case 'deleted':
      return 'red';
    case 'pending':
    case 'pending_payment':
    case 'in_pool':
      return 'yellow';
    default:
      return 'gray';
  }
}