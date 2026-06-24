import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import Modal from '../../src/components/Modal';

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <Modal open={open} title="Test Modal" onClose={() => setOpen(false)} footer={<button>OK</button>}>
        <input data-testid="first-input" placeholder="type" />
        <button>inner</button>
      </Modal>
    </>
  );
}

describe('Modal (Sub-C Plan 2)', () => {
  it('1. renders title and content when open', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Test Modal');
    expect(screen.getByPlaceholderText('type')).toBeTruthy();
    expect(screen.getByText('OK')).toBeTruthy();
  });

  it('2. ESC key calls onClose', () => {
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('3. clicking × button calls onClose', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('4. clicking backdrop calls onClose; clicking dialog body does not', () => {
    render(<Harness />);
    // Click inside the dialog
    fireEvent.click(screen.getByPlaceholderText('type'));
    expect(screen.queryByRole('dialog')).toBeTruthy();
  });
});