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