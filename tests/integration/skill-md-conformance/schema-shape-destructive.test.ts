// tests/integration/skill-md-conformance/schema-shape-destructive.test.ts
//
// Tests for capabilities with destructive side-effects that would corrupt
// the shared beforeAll state if run inside the main schema-shape file.
// Each test gets its own fresh DB.
//
// Side-effect behavior itself is covered by dedicated test files in this
// directory (e.g. auth.test.ts). These tests verify only the RESPONSE
// SHAPE matches the declared zod schema.
import { describe, it, expect } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';
import { RotateKeyResponseSchema } from '../../../src/main/schemas/auth';
import { DeleteMyDataResponseSchema } from '../../../src/main/schemas/candidate';

describe('schema-shape: destructive side-effects (per-test fresh DB)', () => {
  it('auth.rotate_key: POST /v1/auth/rotate-key returns new_api_key/new_prefix (schema match)', async () => {
    const f = await freshApp('shape-destr-rotate');
    try {
      const client = new ConformanceClient(f.app);
      const reg = await client.request({
        method: 'POST', path: '/v1/auth/register',
        body: { user_type: 'candidate', name: 'DestrRotate', contact: 'dr@x.com' },
      });
      expect(reg.status).toBe(200);
      const key = reg.data.data.api_key as string;
      const r = await client.request({
        method: 'POST', path: '/v1/auth/rotate-key', auth: key,
        schema: RotateKeyResponseSchema,
      });
      expect(r.status).toBe(200);
    } finally { cleanupDb('shape-destr-rotate'); }
  });

  it('candidate.delete_my_data: POST /v1/candidate/delete-my-data (schema match)', async () => {
    const f = await freshApp('shape-destr-delete');
    try {
      const client = new ConformanceClient(f.app);
      const reg = await client.request({
        method: 'POST', path: '/v1/auth/register',
        body: { user_type: 'candidate', name: 'DestrDel', contact: 'dd@x.com' },
      });
      const cKey = reg.data.data.api_key as string;
      const r = await client.request({
        method: 'POST', path: '/v1/candidate/delete-my-data', auth: cKey,
        schema: DeleteMyDataResponseSchema,
      });
      expect(r.status).toBe(200);
    } finally { cleanupDb('shape-destr-delete'); }
  });
});
