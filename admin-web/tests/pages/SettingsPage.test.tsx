import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import SettingsPage from '../../src/pages/SettingsPage';

vi.mock('../../src/api/config', () => ({
  listConfig: vi.fn(),
  updateConfig: vi.fn(),
}));

import { listConfig, updateConfig } from '../../src/api/config';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/settings']}>
    <ToastProvider>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

const sampleEntries = [
  { key: 'platform_fee_pct', value: 5, updated_at: '2026-06-25T00:00:00Z', updated_by_admin_user_id: 'adm_1' },
  { key: 'salary_bands', value: { junior: 100000, senior: 500000 }, updated_at: '2026-06-25T00:00:00Z', updated_by_admin_user_id: 'adm_1' },
];

describe('SettingsPage (Sub-E Config-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listConfig as any).mockResolvedValue(sampleEntries);
    (updateConfig as any).mockResolvedValue({
      key: 'platform_fee_pct', value: 7, updated_at: '2026-06-25T01:00:00Z', updated_by_admin_user_id: 'adm_1',
    });
  });

  it('1. mount calls listConfig and renders rows with formatted values', async () => {
    renderPage();
    await waitFor(() => expect(listConfig).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('config-row-platform_fee_pct')).toBeTruthy();
    expect(screen.getByTestId('config-row-salary_bands')).toBeTruthy();
    // Value column JSON-stringifies the entry
    expect(screen.getByTestId('config-row-platform_fee_pct').textContent).toContain('5');
    expect(screen.getByTestId('config-row-salary_bands').textContent).toContain('junior');
  });

  it('2. clicking 编辑 opens ConfigEditModal in edit mode (key field disabled)', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('config-edit-platform_fee_pct'));
    fireEvent.click(screen.getByTestId('config-edit-platform_fee_pct'));
    const keyInput = (await screen.findByTestId('config-key')) as HTMLInputElement;
    // Edit mode: key disabled
    expect(keyInput.disabled).toBe(true);
    expect(keyInput.value).toBe('platform_fee_pct');
    // Value pre-filled with JSON stringification of the current value
    const valueInput = screen.getByTestId('config-value') as HTMLTextAreaElement;
    expect(valueInput.value).toBe('5');
  });

  it('3. saving with valid reason calls updateConfig then refetches', async () => {
    renderPage();
    await waitFor(() => expect(listConfig).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('config-edit-platform_fee_pct'));
    // Change value
    const valueInput = (await screen.findByTestId('config-value')) as HTMLTextAreaElement;
    fireEvent.change(valueInput, { target: { value: '7' } });
    // Fill reason
    const reasonInput = screen.getByTestId('config-reason') as HTMLTextAreaElement;
    fireEvent.change(reasonInput, { target: { value: 'increase platform fee' } });
    // Click save
    fireEvent.click(screen.getByTestId('config-save'));
    await waitFor(() => expect(updateConfig).toHaveBeenCalledWith('platform_fee_pct', 7, 'increase platform fee'));
    // After save, modal closes + refetch is triggered. Allow >= 2 calls
    // (handleSave explicitly calls load() and toast change re-fires useEffect).
    await waitFor(() => expect(listConfig.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('4. clicking + New Key opens modal in new mode (key field enabled + empty)', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('config-new'));
    fireEvent.click(screen.getByTestId('config-new'));
    const keyInput = (await screen.findByTestId('config-key')) as HTMLInputElement;
    // New mode: key enabled and empty
    expect(keyInput.disabled).toBe(false);
    expect(keyInput.value).toBe('');
  });

  it('5. updateConfig failure keeps modal open and surfaces error message', async () => {
    (updateConfig as any).mockRejectedValue(new Error('Server: Invalid config key format'));
    renderPage();
    await waitFor(() => screen.getByTestId('config-edit-platform_fee_pct'));
    fireEvent.click(screen.getByTestId('config-edit-platform_fee_pct'));
    const valueInput = (await screen.findByTestId('config-value')) as HTMLTextAreaElement;
    fireEvent.change(valueInput, { target: { value: '9' } });
    fireEvent.change(screen.getByTestId('config-reason'), { target: { value: 'oops' } });
    fireEvent.click(screen.getByTestId('config-save'));
    // Modal stays open (still has the save button) and shows the error
    await waitFor(() => expect(screen.getByTestId('config-modal-error').textContent).toContain('Server: Invalid config key format'));
    expect(screen.getByTestId('config-save')).toBeTruthy();
  });
});
