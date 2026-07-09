import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CandidatePreviewCard } from '../CandidatePreviewCard';
import type { TalentPreview } from '../../../api/employer';

// ---- Helpers --------------------------------------------------------------

function makeCandidate(overrides: Partial<TalentPreview> = {}): TalentPreview {
  return {
    anonymized_id: 'cand-1',
    industry: '互联网',
    title_level: 'senior',
    years_experience: 7,
    salary_range: '40-60万',
    education_tier: '985',
    skills: ['TypeScript', 'React', 'Node.js'],
    ...overrides,
  };
}

// ---- Tests ----------------------------------------------------------------

describe('CandidatePreviewCard — rendered content', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the anonymized id (masked identifier) as the card headline', () => {
    render(<CandidatePreviewCard candidate={makeCandidate({ anonymized_id: 'cand-42' })} />);
    expect(screen.getByTestId('employer-candidate-card-cand-42')).toBeInTheDocument();
    // Anonymized id should be present in the visible text.
    expect(screen.getByTestId('employer-candidate-card-cand-42')).toHaveTextContent('cand-42');
  });

  it('renders the avatar initial derived from the anonymized id', () => {
    render(<CandidatePreviewCard candidate={makeCandidate({ anonymized_id: 'cand-42' })} />);
    const card = screen.getByTestId('employer-candidate-card-cand-42');
    const avatar = card.querySelector('.employer-candidate-avatar');
    expect(avatar).toBeInTheDocument();
    // anonymized_id 'cand-42' starts with 'c' (lowercase)
    expect(avatar).toHaveTextContent('c');
  });

  it('renders industry and title_level meta tags', () => {
    render(
      <CandidatePreviewCard
        candidate={makeCandidate({ industry: '金融', title_level: 'staff' })}
      />,
    );
    const card = screen.getByTestId('employer-candidate-card-cand-1');
    expect(card).toHaveTextContent('金融');
    expect(card).toHaveTextContent('staff');
  });

  it('renders salary range when provided', () => {
    render(<CandidatePreviewCard candidate={makeCandidate({ salary_range: '40-60万' })} />);
    expect(screen.getByTestId('employer-candidate-card-cand-1')).toHaveTextContent('40-60万');
  });

  it('renders years_experience as a meta line when present', () => {
    render(<CandidatePreviewCard candidate={makeCandidate({ years_experience: 7 })} />);
    expect(screen.getByTestId('employer-candidate-card-cand-1')).toHaveTextContent('7');
  });

  it('renders up to 5 skill tags, plus a +N overflow when more', () => {
    render(
      <CandidatePreviewCard
        candidate={makeCandidate({
          skills: ['TypeScript', 'React', 'Node.js', 'GraphQL', 'Docker', 'AWS', 'K8s'],
        })}
      />,
    );
    const card = screen.getByTestId('employer-candidate-card-cand-1');
    // 5 visible skills + 1 overflow chip = 6 spans sharing the class.
    expect(card.querySelectorAll('.employer-candidate-skill')).toHaveLength(6);
    // The non-overflow skill spans are exactly 5.
    expect(
      card.querySelectorAll('.employer-candidate-skill:not(.employer-candidate-skill-overflow)'),
    ).toHaveLength(5);
    expect(card).toHaveTextContent('+2');
  });

  it('renders a placeholder when there are no skills', () => {
    render(<CandidatePreviewCard candidate={makeCandidate({ skills: [] })} />);
    const card = screen.getByTestId('employer-candidate-card-cand-1');
    expect(card.querySelectorAll('.employer-candidate-skill')).toHaveLength(0);
  });
});

describe('CandidatePreviewCard — match score + actions', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not render the match score chip when matchScore is undefined', () => {
    render(<CandidatePreviewCard candidate={makeCandidate()} />);
    const card = screen.getByTestId('employer-candidate-card-cand-1');
    expect(card.querySelector('.cp-match-score')).toBeNull();
  });

  it('renders the match score chip when matchScore is provided', () => {
    render(<CandidatePreviewCard candidate={makeCandidate()} matchScore={85} />);
    const card = screen.getByTestId('employer-candidate-card-cand-1');
    const score = card.querySelector('.cp-match-score');
    expect(score).toBeInTheDocument();
    expect(score).toHaveTextContent('85');
  });

  it('renders express-interest and unlock buttons; clicking them invokes the callbacks', () => {
    const onExpressInterest = vi.fn();
    const onUnlock = vi.fn();
    render(
      <CandidatePreviewCard
        candidate={makeCandidate()}
        onExpressInterest={onExpressInterest}
        onUnlock={onUnlock}
      />,
    );
    const expressBtn = screen.getByTestId('employer-candidate-card-cand-1-express');
    const unlockBtn = screen.getByTestId('employer-candidate-card-cand-1-unlock');
    expect(expressBtn).toBeInTheDocument();
    expect(unlockBtn).toBeInTheDocument();

    fireEvent.click(expressBtn);
    fireEvent.click(unlockBtn);
    expect(onExpressInterest).toHaveBeenCalledTimes(1);
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it('does not throw when callbacks are omitted (button is a no-op)', () => {
    render(<CandidatePreviewCard candidate={makeCandidate()} />);
    const expressBtn = screen.getByTestId('employer-candidate-card-cand-1-express');
    // No callback — clicking should be a no-op (no throw).
    expect(() => fireEvent.click(expressBtn)).not.toThrow();
  });
});