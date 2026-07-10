export type Stage = 'projects' | 'positions' | 'candidates' | 'matches';

export const STAGES: Stage[] = ['projects', 'positions', 'candidates', 'matches'];

const COLOR: Record<Stage, string> = {
  projects: 'var(--c-stage-project)',
  positions: 'var(--c-stage-position)',
  candidates: 'var(--c-stage-candidate)',
  matches: 'var(--c-stage-match)',
};

const BG: Record<Stage, string> = {
  projects: 'var(--b-stage-project)',
  positions: 'var(--b-stage-position)',
  candidates: 'var(--b-stage-candidate)',
  matches: 'var(--b-stage-match)',
};

const LABEL: Record<Stage, string> = {
  projects: '项目',
  positions: '岗位',
  candidates: '候选人',
  matches: '匹配',
};

export function stageColor(s: Stage): string { return COLOR[s]; }
export function stageBg(s: Stage): string { return BG[s]; }
export function stageLabel(s: Stage): string { return LABEL[s]; }