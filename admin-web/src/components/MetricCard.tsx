export default function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="card" style={{ margin: 0, flex: 1, minWidth: 180 }}>
      <div style={{ fontSize: 32, fontWeight: 700, color: '#1a1a1a' }}>{value}</div>
      <div style={{ color: '#666', marginTop: 4 }}>{label}</div>
      {hint && <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}