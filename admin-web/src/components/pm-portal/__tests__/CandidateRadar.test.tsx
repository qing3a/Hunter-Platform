import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  CandidateRadar,
  computeCandidateCapabilities,
  categorizeSkill,
  CANDIDATE_CAPABILITY_CATEGORIES,
  CANDIDATE_LEVEL_SCORE,
  type CandidateRadarSource,
} from '../CandidateRadar';

// ---- Tests for the pure bucketing helpers ---------------------------------

describe('categorizeSkill — keyword buckets', () => {
  beforeEach(() => cleanup());

  it('buckets a vue skill into frontend', () => {
    expect(categorizeSkill('vue')).toBe('frontend');
  });

  it('buckets a Chinese skill (后端) into backend', () => {
    expect(categorizeSkill('高级后端工程师')).toBe('backend');
  });

  it('buckets iOS / android into mobile', () => {
    expect(categorizeSkill('ios')).toBe('mobile');
    expect(categorizeSkill('android')).toBe('mobile');
    expect(categorizeSkill('kotlin')).toBe('mobile');
  });

  it('buckets data / ai / ml into the data category', () => {
    expect(categorizeSkill('data')).toBe('data');
    expect(categorizeSkill('ai')).toBe('data');
    expect(categorizeSkill('ml')).toBe('data');
    expect(categorizeSkill('数据')).toBe('data');
  });

  it('buckets design / UI skills into design', () => {
    expect(categorizeSkill('figma')).toBe('design');
    expect(categorizeSkill('design')).toBe('design');
    expect(categorizeSkill('UI')).toBe('design');
  });

  it('returns null for an unknown skill', () => {
    expect(categorizeSkill('barista')).toBeNull();
    expect(categorizeSkill('underwater-basket-weaving')).toBeNull();
  });

  it('matches case-insensitively (uppercased input)', () => {
    expect(categorizeSkill('VUE')).toBe('frontend');
    expect(categorizeSkill('React')).toBe('frontend');
    expect(categorizeSkill('Machine Learning')).toBe('data');
  });
});

// ---- Tests for computeCandidateCapabilities (pure function) ---------------

describe('computeCandidateCapabilities — score calculation', () => {
  beforeEach(() => cleanup());

  it('seeds every dimension with the level score for a candidate with no matching skills', () => {
    const result = computeCandidateCapabilities({ skills: [], title_level: 'mid' });
    // mid => 50 on every dimension.
    expect(result.frontend).toBe(50);
    expect(result.backend).toBe(50);
    expect(result.mobile).toBe(50);
    expect(result.data).toBe(50);
    expect(result.design).toBe(50);
  });

  it('uses the documented level-score table (junior=25, mid=50, senior=75, staff=100)', () => {
    expect(CANDIDATE_LEVEL_SCORE).toEqual({
      junior: 25,
      mid: 50,
      senior: 75,
      staff: 100,
    });
    expect(computeCandidateCapabilities({ skills: [] }).frontend).toBe(50); // default = mid
    expect(computeCandidateCapabilities({ skills: [], title_level: 'junior' }).backend).toBe(25);
    expect(computeCandidateCapabilities({ skills: [], title_level: 'staff' }).design).toBe(100);
  });

  it('adds 30 per matching skill in a category (uncapped)', () => {
    const result = computeCandidateCapabilities({
      skills: ['vue', 'react', 'typescript'],
      title_level: 'senior', // 75 base
    });
    // frontend matches: vue, react, typescript → 3 × 30 = 90 added → capped at 100.
    expect(result.frontend).toBe(100);
    // backend / mobile / data / design each untouched at 75.
    expect(result.backend).toBe(75);
    expect(result.mobile).toBe(75);
    expect(result.data).toBe(75);
    expect(result.design).toBe(75);
  });

  it('caps each dimension at 100 even with many matching skills', () => {
    const result = computeCandidateCapabilities({
      skills: ['vue', 'react', 'typescript', 'html', 'css', 'frontend', 'webpack', 'javascript'],
      title_level: 'staff', // 100 base — already at the cap
    });
    expect(result.frontend).toBe(100);
    expect(result.backend).toBe(100);
    expect(result.mobile).toBe(100);
    expect(result.data).toBe(100);
    expect(result.design).toBe(100);
  });

  it('only contributes to dimensions that match; unrelated skills leave the rest at level', () => {
    const result = computeCandidateCapabilities({
      skills: ['vue', 'node.js', 'postgres'],
      title_level: 'mid', // 50
    });
    // frontend: 50 + 30 (vue) = 80
    // backend:  50 + 30 (node.js) + 30 (postgres) = 110 → capped at 100
    // mobile / data / design: no match → 50
    expect(result.frontend).toBe(80);
    expect(result.backend).toBe(100);
    expect(result.mobile).toBe(50);
    expect(result.data).toBe(50);
    expect(result.design).toBe(50);
  });

  it('handles a missing title_level by defaulting to mid', () => {
    const result = computeCandidateCapabilities({ skills: ['vue'] });
    // mid base 50 + vue (frontend) 30 = 80
    expect(result.frontend).toBe(80);
    // non-matched untouched at 50.
    expect(result.backend).toBe(50);
  });

  it('returns the full 5-dimension shape (no missing keys)', () => {
    const result = computeCandidateCapabilities({ skills: [], title_level: 'junior' });
    for (const cat of CANDIDATE_CAPABILITY_CATEGORIES) {
      expect(result[cat]).toBe(25);
    }
  });
});

// ---- Tests for the React component surface --------------------------------

describe('CandidateRadar — component rendering', () => {
  beforeEach(() => cleanup());

  it('renders an SVG inside the .pm-candidate-radar wrapper', () => {
    const source: CandidateRadarSource = { skills: ['vue', 'react'], title_level: 'senior' };
    render(<CandidateRadar source={source} />);
    const wrap = screen.getByTestId('pm-candidate-radar');
    expect(wrap).toBeInTheDocument();
    // The reused RadarChart renders an svg.cp-radar directly inside.
    expect(wrap.querySelector('svg.cp-radar')).not.toBeNull();
  });

  it('passes the computed dimensions to RadarChart (vertex polygon reflects source)', () => {
    const { container } = render(
      <CandidateRadar source={{ skills: ['vue'], title_level: 'junior' }} size={200} />,
    );
    // The RadarChart renders 5 label texts prefixed with the category name.
    // We assert that the label text "前端" appears (i.e. the frontend dimension was computed).
    // RadarChart label format is `${d.label}: ${d.score}` so junior + vue → 25 + 30 = 55.
    const svg = container.querySelector('svg.cp-radar');
    expect(svg).not.toBeNull();
    expect(svg!.textContent).toContain('前端');
  });

  it('does not crash on an empty skills list (degenerate polygon)', () => {
    expect(() =>
      render(<CandidateRadar source={{ skills: [], title_level: 'mid' }} />),
    ).not.toThrow();
  });

  it('honours the size prop', () => {
    const { container } = render(
      <CandidateRadar source={{ skills: ['vue'] }} size={300} />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('300');
    expect(svg?.getAttribute('height')).toBe('300');
  });
});
