import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  description: string;
  scripts: Record<string, string>;
};

describe('package.json identity', () => {
  it('package name is "hunter-platform"', () => {
    expect(pkg.name).toBe('hunter-platform');
  });

  it('description reflects 猎头中介 API 平台', () => {
    expect(pkg.description).toContain('猎头');
    expect(pkg.description).toContain('API');
  });
});

describe('package.json scripts', () => {
  it('scripts.dev uses tsx with --env-file=.env (API default)', () => {
    expect(pkg.scripts.dev).toBe('tsx --env-file=.env src/main/index.ts');
  });

  it('scripts.build no longer invokes electron-vite', () => {
    expect(pkg.scripts.build).not.toContain('electron-vite');
    expect(pkg.scripts.build).toContain('tsc');
  });

  it('scripts.start runs compiled output with --env-file', () => {
    expect(pkg.scripts.start).toContain('--env-file=.env');
    expect(pkg.scripts.start).toContain('out/main/index.js');
  });

  it('scripts.package is removed (desktop packaging out of scope)', () => {
    expect(pkg.scripts.package).toBeUndefined();
  });

  it('scripts.api:dev uses --env-file=.env', () => {
    expect(pkg.scripts['api:dev']).toBe('tsx --env-file=.env src/main/index.ts');
  });
});

describe('filesystem invariants', () => {
  it('electron.vite.config.ts has been deleted', () => {
    expect(existsSync(resolve(ROOT, 'electron.vite.config.ts'))).toBe(false);
  });
});