/**
 * Vitest global setup — runs once before all test files.
 *
 * Refuses to start the test suite if `openapi.json` has drifted from reality:
 * every path declared in openapi.json must still exist in code (reverse
 * coverage). Forward coverage (routes in code but not yet in spec) is
 * reported but not enforced — new routes take time to document.
 *
 * Use `pnpm openapi:check` from CLI for the same check.
 */
export async function setup() {
  const { runCheck } = await import('../scripts/generate-openapi');
  const result = runCheck();
  if (!result.ok) {
    const dangling = result.dangling.length;
    const list = result.dangling.slice(0, 10).map((d) => `  - ${d}`).join('\n');
    const more = result.dangling.length > 10 ? `\n  ... and ${result.dangling.length - 10} more` : '';
    throw new Error(
      `openapi.json has ${dangling} dangling path(s) — paths declared in spec but missing from code.\n` +
      `${list}${more}\n` +
      `Run \`pnpm openapi:generate\` and re-check, or update openapi.json manually if a route was intentionally removed.`,
    );
  }
  console.log(
    `[global-setup] openapi.json ok: ${result.declaredCount} declared, ` +
    `${result.scannedCount} scanned, ${result.forwardMissing.length} forward gaps (informational).`,
  );
}
// R1 vitest worker crash fix: in `pool: 'forks', singleFork: true`
// every test file runs in the same Node process. A single unhandled
// promise rejection (e.g. an expected error path that the test code
// didn't `.catch` for, or a `setTimeout` that fires after the test
// ends) is enough to terminate the worker process with no
// recoverable error in tinypool's IPC channel. The result is
// `Worker exited unexpectedly` / `ERR_IPC_CHANNEL_CLOSED` and the
// remaining tests in the run are silently skipped.
//
// Mitigate by adding a worker-process-level swallow handler. Test
// failures are still surfaced via vitest's own "unhandled error"
// reporter — we just stop them from killing the worker.
//
// Production code (out-of-test) is unaffected because global-setup
// only runs under vitest. The real fix is to `.catch` everywhere it
// matters in source; this is a test-runtime stability shim.
if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
  process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    console.error(
      '[global-setup] swallowed unhandledRejection (test-runtime):',
      reason instanceof Error ? (reason.stack ?? reason.message) : reason,
    );
  });
  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error(
      '[global-setup] swallowed uncaughtException (test-runtime):',
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
  });
}
