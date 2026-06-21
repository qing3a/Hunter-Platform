import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROUTES_DIR = path.join(__dirname, '../../src/main/routes');

describe('schema coverage: every res.json in routes uses respond()', () => {
  const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'));
  for (const file of files) {
    it(`${file} imports respond and has no bare res.json({ ok: true, data: ... })`, () => {
      const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');

      // Skip routes that don't return JSON at all (e.g. landing.ts returns HTML).
      const hasAnyResJson = /res\.json\s*\(/.test(src);
      if (!hasAnyResJson) return;

      // Each JSON-returning route file must import respond
      expect(src, `${file} must import respond from '../responses.js'`).toMatch(
        /from ['"]\.\.\/responses\.js['"]/
      );

      // No bare res.json calls that look like response envelopes
      // (legitimate uses are res.status().json({ error }) which we allow below)
      const bareResJson = src.match(/res\.json\(\s*\{\s*ok:\s*true/g) ?? [];
      expect(
        bareResJson.length,
        `${file} has ${bareResJson.length} bare res.json({ ok: true, ... }) calls — must use respond()`
      ).toBe(0);
    });
  }
});