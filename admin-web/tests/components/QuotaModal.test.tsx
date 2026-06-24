import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuotaModal from '../../src/components/QuotaModal';

const user = { id: 'u_1', name: '张三', current_quota: 100 };

describe('QuotaModal (Sub-C Plan 2)', () => {
  it('1. renders current quota and prefills input', () => {
    render(
      <QuotaModal open={true} user={user} onClose={() => {}} onSubmit={async () => {}} />
    );
    expect(screen.getByText(/当前配额/)).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    // Number input is the first input on the page
    const input = document.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input.value).toBe('100');
  });

  it('2. submit calls onSubmit with parsed values + closes modal on success', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<QuotaModal open={true} user={user} onClose={onClose} onSubmit={onSubmit} />);

    const numberInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    const reasonTextarea = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(numberInput, { target: { value: '50' } });
    fireEvent.change(reasonTextarea, { target: { value: '客户紧急加单' } });
    fireEvent.click(screen.getByText('确认调整'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ new_quota: 50, reason: '客户紧急加单' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('3. reason < 3 chars blocks submit', async () => {
    const onSubmit = vi.fn();
    render(<QuotaModal open={true} user={user} onClose={() => {}} onSubmit={onSubmit} />);

    const numberInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    const reasonTextarea = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(numberInput, { target: { value: '50' } });
    fireEvent.change(reasonTextarea, { target: { value: 'ab' } });
    fireEvent.click(screen.getByText('确认调整'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/原因至少 3 个字符/)).toBeTruthy();
  });

  it('4. new_quota out of range blocks submit', async () => {
    const onSubmit = vi.fn();
    render(<QuotaModal open={true} user={user} onClose={() => {}} onSubmit={onSubmit} />);

    const numberInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    const reasonTextarea = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(numberInput, { target: { value: '999999' } });
    fireEvent.change(reasonTextarea, { target: { value: 'test reason' } });
    fireEvent.click(screen.getByText('确认调整'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/必须是 0-100000/)).toBeTruthy();
  });

  it('5. onSubmit error displays message and keeps modal open', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('用户不存在'));
    const onClose = vi.fn();
    render(<QuotaModal open={true} user={user} onClose={onClose} onSubmit={onSubmit} />);

    const numberInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    const reasonTextarea = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(numberInput, { target: { value: '50' } });
    fireEvent.change(reasonTextarea, { target: { value: 'test' } });
    fireEvent.click(screen.getByText('确认调整'));

    await waitFor(() => expect(screen.getByText('用户不存在')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });
});