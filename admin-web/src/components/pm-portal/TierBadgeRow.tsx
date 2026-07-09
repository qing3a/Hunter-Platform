// ============================================================================
// TierBadgeRow (S5 / Task 10)
// ============================================================================
//
// Right-column tier badges (5 dimensions, A/B/C/D grading) that sit
// underneath the radar. Each dimension is rendered as a row with:
//   - tier letter (A/B/C/D, colour-coded)
//   - dimension label (e.g. "前端")
//   - numeric value
//   - horizontal bar showing the value
//
// Grading thresholds (per plan):
//   - A: value >= 80  (green  #16a34a)
//   - B: value >= 60  (blue   #2563eb)
//   - C: value >= 40  (amber  #d97706)
//   - D: value <  40  (red    #dc2626)

interface Dim {
  label: string;
  value: number;
}

interface Props {
  dims: Dim[];
}

function tier(value: number): 'A' | 'B' | 'C' | 'D' {
  if (value >= 80) return 'A';
  if (value >= 60) return 'B';
  if (value >= 40) return 'C';
  return 'D';
}

const TIER_COLOR: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: '#16a34a',
  B: '#2563eb',
  C: '#d97706',
  D: '#dc2626',
};

export function TierBadgeRow({ dims }: Props) {
  return (
    <ul className="pm-tier-badge-row">
      {dims.map((d) => {
        const t = tier(d.value);
        const color = TIER_COLOR[t];
        return (
          <li key={d.label} data-tier={t} data-testid="pm-tier-badge">
            <span className="pm-tier-letter" style={{ color }}>
              {t}
            </span>
            <span className="pm-tier-label">{d.label}</span>
            <span className="pm-tier-value">{d.value}</span>
            <span className="pm-tier-bar">
              <span
                style={{
                  width: `${d.value}%`,
                  background: color,
                }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
