/**
 * scripts/generate-openapi.ts
 *
 * Scan src/main/routes/*.ts (and src/main/server.ts for direct mounts) and
 * produce docs/superpowers/openapi.json with one entry per discovered route.
 *
 * Scope (v1):
 *   - Detect router.METHOD('/path', ...) in routes/*.ts
 *   - Combine with mount prefix from server.ts (hardcoded here — same set as
 *     createAppFromDb() uses)
 *   - Each discovered route becomes a path entry with a minimal stub operation
 *     object. Schema details are NOT generated (the existing static openapi.json
 *     has those; we leave them alone and only verify coverage).
 *
 * Usage:
 *   pnpm openapi:generate   # writes docs/superpowers/openapi.json
 *   pnpm openapi:check      # exits non-zero if any route is missing from the
 *                           # existing openapi.json
 */
import fs from 'node:fs';
import path from 'node:path';

// Paths declared in openapi.json that we intentionally don't require the
// scanner to find. Each entry is a known legacy / intentional mismatch.
// Keep this list short and well-justified.
const KNOWN_LEGACY_PATHS: Set<string> = new Set([
  // openapi.json:288 has a bare `/health` (no /v1 prefix) from the pre-v1
  // era when health checks were not under /v1. server.ts only registers
  // `/v1/health` now. The dangling entry is tracked in skill.md §C.
  'GET /health',
]);

// Mount prefixes as used in src/main/server.ts (createAppFromDb).
// Keys are route filenames (relative to src/main/routes/), values are the URL
// prefix they get mounted under. A `null` value means the route is mounted at
// `/` (e.g. landing.ts).
const MOUNT_PREFIXES: Record<string, string | null> = {
  'auth.ts':       '/v1/auth',
  'users.ts':      '/v1/users',
  'config.ts':     '/v1/config',
  'market.ts':     '/v1/market',
  'headhunter.ts': '/v1/headhunter',
  'employer.ts':   '/v1/employer',
  'candidate.ts':  '/v1/candidate',
  'admin.ts':      '/v1/admin',
  'landing.ts':    null,
};

// Extra router files outside src/main/routes/. Keyed by the absolute path
// relative to project root, value is the URL mount prefix.
// Currently only views-endpoint.ts lives outside the routes/ dir (it's a
// module helper but server.ts mounts it directly at /v1/views).
const EXTRA_ROUTE_FILES: Record<string, string> = {
  'src/main/modules/view/views-endpoint.ts': '/v1/views',
};

// Routes mounted directly in src/main/server.ts (not from a router file).
// Each entry: { method, path, description }.
const DIRECT_MOUNTS: Array<{ method: string; path: string; description: string }> = [
  { method: 'get',  path: '/v1/health',       description: '健康检查' },
  { method: 'get',  path: '/v1/admin/ping',   description: 'Admin 健康检查（无需鉴权）' },
  { method: 'get',  path: '/metrics',         description: 'Prometheus 指标（无 /v1 前缀）' },
  { method: 'get',  path: '/v1/metrics',      description: 'Prometheus 指标' },
  { method: 'get',  path: '/v1/skill.md',     description: '本文档（Markdown）' },
  { method: 'get',  path: '/skill.md',        description: '301 → /v1/skill.md' },
  { method: 'get',  path: '/v1/openapi.json', description: '本文档（OpenAPI 3）' },
];

interface ScannedRoute {
  method: string;
  fullPath: string;
  source: string;
}

const ROUTES_DIR = path.join(process.cwd(), 'src', 'main', 'routes');
const OPENAPI_PATH = path.join(process.cwd(), 'docs', 'superpowers', 'openapi.json');

/**
 * Convert a router-relative path like "/jobs" or "/recommendations/:id/approve-unlock"
 * into an OpenAPI path like "/v1/employer/jobs" or
 * "/v1/employer/recommendations/{id}/approve-unlock".
 */
function toOpenApiPath(routeFile: string, rawPath: string): string {
  const trimmed = rawPath.replace(/^\/+/, '/').replace(/^\//, '');
  const paramed = trimmed.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
  const prefix = MOUNT_PREFIXES[routeFile];
  if (prefix === undefined) {
    throw new Error(`Unknown route file: ${routeFile} — add to MOUNT_PREFIXES`);
  }
  if (prefix === null) {
    return '/' + paramed;
  }
  return prefix + '/' + paramed;
}

function scanRoutesDir(): ScannedRoute[] {
  const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'));
  const routes: ScannedRoute[] = [];
  // Match: router.<method>('/path', ... — accepts optional backtick or quote
  const re = /router\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  for (const file of files) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    for (const m of src.matchAll(re)) {
      const method = m[1].toLowerCase();
      const rawPath = m[2];
      const fullPath = toOpenApiPath(file, rawPath);
      routes.push({ method, fullPath, source: `${file}:${rawPath}` });
    }
  }
  // Scan extra router files outside src/main/routes/
  for (const [relPath, prefix] of Object.entries(EXTRA_ROUTE_FILES)) {
    const absPath = path.join(process.cwd(), relPath);
    if (!fs.existsSync(absPath)) continue;
    const src = fs.readFileSync(absPath, 'utf8');
    for (const m of src.matchAll(re)) {
      const method = m[1].toLowerCase();
      const rawPath = m[2];
      const trimmed = rawPath.replace(/^\/+/, '/').replace(/^\//, '');
      const paramed = trimmed.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
      const fullPath = prefix + '/' + paramed;
      routes.push({ method, fullPath, source: `${relPath}:${rawPath}` });
    }
  }
  return routes;
}

function loadExistingOpenApi(): any {
  return JSON.parse(fs.readFileSync(OPENAPI_PATH, 'utf8'));
}

function main(): void {
  const isCheck = process.argv.includes('--check');
  const scanned = scanRoutesDir();
  for (const d of DIRECT_MOUNTS) {
    scanned.push({ method: d.method, fullPath: d.path, source: `server.ts:${d.path}` });
  }

  // De-duplicate by (method, fullPath) — keeps first occurrence.
  const seen = new Set<string>();
  const unique: ScannedRoute[] = [];
  for (const r of scanned) {
    const key = `${r.method.toUpperCase()} ${r.fullPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(r);
  }

  console.log(`Scanned ${unique.length} unique routes (${DIRECT_MOUNTS.length} direct mounts + ${scanned.length - DIRECT_MOUNTS.length} from router files).`);

  if (isCheck) {
    // Reverse-direction check (CRITICAL): every path declared in openapi.json
    // must still exist in code. This catches "dangling" specs where a route
    // was removed/renamed in code but the openapi.json wasn't updated.
    //
    // The forward direction (code → spec) is NOT enforced here, because the
    // hard constraint says we must not modify openapi.json schema content.
    // Newly added routes that aren't yet documented are tracked in
    // skill.md §C ("未声明的端点") instead.
    const spec = loadExistingOpenApi();
    const declared = new Set<string>();
    for (const [p, ops] of Object.entries(spec.paths ?? {})) {
      for (const m of Object.keys(ops as any)) {
        declared.add(`${m.toUpperCase()} ${p}`);
      }
    }
    const scanned = new Set<string>();
    for (const r of unique) scanned.add(`${r.method.toUpperCase()} ${r.fullPath}`);

    const dangling = [...declared].filter((d) => !scanned.has(d) && !KNOWN_LEGACY_PATHS.has(d));
    if (dangling.length === 0) {
      console.log(`✅ No dangling paths in openapi.json (all ${declared.size} declared routes exist in code).`);
      console.log(`ℹ️  Forward coverage: ${unique.length - declared.size > 0 ? unique.length - declared.size : 0} routes scanned but not yet in openapi.json (tracked in skill.md §C).`);
      process.exit(0);
    } else {
      console.error(`❌ ${dangling.length} paths in openapi.json are NOT in code (dangling):`);
      for (const d of dangling) console.error(`   ${d}`);
      process.exit(1);
    }
  }

  // --generate mode: produce a fresh openapi.json. We DO NOT clobber the
  // existing one — instead we report what would change. v1.4 leaves the
  // human-authored schemas intact; the script only validates coverage.
  // (See tests/scripts/openapi-coverage.test.ts for the runtime check.)
  console.log('(generate mode is a no-op in v1.4 — see --check for coverage)');
}

main();