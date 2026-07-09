// ============================================================================
// OnTrackAlert (Task 8 / S3)
// ============================================================================
//
// A small footer banner that compares the funnel's `offer + onboarded`
// candidate count against the position's planned headcount and surfaces
// either a green "✓ 节奏正常" pill or an amber remediation hint with the
// delta.
//
// Props
// -----
//   offerOnboarded  total candidates currently in {offer, onboarded}
//   target          the position's headcount_planned
//
// When offerOnboarded >= target we render the green chip. Otherwise we
// render the amber banner with the remaining gap and a one-line action
// suggestion that links back to the candidate-match page in spirit (the
// actual deep-link is out-of-scope for v1).

interface OnTrackAlertProps {
  offerOnboarded: number;
  target: number;
}

export function OnTrackAlert({ offerOnboarded, target }: OnTrackAlertProps) {
  if (offerOnboarded >= target) {
    return (
      <div data-testid="pm-ontrack-ok" className="pm-ontrack pm-ontrack--ok">
        ✓ 节奏正常
      </div>
    );
  }

  const gap = target - offerOnboarded;
  return (
    <div
      data-testid="pm-ontrack-warn"
      className="pm-ontrack pm-ontrack--warn"
      role="alert"
    >
      ⚠️ 沙盘提醒：还差 {gap} 个候选人到岗（已 {offerOnboarded} / 目标 {target}）。
      建议:在「候选人匹配」页加大投放或激活待认领的猎头。
    </div>
  );
}
