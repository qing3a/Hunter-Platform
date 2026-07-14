#!/usr/bin/env node
// scripts/copy-migrations.mjs
// Postbuild step: copy (a) SQL migration files, (b) .css asset files
// from src/ to out/ so the compiled code can find them at runtime.
// The TypeScript compiler only handles .ts -> .js, not arbitrary files.
// Without the SQL copy, production deploys get "ENOENT" on first
// runMigrations(). Without the .css copy, view templates fail their
// fs.readFileSync(...) call.
//
// Usage: invoked by `pnpm build`. Safe to re-run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// --- 1. SQL migrations ---
const sqlSrc = path.join(projectRoot, 'src', 'main', 'db', 'migrations');
const sqlDst = path.join(projectRoot, 'out', 'main', 'db', 'migrations');

if (!fs.existsSync(sqlSrc)) {
  console.error(`copy-migrations: source not found: ${sqlSrc}`);
  process.exit(1);
}

fs.mkdirSync(sqlDst, { recursive: true });
const sqlFiles = fs.readdirSync(sqlSrc).filter(f => f.endsWith('.sql'));
for (const f of sqlFiles) {
  fs.copyFileSync(path.join(sqlSrc, f), path.join(sqlDst, f));
}
console.log(`copy-migrations: copied ${sqlFiles.length} .sql files to ${path.relative(projectRoot, sqlDst)}`);

// --- 2. .css assets ---
// landing.css is imported by landing.css.ts via fs.readFileSync at module-load
// time. Mirrors the same relative-layout as tsc (src/main/ → out/main/).
const cssExts = new Set(['.css']);
const cssSrcRoot = path.join(projectRoot, 'src', 'main');
const cssDstRoot = path.join(projectRoot, 'out', 'main');
let cssCopied = 0;
function walkAndCopyCss(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      walkAndCopyCss(s, d);
    } else if (cssExts.has(path.extname(entry.name))) {
      fs.copyFileSync(s, d);
      cssCopied++;
    }
  }
}
walkAndCopyCss(cssSrcRoot, cssDstRoot);
if (cssCopied > 0) {
  console.log(`copy-migrations: copied ${cssCopied} .css assets to ${path.relative(projectRoot, cssDstRoot)}`);
}
