/**
 * Integration tests — IMS endpoints (Group 3)
 *
 * Requires:
 *   DATABASE_URL_COMMERCIAL — jag_commercial pool
 *   DATABASE_URL_CORE       — jag_core pool (for audit log verification)
 *
 * Auth middleware is mocked — tests focus on business logic and RLS behaviour.
 * All test data uses UUIDs in the 'c0000000-*' range and is cleaned up in afterAll.
 */

import request from 'supertest';
import { Pool } from 'pg';
import app from '../../index';

const hasDb = !!(process.env.DATABASE_URL_COMMERCIAL && process.env.DATABASE_URL_CORE);

// ── Test fixture UUIDs ────────────────────────────────────────────────────────
const TEST_TENANT_ID   = '00000000-0000-0000-0001-000000000001'; // seeded JAG_HOLDINGS tenant
const TEST_USER_ID     = 'c36b9245-a819-4f6d-9a53-44026b573920'; // testuser synced in earlier tests
const TEST_LOCATION_ID = 'e5c60781-4fd6-42e9-9aae-7e038ce4264a'; // JABCO_YARD seeded location

// ── Mock auth middleware ───────────────────────────────────────────────────────
jest.mock('../../middleware/auth', () => ({
  requireAuth: () => (req: any, _res: any, next: any) => {
    req.rlsCtx = {
      userId:   TEST_USER_ID,
      tenantId: TEST_TENANT_ID,
      isOwner:  true,
      ownerId:  TEST_USER_ID,
    };
    next();
  },
}));

// ── Test suite ────────────────────────────────────────────────────────────────

describe('IMS endpoints', () => {
  let createdItemId: string;
  const IDEM_KEY = 'c0000000-face-4444-8888-000000000001';

  describe('GET /api/v1/ims/locations', () => {
    it('returns 200 with array', async () => {
      const res = await request(app)
        .get('/api/v1/ims/locations')
        .set('Authorization', 'Bearer mock');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/v1/ims/categories', () => {
    it('returns 200 with array', async () => {
      const res = await request(app)
        .get('/api/v1/ims/categories')
        .set('Authorization', 'Bearer mock');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('POST /api/v1/ims/items', () => {
    it('returns 422 when location_id is missing', async () => {
      const res = await request(app)
        .post('/api/v1/ims/items')
        .set('Authorization', 'Bearer mock')
        .send({ name: 'No location' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    (hasDb ? it : it.skip)('creates item and returns 201 with id', async () => {
      const res = await request(app)
        .post('/api/v1/ims/items')
        .set('Authorization', 'Bearer mock')
        .send({
          name:        'Test Hammer',
          location_id: TEST_LOCATION_ID,
          unit_of_measure: 'each',
          quantity_on_hand: 3,
          condition:   'GOOD',
        });
      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeTruthy();
      createdItemId = res.body.data.id;
    });
  });

  describe('GET /api/v1/ims/items/:id', () => {
    (hasDb ? it : it.skip)('returns item detail with tags/barcodes/vehicle fields', async () => {
      const res = await request(app)
        .get(`/api/v1/ims/items/${createdItemId}`)
        .set('Authorization', 'Bearer mock');
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(createdItemId);
      expect(Array.isArray(res.body.data.tags)).toBe(true);
      expect(Array.isArray(res.body.data.barcodes)).toBe(true);
    });

    it('returns 422 for invalid UUID', async () => {
      const res = await request(app)
        .get('/api/v1/ims/items/not-a-uuid')
        .set('Authorization', 'Bearer mock');
      expect(res.status).toBe(422);
    });
  });

  describe('POST /api/v1/ims/movements — idempotency (STD-11)', () => {
    (hasDb ? it : it.skip)('returns 201 on first movement, 200 on duplicate key', async () => {
      const body = {
        item_id:         createdItemId,
        movement_type:   'RECEIVE',
        quantity:        10,
        idempotency_key: IDEM_KEY,
        notes:           'Test receive',
      };

      const res1 = await request(app)
        .post('/api/v1/ims/movements')
        .set('Authorization', 'Bearer mock')
        .send(body);
      expect(res1.status).toBe(201);
      const movId = res1.body.data.id;

      // Duplicate — same idempotency_key.
      const res2 = await request(app)
        .post('/api/v1/ims/movements')
        .set('Authorization', 'Bearer mock')
        .send(body);
      expect(res2.status).toBe(200);
      expect(res2.body.data.id).toBe(movId); // same record returned
    });

    it('returns 422 when TRANSFER has no to_location_id', async () => {
      const res = await request(app)
        .post('/api/v1/ims/movements')
        .set('Authorization', 'Bearer mock')
        .send({
          item_id:         '00000000-0000-0000-0000-000000000001',
          movement_type:   'TRANSFER',
          quantity:        1,
          idempotency_key: '00000000-0000-0000-0000-999999999999',
        });
      expect(res.status).toBe(422);
    });

    it('returns 422 when idempotency_key is missing', async () => {
      const res = await request(app)
        .post('/api/v1/ims/movements')
        .set('Authorization', 'Bearer mock')
        .send({ item_id: TEST_LOCATION_ID, movement_type: 'RECEIVE', quantity: 1 });
      expect(res.status).toBe(422);
    });
  });

  // ── Vehicles — STD-13 dual-write (owner_entity ↔ fleet_type) ───────────────
  describe('POST + PATCH /api/v1/ims/vehicles — STD-13 dual-write', () => {
    let createdVehicleId: string;

    it('POST creates vehicle with owner_entity and fleet_type in sync', async () => {
      if (!hasDb) return;
      const res = await request(app)
        .post('/api/v1/ims/vehicles')
        .set('Authorization', 'Bearer mock')
        .send({
          name:                'STD-13 Test Truck',
          owner_entity:        'JABCO',
          registration_number: 'T13-0001',
          make:                'Toyota',
          model:               'Hilux',
          year:                2022,
          vehicle_type:        'TRUCK',
          fuel_type:           'DIESEL',
          service_interval_days: 90,
        });
      expect(res.status).toBe(201);
      createdVehicleId = res.body.data?.vehicle_id;
      expect(createdVehicleId).toBeTruthy();
    });

    it('GET returns matching owner_entity and fleet_type after POST', async () => {
      if (!hasDb || !createdVehicleId) return;
      const res = await request(app)
        .get('/api/v1/ims/vehicles')
        .set('Authorization', 'Bearer mock')
        .query({ registration_number: 'T13-0001' });
      expect(res.status).toBe(200);
      const v = res.body.data?.vehicles?.[0];
      expect(v).toBeTruthy();
      expect(v.owner_entity).toBe('JABCO');
      expect(v.fleet_type).toBe('JABCO');
    });

    it('PATCH owner_entity also updates fleet_type (STD-13 dual-write)', async () => {
      if (!hasDb || !createdVehicleId) return;
      const patchRes = await request(app)
        .patch(`/api/v1/ims/vehicles/${createdVehicleId}`)
        .set('Authorization', 'Bearer mock')
        .send({ owner_entity: 'JAG Properties' });
      expect(patchRes.status).toBe(200);

      const getRes = await request(app)
        .get('/api/v1/ims/vehicles')
        .set('Authorization', 'Bearer mock')
        .query({ registration_number: 'T13-0001' });
      expect(getRes.status).toBe(200);
      const v = getRes.body.data?.vehicles?.[0];
      expect(v.owner_entity).toBe('JAG Properties');
      expect(v.fleet_type).toBe('JAG Properties');
    });

    it('PATCH colour updates ims_vehicles (colour column on vehicle row, not item row)', async () => {
      if (!hasDb || !createdVehicleId) return;
      const patchRes = await request(app)
        .patch(`/api/v1/ims/vehicles/${createdVehicleId}`)
        .set('Authorization', 'Bearer mock')
        .send({ colour: 'Red' });
      expect(patchRes.status).toBe(200);

      const getRes = await request(app)
        .get('/api/v1/ims/vehicles')
        .set('Authorization', 'Bearer mock')
        .query({ registration_number: 'T13-0001' });
      expect(getRes.status).toBe(200);
      const v = getRes.body.data?.vehicles?.[0];
      expect(v.colour).toBe('Red');
    });

    afterAll(async () => {
      if (!hasDb || !createdVehicleId) return;
      const pool = new Pool({ connectionString: process.env.DATABASE_URL_COMMERCIAL });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [TEST_TENANT_ID]);
        const itemRow = await client.query(
          `SELECT item_id FROM ims_vehicles WHERE id = $1`, [createdVehicleId],
        );
        await client.query(`DELETE FROM ims_vehicles WHERE id = $1`, [createdVehicleId]);
        if (itemRow.rows[0]) {
          await client.query(`DELETE FROM ims_items WHERE id = $1`, [itemRow.rows[0].item_id]);
        }
        await client.query('COMMIT');
      } catch { await client.query('ROLLBACK'); }
      finally { client.release(); await pool.end(); }
    });
  });

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  afterAll(async () => {
    if (!hasDb || !createdItemId) return;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL_COMMERCIAL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [TEST_TENANT_ID]);
      await client.query(`DELETE FROM ims_stock_movements WHERE item_id = $1`, [createdItemId]);
      await client.query(`DELETE FROM ims_items WHERE id = $1`, [createdItemId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await pool.end();
    }
  });
});
