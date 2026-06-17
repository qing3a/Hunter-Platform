import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('OpenAPI documentation', () => {
  const openapiPath = path.join(__dirname, '../../docs/superpowers/openapi.json');

  it('openapi.json exists and is valid JSON', () => {
    expect(fs.existsSync(openapiPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
    expect(content.openapi).toBe('3.0.0');
    expect(content.paths['/v1/auth/register']).toBeDefined();
    expect(content.paths['/v1/employer/placements']).toBeDefined();
  });

  it('GET /v1/openapi.json returns 200 (server endpoint)', async () => {
    const request = (await import('supertest')).default;
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = path.join(__dirname, '../../tmp/openapi-test.db');
    process.env.NODE_ENV = 'test';
    try { fs.unlinkSync(process.env.DATABASE_PATH); } catch {}
    const { createApp } = await import('../../src/main/server');
    const app = createApp();
    const res = await request(app).get('/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
  });
});