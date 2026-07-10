interface Values {
  coverage: number;
  match: number;
  composite: number;
}

interface Props {
  values: Values;
  locked: boolean;
  size?: number;
}

/**
 * 3-dimension triangle radar (综合 / 覆盖 / 匹配) rendered as inline SVG.
 *
 * Used inside StaffingPlanCard (S4). The value polygon is filled with a
 * muted blue when the plan is selected (locked) and a neutral grey when
 * it is not, so the user can spot the active plan at a glance.
 */
export function TriangleRadar({ values, locked, size = 120 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;

  // Three vertices: top (composite), bottom-left (coverage), bottom-right (match).
  const top: [number, number] = [cx, cy - r];
  const bl: [number, number] = [cx - r * Math.sin(Math.PI / 3), cy + r * Math.cos(Math.PI / 3)];
  const br: [number, number] = [cx + r * Math.sin(Math.PI / 3), cy + r * Math.cos(Math.PI / 3)];

  // Clamp each input 0-100 then scale to 0-1 along its axis from the centre.
  const scale = (v: number) => Math.max(0, Math.min(100, v)) / 100;

  const vp: [number, number][] = [
    [cx, cy - r * scale(values.composite)],
    [
      cx - r * Math.sin(Math.PI / 3) * scale(values.coverage),
      cy + r * Math.cos(Math.PI / 3) * scale(values.coverage),
    ],
    [
      cx + r * Math.sin(Math.PI / 3) * scale(values.match),
      cy + r * Math.cos(Math.PI / 3) * scale(values.match),
    ],
  ];

  const fill = locked ? '#dbeafe' : '#f3f4f6';
  const pointsStr = (pts: [number, number][]) => pts.map((p) => p.join(',')).join(' ');

  return (
    <svg
      data-testid="pm-triangle-radar"
      className="pm-triangle-radar"
      width={size}
      height={size * 0.9}
      role="img"
      aria-label="能力雷达"
    >
      <polygon
        data-testid="pm-triangle-radar-grid"
        points={pointsStr([top, bl, br])}
        fill="#e5e7eb"
      />
      <polygon
        data-testid="pm-triangle-radar-value"
        points={pointsStr(vp)}
        fill={fill}
        stroke="#2563eb"
        strokeWidth={1}
      />
      <text x={top[0]} y={top[1] - 4} textAnchor="middle" fontSize={9}>
        综合
      </text>
      <text x={bl[0] - 4} y={bl[1] + 4} textAnchor="end" fontSize={9}>
        覆盖
      </text>
      <text x={br[0] + 4} y={br[1] + 4} textAnchor="start" fontSize={9}>
        匹配
      </text>
    </svg>
  );
}
