import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConfigEditModal from '../../src/components/ConfigEditModal';
import type { ConfigEntry } from '../../src/api/config';

const sampleEntry: ConfigEntry = {
  key: 'platform_fee_pct',
  value: 5,
  updated_at: '2026-06-25T00:00:00Z',
  updated_by_admin_user_id: 'adm_1',
};

function renderModal(props: Partial<React.ComponentProps<typeof ConfigEditModal>> = {}) {
  const onClose = vi.fn();
  const onSave = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <ConfigEditModal
      open
      entry={null}
      onClose={onClose}
      onSave={onSave}
      {...props}
    />,
  );
  return { onClose, onSave, ...utils };
}

describe('ConfigEditModal (Sub-E)', () => {
  it('1. new-mode (entry=null): key enabled, value pre-filled with {}', () => {
    renderModal({ entry: null });
    const keyInput = screen.getByTestId('config-key') as HTMLInputElement;
    const valueInput = screen.getByTestId('config-value') as HTMLTextAreaElement;
    expect(keyInput.disabled).toBe(false);
    expect(keyInput.value).toBe('');
    expect(valueInput.value).toBe('{}');
  });

  it('2. edit-mode (entry=...): key disabled with current key, value is JSON-stringified', () => {
    renderModal({ entry: sampleEntry });
    const keyInput = screen.getByTestId('config-key') as HTMLInputElement;
    const valueInput = screen.getByTestId('config-value') as HTMLTextAreaElement;
    expect(keyInput.disabled).toBe(true);
    expect(keyInput.value).toBe('platform_fee_pct');
    expect(valueInput.value).toBe('5');
  });

  it('3. complex value renders as pretty JSON in edit mode', () => {
    renderModal({ entry: { ...sampleEntry, value: { junior: 100, senior: 500 } } });
    const valueInput = screen.getByTestId('config-value') as HTMLTextAreaElement;
    expect(valueInput.value).toContain('"junior": 100');
    expect(valueInput.value).toContain('"senior": 500');
  });

  it('4. empty key shows error and does not call onSave', async () => {
    const { onSave } = renderModal();
    // value defaults to '{}' which parses to {}; reason needs to be filled
    fireEvent.change(screen.getByTestId('config-reason'), { target: { value: 'noop' } });
    fireEvent.click(screen.getByTestId('config-save'));
    expect(screen.getByTestId('config-modal-error').textContent).toContain('Key 不能为空');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('5. invalid key format (uppercase) shows format error', async () => {
    const { onSave } = renderModal();
    fireEvent.change(screen.getByTestId('config-key'), { target: { value: 'Invalid.Key' } });
    fireEvent.change(screen.getByTestId('config-reason'), { target: { value: 'oops' } });
    fireEvent.click(screen.getByTestId('config-save'));
    expect(screen.getByTestId('config-modal-error').textContent).toContain('Key 格式');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('6. reason shorter than 3 chars shows reason error', async () => {
    const { onSave } = renderModal();
    fireEvent.change(screen.getByTestId('config-key'), { target: { value: 'platform.fee' } });
    fireEvent.change(screen.getByTestId('config-reason'), { target: { value: 'no' } });
    fireEvent.click(screen.getByTestId('config-save'));
    expect(screen.getByTestId('config-modal-error').textContent).toContain('原因至少 3 字符');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('7. invalid JSON value shows parse error', async () => {
    const { onSave } = renderModal();
    fireEvent.change(screen.getByTestId('config-key'), { target: { value: 'platform.fee' } });
    fireEvent.change(screen.getByTestId('config-value'), { target: { value: 'not json{' } });
    fireEvent.change(screen.getByTestId('config-reason'), { target: { value: 'broken' } });
    fireEvent.click(screen.getByTestId('config-save'));
    expect(screen.getByTestId('config-modal-error').textContent).toContain('Value 不是合法 JSON');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('8. valid input calls onSave with parsed value, trimmed reason, and closes modal', async () => {
    const { onSave, onClose } = renderModal();
    fireEvent.change(screen.getByTestId('config-key'), { target: { value: 'platform.fee.pct' } });
    fireEvent.change(screen.getByTestId('config-value'), { target: { value: '{"tier":0.05}' } });
    fireEvent.change(screen.getByTestId('config-reason'), { target: { value: '  set tier 0.05  ' } });
    fireEvent.click(screen.getByTestId('config-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('platform.fee.pct', { tier: 0.05 }, 'set tier 0.05'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('9. onSave rejection surfaces the error and keeps modal open', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Server: rate limited'));
    render(<ConfigEditModal open entry={null} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByTestId('config-key'), { target: { value: 'platform.fee' } });
    fireEvent.change(screen.getByTestId('config-value'), { target: { value: '7' } });
    fireEvent.change(screen.getByTestId('config-reason'), { target: { value: 'retry please' } });
    fireEvent.click(screen.getByTestId('config-save'));
    await waitFor(() => expect(screen.getByTestId('config-modal-error').textContent).toContain('Server: rate limited'));
    // Modal still open (save button still rendered)
    expect(screen.getByTestId('config-save')).toBeTruthy();
  });

  it('10. closed modal renders nothing', () => {
    const { container } = render(
      <ConfigEditModal open={false} entry={null} onClose={vi.fn()} onSave={vi.fn()} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
