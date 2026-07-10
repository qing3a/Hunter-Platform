import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ActivityFeed } from '../ActivityFeed';
import type { ActivityEvent, ActivityEventType } from '../../../api/pm-portal';

// ---- Helpers --------------------------------------------------------------

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    event_type: 'application',
    occurred_at: Date.now() - 5 * 60 * 1000, // 5min ago
    project_id: 'proj_1',
    position_id: 'pos_1',
    candidate_user_id: 'user_1',
    summary: '张*三 申请了 高级前端工程师',
    ...overrides,
  };
}

// ---- Tests ----------------------------------------------------------------

describe('ActivityFeed', () => {
  afterEach(() => cleanup());

  // -------- Empty state ----------

  it('shows an empty-state message when there are no events', () => {
    render(<ActivityFeed events={[]} />);
    expect(screen.getByTestId('pm-snapshot-feed-empty')).toBeInTheDocument();
    expect(screen.getByTestId('pm-snapshot-feed-empty')).toHaveTextContent('暂无最近活动');
  });

  it('does NOT render the feed list when there are no events', () => {
    render(<ActivityFeed events={[]} />);
    expect(screen.queryByTestId('pm-snapshot-feed')).not.toBeInTheDocument();
  });

  // -------- Rendering ----------

  it('renders one row per event', () => {
    const events = [
      makeEvent({ event_type: 'application', summary: '张*三 申请了 高级前端' }),
      makeEvent({ event_type: 'pickup', summary: '猎头认领了 李*四 · 高级后端' }),
      makeEvent({ event_type: 'match_created', summary: '系统为 王*五 生成了匹配 · 高级测试' }),
    ];
    render(<ActivityFeed events={events} />);
    const items = screen.getAllByTestId('pm-snapshot-feed-item');
    expect(items).toHaveLength(3);
  });

  it('renders the pre-formatted Chinese summary verbatim', () => {
    const events = [makeEvent({ summary: '张*三 申请了 高级前端工程师' })];
    render(<ActivityFeed events={events} />);
    expect(screen.getByTestId('pm-snapshot-feed-summary')).toHaveTextContent(
      '张*三 申请了 高级前端工程师',
    );
  });

  it('renders the chip with the correct label per event type', () => {
    const events: Array<{ type: ActivityEventType; label: string }> = [
      { type: 'application', label: '申请' },
      { type: 'pickup', label: '认领' },
      { type: 'match_created', label: '匹配' },
    ];
    render(
      <ActivityFeed
        events={events.map((e) => makeEvent({ event_type: e.type }))}
      />,
    );
    const chips = screen.getAllByTestId('pm-snapshot-feed-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['申请', '认领', '匹配']);
  });

  it('attaches data-event-type + data-position-id + data-project-id on each row', () => {
    const event = makeEvent({
      event_type: 'match_created',
      project_id: 'proj_99',
      position_id: 'pos_42',
    });
    render(<ActivityFeed events={[event]} />);
    const row = screen.getByTestId('pm-snapshot-feed-item');
    expect(row).toHaveAttribute('data-event-type', 'match_created');
    expect(row).toHaveAttribute('data-position-id', 'pos_42');
    expect(row).toHaveAttribute('data-project-id', 'proj_99');
  });

  it('renders data-position-id="" when position_id is null', () => {
    const event = makeEvent({ position_id: null, project_id: null });
    render(<ActivityFeed events={[event]} />);
    const row = screen.getByTestId('pm-snapshot-feed-item');
    expect(row).toHaveAttribute('data-position-id', '');
    expect(row).toHaveAttribute('data-project-id', '');
  });

  // -------- Relative time ----------

  it('formats relative time as "刚刚" for events < 1 minute ago', () => {
    const now = 1_700_000_000_000;
    const event = makeEvent({ occurred_at: now - 30 * 1000 });
    render(<ActivityFeed events={[event]} now={now} />);
    expect(screen.getByTestId('pm-snapshot-feed-time')).toHaveTextContent('刚刚');
  });

  it('formats relative time as "N 分钟前" for events < 1 hour ago', () => {
    const now = 1_700_000_000_000;
    const event = makeEvent({ occurred_at: now - 15 * 60 * 1000 });
    render(<ActivityFeed events={[event]} now={now} />);
    expect(screen.getByTestId('pm-snapshot-feed-time')).toHaveTextContent('15 分钟前');
  });

  it('formats relative time as "N 小时前" for events < 24h ago', () => {
    const now = 1_700_000_000_000;
    const event = makeEvent({ occurred_at: now - 3 * 60 * 60 * 1000 });
    render(<ActivityFeed events={[event]} now={now} />);
    expect(screen.getByTestId('pm-snapshot-feed-time')).toHaveTextContent('3 小时前');
  });

  it('formats relative time as "昨天" for events >= 24h ago', () => {
    const now = 1_700_000_000_000;
    const event = makeEvent({ occurred_at: now - 25 * 60 * 60 * 1000 });
    render(<ActivityFeed events={[event]} now={now} />);
    expect(screen.getByTestId('pm-snapshot-feed-time')).toHaveTextContent('昨天');
  });
});