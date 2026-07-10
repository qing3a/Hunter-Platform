import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from '../SettingsPage';
import { setSession } from '../../../lib/candidate-session';
import { ToastProvider } from '@hunter-platform/shared-web/lib';

// ---- Helpers --------------------------------------------------------------

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/employer/settings']}>
      <ToastProvider>
        <SettingsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function seedEmployerSession(apiKey = 'emp_test_api_key_xyz') {
  setSession({
    api_key: apiKey,
    user_id: 'user-emp-42',
    profile_complete: true,
    email: 'hr@example-corp.com',
    role: 'employer',
  });
}

// ---- Tests ----------------------------------------------------------------

describe('SettingsPage — header', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    seedEmployerSession();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders the page title 设置 and the three section headings', () => {
    renderPage();
    expect(screen.getByTestId('employer-settings-title')).toHaveTextContent('设置');
    expect(screen.getByTestId('employer-settings-section-company')).toBeInTheDocument();
    expect(screen.getByTestId('employer-settings-section-notifications')).toBeInTheDocument();
    expect(screen.getByTestId('employer-settings-section-api-key')).toBeInTheDocument();
  });
});

describe('SettingsPage — company info (read-only v1)', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    seedEmployerSession();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders the company info section with the contact email from the session', () => {
    renderPage();
    const section = screen.getByTestId('employer-settings-section-company');
    // session.email -> contact line
    expect(within(section).getByTestId('employer-settings-company-email')).toHaveTextContent(
      'hr@example-corp.com',
    );
  });

  it('renders the user_id and role read-only fields', () => {
    renderPage();
    const section = screen.getByTestId('employer-settings-section-company');
    expect(within(section).getByTestId('employer-settings-user-id')).toHaveTextContent('user-emp-42');
    expect(within(section).getByTestId('employer-settings-role')).toHaveTextContent('employer');
  });
});

describe('SettingsPage — notification toggles', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    seedEmployerSession();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders both notification toggles checked by default', () => {
    renderPage();
    const emailToggle = screen.getByTestId('employer-settings-notify-email') as HTMLInputElement;
    const inAppToggle = screen.getByTestId('employer-settings-notify-inapp') as HTMLInputElement;
    expect(emailToggle.type).toBe('checkbox');
    expect(emailToggle.checked).toBe(true);
    expect(inAppToggle.checked).toBe(true);
  });

  it('flips a notification toggle off when clicked and back on when clicked again', () => {
    renderPage();
    const emailToggle = screen.getByTestId('employer-settings-notify-email') as HTMLInputElement;
    expect(emailToggle.checked).toBe(true);
    fireEvent.click(emailToggle);
    expect(emailToggle.checked).toBe(false);
    fireEvent.click(emailToggle);
    expect(emailToggle.checked).toBe(true);
  });
});

describe('SettingsPage — API key', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    seedEmployerSession('emp_special_live_key_999');
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders the api_key value from the session in the api-key section', () => {
    renderPage();
    const section = screen.getByTestId('employer-settings-section-api-key');
    expect(within(section).getByTestId('employer-settings-api-key-value')).toHaveTextContent(
      'emp_special_live_key_999',
    );
  });

  it('writes the api_key to the clipboard and shows feedback when 复制 is clicked', async () => {
    // jsdom doesn't ship a real clipboard; mock the modern API used by the page.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    renderPage();
    fireEvent.click(screen.getByTestId('employer-settings-api-key-copy'));

    expect(writeText).toHaveBeenCalledWith('emp_special_live_key_999');
    // The copy button label flips to a confirmation string on success.
    await screen.findByTestId('employer-settings-api-key-copied');
  });
});