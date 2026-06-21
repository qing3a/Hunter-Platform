// Aggregator + lookup helpers. Phase 4 single source of truth for
// capability declarations. Used by:
//   - capability-resolver middleware (Task 5) → req._capability
//   - /v1/capabilities endpoint (Task 7)
//   - /v1/capabilities/me endpoint (Task 7)
//   - capabilities:check script (Task 8)
//   - capabilities:doc script (Task 9)
export { type Capability, type CapabilitySet, defineCapabilitySet, canInvoke, canInvokeError } from './types.js';
export { headhunterCapabilities } from './headhunter.js';
export { employerCapabilities } from './employer.js';
export { candidateCapabilities } from './candidate.js';
export { adminCapabilities } from './admin.js';
export { authCapabilities } from './auth.js';

import { headhunterCapabilities } from './headhunter.js';
import { employerCapabilities } from './employer.js';
import { candidateCapabilities } from './candidate.js';
import { adminCapabilities } from './admin.js';
import { authCapabilities } from './auth.js';
import type { Capability, CapabilitySet } from './types.js';

const ALL_SETS: CapabilitySet[] = [
  headhunterCapabilities, employerCapabilities, candidateCapabilities, adminCapabilities, authCapabilities,
];

/** Look up a capability by HTTP method + path. Returns undefined if not
 *  declared. Used by capability-resolver middleware to attach
 *  `req._capability` to every request. */
export function findCapabilityByEndpoint(method: string, path: string): Capability | undefined {
  // Normalize path: strip query string, collapse trailing slash
  const normalized = (path.split('?')[0] ?? path).replace(/\/$/, '');
  for (const set of ALL_SETS) {
    for (const cap of set.capabilities) {
      if (cap.method !== method.toUpperCase()) continue;
      if (matchPath(cap.path, normalized)) return cap;
    }
  }
  return undefined;
}

/** Match a declared path with `:param` placeholders against an actual
 *  request path. e.g. '/v1/headhunter/candidates/:id/publish-to-pool'
 *  matches '/v1/headhunter/candidates/abc123/publish-to-pool'. */
function matchPath(pattern: string, actual: string): boolean {
  const patternParts = pattern.split('/');
  const actualParts = actual.split('/');
  if (patternParts.length !== actualParts.length) return false;
  return patternParts.every((p, i) => p.startsWith(':') || p === actualParts[i]);
}

/** All capability sets, for the `/v1/capabilities` endpoint. */
export function getAllCapabilitySets(): CapabilitySet[] {
  return ALL_SETS;
}

/** Get the capability set for a specific role. */
export function getCapabilitiesForRole(role: string): CapabilitySet | undefined {
  return ALL_SETS.find((s) => s.role === role);
}