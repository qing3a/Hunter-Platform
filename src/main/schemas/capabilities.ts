// src/main/schemas/capabilities.ts
// Schemas for the capability discovery endpoints (Phase 4):
//   GET /v1/capabilities           — public, lists all capability sets
//   GET /v1/capabilities/me        — auth, this user's available capabilities
//
// These are the source-of-truth shapes for the API contract. The
// conformance tests in tests/integration/skill-md-conformance/capabilities.test.ts
// import these schemas directly to validate response shape.

import { z } from 'zod';
import { EnvelopeSchema } from './common.js';

const CapabilitySummarySchema = z.object({
  name: z.string(),
  description: z.string(),
  // Mirrors the `method` union in src/main/capabilities/types.ts.
  // PM Workbench (Phase 3b / Task 1b) added PATCH for pm.update_project /
  // pm.update_position; the schema has to accept every HTTP verb the
  // capability set declares, otherwise GET /v1/capabilities blows up at
  // zod validation time with `Invalid enum value. Expected ... 'PATCH'`.
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string(),
  quota_cost: z.number().int(),
  preconditions: z.array(z.string()),
  effects: z.array(z.string()),
});

export const CapabilitiesResponseSchema = EnvelopeSchema(
  z.object({
    sets: z.array(
      z.object({
        role: z.string(),
        capabilities: z.array(CapabilitySummarySchema),
      })
    ),
  })
);

const MeCapabilityItemSchema = z.object({
  name: z.string(),
  description: z.string(),
  method: z.string(),
  path: z.string(),
  quota_cost: z.number().int(),
  available: z.boolean(),
  /** Present only when available: false. One of:
   *  'INSUFFICIENT_QUOTA' | 'FORBIDDEN' | 'NOT_FOUND' (from canInvoke predicate) */
  reason: z.string().optional(),
});

export const MeCapabilitiesResponseSchema = EnvelopeSchema(
  z.object({
    user_id: z.string(),
    user_type: z.string(),
    status: z.string(),
    quota_per_day: z.number().int(),
    quota_used: z.number().int(),
    quota_remaining: z.number().int(),
    capabilities: z.array(MeCapabilityItemSchema),
  })
);
