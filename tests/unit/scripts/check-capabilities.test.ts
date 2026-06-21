import { describe, it, expect } from 'vitest';
import { findCapabilityByEndpoint, getAllCapabilitySets } from '../../../src/main/capabilities';

describe('capabilities:check script invariants', () => {
  it('every declared capability has a unique name', () => {
    const all = getAllCapabilitySets();
    const names = new Set<string>();
    for (const set of all) {
      for (const cap of set.capabilities) {
        expect(names.has(cap.name), `Duplicate capability name: ${cap.name}`).toBe(false);
        names.add(cap.name);
      }
    }
  });

  it('every declared capability has a non-empty path starting with /v1/', () => {
    const all = getAllCapabilitySets();
    for (const set of all) {
      for (const cap of set.capabilities) {
        expect(cap.path.startsWith('/v1/'), `${cap.name} has invalid path: ${cap.path}`).toBe(true);
      }
    }
  });

  it('findCapabilityByEndpoint finds declared capabilities', () => {
    const found = findCapabilityByEndpoint('POST', '/v1/auth/register');
    expect(found).toBeDefined();
    expect(found!.name).toBe('auth.register');
  });

  it('findCapabilityByEndpoint returns undefined for unknown paths', () => {
    expect(findCapabilityByEndpoint('GET', '/v1/nonexistent')).toBeUndefined();
    expect(findCapabilityByEndpoint('GET', '/v1/health')).toBeUndefined();
  });
});