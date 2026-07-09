import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
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
});