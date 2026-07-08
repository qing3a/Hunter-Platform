export type PipelineStage =
  | 'submitted'
  | 'screen_passed'
  | 'interview'
  | 'offer'
  | 'onboarded'
  | 'rejected';

export const PIPELINE_STAGES: PipelineStage[] = [
  'submitted',
  'screen_passed',
  'interview',
  'offer',
  'onboarded',
];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  submitted: '投递',
  screen_passed: '简历过',
  interview: '面试',
  offer: 'Offer',
  onboarded: '到岗',
  rejected: '已拒绝',
};

export const STAGE_COLORS: Record<PipelineStage, string> = {
  submitted: '#3b82f6',
  screen_passed: '#8b5cf6',
  interview: '#ec4899',
  offer: '#f59e0b',
  onboarded: '#10b981',
  rejected: '#6b7280',
};

const TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  submitted: ['screen_passed', 'rejected'],
  screen_passed: ['interview', 'rejected'],
  interview: ['offer', 'rejected'],
  offer: ['onboarded', 'rejected'],
  onboarded: [],
  rejected: [],
};

export function canTransition(from: PipelineStage, to: PipelineStage): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStages(from: PipelineStage): PipelineStage[] {
  return TRANSITIONS[from] ?? [];
}

export function isTerminal(stage: PipelineStage): boolean {
  return ['onboarded', 'rejected'].includes(stage);
}
