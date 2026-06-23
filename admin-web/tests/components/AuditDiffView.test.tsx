import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AuditDiffView from '../../src/components/AuditDiffView';

describe('AuditDiffView', () => {
  it('renders null when json is null', () => {
    const { container } = render(<AuditDiffView json={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders flat key-value JSON', () => {
    const json = JSON.stringify({ field_count: 8, industry: '互联网' });
    render(<AuditDiffView json={json} />);
    expect(screen.getByText(/field_count/)).toBeInTheDocument();
    expect(screen.getByText(/互联网/)).toBeInTheDocument();
  });

  it('masks PII fields by default (email)', () => {
    const json = JSON.stringify({ email: 'alice@example.com', name: 'Alice Wong' });
    render(<AuditDiffView json={json} />);
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
    expect(screen.getByText(/a\*\*\*@\*\*\*/)).toBeInTheDocument();
  });

  it('falls back to raw text when JSON is malformed', () => {
    const { container } = render(<AuditDiffView json="not valid json{" />);
    expect(container.textContent).toContain('not valid json');
  });
});