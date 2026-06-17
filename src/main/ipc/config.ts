import fs from 'node:fs';
import path from 'node:path';

const CONFIG_FILES: Record<string, string> = {
  'desensitization': 'config/desensitization.json',
  'commission': 'config/commission.json',
};

export function createConfigIpc(projectRoot: string = process.cwd()) {
  return {
    get(): Record<string, unknown> {
      const result: Record<string, unknown> = {};
      for (const [key, rel] of Object.entries(CONFIG_FILES)) {
        const full = path.join(projectRoot, rel);
        try {
          result[key] = JSON.parse(fs.readFileSync(full, 'utf8'));
        } catch {
          result[key] = null;
        }
      }
      return result;
    },
    set(key: string, value: unknown): { key: string; saved: boolean } {
      const rel = CONFIG_FILES[key];
      if (!rel) throw new Error(`Unknown config key: ${key}`);
      const full = path.join(projectRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, JSON.stringify(value, null, 2));
      return { key, saved: true };
    },
  };
}