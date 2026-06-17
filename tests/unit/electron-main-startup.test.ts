import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('electron main entry', () => {
  const testDb = path.join(__dirname, '../../tmp/electron-main.db');

  beforeAll(() => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('index.ts includes Electron + BrowserWindow + app.whenReady', async () => {
    const mainPath = path.join(__dirname, '../../src/main/index.ts');
    const content = fs.readFileSync(mainPath, 'utf8');
    expect(content).toContain("from 'electron'");
    expect(content).toContain('BrowserWindow');
    expect(content).toContain('app.whenReady');
  });

  it('returns true when not running under Electron (tsx standalone)', async () => {
    const original = (process as any).versions.electron;
    delete (process as any).versions.electron;
    try {
      const { shouldStartApiStandalone } = await import('../../src/main/index');
      expect(shouldStartApiStandalone()).toBe(true);
    } finally {
      if (original) (process as any).versions.electron = original;
    }
  });

  it('returns false when running under Electron', async () => {
    (process as any).versions.electron = '32.2.5';
    try {
      const { shouldStartApiStandalone } = await import('../../src/main/index');
      expect(shouldStartApiStandalone()).toBe(false);
    } finally {
      delete (process as any).versions.electron;
    }
  });
});