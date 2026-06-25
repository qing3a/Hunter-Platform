import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimelineFilterBar from '../../src/components/TimelineFilterBar';

describe('TimelineFilterBar (Sub-D2)', () => {
  it('1. renders 4 filter controls', () => {
    render(
      <TimelineFilterBar
        source="all" onSourceChange={() => {}}
        from="" onFromChange={() => {}}
        until="" onUntilChange={() => {}}
        actor="" onActorChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByTestId('timeline-source-filter')).toBeTruthy();
    expect(screen.getByTestId('timeline-from')).toBeTruthy();
    expect(screen.getByTestId('timeline-until')).toBeTruthy();
    expect(screen.getByTestId('timeline-actor')).toBeTruthy();
    expect(screen.getByTestId('timeline-clear')).toBeTruthy();
  });

  it('2. changing source calls onSourceChange', () => {
    const onSourceChange = vi.fn();
    render(
      <TimelineFilterBar
        source="all" onSourceChange={onSourceChange}
        from="" onFromChange={() => {}}
        until="" onUntilChange={() => {}}
        actor="" onActorChange={() => {}}
        onClear={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId('timeline-source-filter'), { target: { value: 'admin' } });
    expect(onSourceChange).toHaveBeenCalledWith('admin');
  });

  it('3. clicking 清除 calls onClear', () => {
    const onClear = vi.fn();
    render(
      <TimelineFilterBar
        source="admin" onSourceChange={() => {}}
        from="2026-06-25T00:00:00Z" onFromChange={() => {}}
        until="2026-06-25T23:59:59Z" onUntilChange={() => {}}
        actor="adm_1" onActorChange={() => {}}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByTestId('timeline-clear'));
    expect(onClear).toHaveBeenCalled();
  });
});