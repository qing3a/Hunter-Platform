import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MetadataEditModal } from '../MetadataEditModal';
import type { Project } from '../../../api/pm-portal';

describe('MetadataEditModal', () => {
  const project: Project = {
    id: 'p1',
    pm_user_id: 'pm-1',
    name: '海外仓 WMS',
    target: '...',
    budget_total: 8500000,
    start_at: 1751328000000,
    end_at: 1764547200000,
    current_team: [{ role: '前端', count: 3 }],
    status: 'active',
    created_at: 0,
    updated_at: 0,
  };

  it('renders the modal with 6 fields', () => {
    render(<MetadataEditModal open={true} project={project} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('pm-meta-modal')).toBeInTheDocument();
    expect(screen.getByDisplayValue('海外仓 WMS')).toBeInTheDocument();
  });

  it('fires onSave with the updated fields', () => {
    const onSave = vi.fn();
    render(<MetadataEditModal open={true} project={project} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('项目名'), { target: { value: '新名字' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: '新名字' }));
  });

  it('does not render when open is false', () => {
    render(<MetadataEditModal open={false} project={project} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId('pm-meta-modal')).not.toBeInTheDocument();
  });
});
