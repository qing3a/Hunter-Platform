// admin-web/tests/e2e/admin-login.spec.ts
//
// Phase 0: Reproduce "blank /admin/login" report from 2026-07-10.
// Curl showed the dev server returns 200 with correct HTML — this test
// runs a real headless browser to surface console errors and network
// failures, plus assert the React tree actually renders content.
import { test, expect } from '@playwright/test';

function lastLines(value: string, count = 10): string[] {
  return value.split('\n').slice(-count);
}

const isVitest = process.env.VITEST === 'true' ||
  process.env.VITEST_WORKER_ID !== undefined ||
  Boolean((import.meta as ImportMeta & { vitest?: unknown }).vitest);

if (isVitest) {
  const vitestGlobals = globalThis as typeof globalThis & {
    describe?: { skip: (name: string, fn: () => void) => void };
    it?: (name: string, fn: () => void) => void;
  };

  vitestGlobals.describe?.skip('/admin/login (Phase 0 diagnostic)', () => {
    vitestGlobals.it?.('runs via Playwright using pnpm test:e2e', () => {});
  });
} else {
  test.describe('/admin/login (Phase 0 diagnostic)', () => {
    test('returns 200 with no console errors and non-empty root', async ({ page }) => {
      const consoleErrors: string[] = [];
      const consoleWarnings: string[] = [];
      const failedRequests: string[] = [];
      const networkErrors: string[] = [];
      const pageErrors: string[] = [];
      const pageErrorBodySnapshots: string[][] = [];

      await page.addInitScript(() => {
        window.addEventListener('unhandledrejection', (event) => {
          const reason = event.reason;
          const message = reason instanceof Error
            ? `${reason.name}: ${reason.message}\n${reason.stack ?? ''}`
            : String(reason);
          const target = window as typeof window & { __phase15UnhandledRejections?: string[] };
          target.__phase15UnhandledRejections ??= [];
          target.__phase15UnhandledRejections.push(message);
          console.warn(`[phase-1.5 unhandledrejection] ${message}`);
        });
      });

      page.on('pageerror', (error) => {
        const message = `${error.name}: ${error.message}\n${error.stack ?? ''}`;
        pageErrors.push(message);
        console.log('Page error fired:', message);
        void page.evaluate(() => document.body.outerHTML)
          .then((bodyHtml) => pageErrorBodySnapshots.push(lastLines(bodyHtml)))
          .catch((snapshotError: unknown) => {
            pageErrorBodySnapshots.push([`Unable to capture body outerHTML: ${String(snapshotError)}`]);
          });
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
        if (msg.type() === 'warning') consoleWarnings.push(msg.text());
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
      const finalUrl = page.url();

      // The script tag must be present
      const scriptSrc = await page.locator('script[src*="main.tsx"]').getAttribute('src');
      expect(scriptSrc).toMatch(/\/admin\/src\/main\.tsx/);

      // Give React time to mount (StrictMode double-render takes a tick)
      await page.waitForSelector('#root *', { timeout: 5000 }).catch(() => {});
      const rootHtml = (await page.locator('#root').innerHTML()).trim();
      const pageContentLast10Lines = lastLines(await page.content());
      const bodyOuterHtmlLast10Lines = await page.evaluate(() => document.body.outerHTML)
        .then((bodyHtml) => lastLines(bodyHtml))
        .catch((error: unknown) => [`Unable to capture body outerHTML: ${String(error)}`]);
      const unhandledRejections = await page.evaluate(() => {
        const target = window as typeof window & { __phase15UnhandledRejections?: string[] };
        return target.__phase15UnhandledRejections ?? [];
      }).catch((error: unknown) => [`Unable to read unhandled rejections: ${String(error)}`]);

      // Diagnostic output — do NOT fail on these yet, just record them
      console.log('=== Phase 0 diagnostic output ===');
      console.log('Final URL:', finalUrl);
      console.log('Console errors:', consoleErrors);
      console.log('Console warnings:', consoleWarnings);
      console.log('Page errors:', pageErrors);
      console.log('Unhandled rejections:', unhandledRejections);
      console.log('Failed requests:', failedRequests);
      console.log('Network 4xx/5xx:', networkErrors);
      console.log('Root innerHTML length:', rootHtml.length);
      console.log('Root innerHTML preview:', rootHtml.slice(0, 200));
      console.log('page.content() last 10 lines:', pageContentLast10Lines);
      console.log('document.body.outerHTML last 10 lines:', bodyOuterHtmlLast10Lines);
      console.log('pageerror body.outerHTML snapshots:', pageErrorBodySnapshots);
      console.log('=== end diagnostic ===');

      // Hard asserts (these are the regression we'll keep):
      expect(networkErrors.filter((e) => e.includes('/admin/src/'))).toEqual([]);
      expect(failedRequests).toEqual([]);
      expect(rootHtml.length).toBeGreaterThan(50);
    });
  });
}
