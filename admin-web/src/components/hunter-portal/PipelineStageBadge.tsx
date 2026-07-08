import type { PipelineStage } from '../../api/hunter-portal';

// NOTE: These constants are intentionally duplicated from src/main/lib/hunter-pipeline.ts.
// The admin-web frontend does not import from src/main/; the single source of truth lives
// in hunter-portal.ts (types) and the backend module (transitions). Keep in sync manually.

const STAGE_LABELS: Record<PipelineStage, string> = {
  submitted: '投递',
  screen_passed: '简历过',
  interview: '面试',
  offer: 'Offer',
  onboarded: '到岗',
  rejected: '已拒绝',
};

const STAGE_COLORS: Record<PipelineStage, string> = {
  submitted: '#3b82f6',
  screen_passed: '#8b5cf6',
  interview: '#ec4899',
  offer: '#f59e0b',
  onboarded: '#10b981',
  rejected: '#6b7280',
};

interface PipelineStageBadgeProps {
  stage: PipelineStage;
  size?: 'sm' | 'md';
}

export function PipelineStageBadge({ stage, size = 'md' }: PipelineStageBadgeProps) {
  return (
    <span
      className={`hp-pipeline-badge hp-pipeline-badge--${size}`}
      style={{
        backgroundColor: STAGE_COLORS[stage] + '22',
        color: STAGE_COLORS[stage],
        borderColor: STAGE_COLORS[stage],
      }}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}
