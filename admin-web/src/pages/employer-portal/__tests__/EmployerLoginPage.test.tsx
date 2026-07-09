import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EmployerLoginPage } from '../EmployerLoginPage';
import { employerAuth } from '../../../api/employer';
import { clearSession, getSession } from '../../../lib/candidate-session';

// ---- Mocks ----------------------------------------------------------------

// Record every argument passed to `navigate(...)` so we can assert on the
// post-login redirect target without spinning up a real router history.
let lastNavigateTo: string | undefined;
const navigateSpy = vi.fn((to: string) => {
  lastNavigateTo = to;
});

// Mock the Employer API client so we don't talk to a real backend in unit tests.
// We mock the whole module because employerAuth owns both
// requestOtp and verifyOtp.
vi.mock('../../../api/employer', () => ({
  employerAuth: {
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

const mockedAuth = vi.mocked(employerAuth);

// ---- Helpers --------------------------------------------------------------

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/employer/login']}>
      <EmployerLoginPage />
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

describe('EmployerLoginPage', () => {
  beforeEach(() => {
    cleanup();
    clearSession();
    lastNavigateTo = undefined;
    navigateSpy.mockClear();
    vi.clearAllMocks();
  });

  it('renders the email step initially (no OTP UI visible)', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('雇主登录');
    expect(screen.getByTestId('employer-email-input')).toBeInTheDocument();
    expect(screen.getByTestId('employer-request-otp')).toBeInTheDocument();
    expect(screen.queryByTestId('employer-verify-otp')).toBeNull();
    expect(screen.queryByTestId('employer-dev-code')).toBeNull();
    expect(screen.queryByTestId('employer-error')).toBeNull();
  });

  it('typing an email + submitting advances to the OTP step and calls employerAuth.requestOtp', async () => {
    mockedAuth.requestOtp.mockResolvedValueOnce({ expires_in: 300 });

    renderPage();
    fireEvent.change(screen.getByTestId('employer-email-input'), {
      target: { value: 'employer@example.com' },
    });
    fireEvent.click(screen.getByTestId('employer-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('employer-verify-otp')).toBeInTheDocument();
    });

    expect(mockedAuth.requestOtp).toHaveBeenCalledTimes(1);
    expect(mockedAuth.requestOtp).toHaveBeenCalledWith('employer@example.com');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('输入验证码');
  });

  it('shows the dev_code from employerAuth.requestOtp in test mode', async () => {
    mockedAuth.requestOtp.mockResolvedValueOnce({
      expires_in: 300,
      dev_code: '654321',
    });

    renderPage();
    fireEvent.change(screen.getByTestId('employer-email-input'), {
      target: { value: 'employer@example.com' },
    });
    fireEvent.click(screen.getByTestId('employer-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('employer-dev-code')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-dev-code')).toHaveTextContent('654321');
  });

  it('submitting the OTP calls employerAuth.verifyOtp(email, code)', async () => {
    mockedAuth.requestOtp.mockResolvedValueOnce({ expires_in: 300, dev_code: '654321' });
    mockedAuth.verifyOtp.mockResolvedValueOnce({
      api_key: 'hp_live_emp_test_key',
      user_id: 'emp_abc',
      profile_complete: false,
      user_type: 'employer',
      role: 'employer',
    });

    renderPage();
    fireEvent.change(screen.getByTestId('employer-email-input'), {
      target: { value: 'employer@example.com' },
    });
    fireEvent.click(screen.getByTestId('employer-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('employer-verify-otp')).toBeInTheDocument();
    });

    fillOtpInput('654321');
    fireEvent.click(screen.getByTestId('employer-verify-otp'));

    await waitFor(() => {
      expect(mockedAuth.verifyOtp).toHaveBeenCalledTimes(1);
    });
    expect(mockedAuth.verifyOtp).toHaveBeenCalledWith('employer@example.com', '654321');
  });

  it('writes role=employer to the session and navigates to /admin/employer/dashboard on success', async () => {
    mockedAuth.requestOtp.mockResolvedValueOnce({ expires_in: 300 });
    mockedAuth.verifyOtp.mockResolvedValueOnce({
      api_key: 'hp_live_emp_test_key',
      user_id: 'emp_abc',
      profile_complete: false,
      user_type: 'employer',
      role: 'employer',
    });

    renderPage();
    fireEvent.change(screen.getByTestId('employer-email-input'), {
      target: { value: 'employer@example.com' },
    });
    fireEvent.click(screen.getByTestId('employer-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('employer-verify-otp')).toBeInTheDocument();
    });

    fillOtpInput('654321');
    fireEvent.click(screen.getByTestId('employer-verify-otp'));

    await waitFor(() => {
      expect(lastNavigateTo).toBe('/admin/employer/dashboard');
    });
    // Sanity check: the spy saw the same target.
    expect(navigateSpy).toHaveBeenCalledWith('/admin/employer/dashboard');

    // Session must carry role: 'employer' so RequireEmployerAuth accepts it.
    const session = getSession();
    expect(session).not.toBeNull();
    expect(session?.role).toBe('employer');
    expect(session?.api_key).toBe('hp_live_emp_test_key');
    expect(session?.user_id).toBe('emp_abc');
    expect(session?.profile_complete).toBe(false);
    expect(session?.email).toBe('employer@example.com');
    // Sanity guard against silently setting the wrong role.
    expect(session?.role).not.toBe('headhunter');
    expect(session?.role).not.toBe('candidate');
    expect(session?.role).not.toBe('pm');
  });

  it('renders an error message when employerAuth.requestOtp throws', async () => {
    mockedAuth.requestOtp.mockRejectedValueOnce(new Error('限流:请稍后再试'));
    renderPage();

    fireEvent.change(screen.getByTestId('employer-email-input'), {
      target: { value: 'employer@example.com' },
    });
    fireEvent.click(screen.getByTestId('employer-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('employer-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-error')).toHaveTextContent('限流:请稍后再试');

    // Should stay on the email step — don't advance to OTP on request failure.
    expect(screen.queryByTestId('employer-verify-otp')).toBeNull();
    expect(lastNavigateTo).toBeUndefined();
  });

  it('renders an error message when employerAuth.verifyOtp throws', async () => {
    mockedAuth.requestOtp.mockResolvedValueOnce({ expires_in: 300 });
    mockedAuth.verifyOtp.mockRejectedValueOnce(new Error('验证码错误'));

    renderPage();
    fireEvent.change(screen.getByTestId('employer-email-input'), {
      target: { value: 'employer@example.com' },
    });
    fireEvent.click(screen.getByTestId('employer-request-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('employer-verify-otp')).toBeInTheDocument();
    });

    fillOtpInput('000000');
    fireEvent.click(screen.getByTestId('employer-verify-otp'));

    await waitFor(() => {
      expect(screen.getByTestId('employer-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-error')).toHaveTextContent('验证码错误');

    // Session must not have been written — we never get a successful verify.
    expect(getSession()).toBeNull();
    expect(lastNavigateTo).toBeUndefined();
  });
});