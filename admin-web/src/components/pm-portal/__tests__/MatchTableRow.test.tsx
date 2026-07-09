import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MatchTableRow } from '../MatchTableRow';

describe('MatchTableRow', () => {
  const match = {
    position: '高级前端',
    project: '电商 V3',
    level: 'P5',
    score: 92,
    reasons: '技能 90% / 职级匹配',
    gaps: '',
  };

  it('renders a row with the pm-s5-match-row testid', () => {
    render(
      <table>
        <tbody>
          <MatchTableRow match={match} onRecommend={vi.fn()} onCaution={vi.fn()} />
        </tbody>
      </table>,
    );
    expect(screen.getByTestId('pm-s5-match-row')).toBeInTheDocument();
  });

  it('fires onRecommend when 推荐 clicked', () => {
    const onRec = vi.fn();
    render(
      <table>
        <tbody>
          <MatchTableRow match={match} onRecommend={onRec} onCaution={vi.fn()} />
        </tbody>
      </table>,
    );
    fireEvent.click(screen.getByRole('button', { name: /推荐/ }));
    expect(onRec).toHaveBeenCalledOnce();
  });
});
