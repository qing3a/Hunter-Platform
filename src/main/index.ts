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
 * - `tsx src/main/index.ts` -> standalone API only (no window)
 * - `electron .` / electron-vite dev -> hybrid (API + BrowserWindow)
 */
export function shouldStartApiStandalone(): boolean {
  return !process.versions.electron;
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
 * Single entry point — called once on module load.
 * Pulled out so test imports of this module (for `shouldStartApiStandalone`)
 * don't accidentally fire side effects.
 */
export async function main(): Promise<void> {
  if (shouldStartApiStandalone()) {
    // Mode A: tsx CLI — API only
    apiServer = await startApiServer();
    console.log('API server running standalone (no Electron)');
  } else {
    // Mode B: Electron — API + window
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

// Only fire main() if this module is the actual entry point (not a test import).
// We compare process.argv[1] against this module's file path; if argv[1] is
// something else (vitest worker, etc.) we skip.
import { fileURLToPath as _toPath } from 'node:url';
function isEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return _toPath(import.meta.url) === _toPath(new URL(process.argv[1], 'file://'));
  } catch {
    return false;
  }
}
if (isEntryPoint()) {
  void main().catch((err) => {
    console.error('main() failed:', err);
    if (process.versions.electron) app.quit();
    else process.exit(1);
  });
}