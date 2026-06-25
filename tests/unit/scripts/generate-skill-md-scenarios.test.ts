// tests/unit/scripts/generate-skill-md-scenarios.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllCapabilitySets } from '../../../src/main/capabilities/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');
const SCRIPT = path.join(PROJECT_ROOT, 'scripts/generate-skill-md-scenarios.ts');
const OUT = path.join(
  PROJECT_ROOT,
  'tests/integration/skill-md-conformance/_generated.test.ts',
);

function runGenerator(): void {
  execSync(`tsx "${SCRIPT}"`, { cwd: PROJECT_ROOT, stdio: 'pipe' });
}

describe('pnpm conformance:gen', () => {
  let originalOutput: string | null = null;

  beforeAll(() => {
    // Snapshot existing output so we can restore it after the test
    if (fs.existsSync(OUT)) {
      originalOutput = fs.readFileSync(OUT, 'utf8');
    }
    runGenerator();
  });

  afterAll(() => {
    // Restore original output (whether we wrote one or not)
    if (originalOutput !== null) {
      fs.writeFileSync(OUT, originalOutput, 'utf8');
    } else if (fs.existsSync(OUT)) {
      fs.unlinkSync(OUT);
    }
  });

  it('output file exists after running the generator', () => {
    expect(fs.existsSync(OUT)).toBe(true);
  });

  it('output contains 51 it.todo stubs (one per capability)', () => {
    const src = fs.readFileSync(OUT, 'utf8');
    const stubCount = (src.match(/it\.todo\(/g) ?? []).length;
    const expectedCount = getAllCapabilitySets().reduce(
      (n, s) => n + s.capabilities.length,
      0,
    );
    expect(stubCount).toBe(expectedCount);
    // Sub-C Plan 1 added admin.list_jobs + admin.list_recommendations (+2 = 53)
    // Sub-D2 added admin.get_timeline (+1 = 54)
    // Sub-D3 added admin.list_dead_letter (+1 = 55; admin.list_placements already existed)
    expect(expectedCount).toBe(55);
  });

  it('output contains 6 describe blocks (one per set)', () => {
    const src = fs.readFileSync(OUT, 'utf8');
    const roles = getAllCapabilitySets().map((s) => s.role).sort();
    const describeCount = (src.match(/^describe\(/gm) ?? []).length;
    expect(describeCount).toBe(roles.length);
    expect(describeCount).toBe(6);
    for (const role of roles) {
      expect(src).toContain(`describe('${role}'`);
    }
  });

  it('every capability name appears as a string in the output', () => {
    const src = fs.readFileSync(OUT, 'utf8');
    const allCaps = getAllCapabilitySets().flatMap((s) => s.capabilities);
    for (const cap of allCaps) {
      expect(src).toContain(cap.name);
    }
  });

  it('is idempotent (running twice yields byte-identical output)', () => {
    const first = fs.readFileSync(OUT, 'utf8');
    runGenerator();
    const second = fs.readFileSync(OUT, 'utf8');
    expect(second).toBe(first);
  });
});
