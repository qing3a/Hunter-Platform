import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OtpInput } from '../OtpInput';

describe('OtpInput', () => {
  it('renders 6 input boxes by default', () => {
    render(<OtpInput />);
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
  });

  it('renders custom length', () => {
    render(<OtpInput length={4} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
  });

  it('calls onChange when a digit is entered', () => {
    const onChange = vi.fn();
    render(<OtpInput onChange={onChange} />);
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '1' } });
    expect(onChange).toHaveBeenCalledWith('1');
  });

  it('rejects non-numeric input', () => {
    render(<OtpInput />);
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.change(input, { target: { value: 'a' } });
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('auto-advances to next input on digit entry', () => {
    render(<OtpInput />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: '1' } });
    expect(document.activeElement).toBe(inputs[1]);
  });
});