import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PMLoginPage } from '../PMLoginPage';
import { pmAuth } from '../../../api/pm-portal';
import { clearSession, getSession } from '../../../lib/candidate-session';

// ---- Mocks ----------------------------------------------------------------

// Record every argument passed to `navigate(...)` so we can assert on the
// post-login redirect target without spinning up a real router history.
let lastNavigateTo: string | undefined;
const navigateSpy = vi.fn((to: string) => {
  lastNavigateTo = to;
});

// Mock the PM API client so we don't talk to a real backend in unit tests.
// We mock the whole module (instead of one method) because pmAuth owns both
// requestOtp and verifyOtp; spy-by-method would require us to dance around
// TypeScript typing for the discriminated `user_type` parameter.
vi.mock('../../../api/pm-portal', () => ({
  pmAuth: {
    requestOtp: vi.fn(),
    verifyOtp: vi.fn(),
  },
}));

// Mock react-router-dom: keep MemoryRouter + everything else real, but swap
// useNavigate for a spy so we can observe the post-login redirect.
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

const mockedAuth = vi.mocked(pmAuth);

// ---- Helpers --------------------------------------------------------------

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/pm/login']}>
      <PMLoginPage />
    </MemoryRouter>,
  );
}

function fillOtpInput(code: string) {
  // The OtpInput renders one textbox per digit; type each digit to drive
  // the controlled input the same way a paste / sequential entry would.
  const inputs = screen.getAllByRole('textbox');
  for (let i = 0; i < inputs.length; i++) {
    fireEvent.change(inputs[i], { target: { value: code[i] ?? '' } });
  }
}

// ---- Tests ----------------------------------------------------------------

describe('PMLoginPage', () => {
  beforeEach(() => {
    cleanup();
    clearSession();
    lastNavigateTo = undefined;
    navigateSpy.mockClear();
    vi.clearAllMocks();
  });

  it('renders the email step initially (no OTP UI visible)', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('PM 登录');
    expect(screen.getByTestId('pm-email-input')).toBeInTheDocument();
    expect(screen.getByTestId('pm-request-otp')).toBeInTheDocument();
    // OTP step contents (and error slot) must not be visible yet.
    expect(screen.queryByTestId('pm-verify-otp')).toBeNull();
    expect(screen.queryByTestId('pm-dev-code')).toBeNull();
    expect(screen.queryByTestId('pm-error')).toBeNull();
  });

  it('typing an email + submitting advances to the OTP step and calls pmAuth.requestOtp', async () => {
    mockedAuth.requestOtp.mockResolvedValueOnce({ expires_in: 300 });

    renderPage();
    fireEvent.change(screen.getByTestId('pm-email-input'), {
      target: { value: 'pm@example.com' },
    });
    fireEvent.click(screen.getByTestId('pm-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('pm-verify-otp')).toBeInTheDocument();
    });

    expect(mockedAuth.requestOtp).toHaveBeenCalledTimes(1);
    expect(mockedAuth.requestOtp).toHaveBeenCalledWith('pm@example.com');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('输入验证码');
  });

  it('shows the dev_code from pmAuth.requestOtp in test mode', async () => {
    mockedAuth.requestOtp.mockResolvedValueOnce({
      expires_in: 300,
      dev_code: '654321',
    });

    renderPage();
    fireEvent.change(screen.getByTestId('pm-email-input'), {
      target: { value: 'pm@example.com' },
    });
    fireEvent.click(screen.getByTestId('pm-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('pm-dev-code')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-dev-code')).toHaveTextContent('654321');
  });

  it('submitting the OTP calls pmAuth.verifyOtp(email, code)', async () => {
    mockedAuth.requestOtp.mockResolvedValueOnce({ expires_in: 300, dev_code: '654321' });
    mockedAuth.verifyOtp.mockResolvedValueOnce({
      api_key: 'hp_live_pm_test_key',
      user_id: 'pm_abc',
      profile_complete: false,
      user_type: 'pm',
    });

    renderPage();
    fireEvent.change(screen.getByTestId('pm-email-input'), {
      target: { value: 'pm@example.com' },
    });
    fireEvent.click(screen.getByTestId('pm-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('pm-verify-otp')).toBeInTheDocument();
    });

    fillOtpInput('654321');
    fireEvent.click(screen.getByTestId('pm-verify-otp'));

    await waitFor(() => {
      expect(mockedAuth.verifyOtp).toHaveBeenCalledTimes(1);
    });
    expect(mockedAuth.verifyOtp).toHaveBeenCalledWith('pm@example.com', '654321');
  });

  it('writes role=pm to the session and navigates to /pm/projects on success', async () => {
    mockedAuth.requestOtp.mockResolvedValueOnce({ expires_in: 300 });
    mockedAuth.verifyOtp.mockResolvedValueOnce({
      api_key: 'hp_live_pm_test_key',
      user_id: 'pm_abc',
      profile_complete: false,
      user_type: 'pm',
    });

    renderPage();
    fireEvent.change(screen.getByTestId('pm-email-input'), {
      target: { value: 'pm@example.com' },
    });
    fireEvent.click(screen.getByTestId('pm-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('pm-verify-otp')).toBeInTheDocument();
    });

    fillOtpInput('654321');
    fireEvent.click(screen.getByTestId('pm-verify-otp'));

    await waitFor(() => {
      expect(lastNavigateTo).toBe('/pm/projects');
    });
    // Sanity check: the spy saw the same target.
    expect(navigateSpy).toHaveBeenCalledWith('/pm/projects');

    // Session must carry role: 'pm' so RequirePMAuth accepts it.
    const session = getSession();
    expect(session).not.toBeNull();
    expect(session?.role).toBe('pm');
    expect(session?.api_key).toBe('hp_live_pm_test_key');
    expect(session?.user_id).toBe('pm_abc');
    expect(session?.profile_complete).toBe(false);
    expect(session?.email).toBe('pm@example.com');
    // Sanity guard against silently setting the wrong role (regression guard).
    expect(session?.role).not.toBe('headhunter');
    expect(session?.role).not.toBe('candidate');
  });

  it('renders an error message when pmAuth.requestOtp throws', async () => {
    mockedAuth.requestOtp.mockRejectedValueOnce(new Error('限流:请稍后再试'));
    renderPage();

    fireEvent.change(screen.getByTestId('pm-email-input'), {
      target: { value: 'pm@example.com' },
    });
    fireEvent.click(screen.getByTestId('pm-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('pm-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-error')).toHaveTextContent('限流:请稍后再试');

    // Should stay on the email step — don't advance to OTP on request failure.
    expect(screen.queryByTestId('pm-verify-otp')).toBeNull();
    expect(lastNavigateTo).toBeUndefined();
  });

  it('renders an error message when pmAuth.verifyOtp throws', async () => {
    mockedAuth.requestOtp.mockResolvedValueOnce({ expires_in: 300 });
    mockedAuth.verifyOtp.mockRejectedValueOnce(new Error('验证码错误'));

    renderPage();
    fireEvent.change(screen.getByTestId('pm-email-input'), {
      target: { value: 'pm@example.com' },
    });
    fireEvent.click(screen.getByTestId('pm-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('pm-verify-otp')).toBeInTheDocument();
    });

    fillOtpInput('000000');
    fireEvent.click(screen.getByTestId('pm-verify-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('pm-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-error')).toHaveTextContent('验证码错误');

    // Session must not have been written — we never get a successful verify.
    expect(getSession()).toBeNull();
    expect(lastNavigateTo).toBeUndefined();
  });
});
