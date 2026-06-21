import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROUTES_DIR = path.join(__dirname, '../../src/main/routes');

/**
 * Strip JS/TS comments and string literals so the regex below only matches
 * real `res.json(...)` call sites, not example code inside `// ...`, `/* ... *\/`,
 * `'...'`, `"..."`, or backtick template literals.
 *
 * Template literals with `${...}` interpolation can still smuggle code; route
 * files don't currently do that and the cost of full AST parsing is not
 * worth the defensive gain. If a future route file uses template interpolation
 * in a way that confuses this test, switch to ts-morph or the TS compiler API.
 */
function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')                 // block comments
    .replace(/\/\/[^\n]*/g, '')                      // line comments
    .replace(/'(?:[^'\\]|\\.|\\\n)*'/g, "''")        // single-quoted strings
    .replace(/"(?:[^"\\]|\\.|\\\n)*"/g, '""')        // double-quoted strings
    .replace(/`(?:[^`\\]|\\.|\\\n)*`/g, '``');       // template literals (no interp)
}

describe('schema coverage: every res.json in routes uses respond()', () => {
  const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'));
  for (const file of files) {
    it(`${file} imports respond and has no bare res.json({ ok: true, data: ... })`, () => {
      const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
      const stripped = stripCommentsAndStrings(src);

      // Skip routes that don't return JSON at all (e.g. landing.ts returns HTML).
      const hasAnyResJson = /res\.json\s*\(/.test(stripped);
      if (!hasAnyResJson) return;

      // Each JSON-returning route file must import respond
      expect(src, `${file} must import respond from '../responses.js'`).toMatch(
        /from ['"]\.\.\/responses\.js['"]/
      );

      // No bare res.json calls that look like response envelopes.
      // Match the function call form (no leading quote, not in a string).
      const bareResJson = stripped.match(/res\.json\(\s*\{\s*ok:\s*true/g) ?? [];
      expect(
        bareResJson.length,
        `${file} has ${bareResJson.length} bare res.json({ ok: true, ... }) calls — must use respond()`
      ).toBe(0);
    });
  }

  it('regex correctly ignores res.json inside a string literal or comment', () => {
    // sanity-check: if a route file had a docstring like "use res.json({ok:true, ...})"
    // the test should NOT flag it.
    const fakeSrc = `
      // Example: res.json({ ok: true, data: {...} }) — don't flag this
      /* block: res.json({ ok: true, data: {} }) */
      const doc = "res.json({ ok: true, data: {} })";
      const tpl = \`res.json({ ok: true, data: {} })\`;
    `;
    const stripped = stripCommentsAndStrings(fakeSrc);
    expect(stripped.match(/res\.json\(\s*\{\s*ok:\s*true/g)).toBeNull();
  });
});