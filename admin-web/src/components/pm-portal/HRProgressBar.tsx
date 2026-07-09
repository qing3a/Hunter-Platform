interface Props {
  filled: number;
  planned: number;
}

/**
 * HR headcount-fill progress bar (S8 / Task 13).
 *
 * Renders a single horizontal bar with a coloured fill segment and a
 * centred "{filled} / {planned} ({pct}%)" label. The fill width is the
 * rounded percentage of `filled / planned`; the fill colour follows a
 * three-tier threshold:
 *
 *   - ≥ 80 %  →  #16a34a (green)  — on-track
 *   - ≥ 30 %  →  #d97706 (amber)  — partial progress
 *   - <  30 % →  #94a3b8 (muted)  — early / no progress
 *
 * When `planned === 0` we render 0 % (and the muted colour) to avoid a
 * divide-by-zero — a project with no planned positions hasn't started
 * recruiting yet so there is nothing to fill.
 *
 * The root element exposes `data-pct={pct}` so table-style consumers
 * can style or assert against the percentage without parsing the
 * label text.
 */
export function HRProgressBar({ filled, planned }: Props) {
  const pct = planned === 0 ? 0 : Math.round((filled / planned) * 100);
  const color = pct >= 80 ? '#16a34a' : pct >= 30 ? '#d97706' : '#94a3b8';
  return (
    <div
      className="pm-hr-bar"
      data-testid="pm-hr-bar"
      data-pct={pct}
      title={`已到岗 ${filled} / 总 ${planned}`}
    >
      <div
        className="pm-hr-bar-fill"
        data-testid="pm-hr-bar-fill"
        style={{ width: `${pct}%`, background: color }}
      />
      <span className="pm-hr-bar-text">
        {filled} / {planned} ({pct}%)
      </span>
    </div>
  );
}