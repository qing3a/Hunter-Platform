import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ErpStatusTable } from '../ErpStatusTable';
import type { ErpConfig } from '../ErpConnectionForm';

describe('ErpStatusTable', () => {
  it('renders 3 rows: 当前后端 / URL / 已发布数', () => {
    const config: ErpConfig = {
      backend: 'ow-headhunter-erp',
      url: 'https://erp.example.com',
      token: 'tok',
    };
    render(<ErpStatusTable config={config} published={42} />);
    const rows = screen.getByTestId('pm-erp-status-table').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('当前后端');
    expect(rows[0]).toHaveTextContent('ow-headhunter-erp');
    expect(rows[1]).toHaveTextContent('URL');
    expect(rows[1]).toHaveTextContent('https://erp.example.com');
    expect(rows[2]).toHaveTextContent('已发布数');
    expect(rows[2]).toHaveTextContent('42');
  });

  it('renders an em dash when URL is empty', () => {
    const config: ErpConfig = { backend: 'MOCK', url: '', token: '' };
    render(<ErpStatusTable config={config} published={0} />);
    const rows = screen.getByTestId('pm-erp-status-table').querySelectorAll('tbody tr');
    expect(rows[1]).toHaveTextContent('URL');
    expect(rows[1]).toHaveTextContent('—');
  });
});