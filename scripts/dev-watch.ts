/**
 * Dev-mode auto-restart watcher.
 *
 * Why this exists: we use `node --import tsx src/main/index.ts` directly (no
 * tsx/pnpm supervisor) to keep the process tree clean — one process, no
 * orphan risk. Side effect: no auto-restart on .ts edits. This script adds
 * restart back, manually, with safe process kill semantics.
 *
 * Usage: pnpm dev:watch
 *
 * How it works:
 *   1. Spawn `node --import tsx src/main/index.ts` as a child
 *   2. Watch src/ recursively (Windows/macOS fs.watch supports recursive)
 *   3. On any *.ts change → SIGTERM the child, wait for clean exit, respawn
 *   4. On Ctrl+C → SIGTERM child, wait, exit 0
 *
 * What it deliberately does NOT do:
 *   - Use chokidar / nodemon (adds deps, larger surface than needed)
 *   - Spawn through pnpm (would re-introduce the supervisor pattern we fixed)
 *   - Use SIGKILL (would leave port 3000 in TIME_WAIT; SIGTERM lets Express
 *     drain the listener cleanly)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { watch } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const SRC_DIR = resolve(PROJECT_ROOT, 'src');
const DEBOUNCE_MS = 200;

let child: ChildProcess | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let stopping = false;

function start(): void {
  if (child) return;
  console.log('[dev-watch] starting server...');
  child = spawn(
    process.execPath,
    ['--env-file=.env', '--import', 'tsx', 'src/main/index.ts'],
    { cwd: PROJECT_ROOT, stdio: 'inherit' },
  );
  child.on('exit', (code, signal) => {
    console.log(`[dev-watch] server exited code=${code} signal=${signal}`);
    child = null;
    if (!stopping) {
      // Crashed — restart after a short delay so we don't tight-loop.
      setTimeout(() => start(), 1000);
    }
  });
}

function scheduleRestart(reason: string): void {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    console.log(`[dev-watch] ${reason}, restarting...`);
    if (child) {
      child.once('exit', () => start());
      child.kill('SIGTERM');
    } else {
      start();
    }
  }, DEBOUNCE_MS);
}

watch(SRC_DIR, { recursive: true }, (_event, filename) => {
  if (filename && filename.toString().endsWith('.ts')) {
    scheduleRestart(`detected change: ${filename}`);
  }
});

process.on('SIGINT', () => {
  stopping = true;
  console.log('\n[dev-watch] SIGINT, stopping...');
  if (child) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 500);
});

start();
