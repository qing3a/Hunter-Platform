import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PublishStatus } from '../PublishStatus';

describe('PublishStatus', () => {
  it('renders unpublished state', () => {
    render(<PublishStatus status="unpublished" onPublish={() => {}} onRepublish={() => {}} />);
    expect(screen.getByTestId('pm-publish-chip-unpublished')).toBeInTheDocument();
  });

  it('renders published state with timestamp', () => {
    render(<PublishStatus status="published" publishedAt={1700000000000} onPublish={() => {}} onRepublish={() => {}} />);
    expect(screen.getByTestId('pm-publish-chip-published')).toHaveTextContent('已发布');
  });

  it('renders failed state with retry hint', () => {
    render(<PublishStatus status="failed" failureReason="ERP 5xx" onPublish={() => {}} onRepublish={() => {}} />);
    expect(screen.getByTestId('pm-publish-chip-failed')).toHaveTextContent('发布失败');
    expect(screen.getByTestId('pm-publish-chip-failed')).toHaveTextContent('ERP 5xx');
  });

  it('unpublished button click invokes onPublish', () => {
    const onPublish = vi.fn();
    const onRepublish = vi.fn();
    render(<PublishStatus status="unpublished" onPublish={onPublish} onRepublish={onRepublish} />);
    fireEvent.click(screen.getByRole('button', { name: '📤 发布' }));
    expect(onPublish).toHaveBeenCalledOnce();
    expect(onRepublish).not.toHaveBeenCalled();
  });

  it('failed button click invokes onRepublish', () => {
    const onPublish = vi.fn();
    const onRepublish = vi.fn();
    render(<PublishStatus status="failed" failureReason="ERP 5xx" onPublish={onPublish} onRepublish={onRepublish} />);
    fireEvent.click(screen.getByRole('button', { name: '🔄 重发' }));
    expect(onRepublish).toHaveBeenCalledOnce();
    expect(onPublish).not.toHaveBeenCalled();
  });
});