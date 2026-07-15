/**
 * pnpm capabilities:check — fail if any route in src/main/routes/ has
 * a router.<method>('/path', ...) but no matching capability declaration
 * in src/main/capabilities/*.ts. Or vice versa: capability declared but
 * no matching route.
 *
 * Output format (one line per issue, exit code 1 on any issue):
 *   ROUTE_WITHOUT_CAPABILITY: METHOD /path
 *   CAPABILITY_WITHOUT_ROUTE:  name (declared METHOD /path)
 *
 * Exit 0 on clean state. Final line: OK: N routes, M capabilities.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findCapabilityByEndpoint,
  getAllCapabilitySets,
  type Capability,
} from '../src/main/capabilities/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROUTES_DIR = path.join(__dirname, '../src/main/routes');

// Files that are NOT business endpoints (no capability declaration expected).
//   - capabilities.ts itself serves the discovery endpoint
//   - landing.ts is the public marketplace landing page (no auth, no quota)
//   - users.ts: user self-service infra (/users/:id/status, /users/:id/history)
//   - config.ts: dynamic config read (/config/*)
//   - market.ts: public job browse (/market/*)
// Phase 4 declares capabilities for 4 role files only (auth, headhunter, employer,
// candidate, admin). If we add user-facing capabilities to these infra endpoints
// in a future phase, remove them from SKIP_FILES.
const SKIP_FILES = new Set([
  'capabilities.ts',
  'landing.ts',
  'users.ts',
  'config.ts',
  'market.ts',
]);

// Mount prefixes — mirrors scripts/generate-openapi.ts MOUNT_PREFIXES.
// Routes inside a router file are declared relative to the prefix (e.g. auth.ts
// uses '/register', mounted under '/v1/auth' → effective path '/v1/auth/register').
// `null` means the router is mounted at root and uses full paths internally
// (capabilities.ts uses '/v1/capabilities' directly; landing uses '/').
const MOUNT_PREFIXES: Record<string, string | null> = {
  'auth.ts':                  '/v1/auth',
  'users.ts':                 '/v1/users',
  'config.ts':                '/v1/config',
  'market.ts':                '/v1/market',
  'headhunter.ts':            '/v1/headhunter',
  'employer.ts':              '/v1/employer',
  'candidate.ts':             '/v1/candidate',
  'admin.ts':                 '/v1/admin',
  'capabilities.ts':          null,
  'notifications.ts':         '/v1/notifications',
  'landing.ts':               null,
  'candidate-portal.ts':      '/v1/candidate-portal',
  'headhunter-workspace.ts':  '/v1/headhunter-workspace',
  'pm.ts':                    '/v1/pm',
  'employer-panel.ts':        '/v1/employer-panel',
  'webhooks-inbox.ts':        '/v1/webhooks',
};

// Match router.get('/path', ...) etc. — accepts single, double, or backtick quotes.
const ROUTE_RE = /router\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

interface ScannedRoute {
  method: string;
  path: string;
  file: string;
}

function applyMountPrefix(file: string, rawPath: string): string {
  const prefix = MOUNT_PREFIXES[file];
  if (prefix === undefined) {
    throw new Error(`Unknown route file: ${file} — add to MOUNT_PREFIXES`);
  }
  // Strip leading slash from rawPath, then join
  const trimmed = rawPath.replace(/^\/+/, '');
  if (prefix === null) {
    return '/' + trimmed;
  }
  // Empty path (router.get('/', ...)) means the mount itself is the route —
  // return prefix without trailing slash so the capability check compares
  // "/v1/notifications" to "/v1/notifications" (not "/v1/notifications/").
  if (trimmed === '') return prefix;
  return prefix + '/' + trimmed;
}

function extractRoutes(): ScannedRoute[] {
  const routes: ScannedRoute[] = [];
  for (const file of fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'))) {
    if (SKIP_FILES.has(file)) continue;
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    for (const m of src.matchAll(ROUTE_RE)) {
      routes.push({
        method: m[1].toUpperCase(),
        path: applyMountPrefix(file, m[2]),
        file,
      });
    }
  }
  return routes;
}

interface DeclaredCapability {
  name: string;
  method: string;
  path: string;
}

function declaredCapabilities(): DeclaredCapability[] {
  const out: DeclaredCapability[] = [];
  for (const set of getAllCapabilitySets()) {
    for (const cap of set.capabilities as Capability[]) {
      out.push({ name: cap.name, method: cap.method, path: cap.path });
    }
  }
  return out;
}

const routes = extractRoutes();
const caps = declaredCapabilities();

let issues = 0;

// 1. Route without capability
for (const r of routes) {
  if (!findCapabilityByEndpoint(r.method, r.path)) {
    console.error(`ROUTE_WITHOUT_CAPABILITY: ${r.method} ${r.path} (${r.file})`);
    issues++;
  }
}

// 2. Capability without route — match by method + path (with :param regex)
for (const c of caps) {
  const exactMatch = routes.find((r) => r.method === c.method && r.path === c.path);
  if (exactMatch) continue;
  const pattern = '^' + c.path.replace(/:[a-zA-Z_]+/g, '[^/]+') + '$';
  const regex = new RegExp(pattern);
  const paramMatch = routes.find((r) => r.method === c.method && regex.test(r.path));
  if (!paramMatch) {
    console.error(`CAPABILITY_WITHOUT_ROUTE: ${c.name} declared ${c.method} ${c.path}`);
    issues++;
  }
}

if (issues > 0) {
  console.error(`\n${issues} issue(s) found.`);
  process.exit(1);
} else {
  console.log(`OK: ${routes.length} routes, ${caps.length} capabilities.`);
}