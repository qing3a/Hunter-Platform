import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { MatchSidebar } from '../MatchSidebar';

describe('MatchSidebar', () => {
  const matches = [
    { positionId: 'pos-1', positionTitle: '高级前端工程师', projectName: '电商 V3', score: 92 },
    { positionId: 'pos-2', positionTitle: '全栈工程师', projectName: '数据中台', score: 78 },
  ];

  it('renders the sidebar with title and subtitle', () => {
    render(<MemoryRouter><MatchSidebar positionId="pos-x" matches={matches} /></MemoryRouter>);
    expect(screen.getByText('🎯 候选人实时匹配')).toBeInTheDocument();
    expect(screen.getByText(/按匹配度排序/)).toBeInTheDocument();
  });

  it('renders one match row per entry with score chip', () => {
    render(<MemoryRouter><MatchSidebar positionId="pos-x" matches={matches} /></MemoryRouter>);
    expect(screen.getByTestId('pm-s2-match-row-pos-1')).toHaveTextContent('高级前端工程师');
    expect(screen.getByTestId('pm-s2-match-row-pos-1')).toHaveTextContent('92');
  });

  it('shows 查看全部匹配 CTA that links to /admin/pm/snapshot', () => {
    render(<MemoryRouter><MatchSidebar positionId="pos-x" matches={matches} /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /查看全部匹配/ });
    expect(link.getAttribute('href')).toBe('/admin/pm/snapshot');
  });

  it('shows empty state when no matches', () => {
    render(<MemoryRouter><MatchSidebar positionId="pos-x" matches={[]} /></MemoryRouter>);
    expect(screen.getByTestId('pm-s2-match-empty')).toHaveTextContent('暂无匹配');
  });
});
