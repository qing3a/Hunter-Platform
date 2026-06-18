import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type http from 'node:http';
import { startApiServer } from './server.js';
import { registerAdminIpc } from './ipc/index.js';
import { loadEnv } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Detect whether we're running as a standalone API server (tsx) vs.
 * embedded inside an Electron main process.
 *
 * - `tsx src/main/index.ts` / `node out/main/index.js` → standalone API
 * - `electron .` / electron-vite dev → hybrid (API + BrowserWindow)
 */
export function shouldStartApiStandalone(): boolean {
  return !process.versions.electron;
}

/**
 * Test environment guard. Returns true if we should NOT fire side effects.
 *
 * Why this exists: the previous implementation compared `import.meta.url` to
 * `process.argv[1]` to detect "is this the entry point?" — a comparison
 * that is fragile in compiled CJS output (electron-vite build artifact)
 * because of URL encoding vs native path format mismatches. For example:
 *
 *   import.meta.url  = file:///D:/dev/hunter-platform/out/main/index.js
 *   process.argv[1] = D:\dev\hunter-platform\out\main\index.js
 *   // (also vitest worker paths are completely different)
 *
 * The robust approach: check explicit environment signals set by vitest
 * or by manual test runs, rather than guessing entry-point status.
 */
function isTestEnv(): boolean {
  return process.env.VITEST === 'true'
      || process.env.VITEST_WORKER_ID !== undefined
      || process.env.NODE_ENV === 'test';
}

let apiServer: http.Server | null = null;

async function startBackend(): Promise<void> {
  const env = loadEnv();
  apiServer = await startApiServer({ port: env.PORT });
  registerAdminIpc();
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Hunter Platform Admin',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function registerPingIpc(): void {
  ipcMain.handle('ping', () => 'pong');
}

/**
 * Main entry point. Always exported for testability, but the
 * bottom-of-file IIFE that calls it has a test-env guard so side
 * effects (binding a port, opening a window) only happen at runtime.
 */
export async function main(): Promise<void> {
  // Test-env guard: don't fire side effects (port bind, window open)
  // when this module is imported by vitest. Tests that need main()'s
  // behavior should call it explicitly.
  if (isTestEnv()) return;

  if (shouldStartApiStandalone()) {
    // Mode A: tsx CLI / `node out/main/index.js` — API only
    console.log('[hunter-platform] starting in API-only mode (no Electron)');
    apiServer = await startApiServer();
    console.log('API server running standalone (no Electron)');
  } else {
    // Mode B: Electron — API + window
    console.log('[hunter-platform] starting in Electron mode (API + Admin UI)');
    await app.whenReady();
    await startBackend();
    registerPingIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    app.on('window-all-closed', () => {
      if (apiServer) apiServer.close();
      if (process.platform !== 'darwin') app.quit();
    });
  }
}

// Always call main() on module load. isTestEnv() inside the guard above
// prevents side effects when this module is imported by vitest.
//
// This replaces the previous isEntryPoint() check that compared
// import.meta.url to process.argv[1] — a comparison that breaks in
// compiled CJS output because the two paths use different formats
// (file:// URL vs native path, with different separators and possibly
// different encodings).
void main().catch((err) => {
  console.error('main() failed:', err);
  if (process.versions.electron) app.quit();
  else process.exit(1);
});