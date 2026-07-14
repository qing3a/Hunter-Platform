// tests/unit/capabilities/alias-lookup.test.ts
// R1.C4 — Capability alias resolution for external skill naming schemes.
//
// Verifies the contract that an external client (e.g. ow-recruit) can look
// up a hunter-platform capability by either:
//   - the canonical `name` (e.g. `candidate_portal.messages.send`), or
//   - any of the declared aliases (e.g. `ow_recruit.send_message`).
import { describe, it, expect } from 'vitest';

import {
  findCapabilityByAlias,
  findCapabilityByEndpoint,
  getAllCapabilitySets,
} from '../../../src/main/capabilities';

describe('R1.C4 capability alias lookup', () => {
  it('resolves the ow-recruit send-message skill to the canonical endpoint', () => {
    const cap = findCapabilityByAlias('ow_recruit.send_message');
    expect(cap).toBeDefined();
    expect(cap?.name).toBe('candidate_portal.messages.send');
    expect(cap?.method).toBe('POST');
    expect(cap?.path).toBe('/v1/candidate-portal/messages');
  });

  it('resolves the ow-recruit sync-project-to-erp skill', () => {
    const cap = findCapabilityByAlias('ow_recruit.sync_project_to_erp');
    expect(cap).toBeDefined();
    expect(cap?.name).toBe('pm.update_project');
    expect(cap?.method).toBe('PATCH');
  });

  it('resolves the ow-recruit advance-candidate skill', () => {
    const cap = findCapabilityByAlias('ow_recruit.advance_candidate');
    expect(cap).toBeDefined();
    expect(cap?.name).toBe('pm.select_staffing_plan');
    expect(cap?.path).toBe('/v1/pm/staffing-plans/:id/select');
  });

  it('also resolves canonical names (alias lookup is a superset of name lookup)', () => {
    const cap = findCapabilityByAlias('candidate_portal.messages.send');
    expect(cap).toBeDefined();
    expect(cap?.name).toBe('candidate_portal.messages.send');
  });

  it('returns undefined for an unknown alias', () => {
    expect(findCapabilityByAlias('ow_recruit.does_not_exist')).toBeUndefined();
    expect(findCapabilityByAlias('random.skill.name')).toBeUndefined();
  });

  it('aliases are declared on the canonical capability (not duplicate entries)', () => {
    const allCaps = getAllCapabilitySets().flatMap((s) => s.capabilities);
    // Each capability name must be unique across the set.
    const names = new Set<string>();
    for (const cap of allCaps) {
      expect(names.has(cap.name), `duplicate name ${cap.name}`).toBe(false);
      names.add(cap.name);
    }
    // Each alias should map to one and only one capability.
    const aliasOwners = new Map<string, string>();
    for (const cap of allCaps) {
      for (const a of cap.aliases ?? []) {
        const prev = aliasOwners.get(a);
        expect(prev, `alias '${a}' declared on both ${prev} and ${cap.name}`).toBeUndefined();
        aliasOwners.set(a, cap.name);
      }
    }
  });

  it('canonical-name lookup via findCapabilityByEndpoint still works (regression check)', () => {
    // pm.update_project is PATCH /v1/pm/projects/:id — the matching method
    // matters. A wrong-method call should return undefined.
    const cap = findCapabilityByEndpoint('PATCH', '/v1/pm/projects/abc123');
    expect(cap).toBeDefined();
    expect(cap?.name).toBe('pm.update_project');
    // Aliases are surfaced — a future /v1/capabilities/by-alias route can reuse them.
    expect(cap?.aliases).toContain('ow_recruit.sync_project_to_erp');
  });
});
