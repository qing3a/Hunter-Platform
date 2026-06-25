import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimelineList from '../../src/components/TimelineList';
import type { TimelineItem } from '../../src/api/timeline';

const items: TimelineItem[] = [
  {
    id: 1, source: 'admin', action: 'adjust_user_quota', actor: 'adm_1',
    details: '{"previous_quota":10,"new_quota":20}', created_at: '2026-06-25T10:00:00Z',
  },
  {
    id: 2, source: 'user', action: 'candidate.upload_resume', actor: 'u_1',
    details: null, created_at: '2026-06-25T11:00:00Z',
  },
];

describe('TimelineList (Sub-D2)', () => {
  it('1. renders items with source badges', () => {
    render(<TimelineList items={items} loading={false} empty="no events" />);
    expect(screen.getByTestId('timeline-item-1')).toBeTruthy();
    expect(screen.getByTestId('timeline-item-2')).toBeTruthy();
    expect(screen.getByTestId('timeline-source-admin')).toBeTruthy();
    expect(screen.getByTestId('timeline-source-user')).toBeTruthy();
  });

  it('2. clicking 详情 opens drawer (when details present)', () => {
    render(<TimelineList items={items} loading={false} empty="no events" />);
    fireEvent.click(screen.getByTestId('timeline-detail-1'));
    // AuditJsonDrawer renders a backdrop + panel; check for the drawer title
    expect(screen.getByText(/adjust_user_quota @/)).toBeTruthy();
  });

  it('3. no 详情 button when details is null', () => {
    render(<TimelineList items={items} loading={false} empty="no events" />);
    expect(screen.queryByTestId('timeline-detail-2')).toBeNull();
  });

  it('4. shows empty state when items is empty', () => {
    render(<TimelineList items={[]} loading={false} empty="暂无事件" />);
    expect(screen.getByText('暂无事件')).toBeTruthy();
  });
});