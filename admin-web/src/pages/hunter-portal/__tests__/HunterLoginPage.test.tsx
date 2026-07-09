import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HunterLoginPage } from '../HunterLoginPage';
import { otp } from '../../../api/candidate-portal';
import { clearSession, getSession } from '../../../lib/candidate-session';

// ---- Mocks ----------------------------------------------------------------

// Record every argument passed to `navigate(...)` so we can assert on the
// post-login redirect target without spinning up a real router history.
let lastNavigateTo: string | undefined;
const navigateSpy = vi.fn((to: string) => {
  lastNavigateTo = to;
});

// Mock the API client so we don't talk to a real backend in unit tests.
vi.mock('../../../api/candidate-portal', () => ({
  otp: {
    request: vi.fn(),
    verify: vi.fn(),
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

const mockedOtp = vi.mocked(otp);

// ---- Helpers --------------------------------------------------------------

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/hunter/login']}>
      <HunterLoginPage />
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

describe('HunterLoginPage', () => {
  beforeEach(() => {
    cleanup();
    clearSession();
    lastNavigateTo = undefined;
    navigateSpy.mockClear();
    vi.clearAllMocks();
  });

  it('renders the email step initially (no OTP UI visible)', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('猎头登录');
    expect(screen.getByTestId('hunter-email-input')).toBeInTheDocument();
    expect(screen.getByTestId('hunter-request-otp')).toBeInTheDocument();
    // OTP step contents (and error slot) must not be visible yet.
    expect(screen.queryByTestId('hunter-verify-otp')).toBeNull();
    expect(screen.queryByTestId('hunter-dev-code')).toBeNull();
    expect(screen.queryByTestId('hunter-error')).toBeNull();
  });

  it('typing an email + submitting advances to the OTP step and calls otp.request with "headhunter"', async () => {
    mockedOtp.request.mockResolvedValueOnce({ expires_in: 300 });

    renderPage();
    fireEvent.change(screen.getByTestId('hunter-email-input'), {
      target: { value: 'hunter@example.com' },
    });
    fireEvent.click(screen.getByTestId('hunter-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('hunter-verify-otp')).toBeInTheDocument();
    });

    expect(mockedOtp.request).toHaveBeenCalledTimes(1);
    expect(mockedOtp.request).toHaveBeenCalledWith('hunter@example.com', 'headhunter');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('输入验证码');
  });

  it('shows the dev_code from otp.request in test mode', async () => {
    mockedOtp.request.mockResolvedValueOnce({
      expires_in: 300,
      dev_code: '123456',
    });

    renderPage();
    fireEvent.change(screen.getByTestId('hunter-email-input'), {
      target: { value: 'hunter@example.com' },
    });
    fireEvent.click(screen.getByTestId('hunter-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('hunter-dev-code')).toBeInTheDocument();
    });
    expect(screen.getByTestId('hunter-dev-code')).toHaveTextContent('123456');
  });

  it('submitting the OTP calls otp.verify(email, code, "headhunter")', async () => {
    mockedOtp.request.mockResolvedValueOnce({ expires_in: 300, dev_code: '123456' });
    mockedOtp.verify.mockResolvedValueOnce({
      api_key: 'hp_live_test_key',
      user_id: 'hunter_abc',
      profile_complete: false,
      user_type: 'headhunter',
    });

    renderPage();
    fireEvent.change(screen.getByTestId('hunter-email-input'), {
      target: { value: 'hunter@example.com' },
    });
    fireEvent.click(screen.getByTestId('hunter-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('hunter-verify-otp')).toBeInTheDocument();
    });

    fillOtpInput('123456');
    fireEvent.click(screen.getByTestId('hunter-verify-otp'));

    await waitFor(() => {
      expect(mockedOtp.verify).toHaveBeenCalledTimes(1);
    });
    expect(mockedOtp.verify).toHaveBeenCalledWith('hunter@example.com', '123456', 'headhunter');
  });

  it('writes role=headhunter to the session and navigates to /hunter/workspace on success', async () => {
    mockedOtp.request.mockResolvedValueOnce({ expires_in: 300 });
    mockedOtp.verify.mockResolvedValueOnce({
      api_key: 'hp_live_test_key',
      user_id: 'hunter_abc',
      profile_complete: false,
      user_type: 'headhunter',
    });

    renderPage();
    fireEvent.change(screen.getByTestId('hunter-email-input'), {
      target: { value: 'hunter@example.com' },
    });
    fireEvent.click(screen.getByTestId('hunter-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('hunter-verify-otp')).toBeInTheDocument();
    });

    fillOtpInput('123456');
    fireEvent.click(screen.getByTestId('hunter-verify-otp'));

    await waitFor(() => {
      expect(lastNavigateTo).toBe('/hunter/workspace');
    });
    // Sanity check: the spy saw the same target.
    expect(navigateSpy).toHaveBeenCalledWith('/hunter/workspace');

    // Session must carry role: 'headhunter' so RequireHunterAuth accepts it.
    const session = getSession();
    expect(session).not.toBeNull();
    expect(session?.role).toBe('headhunter');
    expect(session?.api_key).toBe('hp_live_test_key');
    expect(session?.user_id).toBe('hunter_abc');
    expect(session?.profile_complete).toBe(false);
    expect(session?.email).toBe('hunter@example.com');
    // Sanity guard against silently setting the wrong role (regression guard).
    expect(session?.role).not.toBe('candidate');
  });

  it('renders an error message when otp.request throws', async () => {
    mockedOtp.request.mockRejectedValueOnce(new Error('限流:请稍后再试'));
    renderPage();

    fireEvent.change(screen.getByTestId('hunter-email-input'), {
      target: { value: 'hunter@example.com' },
    });
    fireEvent.click(screen.getByTestId('hunter-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('hunter-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('hunter-error')).toHaveTextContent('限流:请稍后再试');

    // Should stay on the email step — don't advance to OTP on request failure.
    expect(screen.queryByTestId('hunter-verify-otp')).toBeNull();
    expect(lastNavigateTo).toBeUndefined();
  });

  it('renders an error message when otp.verify throws', async () => {
    mockedOtp.request.mockResolvedValueOnce({ expires_in: 300 });
    mockedOtp.verify.mockRejectedValueOnce(new Error('验证码错误'));

    renderPage();
    fireEvent.change(screen.getByTestId('hunter-email-input'), {
      target: { value: 'hunter@example.com' },
    });
    fireEvent.click(screen.getByTestId('hunter-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('hunter-verify-otp')).toBeInTheDocument();
    });

    fillOtpInput('000000');
    fireEvent.click(screen.getByTestId('hunter-verify-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('hunter-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('hunter-error')).toHaveTextContent('验证码错误');

    // Session must not have been written — we never get a successful verify.
    expect(getSession()).toBeNull();
    expect(lastNavigateTo).toBeUndefined();
  });
});
