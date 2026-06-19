import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * tests/scripts/openapi-coverage.test.ts
 *
 * Verifies the OpenAPI scanner script works correctly. The script's role is
 * reverse-direction drift detection (openapi.json paths must exist in code).
 *
 * Forward coverage (code → spec) is intentionally NOT enforced here because
 * the v1.4 hard constraint forbids modifying openapi.json schema content.
 * Forward gaps are tracked manually in skill.md §C instead.
 */
describe('scripts/generate-openapi.ts', () => {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'generate-openapi.ts');

  it('script file exists', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it('pnpm openapi:check exits 0 with no dangling paths', () => {
    // Run the script's --check mode. We expect exit code 0 (no dangling paths
    // in openapi.json that don't exist in code).
    let output = '';
    let exitCode = 0;
    try {
      output = execSync('pnpm openapi:check', {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch (e: any) {
      exitCode = e.status ?? 1;
      output = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
    }
    expect(exitCode).toBe(0);
    expect(output).toContain('No dangling paths');
  });

  it('scanner discovers at least 25 routes (sanity check)', () => {
    let output = '';
    try {
      output = execSync('pnpm openapi:check', {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch (e: any) {
      output = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
    }
    // The scanner line reports "Scanned N unique routes". Extract N and verify
    // it's at least 25 (current code has ~35).
    const m = output.match(/Scanned\s+(\d+)\s+unique/);
    expect(m).not.toBeNull();
    const n = Number(m![1]);
    expect(n).toBeGreaterThanOrEqual(25);
  });

  it('package.json registers the openapi scripts', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'),
    );
    expect(pkg.scripts).toHaveProperty('openapi:generate');
    expect(pkg.scripts).toHaveProperty('openapi:check');
    expect(pkg.scripts['openapi:generate']).toContain('scripts/generate-openapi.ts');
    expect(pkg.scripts['openapi:check']).toContain('--check');
  });
});