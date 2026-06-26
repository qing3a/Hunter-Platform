import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import SettingsPage from '../../src/pages/SettingsPage';

vi.mock('../../src/api/config', () => ({ listConfig: vi.fn(), updateConfig: vi.fn() }));
vi.mock('../../src/api/rate-limit', () => ({ listRateLimits: vi.fn() }));
vi.mock('../../src/api/webhook-subscriptions', () => ({
  listWebhookSubscriptions: vi.fn(),
  createWebhookSubscription: vi.fn(),
  updateWebhookSubscription: vi.fn(),
  deleteWebhookSubscription: vi.fn(),
}));

import { listConfig } from '../../src/api/config';
import { listRateLimits } from '../../src/api/rate-limit';
import { listWebhookSubscriptions } from '../../src/api/webhook-subscriptions';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/settings']}>
    <ToastProvider>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

describe('SettingsPage (Sub-E Plan 2 simplified)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listConfig as any).mockResolvedValue([]);
    (listRateLimits as any).mockResolvedValue([]);
    (listWebhookSubscriptions as any).mockResolvedValue([]);
  });

  it('1. renders 3 tabs', () => {
    renderPage();
    expect(screen.getByTestId('tab-config')).toBeTruthy();
    expect(screen.getByTestId('tab-rate-limit')).toBeTruthy();
    expect(screen.getByTestId('tab-webhooks')).toBeTruthy();
  });

  it('2. default tab is config', () => {
    renderPage();
    expect(screen.getByTestId('settings-tab-title').textContent).toBe('Config');
  });

  it('3. clicking rate-limit tab shows rate-limit content', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('tab-rate-limit'));
    await waitFor(() => expect(screen.getByTestId('settings-tab-title').textContent).toBe('Rate-Limit'));
  });

  it('4. clicking webhooks tab shows webhooks content', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('tab-webhooks'));
    await waitFor(() => expect(screen.getByTestId('settings-tab-title').textContent).toBe('Webhooks'));
  });

  it('5. simplified version: no data fetch (placeholder)', () => {
    // Plan 2 simplified: page shows tab UI only, no useEffect fetch.
    // Full CRUD will be implemented in a follow-up plan.
    renderPage();
    expect(listConfig).not.toHaveBeenCalled();
    expect(listRateLimits).not.toHaveBeenCalled();
    expect(listWebhookSubscriptions).not.toHaveBeenCalled();
    expect(screen.getByTestId('settings-content')).toBeTruthy();
  });
});
