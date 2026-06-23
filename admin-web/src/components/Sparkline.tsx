export default function Sparkline({
  data,
  width = 600,
  height = 80,
}: {
  data: number[];
  width?: number;
  height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data);
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const points = data
    .map((v, i) => `${i * stepX},${height - (v / max) * (height - 8) - 4}`)
    .join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ maxWidth: width }}>
      <polyline points={points} fill="none" stroke="#0066cc" strokeWidth="1.5" />
      {data.map((v, i) => (
        <circle key={i} cx={i * stepX} cy={height - (v / max) * (height - 8) - 4} r="2" fill="#0066cc" />
      ))}
    </svg>
  );
}