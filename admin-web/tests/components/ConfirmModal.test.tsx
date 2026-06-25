import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConfirmModal from '../../src/components/ConfirmModal';

describe('ConfirmModal (Sub-D3)', () => {
  it('1. renders title + message + 2 buttons', () => {
    render(<ConfirmModal open={true} title="T" message="M" onConfirm={async () => {}} onClose={() => {}} />);
    expect(screen.getByText('T')).toBeTruthy();
    expect(screen.getByText('M')).toBeTruthy();
    expect(screen.getByText('确认')).toBeTruthy();
    expect(screen.getByText('取消')).toBeTruthy();
  });

  it('2. clicking confirm calls onConfirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ConfirmModal open={true} title="T" message="M" onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('3. clicking cancel calls onClose (without onConfirm)', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmModal open={true} title="T" message="M" onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByText('取消'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('4. onConfirm rejection shows error inline + modal stays open', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('服务端错误'));
    const onClose = vi.fn();
    render(<ConfirmModal open={true} title="T" message="M" onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    await waitFor(() => expect(screen.getByTestId('confirm-modal-error')).toBeTruthy());
    expect(screen.getByText('服务端错误')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('5. variant=danger renders btn-danger class', () => {
    render(<ConfirmModal open={true} title="T" message="M" variant="danger" onConfirm={async () => {}} onClose={() => {}} />);
    const btn = screen.getByTestId('confirm-modal-confirm');
    expect(btn.className).toContain('btn-danger');
  });

  it('6. requireReason=true shows textarea + blocks short input', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmModal
        open={true} title="T" message="M"
        requireReason={true}
        onConfirm={onConfirm}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId('confirm-modal-reason')).toBeTruthy();
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/原因至少 3 字符/)).toBeTruthy();
  });

  it('7. requireReason=true passes reason to onConfirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmModal
        open={true} title="T" message="M"
        requireReason={true}
        onConfirm={onConfirm}
        onClose={() => {}}
      />
    );
    fireEvent.change(screen.getByTestId('confirm-modal-reason'), { target: { value: '客户投诉违规行为' } });
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('客户投诉违规行为'));
  });
});