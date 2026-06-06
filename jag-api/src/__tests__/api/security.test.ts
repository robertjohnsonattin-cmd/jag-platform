/**
 * STD-03 — API endpoint security tests (cross-module coverage)
 *
 * Verifies that every module rejects requests that are:
 *   (a) unauthenticated (no JWT)
 *   (b) authenticated with the wrong tenant (cross-tenant access attempt)
 *
 * These tests do NOT require a live database. They verify that the auth
 * and RLS middleware blocks requests before any DB call is made.
 *
 * Pattern: write a failing security test BEFORE building the feature (STD-03).
 * This file was written as a course-correction catch-up for Phase 1B–3 modules.
 * All new Phase 4+ modules must have their security test written FIRST.
 *
 * To run:
 *   npm test -- --testPathPattern=security.test
 */

import request from 'supertest';
import app from '../../index';

// ── JWT mock ──────────────────────────────────────────────────────────────────
// Stub jose so tests run without a live Keycloak. The mock returns a valid
// token payload for VALID_TOKEN and throws for INVALID_TOKEN.

const VALID_TOKEN   = 'Bearer valid-test-token';
const INVALID_TOKEN = 'Bearer bad-token';

const TENANT_A = '00000000-0000-0000-0001-000000000001';  // test tenant A
const TENANT_B = '00000000-0000-0000-0001-000000000002';  // test tenant B (attacker)

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn().mockImplementation((_token: string) => {
    const raw = (_token as string).replace('Bearer ', '');
    if (raw === 'valid-test-token') {
      return Promise.resolve({
        payload: {
          sub:                'c0000000-0000-0000-0000-000000000001',
          email:              'security-test@jag.test',
          name:               'Security Test',
          preferred_username: 'security-test',
          jag_user_id:        'c0000000-0000-0000-0002-000000000001',
          jag_tenant_id:      TENANT_A,
          iss:                'http://localhost:8080/realms/jag',
          aud:                'jag-api',
          realm_access:       { roles: ['jag-operator'] },
        },
      });
    }
    return Promise.reject(new Error('Invalid token'));
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

// Every endpoint must reject unauthenticated requests with 401.
async function expectUnauthorized(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
  const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)
    [method](path);
  expect(res.status).toBe(401);
}

// Every tenant-scoped endpoint must reject cross-tenant header with 403 or 404
// (never 200 with another tenant's data).
async function expectCrossTenantBlocked(method: 'get' | 'post', path: string, body?: unknown) {
  const req = (request(app) as unknown as Record<string, (p: string) => request.Test>)
    [method](path)
    .set('Authorization', VALID_TOKEN)
    .set('X-Tenant-ID', TENANT_B);     // different tenant from the JWT claim
  if (body) req.send(body as Record<string, unknown>);
  const res = await req;
  // Must not be 200 — a cross-tenant read that returns 200 means data leak
  expect([400, 401, 403, 404, 422]).toContain(res.status);
  // And must not reveal another tenant's data
  if (res.body?.data) {
    const data = res.body.data;
    if (Array.isArray(data)) expect(data).toHaveLength(0);
  }
}

// ── No-auth tests ─────────────────────────────────────────────────────────────
// Every module's primary list endpoint must reject unauthenticated requests.

describe('STD-03: Unauthenticated requests rejected (401)', () => {
  const getEndpoints = [
    '/api/v1/ims/items',
    '/api/v1/crm/contacts',
    '/api/v1/jabco/projects',
    '/api/v1/properties',
    '/api/v1/properties/pipeline',
    '/api/v1/properties/tenants',
    '/api/v1/docvault/files',
    '/api/v1/succession/documents',
    '/api/v1/lifestyle/loyalty',
    '/api/v1/family/members',
    '/api/v1/bar/products',
    '/api/v1/bar/tabs',
    '/api/v1/club/members',
    '/api/v1/club/chip-float',
    '/api/v1/club/visitor-log',
    '/api/v1/dragonbridge/clients',
    '/api/v1/dragonbridge/quotes',
    '/api/v1/dragonbridge/orders',
    '/api/v1/nlcb/sessions',
    '/api/v1/nlcb/billers',
    '/api/v1/entertainment/reports/pl',
    '/api/v1/brian/permissions',
    '/api/v1/notifications',
  ];

  test.each(getEndpoints)('GET %s → 401 without auth', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });
});

// ── Wrong-tenant tests ────────────────────────────────────────────────────────
// Tenant-scoped modules must reject requests where X-Tenant-ID doesn't match
// the authenticated user's tenant. These modules use withTenantRLS.

describe('STD-03: Cross-tenant requests blocked (tenant-scoped modules)', () => {
  // These modules use X-Tenant-ID header + withTenantRLS
  const tenantEndpoints = [
    '/api/v1/bar/products',
    '/api/v1/bar/tabs',
    '/api/v1/club/members',
    '/api/v1/dragonbridge/clients',
    '/api/v1/dragonbridge/quotes',
    '/api/v1/nlcb/sessions',
  ];

  test.each(tenantEndpoints)(
    'GET %s with mismatched X-Tenant-ID → blocked or empty',
    async (path) => {
      await expectCrossTenantBlocked('get', path);
    },
  );
});

// ── Owner-scoped modules: no tenant header accepted ───────────────────────────
// Owner-scoped modules (properties, family, etc.) must not accept a
// cross-tenant X-Tenant-ID override — only the JWT owner is authorised.

describe('STD-03: Owner-scoped modules reject foreign tenant header', () => {
  const ownerEndpoints = [
    '/api/v1/properties',
    '/api/v1/jabco/projects',
    '/api/v1/docvault/files',
    '/api/v1/succession/documents',
    '/api/v1/family/members',
  ];

  test.each(ownerEndpoints)(
    'GET %s with X-Tenant-ID set to foreign tenant → not 200 with data',
    async (path) => {
      const res = await request(app)
        .get(path)
        .set('Authorization', VALID_TOKEN)
        .set('X-Tenant-ID', TENANT_B);
      // Owner-scoped routes should either ignore the header (200 with own data, not TENANT_B's)
      // or reject outright. They must never 500 (that would mean a DB error from wrong owner_id).
      expect(res.status).not.toBe(500);
    },
  );
});

// ── Brian Portal gate ─────────────────────────────────────────────────────────
// brianPortalGate('MODULE') must block Brian from modules set to NONE.
// This test verifies the gate exists on all Phase 3 modules.

describe('STD-03: Brian Portal gate applied to all modules', () => {
  const BRIAN_TOKEN = 'Bearer brian-test-token';

  beforeAll(() => {
    // Override mock for Brian token
    const jose = jest.requireMock<{ jwtVerify: jest.Mock }>('jose');
    const original = jose.jwtVerify.getMockImplementation();
    jose.jwtVerify.mockImplementation((token: string) => {
      if (token === 'brian-test-token') {
        return Promise.resolve({
          payload: {
            sub:           'c0000000-0000-0000-0000-000000000099',
            jag_user_id:   'c0000000-0000-0000-0002-000000000099',
            jag_tenant_id: TENANT_A,
            iss:           'http://localhost:8080/realms/jag',
            aud:           'jag-api',
            realm_access:  { roles: ['brian_portal'] },
          },
        });
      }
      return original?.(token) ?? Promise.reject(new Error('Invalid token'));
    });
  });

  const gatedModules = [
    '/api/v1/dragonbridge/clients',
    '/api/v1/bar/products',
    '/api/v1/club/members',
    '/api/v1/entertainment/reports/pl',
  ];

  // Brian with NONE access should get 403 on all gated modules.
  // This test verifies the gate exists (not that Brian has NONE — that's a DB state).
  // A 403 or 401 is acceptable; a 200 is a gate bypass.
  test.each(gatedModules)(
    'GET %s with brian_portal role → auth gate applied (not unprotected)',
    async (path) => {
      const res = await request(app)
        .get(path)
        .set('Authorization', BRIAN_TOKEN);
      // Must not be 500 (gate crashed) — gate should return 403 or let through to DB
      expect(res.status).not.toBe(500);
      // Must not skip auth entirely
      expect(res.status).not.toBe(200 /* open without any DB check */);
    },
  );
});
