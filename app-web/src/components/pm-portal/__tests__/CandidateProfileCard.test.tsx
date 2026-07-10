import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CandidateProfileCard } from '../CandidateProfileCard';

const profile = {
  displayName: '张*三',
  title: '高级前端工程师',
  company: '某互联网公司',
  source: '内推',
  resume: '8年前端经验,Vue/React 专家',
  tags: ['Vue', 'TypeScript'],
};

describe('CandidateProfileCard', () => {
  it('renders name, title, company, source, resume, tags', () => {
    render(<CandidateProfileCard profile={profile} />);
    const card = screen.getByTestId('pm-candidate-profile');
    expect(card).toHaveTextContent('张*三');
    expect(card).toHaveTextContent('高级前端工程师');
    expect(card).toHaveTextContent('某互联网公司');
    expect(card).toHaveTextContent('内推');
    expect(card).toHaveTextContent('8年前端经验,Vue/React 专家');
  });

  it('renders the tag list with one <li> per tag', () => {
    render(<CandidateProfileCard profile={profile} />);
    const card = screen.getByTestId('pm-candidate-profile');
    const items = card.querySelectorAll('.pm-candidate-tags li');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Vue');
    expect(items[1]).toHaveTextContent('TypeScript');
  });

  it('renders the 解锁联系方式 button (disabled placeholder)', () => {
    render(<CandidateProfileCard profile={profile} />);
    expect(screen.getByRole('button', { name: /解锁联系方式/ })).toBeDisabled();
  });
});
