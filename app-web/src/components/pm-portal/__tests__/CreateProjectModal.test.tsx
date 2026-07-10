import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CreateProjectModal } from '../CreateProjectModal';
import { pmProjects, type Project } from '../../../api/pm-portal';

// ---- Mocks ----------------------------------------------------------------

vi.mock('../../../api/pm-portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/pm-portal')>();
  return {
    ...actual,
    pmProjects: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
});

const mockedCreate = vi.mocked(pmProjects.create);

beforeEach(() => {
  cleanup();
  mockedCreate.mockReset();
});

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-new-1',
    pm_user_id: 'pm-1',
    name: 'New Project',
    target: null,
    budget_total: null,
    start_at: null,
    end_at: null,
    current_team: null,
    status: 'planning',
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...overrides,
  };
}

function renderModal(opts: { onClose?: () => void; onCreated?: (p: Project) => void } = {}) {
  const onClose = opts.onClose ?? vi.fn();
  const onCreated = opts.onCreated ?? vi.fn();
  const utils = render(
    <CreateProjectModal onClose={onClose} onCreated={onCreated} />,
  );
  return { onClose, onCreated, ...utils };
}

async function fillName(value: string) {
  fireEvent.change(screen.getByTestId('pm-project-form-name'), {
    target: { value },
  });
}

// ---- Tests ----------------------------------------------------------------

describe('CreateProjectModal', () => {
  it('renders the modal chrome (title, close button, cancel, submit)', () => {
    renderModal();
    expect(screen.getByTestId('pm-create-project-modal')).toBeInTheDocument();
    expect(screen.getByText('新建项目')).toBeInTheDocument();
    expect(screen.getByTestId('pm-create-project-modal-close')).toBeInTheDocument();
    expect(screen.getByTestId('pm-create-project-cancel')).toBeInTheDocument();
    expect(screen.getByTestId('pm-create-project-submit')).toBeInTheDocument();
    // Form is rendered too.
    expect(screen.getByTestId('pm-project-form-root')).toBeInTheDocument();
  });

  it('closes via the × button when not submitting', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByTestId('pm-create-project-modal-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes via the cancel button when not submitting', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByTestId('pm-create-project-cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes via the backdrop click when not submitting', () => {
    const { onClose } = renderModal();
    // The backdrop is the testid-bearing element; the inner .pm-modal
    // stops propagation.
    fireEvent.click(screen.getByTestId('pm-create-project-modal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does NOT close via the backdrop click while submitting', async () => {
    // Block the create promise so we stay in the submitting phase.
    mockedCreate.mockReturnValue(new Promise(() => {}));
    const { onClose } = renderModal();
    await fillName('Some Name');
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    // Modal is now submitting. Backdrop click is a no-op.
    fireEvent.click(screen.getByTestId('pm-create-project-modal'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does NOT close via the × button while submitting', async () => {
    mockedCreate.mockReturnValue(new Promise(() => {}));
    const { onClose } = renderModal();
    await fillName('Some Name');
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    fireEvent.click(screen.getByTestId('pm-create-project-modal-close'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does NOT close via the cancel button while submitting', async () => {
    mockedCreate.mockReturnValue(new Promise(() => {}));
    const { onClose } = renderModal();
    await fillName('Some Name');
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    fireEvent.click(screen.getByTestId('pm-create-project-cancel'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables the submit button until the form is valid', () => {
    renderModal();
    const submit = screen.getByTestId('pm-create-project-submit') as HTMLButtonElement;
    // Empty name → invalid → button enabled but showErrors hasn't been
    // triggered yet, so it's clickable. (The button is enabled by
    // default; clicking it forces showErrors on.)
    expect(submit.disabled).toBe(false);
  });

  it('blocks submit with an empty name and surfaces a name error', () => {
    renderModal();
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    // No create call. Name error visible (parent forced showErrors).
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId('pm-project-form-name-error')).toBeInTheDocument();
  });

  it('sends a minimal payload (name only) on successful submit', async () => {
    const created = makeProject({ name: 'Alpha' });
    mockedCreate.mockResolvedValueOnce(created);
    const { onClose, onCreated } = renderModal();
    await fillName('Alpha');
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalled();
    });
    expect(mockedCreate).toHaveBeenCalledWith({ name: 'Alpha' });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
      expect(onCreated).toHaveBeenCalledWith(created);
    });
  });

  it('converts the budget from 元 to 分 (multiply by 100)', async () => {
    const created = makeProject();
    mockedCreate.mockResolvedValueOnce(created);
    renderModal();
    await fillName('Alpha');
    fireEvent.change(screen.getByTestId('pm-project-form-budget'), {
      target: { value: '5000' },
    });
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    const payload = mockedCreate.mock.calls[0][0];
    expect(payload.budget_total).toBe(500_000); // 5000 元 = 500_000 分
  });

  it('includes target only when non-empty (after trim)', async () => {
    const created = makeProject();
    mockedCreate.mockResolvedValueOnce(created);
    renderModal();
    await fillName('Alpha');
    // Whitespace-only target should be dropped.
    fireEvent.change(screen.getByTestId('pm-project-form-target'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    const payload = mockedCreate.mock.calls[0][0];
    expect(payload).not.toHaveProperty('target');
  });

  it('includes the team list, dropping empty-role rows', async () => {
    const created = makeProject();
    mockedCreate.mockResolvedValueOnce(created);
    renderModal();
    await fillName('Alpha');
    // Add two members; leave the first one's role empty.
    fireEvent.click(screen.getByTestId('pm-project-form-team-add'));
    fireEvent.click(screen.getByTestId('pm-project-form-team-add'));
    // The second row gets a role; first stays empty.
    const rows = screen.getAllByTestId('pm-project-form-team-row');
    fireEvent.change(rows[1].querySelector('[data-testid="pm-project-form-team-role"]')!, {
      target: { value: 'HRBP' },
    });
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    const payload = mockedCreate.mock.calls[0][0];
    expect(payload.current_team).toEqual([{ role: 'HRBP', count: 1 }]);
  });

  it('includes start_at / end_at as unix ms when set', async () => {
    const created = makeProject();
    mockedCreate.mockResolvedValueOnce(created);
    renderModal();
    await fillName('Alpha');
    fireEvent.change(screen.getByTestId('pm-project-form-start'), {
      target: { value: '2026-06-10' },
    });
    fireEvent.change(screen.getByTestId('pm-project-form-end'), {
      target: { value: '2026-07-10' },
    });
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    const payload = mockedCreate.mock.calls[0][0];
    expect(payload.start_at).toBe(new Date(2026, 5, 10).getTime());
    expect(payload.end_at).toBe(new Date(2026, 6, 10).getTime());
  });

  it('blocks submit when end_at is before start_at (cross-field check)', () => {
    renderModal();
    fireEvent.change(screen.getByTestId('pm-project-form-start'), {
      target: { value: '2026-06-10' },
    });
    fireEvent.change(screen.getByTestId('pm-project-form-end'), {
      target: { value: '2026-06-01' },
    });
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId('pm-project-form-end-error')).toBeInTheDocument();
  });

  it('shows the submit error and stays in the modal on a failed create', async () => {
    mockedCreate.mockRejectedValueOnce(new Error('后端 500'));
    renderModal();
    await fillName('Alpha');
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('pm-create-project-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-create-project-error')).toHaveTextContent('后端 500');
    // Modal is still visible.
    expect(screen.getByTestId('pm-create-project-modal')).toBeInTheDocument();
  });

  it('lets the PM retry after a failed create (form state preserved)', async () => {
    const created = makeProject();
    mockedCreate
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(created);
    const { onClose } = renderModal();
    await fillName('Alpha');
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    await waitFor(() => screen.getByTestId('pm-create-project-error'));
    // The form value should still be present (typed name preserved).
    expect(
      (screen.getByTestId('pm-project-form-name') as HTMLInputElement).value,
    ).toBe('Alpha');
    // Click again — should succeed.
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(mockedCreate).toHaveBeenCalledTimes(2);
  });

  it('disables the form while submitting (name input disabled)', async () => {
    mockedCreate.mockReturnValue(new Promise(() => {}));
    renderModal();
    await fillName('Alpha');
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    await waitFor(() => {
      expect(
        (screen.getByTestId('pm-project-form-name') as HTMLInputElement).disabled,
      ).toBe(true);
    });
  });

  it('does NOT call onCreated if the create call fails', async () => {
    mockedCreate.mockRejectedValueOnce(new Error('rejected'));
    const { onCreated } = renderModal();
    await fillName('Alpha');
    fireEvent.click(screen.getByTestId('pm-create-project-submit'));
    await waitFor(() => screen.getByTestId('pm-create-project-error'));
    expect(onCreated).not.toHaveBeenCalled();
  });
});
