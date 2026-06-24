import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CsvButton from '../../src/components/CsvButton';

// jsdom doesn't implement URL.createObjectURL or HTMLAnchorElement.click by default
beforeEach(() => {
  global.URL.createObjectURL = vi.fn(() => 'blob:mock');
  global.URL.revokeObjectURL = vi.fn();
});

describe('CsvButton (Sub-C)', () => {
  it('1. renders button with label', () => {
    render(<CsvButton filename="jobs" rows={[]} columns={[]} />);
    expect(screen.getByText(/导出 CSV/)).toBeTruthy();
  });

  it('2. disabled when rows is empty', () => {
    render(<CsvButton filename="x" rows={[]} columns={[]} />);
    expect(screen.getByText(/导出 CSV/)).toBeDisabled();
  });

  it('3. click triggers Blob download with correct content', () => {
    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') el.click = clickSpy;
      return el;
    });

    // Replace global Blob with a constructor that records its first arg (CSV string + BOM)
    let capturedCsv = '';
    const OriginalBlob = global.Blob;
    class FakeBlob {
      parts: unknown[];
      constructor(parts: unknown[], _opts?: unknown) {
        this.parts = parts;
        capturedCsv = parts.map(p => String(p)).join('');
      }
    }
    (global as any).Blob = FakeBlob;

    const rows = [
      { id: 'job_1', title: 'Engineer, Senior' },  // comma triggers quoting
      { id: 'job_2', title: 'PM "Lead"' },          // quote triggers escape
    ];
    const columns = [{ key: 'id', header: 'ID' }, { key: 'title', header: 'Title' }];
    render(<CsvButton filename="jobs" rows={rows} columns={columns} />);

    fireEvent.click(screen.getByText(/导出 CSV/));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    // Header: no special chars → unquoted
    expect(capturedCsv).toContain('ID,Title');
    // Data rows with special chars in title are quoted
    expect(capturedCsv).toContain('job_1,"Engineer, Senior"');
    expect(capturedCsv).toContain('job_2,"PM ""Lead"""');

    (global as any).Blob = OriginalBlob;
    createElementSpy.mockRestore();
  });
});