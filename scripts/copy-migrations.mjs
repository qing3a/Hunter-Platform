#!/usr/bin/env node
// scripts/copy-migrations.mjs
// Postbuild step: copy SQL migration files from src/ to out/ so the compiled
// code can find them relative to itself (via __dirname ESM shim).
// The TypeScript compiler only handles .ts -> .js, not arbitrary files.
// Without this, production deploys get "ENOENT" on first runMigrations().
//
// Usage: invoked by `pnpm build`. Safe to re-run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const src = path.join(projectRoot, 'src', 'main', 'db', 'migrations');
const dst = path.join(projectRoot, 'out', 'main', 'db', 'migrations');

if (!fs.existsSync(src)) {
  console.error(`copy-migrations: source not found: ${src}`);
  process.exit(1);
}

fs.mkdirSync(dst, { recursive: true });
const files = fs.readdirSync(src).filter(f => f.endsWith('.sql'));
for (const f of files) {
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
console.log(`copy-migrations: copied ${files.length} .sql files to ${path.relative(projectRoot, dst)}`);
