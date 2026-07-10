// Pure formatting helpers. No React, no fetch — easy to unit test.

/** ISO 8601 → "2026-06-24 12:34" (local timezone) */
export function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "3 天前" / "2 小时前" / "刚刚" / "未来" */
export function relativeTime(iso: Date | string | number, now: number = Date.now()): string {
  const ts = iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
  if (Number.isNaN(ts)) return String(iso);
  const diffMs = ts - now;
  const absMs = Math.abs(diffMs);
  const future = diffMs > 0;

  if (absMs < 60_000) return future ? '未来' : '刚刚';
  if (absMs < 3_600_000) {
    const n = Math.floor(absMs / 60_000);
    return future ? `${n} 分钟后` : `${n} 分钟前`;
  }
  if (absMs < 86_400_000) {
    const n = Math.floor(absMs / 3_600_000);
    return future ? `${n} 小时后` : `${n} 小时前`;
  }
  if (absMs < 30 * 86_400_000) {
    const n = Math.floor(absMs / 86_400_000);
    return future ? `${n} 天后` : `${n} 天前`;
  }
  if (absMs < 365 * 86_400_000) {
    const n = Math.floor(absMs / (30 * 86_400_000));
    return future ? `${n} 个月后` : `${n} 个月前`;
  }
  const n = Math.floor(absMs / (365 * 86_400_000));
  return future ? `${n} 年后` : `${n} 年前`;
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