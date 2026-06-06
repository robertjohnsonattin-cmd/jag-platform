/**
 * Integration tests — POST /api/v1/auth/sync-user
 *
 * Tests the provisioning endpoint that is called on first login.
 * Requires:
 *   DATABASE_URL_CORE  — jag_core pool
 *   KEYCLOAK_URL       — internal KC URL for JWKS fetch
 *   KEYCLOAK_ISSUER_URL — public issuer in token (may differ)
 *
 * These tests stub JWT verification so no live Keycloak is required.
 * DB operations use the real jag_core pool (run against test DB, not production).
 */

import request from 'supertest';
import { Pool } from 'pg';
import app from '../../index';

// ── Skip gracefully if env not configured ─────────────────────────────────────
const hasDb = !!process.env.DATABASE_URL_CORE;

// ── Test fixture UUIDs ────────────────────────────────────────────────────────
const TEST_KEYCLOAK_ID = 'b0000000-0000-0000-0000-000000000001';
const TEST_EMAIL       = 'auth-test@jag.test';

// ── Helpers ───────────────────────────────────────────────────────────────────

// jose jwtVerify is mocked — tests verify endpoint behaviour, not JWKS network call.
// Values are inlined because jest.mock() is hoisted before const declarations.
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn().mockResolvedValue({
    payload: {
      sub:                'b0000000-0000-0000-0000-000000000001',
      email:              'auth-test@jag.test',
      name:               'Auth Test User',
      preferred_username: 'auth-test',
      iss:                'http://localhost:8080/realms/jag',
      aud:                'jag-api',
    },
  }),
}));

// ── Test suite ────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/sync-user', () => {
  let pool: Pool | null = null;

  beforeAll(async () => {
    if (!hasDb) return;
    pool = new Pool({ connectionString: process.env.DATABASE_URL_CORE });
  });

  afterAll(async () => {
    // Clean up test user.
    if (pool) {
      await pool.query(
        `DELETE FROM users WHERE keycloak_id = $1`, [TEST_KEYCLOAK_ID],
      );
      await pool.end();
    }
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).post('/api/v1/auth/sync-user');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TOKEN');
    expect(res.body.success).toBe(false);
  });

  it('returns 401 for a malformed Bearer token (mocked jwtVerify throws)', async () => {
    const { jwtVerify } = await import('jose');
    (jwtVerify as jest.Mock).mockRejectedValueOnce(new Error('invalid token'));

    const res = await request(app)
      .post('/api/v1/auth/sync-user')
      .set('Authorization', 'Bearer bad.token.here');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('returns 422 when request body has unexpected field (strict schema)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/sync-user')
      .set('Authorization', 'Bearer valid.mock.token')
      .send({ display_name: 'Test', unexpected_field: 'nope' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  (hasDb ? it : it.skip)(
    'creates user row on first call (201) and returns same user_id on second call (200)',
    async () => {
      const res1 = await request(app)
        .post('/api/v1/auth/sync-user')
        .set('Authorization', 'Bearer valid.mock.token')
        .send({});

      expect(res1.status).toBe(201);
      expect(res1.body.success).toBe(true);
      expect(res1.body.data.user_id).toBeTruthy();
      const userId = res1.body.data.user_id;

      // Idempotent — same user_id, 200 not 201.
      const res2 = await request(app)
        .post('/api/v1/auth/sync-user')
        .set('Authorization', 'Bearer valid.mock.token')
        .send({});

      expect(res2.status).toBe(200);
      expect(res2.body.data.user_id).toBe(userId);

      // Verify DB row.
      const dbRow = await pool!.query(
        `SELECT email, display_name FROM users WHERE id = $1`, [userId],
      );
      expect(dbRow.rows[0].email).toBe(TEST_EMAIL);
      expect(dbRow.rows[0].display_name).toBe('Auth Test User');
    },
  );
});
