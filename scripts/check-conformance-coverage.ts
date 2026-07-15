/**
 * pnpm conformance:check — fail if any capability declared in
 * src/main/capabilities/ has no corresponding REAL test in
 * tests/integration/skill-md-conformance/.
 *
 * Strategy: parse each scenario file, STRIPPING `it.todo(...)` lines first
 * (those are generated stubs, not real coverage), then look for capability
 * names appearing as strings OR in HTTP method+path patterns matching
 * capabilities.
 *
 * Exit 0: every capability has a real test that mentions it by name.
 * Exit 1: list missing capabilities.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllCapabilitySets } from '../src/main/capabilities/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFORMANCE_DIR = path.join(__dirname, '../tests/integration/skill-md-conformance');

/**
 * Strip lines that are `it.todo(...)` (or `it.skip` / `xit.todo` /
 * multi-line variants) from a test source. These are placeholders that
 * `pnpm conformance:gen` produces for caps without a real test, and they
 * must NOT count as coverage — otherwise a developer could "cover" a cap
 * by leaving the stub in place.
 */
function stripStubs(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*(?:it|xit|test)\.(?:todo|skip)\s*\(/.test(line))
    .join('\n');
}

function collectTestMentions(): Set<string> {
  const mentioned = new Set<string>();
  for (const file of fs.readdirSync(CONFORMANCE_DIR).filter((f) => f.endsWith('.test.ts'))) {
    const raw = fs.readFileSync(path.join(CONFORMANCE_DIR, file), 'utf8');
    const src = stripStubs(raw);
    for (const set of getAllCapabilitySets()) {
      for (const cap of set.capabilities) {
        if (src.includes(cap.name) || src.includes(`${cap.method} ${cap.path}`)) {
          mentioned.add(cap.name);
        }
      }
    }
  }
  return mentioned;
}

function main() {
  const all = getAllCapabilitySets();
  const allCaps = all.flatMap((s) => s.capabilities);
  const mentioned = collectTestMentions();
  const missing = allCaps.filter((c) => !mentioned.has(c.name));

  if (missing.length > 0) {
    console.error(`\n${missing.length} capability(ies) have no scenario test:\n`);
    for (const c of missing) {
      console.error(`  - ${c.name} (${c.method} ${c.path})`);
    }
    console.error(`\nAdd a test to tests/integration/skill-md-conformance/, or`);
    console.error(`run pnpm conformance:gen + fill in the stub in _generated.test.ts.`);
    process.exit(1);
  }
  console.log(`OK: all ${allCaps.length} capabilities have a scenario test.`);
}

main();