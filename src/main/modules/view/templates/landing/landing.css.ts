// src/main/modules/view/templates/landing/landing.css.ts
// P7 fix: CSS extracted to a separate .css file so stylelint can lint it as proper CSS.
// The string is loaded via fs.readFileSync at module-load time (server-side only, no runtime cost).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const LANDING_CSS: string = readFileSync(
  join(__dirname, 'landing.css'),
  'utf-8'
);