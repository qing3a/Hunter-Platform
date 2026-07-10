// admin-web/tests/e2e/admin-login.spec.ts
//
// Phase 0: Reproduce "blank /admin/login" report from 2026-07-10.
// Curl showed the dev server returns 200 with correct HTML — this test
// runs a real headless browser to surface console errors and network
// failures, plus assert the React tree actually renders content.
import { test, expect } from '@playwright/test';

test.describe('/admin/login (Phase 0 diagnostic)', () => {
  test('returns 200 with no console errors and non-empty root', async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const networkErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`);
    });
    page.on('response', (resp) => {
      if (resp.status() >= 400) {
        networkErrors.push(`${resp.status()} ${resp.url()}`);
      }
    });

    const response = await page.goto('/admin/login', { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);

    // The script tag must be present
    const scriptSrc = await page.locator('script[src*="main.tsx"]').getAttribute('src');
    expect(scriptSrc).toMatch(/\/admin\/src\/main\.tsx/);

    // Give React time to mount (StrictMode double-render takes a tick)
    await page.waitForSelector('#root *', { timeout: 5000 }).catch(() => {});
    const rootHtml = (await page.locator('#root').innerHTML()).trim();

    // Diagnostic output — do NOT fail on these yet, just record them
    console.log('=== Phase 0 diagnostic output ===');
    console.log('Console errors:', consoleErrors);
    console.log('Failed requests:', failedRequests);
    console.log('Network 4xx/5xx:', networkErrors);
    console.log('Root innerHTML length:', rootHtml.length);
    console.log('Root innerHTML preview:', rootHtml.slice(0, 200));
    console.log('=== end diagnostic ===');

    // Hard asserts (these are the regression we'll keep):
    expect(networkErrors.filter((e) => e.includes('/admin/src/'))).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(rootHtml.length).toBeGreaterThan(50);
  });
});