import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from '@hunter-platform/shared-web/lib';
import Toast from '../../src/components/Toast';

function TriggerButton() {
  const { push } = useToast();
  return <button onClick={() => push({ type: 'success', message: 'Saved!' })}>save</button>;
}

function Wrapper() {
  return (
    <ToastProvider>
      <TriggerButton />
      <Toast />
    </ToastProvider>
  );
}

describe('Toast (Sub-C Plan 2)', () => {
  it('1. clicking trigger pushes a toast and renders it', () => {
    render(<Wrapper />);
    fireEvent.click(screen.getByText('save'));
    expect(screen.getByText('Saved!')).toBeTruthy();
  });

  it('2. clicking × dismisses the toast', () => {
    render(<Wrapper />);
    fireEvent.click(screen.getByText('save'));
    expect(screen.getByText('Saved!')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('关闭通知'));
    expect(screen.queryByText('Saved!')).toBeNull();
  });

  it('3. auto-dismisses after 3s (using fake timers)', async () => {
    vi.useFakeTimers();
    render(<Wrapper />);
    fireEvent.click(screen.getByText('save'));
    expect(screen.getByText('Saved!')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3100); });
    expect(screen.queryByText('Saved!')).toBeNull();
    vi.useRealTimers();
  });
});