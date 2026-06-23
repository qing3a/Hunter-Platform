import { statusColor } from '../lib/format';

const COLOR_MAP: Record<string, string> = {
  green: '#22aa22',
  red: '#cc3300',
  yellow: '#cc9900',
  gray: '#888888',
};

export default function StatusBadge({ status }: { status: string }) {
  const color = COLOR_MAP[statusColor(status)];
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
      {status}
    </span>
  );
}