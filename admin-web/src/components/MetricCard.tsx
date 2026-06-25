export default function MetricCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
}) {
  const content = (
    <>
      <div style={{ fontSize: 32, fontWeight: 700, color: '#1a1a1a' }}>{value}</div>
      <div style={{ color: '#666', marginTop: 4 }}>{label}</div>
      {hint && <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{hint}</div>}
    </>
  );
  const style = { margin: 0, flex: 1, minWidth: 180 };
  if (href) {
    return <a href={href} className="card" style={{ ...style, textDecoration: 'none' }} data-testid={`metric-${label}`}>{content}</a>;
  }
  return <div className="card" style={style}>{content}</div>;
}