interface Dimension {
  label: string;
  score: number;
}

interface RadarChartProps {
  dimensions: Dimension[];
  size?: number;
}

export function RadarChart({ dimensions, size = 280 }: RadarChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.4;
  const n = dimensions.length;

  const points = dimensions.map((d, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (d.score / 100) * radius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      labelX: cx + (radius + 16) * Math.cos(angle),
      labelY: cy + (radius + 16) * Math.sin(angle),
      label: d.label,
    };
  });

  const polygonPath = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg width={size} height={size} className="cp-radar" role="img" aria-label="能力雷达图">
      {[0.25, 0.5, 0.75, 1].map(ratio => (
        <circle key={ratio} cx={cx} cy={cy} r={radius * ratio} fill="none" stroke="var(--border)" strokeWidth={1} />
      ))}
      {points.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="var(--border)" />
      ))}
      <polygon points={polygonPath} fill="var(--c-match)" fillOpacity={0.3} stroke="var(--c-match)" strokeWidth={2} />
      {points.map((p, i) => (
        <text key={i} x={p.labelX} y={p.labelY} textAnchor="middle" alignmentBaseline="middle" fontSize={12} fill="var(--text)">
          {p.label}: {dimensions[i].score}
        </text>
      ))}
    </svg>
  );
}