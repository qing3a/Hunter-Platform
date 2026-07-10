import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ErpCallLog, type CallLogEntry } from '../ErpCallLog';

describe('ErpCallLog', () => {
  it('renders one formatted line per entry inside a <pre>', () => {
    const entries: CallLogEntry[] = [
      { ts: Date.UTC(2026, 6, 9, 8, 0, 0), method: 'GET', path: '/api/positions', status: 200, ms: 32 },
      { ts: Date.UTC(2026, 6, 9, 8, 0, 1), method: 'POST', path: '/api/publish', status: 201, ms: 110 },
    ];
    render(<ErpCallLog entries={entries} />);
    const pre = screen.getByTestId('pm-erp-log');
    const lines = pre.textContent!.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/GET \/api\/positions → 200 \(32ms\)/);
    expect(lines[1]).toMatch(/POST \/api\/publish → 201 \(110ms\)/);
  });
});