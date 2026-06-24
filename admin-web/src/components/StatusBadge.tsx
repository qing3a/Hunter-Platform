import { statusColor } from '../lib/format';

// Maps color name (returned by statusColor) → hex value for inline styling.
const COLOR_HEX: Record<string, string> = {
  green: '#22aa22',
  red: '#cc3300',
  yellow: '#cc9900',
  gray: '#888888',
};

// Maps API status value → Chinese display label.
const STATUS_LABELS: Record<string, string> = {
  active: '正常',
  suspended: '已暂停',
  deleted: '已删除',
  success: '成功',
  error: '失败',
  pending: '待处理',
  pending_payment: '待支付',
  in_pool: '候选池中',
  paid: '已支付',
  unlocked: '已解锁',
  locked: '已锁定',
};

export default function StatusBadge({ status }: { status: string }) {
  const color = COLOR_HEX[statusColor(status)];
  const label = STATUS_LABELS[status.toLowerCase()] ?? status;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 500,
      color: 'white',
      background: color,
    }}>
      {label}
    </span>
  );
}
