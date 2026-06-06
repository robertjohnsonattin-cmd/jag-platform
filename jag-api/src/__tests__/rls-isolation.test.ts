/**
 * STD-03 — Cross-tenant RLS isolation integration tests.
 *
 * These are INTEGRATION tests. They require a live jag_core database connected
 * as the jag_app role (the same role used in production). Running them without
 * a database skips the suite gracefully — no failures.
 *
 * To run:
 *   DATABASE_URL_CORE=postgresql://jag_app:pw@localhost:5432/jag_core npm run test:rls
 *
 * What is tested:
 *   1. Tenant A user cannot read Tenant B rows (user_tenant_roles)
 *   2. Missing/empty RLS variable returns 0 rows (fail-closed)
 *   3. SET LOCAL is transaction-scoped — no leak between requests on same connection
 *   4. Owner bypass_rls sees all tenants in audit_log
 *   5. Non-owner sees only own-tenant + system audit entries
 *   6. User A cannot read User B notifications (user_isolation policy)
 *   7. Cross-tenant INSERT is rejected by the WITH CHECK policy
 *
 * Data isolation: all test records use fixed UUIDs in the 'a0000000-*' range.
 * The afterAll hook deletes them. NEVER run against a production database.
 */

import { Pool, type PoolClient } from 'pg';
import { withTenantRLS, withOwnerRLS, type RLSContext } from '../middleware/rls';

// ── Fixed test UUIDs ──────────────────────────────────────────────────────────
// Deterministic IDs make teardown simple and re-runs idempotent.
const ID = {
  tenantA:   'a0000000-0000-0000-0001-000000000001',
  tenantB:   'a0000000-0000-0000-0001-000000000002',
  roleOp:    'a0000000-0000-0000-0006-000000000001', // RLS_TEST_OPERATOR
  roleOwner: 'a0000000-0000-0000-0006-000000000002', // RLS_TEST_OWNER
  userA:     'a0000000-0000-0000-0002-000000000001',
  userB:     'a0000000-0000-0000-0002-000000000002',
  userOwner: 'a0000000-0000-0000-0002-000000000003',
  utrA:      'a0000000-0000-0000-0005-000000000001', // userA in tenantA
  utrB:      'a0000000-0000-0000-0005-000000000002', // userB in tenantB
  utrOwner:  'a0000000-0000-0000-0005-000000000003', // userOwner in tenantA
  notifA:    'a0000000-0000-0000-0003-000000000001',
  notifB:    'a0000000-0000-0000-0003-000000000002',
  auditTA:   'a0000000-0000-0000-0004-000000000001', // tenant A entry
  auditTB:   'a0000000-0000-0000-0004-000000000002', // tenant B entry
  auditSys:  'a0000000-0000-0000-0004-000000000003', // system entry (null tenant)
} as const;

// ── RLS context fixtures ──────────────────────────────────────────────────────
const ctxA: RLSContext = {
  userId: ID.userA, tenantId: ID.tenantA, isOwner: false, ownerId: ID.userA,
};
const ctxB: RLSContext = {
  userId: ID.userB, tenantId: ID.tenantB, isOwner: false, ownerId: ID.userB,
};
const ctxOwner: RLSContext = {
  userId: ID.userOwner, tenantId: ID.tenantA, isOwner: true, ownerId: ID.userOwner,
};

// ── Suite guard ───────────────────────────────────────────────────────────────
const DB_URL = process.env.DATABASE_URL_CORE;
const describe_ = DB_URL ? describe : describe.skip;

let pool: Pool;

// ─────────────────────────────────────────────────────────────────────────────

describe_('RLS isolation — jag_core (STD-03)', () => {

  // ── Test data setup ─────────────────────────────────────────────────────────

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });

    // roles — test-specific names avoid clashing with seeded production roles
    await pool.query(`
      INSERT INTO roles (id, name, description) VALUES
        ($1, 'RLS_TEST_OPERATOR', 'Auto-created by rls-isolation tests — safe to delete'),
        ($2, 'RLS_TEST_OWNER',    'Auto-created by rls-isolation tests — safe to delete')
      ON CONFLICT (id) DO NOTHING
    `, [ID.roleOp, ID.roleOwner]);

    // tenants + users — no RLS on these tables
    await pool.query(`
      INSERT INTO tenants (id, code, name) VALUES
        ($1, 'RLS_TEST_TENANT_A', 'RLS Test Tenant Alpha'),
        ($2, 'RLS_TEST_TENANT_B', 'RLS Test Tenant Bravo')
      ON CONFLICT (id) DO NOTHING
    `, [ID.tenantA, ID.tenantB]);

    await pool.query(`
      INSERT INTO users (id, keycloak_id, email, display_name) VALUES
        ($1, $1, 'rls-test-a@jag.test',     'RLS Test User A'),
        ($2, $2, 'rls-test-b@jag.test',     'RLS Test User B'),
        ($3, $3, 'rls-test-owner@jag.test', 'RLS Test Owner')
      ON CONFLICT (id) DO NOTHING
    `, [ID.userA, ID.userB, ID.userOwner]);

    // user_tenant_roles — RLS requires SET LOCAL before insert
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_tenant_id', ID.tenantA]);
      await c.query(`
        INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, granted_by) VALUES
          ($1, $2, $3, $4, $2),
          ($5, $6, $3, $7, $6)
        ON CONFLICT (id) DO NOTHING
      `, [ID.utrA, ID.userA, ID.tenantA, ID.roleOp,
          ID.utrOwner, ID.userOwner, ID.roleOwner]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_tenant_id', ID.tenantB]);
      await c.query(`
        INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, granted_by)
        VALUES ($1, $2, $3, $4, $2) ON CONFLICT (id) DO NOTHING
      `, [ID.utrB, ID.userB, ID.tenantB, ID.roleOp]);
      await c.query('COMMIT');

      // notification_queue — RLS on current_user_id
      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_user_id', ID.userA]);
      await c.query(`
        INSERT INTO notification_queue (id, user_id, tier, channel, title, body)
        VALUES ($1, $2, 1, 'IN_APP', 'RLS Test A', 'Notif for user A')
        ON CONFLICT (id) DO NOTHING
      `, [ID.notifA, ID.userA]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_user_id', ID.userB]);
      await c.query(`
        INSERT INTO notification_queue (id, user_id, tier, channel, title, body)
        VALUES ($1, $2, 1, 'IN_APP', 'RLS Test B', 'Notif for user B')
        ON CONFLICT (id) DO NOTHING
      `, [ID.notifB, ID.userB]);
      await c.query('COMMIT');

      // audit_log — tenantA entry, tenantB entry, system entry (null tenant_id)
      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_tenant_id', ID.tenantA]);
      await c.query(`
        INSERT INTO audit_log (id, tenant_id, entity, action) VALUES
          ($1, $2, 'RLSTest', 'CREATE') ON CONFLICT (id) DO NOTHING
      `, [ID.auditTA, ID.tenantA]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_tenant_id', ID.tenantB]);
      await c.query(`
        INSERT INTO audit_log (id, tenant_id, entity, action) VALUES
          ($1, $2, 'RLSTest', 'CREATE') ON CONFLICT (id) DO NOTHING
      `, [ID.auditTB, ID.tenantB]);
      await c.query('COMMIT');

      // System event — bypass_rls enables insert with null tenant_id
      await c.query('BEGIN');
      await c.query(`SET LOCAL app.bypass_rls = 'true'`);
      await c.query(`
        INSERT INTO audit_log (id, tenant_id, entity, action, source) VALUES
          ($1, NULL, 'RLSTest', 'STARTUP', 'SYSTEM') ON CONFLICT (id) DO NOTHING
      `, [ID.auditSys]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      // audit_log — bypass_rls sees all rows across both tenants
      await c.query('BEGIN');
      await c.query(`SET LOCAL app.bypass_rls = 'true'`);
      await c.query(`DELETE FROM audit_log WHERE id IN ($1,$2,$3)`,
        [ID.auditTA, ID.auditTB, ID.auditSys]);
      await c.query('COMMIT');

      // notification_queue — must set user context per user
      for (const [notifId, userId] of [[ID.notifA, ID.userA], [ID.notifB, ID.userB]]) {
        await c.query('BEGIN');
        await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_user_id', userId]);
        await c.query(`DELETE FROM notification_queue WHERE id = $1`, [notifId]);
        await c.query('COMMIT');
      }

      // user_tenant_roles — set tenant context per tenant
      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_tenant_id', ID.tenantA]);
      await c.query(`DELETE FROM user_tenant_roles WHERE id IN ($1,$2)`, [ID.utrA, ID.utrOwner]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_tenant_id', ID.tenantB]);
      await c.query(`DELETE FROM user_tenant_roles WHERE id = $1`, [ID.utrB]);
      await c.query('COMMIT');

      // No RLS on users and tenants
      await c.query(`DELETE FROM users WHERE id IN ($1,$2,$3)`,
        [ID.userA, ID.userB, ID.userOwner]);
      await c.query(`DELETE FROM tenants WHERE id IN ($1,$2)`, [ID.tenantA, ID.tenantB]);
      await c.query(`DELETE FROM roles WHERE id IN ($1,$2)`, [ID.roleOp, ID.roleOwner]);
    } finally {
      c.release();
    }
    await pool.end();
  });

  // ── 1. Tenant isolation — user_tenant_roles ─────────────────────────────────

  describe('withTenantRLS — tenant_isolation policy (user_tenant_roles)', () => {

    it('user A reads only their own tenant row', async () => {
      const client = await pool.connect();
      try {
        const { rows } = await withTenantRLS(client, ctxA, c =>
          c.query('SELECT id FROM user_tenant_roles WHERE id IN ($1,$2)', [ID.utrA, ID.utrB]),
        );
        expect(rows.map(r => r.id)).toContain(ID.utrA);
        expect(rows.map(r => r.id)).not.toContain(ID.utrB);
      } finally { client.release(); }
    });

    it('user B cannot read tenant A row — returns empty', async () => {
      const client = await pool.connect();
      try {
        const { rows } = await withTenantRLS(client, ctxB, c =>
          c.query('SELECT id FROM user_tenant_roles WHERE id = $1', [ID.utrA]),
        );
        expect(rows).toHaveLength(0);
      } finally { client.release(); }
    });

    it('fail-closed: empty current_tenant_id returns 0 rows', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL app.current_tenant_id = ''`);
        const { rows } = await client.query(
          'SELECT id FROM user_tenant_roles WHERE id IN ($1,$2)', [ID.utrA, ID.utrB],
        );
        await client.query('COMMIT');
        expect(rows).toHaveLength(0);
      } finally { client.release(); }
    });

    it('fail-closed: no current_tenant_id set returns 0 rows', async () => {
      // Fresh connection — no SET LOCAL at all
      const freshPool = new Pool({ connectionString: DB_URL });
      const client = await freshPool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'SELECT id FROM user_tenant_roles WHERE id IN ($1,$2)', [ID.utrA, ID.utrB],
        );
        await client.query('COMMIT');
        expect(rows).toHaveLength(0);
      } finally {
        client.release();
        await freshPool.end();
      }
    });

    it('SET LOCAL is transaction-scoped — does not leak to next request on same connection', async () => {
      const client = await pool.connect();
      try {
        // First request: set tenant A, verify we see it
        await withTenantRLS(client, ctxA, async c => {
          const { rows } = await c.query(
            `SELECT current_setting('app.current_tenant_id', true) AS tid`,
          );
          expect(rows[0].tid).toBe(ID.tenantA);
        });

        // After commit, setting must be gone — no leak
        const { rows } = await client.query(
          `SELECT current_setting('app.current_tenant_id', true) AS tid`,
        );
        // current_setting returns '' (empty) when not set in a non-transaction context
        expect(rows[0].tid ?? '').toBe('');
      } finally { client.release(); }
    });

    it('cross-tenant INSERT is rejected by WITH CHECK policy', async () => {
      // user A's context sets tenantA — attempting to insert a row for tenantB
      // must throw because the WITH CHECK (defaults to USING) rejects tenantB.
      const client = await pool.connect();
      try {
        await expect(
          withTenantRLS(client, ctxA, c =>
            c.query(`
              INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, granted_by)
              VALUES ($1, $2, $3, $4, $2)
            `, ['a0000000-0000-0000-0009-000000000001', ID.userB, ID.tenantB, ID.roleOp]),
          ),
        ).rejects.toThrow(/row.level security/i);
      } finally {
        client.release();
      }
    });
  });


  // ── 2. audit_log — three-clause policy ─────────────────────────────────────

  describe('withTenantRLS — audit_log (three-clause policy)', () => {

    it('tenant A user sees only own-tenant entries + system (null tenant_id) entries', async () => {
      const client = await pool.connect();
      try {
        const { rows } = await withTenantRLS(client, ctxA, c =>
          c.query('SELECT id FROM audit_log WHERE id IN ($1,$2,$3)',
            [ID.auditTA, ID.auditTB, ID.auditSys]),
        );
        const ids = rows.map(r => r.id);
        expect(ids).toContain(ID.auditTA);      // own tenant ✓
        expect(ids).toContain(ID.auditSys);     // system (tenant_id IS NULL) ✓
        expect(ids).not.toContain(ID.auditTB);  // other tenant ✗
      } finally { client.release(); }
    });

    it('tenant B user cannot see tenant A audit entries', async () => {
      const client = await pool.connect();
      try {
        const { rows } = await withTenantRLS(client, ctxB, c =>
          c.query('SELECT id FROM audit_log WHERE id = $1', [ID.auditTA]),
        );
        expect(rows).toHaveLength(0);
      } finally { client.release(); }
    });

    it('Owner with bypass_rls sees all tenants in audit_log', async () => {
      const client = await pool.connect();
      try {
        const { rows } = await withTenantRLS(client, ctxOwner, c =>
          c.query('SELECT id FROM audit_log WHERE id IN ($1,$2,$3)',
            [ID.auditTA, ID.auditTB, ID.auditSys]),
        );
        const ids = rows.map(r => r.id);
        expect(ids).toContain(ID.auditTA);   // own tenant ✓
        expect(ids).toContain(ID.auditTB);   // other tenant — Owner bypass ✓
        expect(ids).toContain(ID.auditSys);  // system ✓
      } finally { client.release(); }
    });

    it('Owner bypass_rls flag is NOT set when isOwner = false', async () => {
      const client = await pool.connect();
      try {
        // Non-owner context — bypass_rls must not be set
        await withTenantRLS(client, ctxA, async c => {
          const { rows } = await c.query(
            `SELECT current_setting('app.bypass_rls', true) AS bypass`,
          );
          expect(rows[0].bypass ?? '').not.toBe('true');
        });
      } finally { client.release(); }
    });
  });


  // ── 3. notification_queue — user_isolation policy ───────────────────────────

  describe('withTenantRLS — notification_queue (user_isolation policy)', () => {
    // notification_queue lives in jag_core — route handlers use withTenantRLS,
    // which also sets app.current_user_id alongside current_tenant_id.

    it('user A sees only their own notifications', async () => {
      const client = await pool.connect();
      try {
        const { rows } = await withTenantRLS(client, ctxA, c =>
          c.query('SELECT id FROM notification_queue WHERE id IN ($1,$2)',
            [ID.notifA, ID.notifB]),
        );
        expect(rows.map(r => r.id)).toContain(ID.notifA);
        expect(rows.map(r => r.id)).not.toContain(ID.notifB);
      } finally { client.release(); }
    });

    it('user B cannot read user A notifications', async () => {
      const client = await pool.connect();
      try {
        const { rows } = await withTenantRLS(client, ctxB, c =>
          c.query('SELECT id FROM notification_queue WHERE id = $1', [ID.notifA]),
        );
        expect(rows).toHaveLength(0);
      } finally { client.release(); }
    });
  });


  // ── 4. withOwnerRLS — owner_id scoping (simulated via current_owner_id) ─────

  describe('withOwnerRLS — current_owner_id isolation', () => {
    // withOwnerRLS is the production path for jag_family + jag_properties.
    // We simulate isolation using jag_core's notification_queue user_isolation
    // policy, which uses current_user_id — set by withOwnerRLS as ctx.userId.

    it('owner context isolates reads to the correct user', async () => {
      const client = await pool.connect();
      try {
        const { rows } = await withOwnerRLS(client, ctxA, c =>
          c.query('SELECT id FROM notification_queue WHERE id IN ($1,$2)',
            [ID.notifA, ID.notifB]),
        );
        expect(rows.map(r => r.id)).toEqual([ID.notifA]);
      } finally { client.release(); }
    });

    it('wrong owner_id returns 0 rows', async () => {
      // ctxB's ownerId = userB — must not see userA's data
      const client = await pool.connect();
      try {
        const { rows } = await withOwnerRLS(client, ctxB, c =>
          c.query('SELECT id FROM notification_queue WHERE id = $1', [ID.notifA]),
        );
        expect(rows).toHaveLength(0);
      } finally { client.release(); }
    });

    it('withOwnerRLS rolls back on error and releases transaction', async () => {
      const client = await pool.connect();
      await expect(
        withOwnerRLS(client, ctxA, async () => {
          throw new Error('intentional error');
        }),
      ).rejects.toThrow('intentional error');

      // Connection should still be usable after rollback
      const { rows } = await client.query('SELECT 1 AS ok');
      expect(rows[0].ok).toBe(1);
      client.release();
    });
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// jag_commercial — tenant_id RLS isolation
// ─────────────────────────────────────────────────────────────────────────────

const DB_URL_COMMERCIAL = process.env.DATABASE_URL_COMMERCIAL;
const describeCommercial = DB_URL_COMMERCIAL ? describe : describe.skip;

// Deterministic IDs for jag_commercial tests ('c' prefix avoids collision)
const COM = {
  tenantA: 'c0000000-0000-0000-0001-000000000001',
  tenantB: 'c0000000-0000-0000-0001-000000000002',
  catA:    'c0000000-0000-0000-0011-000000000001',
  catB:    'c0000000-0000-0000-0011-000000000002',
} as const;

describeCommercial('RLS isolation — jag_commercial (STD-03)', () => {
  let comPool: Pool;

  beforeAll(async () => {
    comPool = new Pool({ connectionString: DB_URL_COMMERCIAL });
    // ims_categories has no last_modified_by — simplest tenant-scoped table to use
    const c = await comPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_tenant_id', COM.tenantA]);
      await c.query(`
        INSERT INTO ims_categories (id, tenant_id, name)
        VALUES ($1, $2, 'RLS Test Category A')
        ON CONFLICT (id) DO NOTHING
      `, [COM.catA, COM.tenantA]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_tenant_id', COM.tenantB]);
      await c.query(`
        INSERT INTO ims_categories (id, tenant_id, name)
        VALUES ($1, $2, 'RLS Test Category B')
        ON CONFLICT (id) DO NOTHING
      `, [COM.catB, COM.tenantB]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (!comPool) return;
    const c = await comPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_tenant_id', COM.tenantA]);
      await c.query(`DELETE FROM ims_categories WHERE id = $1`, [COM.catA]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_tenant_id', COM.tenantB]);
      await c.query(`DELETE FROM ims_categories WHERE id = $1`, [COM.catB]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    await comPool.end();
  });

  const ctxComA: RLSContext = { userId: ID.userA, tenantId: COM.tenantA, isOwner: false, ownerId: ID.userA };
  const ctxComB: RLSContext = { userId: ID.userB, tenantId: COM.tenantB, isOwner: false, ownerId: ID.userB };

  it('tenant A reads only their IMS categories', async () => {
    const client = await comPool.connect();
    try {
      const { rows } = await withTenantRLS(client, ctxComA, c =>
        c.query('SELECT id FROM ims_categories WHERE id IN ($1,$2)', [COM.catA, COM.catB]),
      );
      expect(rows.map(r => r.id)).toContain(COM.catA);
      expect(rows.map(r => r.id)).not.toContain(COM.catB);
    } finally { client.release(); }
  });

  it('tenant B cannot read tenant A IMS categories', async () => {
    const client = await comPool.connect();
    try {
      const { rows } = await withTenantRLS(client, ctxComB, c =>
        c.query('SELECT id FROM ims_categories WHERE id = $1', [COM.catA]),
      );
      expect(rows).toHaveLength(0);
    } finally { client.release(); }
  });

  it('fail-closed: no tenant context returns 0 rows from ims_categories', async () => {
    const freshPool = new Pool({ connectionString: DB_URL_COMMERCIAL });
    const client = await freshPool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id FROM ims_categories WHERE id IN ($1,$2)', [COM.catA, COM.catB],
      );
      await client.query('COMMIT');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
      await freshPool.end();
    }
  });

  it('cross-tenant INSERT into ims_categories is rejected by WITH CHECK', async () => {
    const client = await comPool.connect();
    try {
      await expect(
        withTenantRLS(client, ctxComA, c =>
          c.query(`
            INSERT INTO ims_categories (id, tenant_id, name)
            VALUES ('c0000000-0000-0000-0099-000000000001', $1, 'Cross-tenant attack')
          `, [COM.tenantB]),
        ),
      ).rejects.toThrow(/row.level security/i);
    } finally { client.release(); }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// jag_entertainment — tenant_id RLS isolation + entity_tag constraint
// ─────────────────────────────────────────────────────────────────────────────

const DB_URL_ENT = process.env.DATABASE_URL_ENTERTAINMENT;
const describeEnt = DB_URL_ENT ? describe : describe.skip;

const ENT = {
  tenantA:  'e0000000-0000-0000-0001-000000000001',
  tenantB:  'e0000000-0000-0000-0001-000000000002',
  sessionA: 'e0000000-0000-0000-0020-000000000001',
  sessionB: 'e0000000-0000-0000-0020-000000000002',
  idemA:    'e1111111-0000-0000-0000-000000000001', // idempotency_key is uuid type
  idemB:    'e2222222-0000-0000-0000-000000000001',
} as const;

describeEnt('RLS isolation — jag_entertainment (STD-03)', () => {
  let entPool: Pool;

  beforeAll(async () => {
    entPool = new Pool({ connectionString: DB_URL_ENT });
    const c = await entPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_tenant_id', ENT.tenantA]);
      await c.query(`
        INSERT INTO ent_bar_sessions
          (id, tenant_id, entity_tag, session_date, opened_by, opening_float, idempotency_key)
        VALUES ($1, $2, 'BAR', CURRENT_DATE, $3, 0.00, $4)
        ON CONFLICT (id) DO NOTHING
      `, [ENT.sessionA, ENT.tenantA, ID.userA, ENT.idemA]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_tenant_id', ENT.tenantB]);
      await c.query(`
        INSERT INTO ent_bar_sessions
          (id, tenant_id, entity_tag, session_date, opened_by, opening_float, idempotency_key)
        VALUES ($1, $2, 'MEMBERS_CLUB', CURRENT_DATE, $3, 0.00, $4)
        ON CONFLICT (id) DO NOTHING
      `, [ENT.sessionB, ENT.tenantB, ID.userB, ENT.idemB]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (!entPool) return;
    const c = await entPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_tenant_id', ENT.tenantA]);
      await c.query(`DELETE FROM ent_bar_sessions WHERE id = $1`, [ENT.sessionA]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_tenant_id', ENT.tenantB]);
      await c.query(`DELETE FROM ent_bar_sessions WHERE id = $1`, [ENT.sessionB]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    await entPool.end();
  });

  const ctxEntA: RLSContext = { userId: ID.userA, tenantId: ENT.tenantA, isOwner: false, ownerId: ID.userA };
  const ctxEntB: RLSContext = { userId: ID.userB, tenantId: ENT.tenantB, isOwner: false, ownerId: ID.userB };

  it('tenant A sees only their bar sessions', async () => {
    const client = await entPool.connect();
    try {
      const { rows } = await withTenantRLS(client, ctxEntA, c =>
        c.query('SELECT id FROM ent_bar_sessions WHERE id IN ($1,$2)', [ENT.sessionA, ENT.sessionB]),
      );
      expect(rows.map(r => r.id)).toContain(ENT.sessionA);
      expect(rows.map(r => r.id)).not.toContain(ENT.sessionB);
    } finally { client.release(); }
  });

  it('tenant B cannot read tenant A bar sessions', async () => {
    const client = await entPool.connect();
    try {
      const { rows } = await withTenantRLS(client, ctxEntB, c =>
        c.query('SELECT id FROM ent_bar_sessions WHERE id = $1', [ENT.sessionA]),
      );
      expect(rows).toHaveLength(0);
    } finally { client.release(); }
  });

  it('entity_tag NULL is rejected — non-negotiable P&L separation constraint', async () => {
    // entity_tag is NOT NULL on every bar session/transaction row.
    // This is the sole P&L separation mechanism between BAR and MEMBERS_CLUB.
    const client = await entPool.connect();
    try {
      await expect(
        withTenantRLS(client, ctxEntA, c =>
          c.query(`
            INSERT INTO ent_bar_sessions
              (id, tenant_id, entity_tag, session_date, opened_by, opening_float, idempotency_key)
            VALUES ('e0000000-0000-0000-0099-000000000001', $1, NULL,
                    CURRENT_DATE, $2, 0.00, gen_random_uuid())
          `, [ENT.tenantA, ID.userA]),
        ),
      ).rejects.toThrow();
    } finally { client.release(); }
  });

  it('fail-closed: no tenant context returns 0 bar sessions', async () => {
    const freshPool = new Pool({ connectionString: DB_URL_ENT });
    const client = await freshPool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id FROM ent_bar_sessions WHERE id IN ($1,$2)', [ENT.sessionA, ENT.sessionB],
      );
      await client.query('COMMIT');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
      await freshPool.end();
    }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// jag_family — owner_id RLS isolation
// ─────────────────────────────────────────────────────────────────────────────

const DB_URL_FAMILY = process.env.DATABASE_URL_FAMILY;
const describeFamily = DB_URL_FAMILY ? describe : describe.skip;

const FAM = {
  ownerA:  'f0000000-0000-0000-0002-000000000001',
  ownerB:  'f0000000-0000-0000-0002-000000000002',
  memberA: 'f0000000-0000-0000-0030-000000000001',
  memberB: 'f0000000-0000-0000-0030-000000000002',
} as const;

describeFamily('RLS isolation — jag_family (STD-03)', () => {
  let famPool: Pool;

  beforeAll(async () => {
    famPool = new Pool({ connectionString: DB_URL_FAMILY });
    const c = await famPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_owner_id', FAM.ownerA]);
      await c.query(`
        INSERT INTO fam_family_members (id, owner_id, relationship, first_name, last_name)
        VALUES ($1, $2, 'SELF', 'RLS Test', 'Owner Alpha')
        ON CONFLICT (id) DO NOTHING
      `, [FAM.memberA, FAM.ownerA]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_owner_id', FAM.ownerB]);
      await c.query(`
        INSERT INTO fam_family_members (id, owner_id, relationship, first_name, last_name)
        VALUES ($1, $2, 'SELF', 'RLS Test', 'Owner Bravo')
        ON CONFLICT (id) DO NOTHING
      `, [FAM.memberB, FAM.ownerB]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (!famPool) return;
    const c = await famPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_owner_id', FAM.ownerA]);
      await c.query(`DELETE FROM fam_family_members WHERE id = $1`, [FAM.memberA]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_owner_id', FAM.ownerB]);
      await c.query(`DELETE FROM fam_family_members WHERE id = $1`, [FAM.memberB]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    await famPool.end();
  });

  it('owner A reads only their family members via withOwnerRLS', async () => {
    const client = await famPool.connect();
    try {
      const ctxFamA: RLSContext = { userId: FAM.ownerA, tenantId: '', isOwner: false, ownerId: FAM.ownerA };
      const { rows } = await withOwnerRLS(client, ctxFamA, c =>
        c.query('SELECT id FROM fam_family_members WHERE id IN ($1,$2)', [FAM.memberA, FAM.memberB]),
      );
      expect(rows.map(r => r.id)).toContain(FAM.memberA);
      expect(rows.map(r => r.id)).not.toContain(FAM.memberB);
    } finally { client.release(); }
  });

  it('owner B cannot read owner A family members', async () => {
    const client = await famPool.connect();
    try {
      const ctxFamB: RLSContext = { userId: FAM.ownerB, tenantId: '', isOwner: false, ownerId: FAM.ownerB };
      const { rows } = await withOwnerRLS(client, ctxFamB, c =>
        c.query('SELECT id FROM fam_family_members WHERE id = $1', [FAM.memberA]),
      );
      expect(rows).toHaveLength(0);
    } finally { client.release(); }
  });

  it('fail-closed: no owner context returns 0 family members', async () => {
    const freshPool = new Pool({ connectionString: DB_URL_FAMILY });
    const client = await freshPool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id FROM fam_family_members WHERE id IN ($1,$2)', [FAM.memberA, FAM.memberB],
      );
      await client.query('COMMIT');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
      await freshPool.end();
    }
  });

  it('cross-owner INSERT is rejected by WITH CHECK policy', async () => {
    const client = await famPool.connect();
    try {
      await expect(
        withOwnerRLS(client,
          { userId: FAM.ownerA, tenantId: '', isOwner: false, ownerId: FAM.ownerA },
          c => c.query(`
            INSERT INTO fam_family_members (id, owner_id, relationship, first_name, last_name)
            VALUES ('f0000000-0000-0000-0099-000000000001', $1, 'SELF', 'Cross-Owner', 'Attack')
          `, [FAM.ownerB]),
        ),
      ).rejects.toThrow(/row.level security/i);
    } finally { client.release(); }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// jag_properties — owner_id RLS isolation
// ─────────────────────────────────────────────────────────────────────────────

const DB_URL_PROPS = process.env.DATABASE_URL_PROPERTIES;
const describeProps = DB_URL_PROPS ? describe : describe.skip;

const PROP = {
  ownerA:   'd0000000-0000-0000-0002-000000000001',
  ownerB:   'd0000000-0000-0000-0002-000000000002',
  propA:    'd0000000-0000-0000-0040-000000000001',
  propB:    'd0000000-0000-0000-0040-000000000002',
  prqA:     'd0000000-0000-0000-0050-000000000001', // pending_review_queue entry
  prqIdemA: 'd0000000-0000-0000-0051-000000000001', // its idempotency_key (uuid type)
} as const;

describeProps('RLS isolation — jag_properties (STD-03)', () => {
  let propsPool: Pool;

  beforeAll(async () => {
    propsPool = new Pool({ connectionString: DB_URL_PROPS });
    const c = await propsPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_owner_id', PROP.ownerA]);
      await c.query(`
        INSERT INTO prop_properties
          (id, owner_id, property_code, name, address_line1, city, property_type)
        VALUES ($1, $2, 'RLS-TEST-PROP-A', 'RLS Test Property A', '1 Test St', 'Port of Spain', 'RESIDENTIAL')
        ON CONFLICT (id) DO NOTHING
      `, [PROP.propA, PROP.ownerA]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_owner_id', PROP.ownerB]);
      await c.query(`
        INSERT INTO prop_properties
          (id, owner_id, property_code, name, address_line1, city, property_type)
        VALUES ($1, $2, 'RLS-TEST-PROP-B', 'RLS Test Property B', '2 Test St', 'San Fernando', 'RESIDENTIAL')
        ON CONFLICT (id) DO NOTHING
      `, [PROP.propB, PROP.ownerB]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (!propsPool) return;
    const c = await propsPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_owner_id', PROP.ownerA]);
      await c.query(`DELETE FROM prop_properties WHERE id = $1`, [PROP.propA]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config(\$1, \$2, true)', ['app.current_owner_id', PROP.ownerB]);
      await c.query(`DELETE FROM prop_properties WHERE id = $1`, [PROP.propB]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    await propsPool.end();
  });

  it('owner A reads only their properties via withOwnerRLS', async () => {
    const client = await propsPool.connect();
    try {
      const ctxPropsA: RLSContext = { userId: PROP.ownerA, tenantId: '', isOwner: false, ownerId: PROP.ownerA };
      const { rows } = await withOwnerRLS(client, ctxPropsA, c =>
        c.query('SELECT id FROM prop_properties WHERE id IN ($1,$2)', [PROP.propA, PROP.propB]),
      );
      expect(rows.map(r => r.id)).toContain(PROP.propA);
      expect(rows.map(r => r.id)).not.toContain(PROP.propB);
    } finally { client.release(); }
  });

  it('owner B cannot read owner A properties', async () => {
    const client = await propsPool.connect();
    try {
      const ctxPropsB: RLSContext = { userId: PROP.ownerB, tenantId: '', isOwner: false, ownerId: PROP.ownerB };
      const { rows } = await withOwnerRLS(client, ctxPropsB, c =>
        c.query('SELECT id FROM prop_properties WHERE id = $1', [PROP.propA]),
      );
      expect(rows).toHaveLength(0);
    } finally { client.release(); }
  });

  it('prop_pending_review_queue is owner-isolated (WiPay OPSEC)', async () => {
    // WiPay webhook review items must be invisible across owner boundaries.
    // idempotency_key is uuid type in this table.
    const client = await propsPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config(\$1, \$2, true)', ['app.current_owner_id', PROP.ownerA]);
      await client.query(`
        INSERT INTO prop_pending_review_queue (id, owner_id, idempotency_key, source, raw_payload)
        VALUES ($1, $2, $3, 'WIPAY_WEBHOOK', '{"test":true}')
        ON CONFLICT (id) DO NOTHING
      `, [PROP.prqA, PROP.ownerA, PROP.prqIdemA]);
      await client.query('COMMIT');

      // Assert: owner B cannot see it
      const { rows } = await withOwnerRLS(client,
        { userId: PROP.ownerB, tenantId: '', isOwner: false, ownerId: PROP.ownerB },
        c => c.query('SELECT id FROM prop_pending_review_queue WHERE id = $1', [PROP.prqA]),
      );
      expect(rows).toHaveLength(0);

      // Cleanup
      await client.query('BEGIN');
      await client.query('SELECT set_config(\$1, \$2, true)', ['app.current_owner_id', PROP.ownerA]);
      await client.query(`DELETE FROM prop_pending_review_queue WHERE id = $1`, [PROP.prqA]);
      await client.query('COMMIT');
    } finally { client.release(); }
  });

  it('fail-closed: no owner context returns 0 properties', async () => {
    const freshPool = new Pool({ connectionString: DB_URL_PROPS });
    const client = await freshPool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id FROM prop_properties WHERE id IN ($1,$2)', [PROP.propA, PROP.propB],
      );
      await client.query('COMMIT');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
      await freshPool.end();
    }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// jag_family — Finance (Phase 4) owner_id RLS isolation
// ─────────────────────────────────────────────────────────────────────────────

const describeFinance = DB_URL_FAMILY ? describe : describe.skip;

// 'b' prefix — finance namespace ('b' is valid hex, unused by other suites)
const FIN = {
  ownerA:        'b0000000-0000-0000-0002-000000000001',
  ownerB:        'b0000000-0000-0000-0002-000000000002',
  entityJabco:   'b0000000-0000-0000-0001-000000000002',
  entityHolding: 'b0000000-0000-0000-0001-000000000001',
  accountA:      'b0000000-0000-0000-0010-000000000001',
  accountB:      'b0000000-0000-0000-0010-000000000002',
  txnA:          'b0000000-0000-0000-0020-000000000001',
  fxRateId:      'b0000000-0000-0000-0030-000000000001',
  investmentA:   'b0000000-0000-0000-0040-000000000001',
  snapshotA:     'b0000000-0000-0000-0050-000000000001',
  prqA:          'b0000000-0000-0000-0060-000000000001',
  prqTxnId:      'b0000000-0000-0000-0021-000000000001',
} as const;

describeFinance('RLS isolation — jag_family Finance tables (STD-03, Phase 4)', () => {
  let finPool: Pool;

  beforeAll(async () => {
    finPool = new Pool({ connectionString: DB_URL_FAMILY });
    const c = await finPool.connect();
    try {
      // fin_accounts — owner A (JABCO entity)
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', FIN.ownerA]);
      await c.query(`
        INSERT INTO fin_accounts
          (id, owner_id, owner_entity_id, account_name, institution_name, account_type, currency)
        VALUES ($1, $2, $3, 'RLS Test Account A', 'Test Bank', 'CHEQUING', 'TTD')
        ON CONFLICT (id) DO NOTHING
      `, [FIN.accountA, FIN.ownerA, FIN.entityJabco]);
      await c.query('COMMIT');

      // fin_accounts — owner B
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', FIN.ownerB]);
      await c.query(`
        INSERT INTO fin_accounts
          (id, owner_id, owner_entity_id, account_name, institution_name, account_type, currency)
        VALUES ($1, $2, $3, 'RLS Test Account B', 'Other Bank', 'SAVINGS', 'TTD')
        ON CONFLICT (id) DO NOTHING
      `, [FIN.accountB, FIN.ownerB, FIN.entityHolding]);
      await c.query('COMMIT');

      // fin_transactions — owner A, linked to accountA
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', FIN.ownerA]);
      await c.query(`
        INSERT INTO fin_transactions
          (id, owner_id, account_id, transaction_date, amount, currency, description, idempotency_key)
        VALUES ($1, $2, $3, CURRENT_DATE, -500.00, 'TTD', 'RLS Test Txn A', 'fin-rls-idem-txn-a')
        ON CONFLICT (id) DO NOTHING
      `, [FIN.txnA, FIN.ownerA, FIN.accountA]);
      await c.query('COMMIT');

      // fin_fx_rates — shared reference data, inserted without owner context
      // (uses the permissive fin_fx_rates_write policy — any authenticated owner)
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', FIN.ownerA]);
      await c.query(`
        INSERT INTO fin_fx_rates (id, currency, rate_date, rate_to_ttd, source)
        VALUES ($1, 'USD', '2000-01-01', 6.79, 'RLS_TEST')
        ON CONFLICT (currency, rate_date) DO UPDATE SET rate_to_ttd = EXCLUDED.rate_to_ttd
      `, [FIN.fxRateId]);
      await c.query('COMMIT');

      // fin_investments — owner A
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', FIN.ownerA]);
      await c.query(`
        INSERT INTO fin_investments
          (id, owner_id, owner_entity_id, investment_type, asset_name, currency)
        VALUES ($1, $2, $3, 'EQUITY', 'RLS Test Equity A', 'TTD')
        ON CONFLICT (id) DO NOTHING
      `, [FIN.investmentA, FIN.ownerA, FIN.entityJabco]);
      await c.query('COMMIT');

      // fin_net_worth_snapshots — owner A
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', FIN.ownerA]);
      await c.query(`
        INSERT INTO fin_net_worth_snapshots
          (id, owner_id, snapshot_date, owner_entity_id, total_assets_ttd, total_liabilities_ttd, liquid_assets_ttd, investment_assets_ttd, property_assets_ttd)
        VALUES ($1, $2, CURRENT_DATE, $3, 100000.00, 20000.00, 50000.00, 40000.00, 10000.00)
        ON CONFLICT (id) DO NOTHING
      `, [FIN.snapshotA, FIN.ownerA, FIN.entityJabco]);
      await c.query('COMMIT');

      // fin_pending_review_queue — requires a transaction row first
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', FIN.ownerA]);
      await c.query(`
        INSERT INTO fin_transactions
          (id, owner_id, account_id, transaction_date, amount, currency, description, idempotency_key, is_pending_review)
        VALUES ($1, $2, $3, CURRENT_DATE, -100.00, 'TTD', 'PRQ Test Txn', 'fin-rls-idem-prq-txn', true)
        ON CONFLICT (id) DO NOTHING
      `, [FIN.prqTxnId, FIN.ownerA, FIN.accountA]);
      await c.query(`
        INSERT INTO fin_pending_review_queue (id, owner_id, transaction_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
      `, [FIN.prqA, FIN.ownerA, FIN.prqTxnId]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (!finPool) return;
    const c = await finPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', FIN.ownerA]);
      await c.query(`DELETE FROM fin_pending_review_queue WHERE id = $1`, [FIN.prqA]);
      await c.query(`DELETE FROM fin_transactions WHERE id IN ($1,$2)`, [FIN.txnA, FIN.prqTxnId]);
      await c.query(`DELETE FROM fin_investments WHERE id = $1`, [FIN.investmentA]);
      await c.query(`DELETE FROM fin_net_worth_snapshots WHERE id = $1`, [FIN.snapshotA]);
      await c.query(`DELETE FROM fin_accounts WHERE id = $1`, [FIN.accountA]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', FIN.ownerB]);
      await c.query(`DELETE FROM fin_accounts WHERE id = $1`, [FIN.accountB]);
      await c.query('COMMIT');

      // fin_fx_rates uses permissive policy — any authenticated owner can delete
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', FIN.ownerA]);
      await c.query(`DELETE FROM fin_fx_rates WHERE id = $1`, [FIN.fxRateId]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    await finPool.end();
  });

  // ── fin_accounts ─────────────────────────────────────────────────────────────

  describe('fin_accounts — owner isolation', () => {

    it('owner A reads only their account', async () => {
      const client = await finPool.connect();
      try {
        const ctxA: RLSContext = { userId: FIN.ownerA, tenantId: '', isOwner: false, ownerId: FIN.ownerA };
        const { rows } = await withOwnerRLS(client, ctxA, c =>
          c.query('SELECT id FROM fin_accounts WHERE id IN ($1,$2)', [FIN.accountA, FIN.accountB]),
        );
        expect(rows.map(r => r.id)).toContain(FIN.accountA);
        expect(rows.map(r => r.id)).not.toContain(FIN.accountB);
      } finally { client.release(); }
    });

    it('owner B cannot read owner A account', async () => {
      const client = await finPool.connect();
      try {
        const ctxB: RLSContext = { userId: FIN.ownerB, tenantId: '', isOwner: false, ownerId: FIN.ownerB };
        const { rows } = await withOwnerRLS(client, ctxB, c =>
          c.query('SELECT id FROM fin_accounts WHERE id = $1', [FIN.accountA]),
        );
        expect(rows).toHaveLength(0);
      } finally { client.release(); }
    });

    it('fail-closed: no owner context returns 0 accounts', async () => {
      const freshPool = new Pool({ connectionString: DB_URL_FAMILY });
      const client = await freshPool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'SELECT id FROM fin_accounts WHERE id IN ($1,$2)', [FIN.accountA, FIN.accountB],
        );
        await client.query('COMMIT');
        expect(rows).toHaveLength(0);
      } finally {
        client.release();
        await freshPool.end();
      }
    });

    it('cross-owner INSERT is rejected by WITH CHECK policy', async () => {
      const client = await finPool.connect();
      try {
        await expect(
          withOwnerRLS(client,
            { userId: FIN.ownerA, tenantId: '', isOwner: false, ownerId: FIN.ownerA },
            c => c.query(`
              INSERT INTO fin_accounts
                (id, owner_id, owner_entity_id, account_name, institution_name, account_type)
              VALUES ('b0000000-0000-0000-0099-000000000001', $1, $2, 'Cross-Owner Attack', 'Hack Bank', 'CHEQUING')
            `, [FIN.ownerB, FIN.entityHolding]),
          ),
        ).rejects.toThrow(/row.level security/i);
      } finally { client.release(); }
    });

    it('owner can filter accounts by owner_entity_id (Option B entity-scoped query)', async () => {
      const client = await finPool.connect();
      try {
        const ctxA: RLSContext = { userId: FIN.ownerA, tenantId: '', isOwner: false, ownerId: FIN.ownerA };
        const { rows } = await withOwnerRLS(client, ctxA, c =>
          c.query('SELECT id FROM fin_accounts WHERE owner_entity_id = $1', [FIN.entityJabco]),
        );
        expect(rows.map(r => r.id)).toContain(FIN.accountA);
      } finally { client.release(); }
    });
  });

  // ── fin_transactions ──────────────────────────────────────────────────────────

  describe('fin_transactions — owner isolation', () => {

    it('owner A reads only their transactions', async () => {
      const client = await finPool.connect();
      try {
        const ctxA: RLSContext = { userId: FIN.ownerA, tenantId: '', isOwner: false, ownerId: FIN.ownerA };
        const { rows } = await withOwnerRLS(client, ctxA, c =>
          c.query('SELECT id FROM fin_transactions WHERE id = $1', [FIN.txnA]),
        );
        expect(rows).toHaveLength(1);
      } finally { client.release(); }
    });

    it('owner B cannot read owner A transactions', async () => {
      const client = await finPool.connect();
      try {
        const ctxB: RLSContext = { userId: FIN.ownerB, tenantId: '', isOwner: false, ownerId: FIN.ownerB };
        const { rows } = await withOwnerRLS(client, ctxB, c =>
          c.query('SELECT id FROM fin_transactions WHERE id = $1', [FIN.txnA]),
        );
        expect(rows).toHaveLength(0);
      } finally { client.release(); }
    });

    it('fail-closed: no owner context returns 0 transactions', async () => {
      const freshPool = new Pool({ connectionString: DB_URL_FAMILY });
      const client = await freshPool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'SELECT id FROM fin_transactions WHERE id = $1', [FIN.txnA],
        );
        await client.query('COMMIT');
        expect(rows).toHaveLength(0);
      } finally {
        client.release();
        await freshPool.end();
      }
    });
  });

  // ── fin_fx_rates — shared reference table ────────────────────────────────────

  describe('fin_fx_rates — readable by any authenticated owner', () => {

    it('owner A can read the FX rate', async () => {
      const client = await finPool.connect();
      try {
        const ctxA: RLSContext = { userId: FIN.ownerA, tenantId: '', isOwner: false, ownerId: FIN.ownerA };
        const { rows } = await withOwnerRLS(client, ctxA, c =>
          c.query('SELECT id, rate_to_ttd FROM fin_fx_rates WHERE id = $1', [FIN.fxRateId]),
        );
        expect(rows).toHaveLength(1);
        expect(Number(rows[0].rate_to_ttd)).toBeCloseTo(6.79);
      } finally { client.release(); }
    });

    it('owner B can also read the same FX rate (shared reference)', async () => {
      const client = await finPool.connect();
      try {
        const ctxB: RLSContext = { userId: FIN.ownerB, tenantId: '', isOwner: false, ownerId: FIN.ownerB };
        const { rows } = await withOwnerRLS(client, ctxB, c =>
          c.query('SELECT id FROM fin_fx_rates WHERE id = $1', [FIN.fxRateId]),
        );
        expect(rows).toHaveLength(1);
      } finally { client.release(); }
    });

    it('fail-closed: no owner context returns 0 FX rates', async () => {
      const freshPool = new Pool({ connectionString: DB_URL_FAMILY });
      const client = await freshPool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'SELECT id FROM fin_fx_rates WHERE id = $1', [FIN.fxRateId],
        );
        await client.query('COMMIT');
        expect(rows).toHaveLength(0);
      } finally {
        client.release();
        await freshPool.end();
      }
    });
  });

  // ── fin_investments ───────────────────────────────────────────────────────────

  describe('fin_investments — owner isolation', () => {

    it('owner A reads only their investment', async () => {
      const client = await finPool.connect();
      try {
        const ctxA: RLSContext = { userId: FIN.ownerA, tenantId: '', isOwner: false, ownerId: FIN.ownerA };
        const { rows } = await withOwnerRLS(client, ctxA, c =>
          c.query('SELECT id FROM fin_investments WHERE id = $1', [FIN.investmentA]),
        );
        expect(rows).toHaveLength(1);
      } finally { client.release(); }
    });

    it('owner B cannot read owner A investments', async () => {
      const client = await finPool.connect();
      try {
        const ctxB: RLSContext = { userId: FIN.ownerB, tenantId: '', isOwner: false, ownerId: FIN.ownerB };
        const { rows } = await withOwnerRLS(client, ctxB, c =>
          c.query('SELECT id FROM fin_investments WHERE id = $1', [FIN.investmentA]),
        );
        expect(rows).toHaveLength(0);
      } finally { client.release(); }
    });
  });

  // ── fin_net_worth_snapshots ───────────────────────────────────────────────────

  describe('fin_net_worth_snapshots — owner isolation + generated column', () => {

    it('owner A reads their snapshot and net_worth_ttd is correctly computed', async () => {
      const client = await finPool.connect();
      try {
        const ctxA: RLSContext = { userId: FIN.ownerA, tenantId: '', isOwner: false, ownerId: FIN.ownerA };
        const { rows } = await withOwnerRLS(client, ctxA, c =>
          c.query('SELECT id, total_assets_ttd, total_liabilities_ttd, net_worth_ttd FROM fin_net_worth_snapshots WHERE id = $1', [FIN.snapshotA]),
        );
        expect(rows).toHaveLength(1);
        // net_worth_ttd = 100000 - 20000 = 80000 (generated column)
        expect(Number(rows[0].net_worth_ttd)).toBeCloseTo(80000);
      } finally { client.release(); }
    });

    it('owner B cannot read owner A net worth snapshots', async () => {
      const client = await finPool.connect();
      try {
        const ctxB: RLSContext = { userId: FIN.ownerB, tenantId: '', isOwner: false, ownerId: FIN.ownerB };
        const { rows } = await withOwnerRLS(client, ctxB, c =>
          c.query('SELECT id FROM fin_net_worth_snapshots WHERE id = $1', [FIN.snapshotA]),
        );
        expect(rows).toHaveLength(0);
      } finally { client.release(); }
    });
  });

  // ── fin_pending_review_queue ──────────────────────────────────────────────────

  describe('fin_pending_review_queue — owner isolation (finance OPSEC)', () => {

    it('owner B cannot see owner A pending review items', async () => {
      const client = await finPool.connect();
      try {
        const ctxB: RLSContext = { userId: FIN.ownerB, tenantId: '', isOwner: false, ownerId: FIN.ownerB };
        const { rows } = await withOwnerRLS(client, ctxB, c =>
          c.query('SELECT id FROM fin_pending_review_queue WHERE id = $1', [FIN.prqA]),
        );
        expect(rows).toHaveLength(0);
      } finally { client.release(); }
    });

    it('owner A can resolve their own pending review item', async () => {
      const client = await finPool.connect();
      try {
        const ctxA: RLSContext = { userId: FIN.ownerA, tenantId: '', isOwner: false, ownerId: FIN.ownerA };
        const { rows } = await withOwnerRLS(client, ctxA, c =>
          c.query(`
            UPDATE fin_pending_review_queue
            SET resolved_at = now()
            WHERE id = $1
            RETURNING id, resolved_at
          `, [FIN.prqA]),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].resolved_at).not.toBeNull();
      } finally { client.release(); }
    });
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// jag_family — General Ledger (Phase 5) owner_id RLS isolation
// ─────────────────────────────────────────────────────────────────────────────

const describeGL = DB_URL_FAMILY ? describe : describe.skip;

// 'g' prefix — GL namespace
const GL = {
  ownerA:    'g0000000-0000-0000-0002-000000000001',
  ownerB:    'g0000000-0000-0000-0002-000000000002',
  entityA:   'g0000000-0000-0000-0001-000000000001',
  accountA:  'g0000000-0000-0000-0010-000000000001',  // Cash (owner A)
  accountA2: 'g0000000-0000-0000-0010-000000000002',  // Revenue (owner A)
  accountB:  'g0000000-0000-0000-0010-000000000003',  // Cash (owner B)
  entryA:    'g0000000-0000-0000-0020-000000000001',
  lineA1:    'g0000000-0000-0000-0030-000000000001',
  lineA2:    'g0000000-0000-0000-0030-000000000002',
} as const;

describeGL('RLS isolation — jag_family GL tables (STD-03, Phase 5)', () => {
  let glPool: Pool;

  beforeAll(async () => {
    glPool = new Pool({ connectionString: DB_URL_FAMILY });
    const c = await glPool.connect();
    try {
      // GL account — owner A (Cash/Asset)
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', GL.ownerA]);
      await c.query(`
        INSERT INTO fin_gl_accounts
          (id, owner_id, owner_entity_id, account_code, account_name, account_type, normal_balance)
        VALUES
          ($1, $2, $3, '1100', 'RLS Test Cash A',    'ASSET',   'DEBIT'),
          ($4, $2, $3, '4100', 'RLS Test Revenue A', 'REVENUE', 'CREDIT')
        ON CONFLICT (id) DO NOTHING
      `, [GL.accountA, GL.ownerA, GL.entityA, GL.accountA2]);
      await c.query('COMMIT');

      // GL account — owner B
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', GL.ownerB]);
      await c.query(`
        INSERT INTO fin_gl_accounts
          (id, owner_id, owner_entity_id, account_code, account_name, account_type, normal_balance)
        VALUES ($1, $2, $3, '1100', 'RLS Test Cash B', 'ASSET', 'DEBIT')
        ON CONFLICT (id) DO NOTHING
      `, [GL.accountB, GL.ownerB, GL.entityA]);
      await c.query('COMMIT');

      // Journal entry + lines — owner A
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', GL.ownerA]);
      await c.query(`
        INSERT INTO fin_journal_entries
          (id, owner_id, owner_entity_id, entry_date, description, status,
           source, currency, total_debit_ttd, total_credit_ttd, idempotency_key)
        VALUES ($1, $2, $3, CURRENT_DATE, 'RLS Test Entry A', 'DRAFT',
                'MANUAL', 'TTD', 1000.00, 1000.00, 'gl-rls-idem-entry-a')
        ON CONFLICT (id) DO NOTHING
      `, [GL.entryA, GL.ownerA, GL.entityA]);
      await c.query(`
        INSERT INTO fin_journal_entry_lines
          (id, owner_id, journal_entry_id, gl_account_id, line_number, debit_ttd, credit_ttd)
        VALUES
          ($1, $2, $3, $4, 1, 1000.00,    0),
          ($5, $2, $3, $6, 2,    0, 1000.00)
        ON CONFLICT (id) DO NOTHING
      `, [GL.lineA1, GL.ownerA, GL.entryA, GL.accountA,
          GL.lineA2, GL.ownerA, GL.entryA, GL.accountA2]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (!glPool) return;
    const c = await glPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', GL.ownerA]);
      // Lines cascade-delete with entry (ON DELETE CASCADE)
      await c.query(`DELETE FROM fin_journal_entries WHERE id = $1`, [GL.entryA]);
      await c.query(`DELETE FROM fin_gl_accounts WHERE id IN ($1,$2)`, [GL.accountA, GL.accountA2]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', GL.ownerB]);
      await c.query(`DELETE FROM fin_gl_accounts WHERE id = $1`, [GL.accountB]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    await glPool.end();
  });

  // ── fin_gl_accounts ───────────────────────────────────────────────────────────

  describe('fin_gl_accounts — owner isolation', () => {

    it('owner A reads only their GL accounts', async () => {
      const client = await glPool.connect();
      try {
        const ctxA: RLSContext = { userId: GL.ownerA, tenantId: '', isOwner: false, ownerId: GL.ownerA };
        const { rows } = await withOwnerRLS(client, ctxA, c =>
          c.query('SELECT id FROM fin_gl_accounts WHERE id IN ($1,$2,$3)',
            [GL.accountA, GL.accountA2, GL.accountB]),
        );
        const ids = rows.map(r => r.id);
        expect(ids).toContain(GL.accountA);
        expect(ids).toContain(GL.accountA2);
        expect(ids).not.toContain(GL.accountB);
      } finally { client.release(); }
    });

    it('owner B cannot read owner A GL accounts', async () => {
      const client = await glPool.connect();
      try {
        const ctxB: RLSContext = { userId: GL.ownerB, tenantId: '', isOwner: false, ownerId: GL.ownerB };
        const { rows } = await withOwnerRLS(client, ctxB, c =>
          c.query('SELECT id FROM fin_gl_accounts WHERE id = $1', [GL.accountA]),
        );
        expect(rows).toHaveLength(0);
      } finally { client.release(); }
    });

    it('fail-closed: no owner context returns 0 GL accounts', async () => {
      const freshPool = new Pool({ connectionString: DB_URL_FAMILY });
      const client = await freshPool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'SELECT id FROM fin_gl_accounts WHERE id IN ($1,$2)', [GL.accountA, GL.accountB],
        );
        await client.query('COMMIT');
        expect(rows).toHaveLength(0);
      } finally {
        client.release();
        await freshPool.end();
      }
    });

    it('cross-owner INSERT into fin_gl_accounts is rejected by WITH CHECK', async () => {
      const client = await glPool.connect();
      try {
        await expect(
          withOwnerRLS(client,
            { userId: GL.ownerA, tenantId: '', isOwner: false, ownerId: GL.ownerA },
            c => c.query(`
              INSERT INTO fin_gl_accounts
                (id, owner_id, owner_entity_id, account_code, account_name, account_type, normal_balance)
              VALUES ('g0000000-0000-0000-0099-000000000001', $1, $2, '9999', 'Cross-Owner Attack', 'ASSET', 'DEBIT')
            `, [GL.ownerB, GL.entityA]),
          ),
        ).rejects.toThrow(/row.level security/i);
      } finally { client.release(); }
    });
  });

  // ── fin_journal_entries ───────────────────────────────────────────────────────

  describe('fin_journal_entries — owner isolation', () => {

    it('owner A reads only their journal entry', async () => {
      const client = await glPool.connect();
      try {
        const ctxA: RLSContext = { userId: GL.ownerA, tenantId: '', isOwner: false, ownerId: GL.ownerA };
        const { rows } = await withOwnerRLS(client, ctxA, c =>
          c.query('SELECT id FROM fin_journal_entries WHERE id = $1', [GL.entryA]),
        );
        expect(rows).toHaveLength(1);
      } finally { client.release(); }
    });

    it('owner B cannot read owner A journal entry', async () => {
      const client = await glPool.connect();
      try {
        const ctxB: RLSContext = { userId: GL.ownerB, tenantId: '', isOwner: false, ownerId: GL.ownerB };
        const { rows } = await withOwnerRLS(client, ctxB, c =>
          c.query('SELECT id FROM fin_journal_entries WHERE id = $1', [GL.entryA]),
        );
        expect(rows).toHaveLength(0);
      } finally { client.release(); }
    });

    it('fail-closed: no owner context returns 0 journal entries', async () => {
      const freshPool = new Pool({ connectionString: DB_URL_FAMILY });
      const client = await freshPool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'SELECT id FROM fin_journal_entries WHERE id = $1', [GL.entryA],
        );
        await client.query('COMMIT');
        expect(rows).toHaveLength(0);
      } finally {
        client.release();
        await freshPool.end();
      }
    });
  });

  // ── fin_journal_entry_lines ───────────────────────────────────────────────────

  describe('fin_journal_entry_lines — owner isolation', () => {

    it('owner A reads their own lines', async () => {
      const client = await glPool.connect();
      try {
        const ctxA: RLSContext = { userId: GL.ownerA, tenantId: '', isOwner: false, ownerId: GL.ownerA };
        const { rows } = await withOwnerRLS(client, ctxA, c =>
          c.query('SELECT id FROM fin_journal_entry_lines WHERE id IN ($1,$2)',
            [GL.lineA1, GL.lineA2]),
        );
        expect(rows).toHaveLength(2);
      } finally { client.release(); }
    });

    it('owner B cannot read owner A lines', async () => {
      const client = await glPool.connect();
      try {
        const ctxB: RLSContext = { userId: GL.ownerB, tenantId: '', isOwner: false, ownerId: GL.ownerB };
        const { rows } = await withOwnerRLS(client, ctxB, c =>
          c.query('SELECT id FROM fin_journal_entry_lines WHERE id IN ($1,$2)',
            [GL.lineA1, GL.lineA2]),
        );
        expect(rows).toHaveLength(0);
      } finally { client.release(); }
    });

    it('line constraints: both debit and credit non-zero is rejected', async () => {
      const client = await glPool.connect();
      try {
        await expect(
          withOwnerRLS(client,
            { userId: GL.ownerA, tenantId: '', isOwner: false, ownerId: GL.ownerA },
            c => c.query(`
              INSERT INTO fin_journal_entry_lines
                (id, owner_id, journal_entry_id, gl_account_id, line_number, debit_ttd, credit_ttd)
              VALUES ('g0000000-0000-0000-0099-000000000001', $1, $2, $3, 99, 100.00, 100.00)
            `, [GL.ownerA, GL.entryA, GL.accountA]),
          ),
        ).rejects.toThrow();
      } finally { client.release(); }
    });
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// jag_family — Expense Management (Phase 5) owner_id RLS isolation
// ─────────────────────────────────────────────────────────────────────────────

const describeExpenses = DB_URL_FAMILY ? describe : describe.skip;

const EXP = {
  ownerA:   'x0000000-0000-0000-0002-000000000001',
  ownerB:   'x0000000-0000-0000-0002-000000000002',
  entityA:  'x0000000-0000-0000-0001-000000000001',
  glDebit:  'x0000000-0000-0000-0010-000000000001',  // expense GL account (owner A)
  glCredit: 'x0000000-0000-0000-0010-000000000002',  // bank GL account (owner A)
  expenseA: 'x0000000-0000-0000-0020-000000000001',
  expenseB: 'x0000000-0000-0000-0020-000000000002',
} as const;

describeExpenses('RLS isolation — fin_expenses (STD-03, Phase 5)', () => {
  let expPool: Pool;

  beforeAll(async () => {
    expPool = new Pool({ connectionString: DB_URL_FAMILY });
    const c = await expPool.connect();
    try {
      // GL accounts for owner A (needed for approve test)
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', EXP.ownerA]);
      await c.query(`
        INSERT INTO fin_gl_accounts
          (id, owner_id, owner_entity_id, account_code, account_name, account_type, normal_balance)
        VALUES
          ($1, $2, $3, '5200', 'RLS Test Office Expense', 'EXPENSE', 'DEBIT'),
          ($4, $2, $3, '1100', 'RLS Test Cash',           'ASSET',   'DEBIT')
        ON CONFLICT (id) DO NOTHING
      `, [EXP.glDebit, EXP.ownerA, EXP.entityA, EXP.glCredit]);
      await c.query('COMMIT');

      // Expense — owner A
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', EXP.ownerA]);
      await c.query(`
        INSERT INTO fin_expenses
          (id, owner_id, owner_entity_id, submitted_by, expense_date, description,
           amount, currency, amount_ttd, payment_method, category, idempotency_key)
        VALUES ($1, $2, $3, $2, CURRENT_DATE, 'RLS Test Expense A',
                500.00, 'TTD', 500.00, 'CASH', 'OPERATING_EXPENSE', 'exp-rls-idem-a')
        ON CONFLICT (id) DO NOTHING
      `, [EXP.expenseA, EXP.ownerA, EXP.entityA]);
      await c.query('COMMIT');

      // Expense — owner B
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', EXP.ownerB]);
      await c.query(`
        INSERT INTO fin_expenses
          (id, owner_id, owner_entity_id, submitted_by, expense_date, description,
           amount, currency, amount_ttd, payment_method, category, idempotency_key)
        VALUES ($1, $2, $3, $2, CURRENT_DATE, 'RLS Test Expense B',
                200.00, 'TTD', 200.00, 'CASH', 'OPERATING_EXPENSE', 'exp-rls-idem-b')
        ON CONFLICT (id) DO NOTHING
      `, [EXP.expenseB, EXP.ownerB, EXP.entityA]);
      await c.query('COMMIT');
    } finally { c.release(); }
  });

  afterAll(async () => {
    if (!expPool) return;
    const c = await expPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', EXP.ownerA]);
      await c.query(`DELETE FROM fin_expenses WHERE id = $1`, [EXP.expenseA]);
      await c.query(`DELETE FROM fin_gl_accounts WHERE id IN ($1,$2)`, [EXP.glDebit, EXP.glCredit]);
      await c.query('COMMIT');

      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', EXP.ownerB]);
      await c.query(`DELETE FROM fin_expenses WHERE id = $1`, [EXP.expenseB]);
      await c.query('COMMIT');
    } finally { c.release(); }
    await expPool.end();
  });

  it('owner A reads only their expense', async () => {
    const client = await expPool.connect();
    try {
      const ctxA: RLSContext = { userId: EXP.ownerA, tenantId: '', isOwner: false, ownerId: EXP.ownerA };
      const { rows } = await withOwnerRLS(client, ctxA, c =>
        c.query('SELECT id FROM fin_expenses WHERE id IN ($1,$2)', [EXP.expenseA, EXP.expenseB]),
      );
      expect(rows.map(r => r.id)).toContain(EXP.expenseA);
      expect(rows.map(r => r.id)).not.toContain(EXP.expenseB);
    } finally { client.release(); }
  });

  it('owner B cannot read owner A expense', async () => {
    const client = await expPool.connect();
    try {
      const ctxB: RLSContext = { userId: EXP.ownerB, tenantId: '', isOwner: false, ownerId: EXP.ownerB };
      const { rows } = await withOwnerRLS(client, ctxB, c =>
        c.query('SELECT id FROM fin_expenses WHERE id = $1', [EXP.expenseA]),
      );
      expect(rows).toHaveLength(0);
    } finally { client.release(); }
  });

  it('fail-closed: no owner context returns 0 expenses', async () => {
    const freshPool = new Pool({ connectionString: DB_URL_FAMILY });
    const client = await freshPool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id FROM fin_expenses WHERE id IN ($1,$2)', [EXP.expenseA, EXP.expenseB],
      );
      await client.query('COMMIT');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
      await freshPool.end();
    }
  });

  it('cross-owner INSERT is rejected by WITH CHECK policy', async () => {
    const client = await expPool.connect();
    try {
      await expect(
        withOwnerRLS(client,
          { userId: EXP.ownerA, tenantId: '', isOwner: false, ownerId: EXP.ownerA },
          c => c.query(`
            INSERT INTO fin_expenses
              (id, owner_id, owner_entity_id, submitted_by, expense_date, description,
               amount, currency, amount_ttd, payment_method, category, idempotency_key)
            VALUES ('x0000000-0000-0000-0099-000000000001', $1, $2, $1,
                    CURRENT_DATE, 'Cross-Owner Attack', 1.00, 'TTD', 1.00,
                    'CASH', 'OPERATING_EXPENSE', 'exp-rls-cross-owner')
          `, [EXP.ownerB, EXP.entityA]),
        ),
      ).rejects.toThrow(/row.level security/i);
    } finally { client.release(); }
  });

  it('status transitions: DRAFT → SUBMITTED updates correctly', async () => {
    const client = await expPool.connect();
    try {
      const ctxA: RLSContext = { userId: EXP.ownerA, tenantId: '', isOwner: false, ownerId: EXP.ownerA };
      const { rows } = await withOwnerRLS(client, ctxA, c =>
        c.query(
          `UPDATE fin_expenses SET status = 'SUBMITTED', submitted_at = now()
           WHERE id = $1 RETURNING id, status`,
          [EXP.expenseA],
        ),
      );
      expect(rows[0].status).toBe('SUBMITTED');
    } finally { client.release(); }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Insurance module RLS (fin_insurance_policies / premiums / claims)
// ─────────────────────────────────────────────────────────────────────────────

const DB_URL_FAMILY_INS = process.env.DATABASE_URL_FAMILY;
const describeInsurance  = DB_URL_FAMILY_INS ? describe : describe.skip;

const INS = {
  ownerA:  'i0000000-0000-0000-0001-000000000001',
  ownerB:  'i0000000-0000-0000-0001-000000000002',
  entityA: 'i0000000-0000-0000-0002-000000000001',
  polA:    'i0000000-0000-0000-0010-000000000001',  // ownerA policy
  polB:    'i0000000-0000-0000-0010-000000000002',  // ownerB policy
  premA:   'i0000000-0000-0000-0020-000000000001',  // ownerA premium
  premB:   'i0000000-0000-0000-0020-000000000002',  // ownerB premium
  claimA:  'i0000000-0000-0000-0030-000000000001',  // ownerA claim
  claimB:  'i0000000-0000-0000-0030-000000000002',  // ownerB claim
} as const;

describeInsurance('Insurance RLS isolation — jag_family (STD-03)', () => {
  let insPool: Pool;

  beforeAll(async () => {
    insPool = new Pool({ connectionString: DB_URL_FAMILY_INS });
    const client = await insPool.connect();
    try {
      // Insert ownerA policy
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', INS.ownerA]);
      await client.query(`
        INSERT INTO fin_insurance_policies
          (id, owner_id, owner_entity_id, policy_number, insurer_name, policy_type,
           insured_asset_type, coverage_amount, coverage_amount_ttd,
           premium_amount, premium_amount_ttd, premium_frequency,
           start_date, expiry_date, renewal_alert_days)
        VALUES ($1,$2,$3,'INS-RLS-001','RLS Insurer A','VEHICLE','VEHICLE',
                10000,10000,1000,1000,'ANNUAL',
                CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year', 60)
        ON CONFLICT (id) DO NOTHING
      `, [INS.polA, INS.ownerA, INS.entityA]);
      await client.query('COMMIT');

      // Insert ownerA premium
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', INS.ownerA]);
      await client.query(`
        INSERT INTO fin_insurance_premiums
          (id, owner_id, policy_id, due_date, amount, amount_ttd, idempotency_key)
        VALUES ($1,$2,$3, CURRENT_DATE, 1000, 1000, 'ins-rls-prem-a')
        ON CONFLICT (id) DO NOTHING
      `, [INS.premA, INS.ownerA, INS.polA]);
      await client.query('COMMIT');

      // Insert ownerA claim
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', INS.ownerA]);
      await client.query(`
        INSERT INTO fin_insurance_claims
          (id, owner_id, policy_id, incident_date, claim_date, description,
           claimed_amount_ttd, idempotency_key)
        VALUES ($1,$2,$3, CURRENT_DATE, CURRENT_DATE, 'RLS test claim', 5000, 'ins-rls-claim-a')
        ON CONFLICT (id) DO NOTHING
      `, [INS.claimA, INS.ownerA, INS.polA]);
      await client.query('COMMIT');

      // Insert ownerB policy
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', INS.ownerB]);
      await client.query(`
        INSERT INTO fin_insurance_policies
          (id, owner_id, owner_entity_id, policy_number, insurer_name, policy_type,
           insured_asset_type, coverage_amount, coverage_amount_ttd,
           premium_amount, premium_amount_ttd, premium_frequency,
           start_date, expiry_date, renewal_alert_days)
        VALUES ($1,$2,$3,'INS-RLS-002','RLS Insurer B','PROPERTY','PROPERTY',
                20000,20000,2000,2000,'ANNUAL',
                CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year', 60)
        ON CONFLICT (id) DO NOTHING
      `, [INS.polB, INS.ownerB, INS.entityA]);
      await client.query('COMMIT');

      // Insert ownerB premium
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', INS.ownerB]);
      await client.query(`
        INSERT INTO fin_insurance_premiums
          (id, owner_id, policy_id, due_date, amount, amount_ttd, idempotency_key)
        VALUES ($1,$2,$3, CURRENT_DATE, 2000, 2000, 'ins-rls-prem-b')
        ON CONFLICT (id) DO NOTHING
      `, [INS.premB, INS.ownerB, INS.polB]);
      await client.query('COMMIT');

      // Insert ownerB claim
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', INS.ownerB]);
      await client.query(`
        INSERT INTO fin_insurance_claims
          (id, owner_id, policy_id, incident_date, claim_date, description,
           claimed_amount_ttd, idempotency_key)
        VALUES ($1,$2,$3, CURRENT_DATE, CURRENT_DATE, 'RLS test claim B', 8000, 'ins-rls-claim-b')
        ON CONFLICT (id) DO NOTHING
      `, [INS.claimB, INS.ownerB, INS.polB]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await insPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.current_owner_id', INS.ownerA]);
      await client.query(`DELETE FROM fin_insurance_claims   WHERE id IN ($1,$2)`, [INS.claimA, INS.claimB]);
      await client.query(`DELETE FROM fin_insurance_premiums WHERE id IN ($1,$2)`, [INS.premA,  INS.premB]);
      await client.query(`DELETE FROM fin_insurance_policies WHERE id IN ($1,$2)`, [INS.polA,   INS.polB]);
      await client.query('COMMIT');
    } finally {
      client.release();
      await insPool.end();
    }
  });

  it('ownerA sees only their own policy', async () => {
    const client = await insPool.connect();
    try {
      const ctxA: RLSContext = { userId: INS.ownerA, tenantId: '', isOwner: false, ownerId: INS.ownerA };
      const { rows } = await withOwnerRLS(client, ctxA, c =>
        c.query('SELECT id FROM fin_insurance_policies WHERE id IN ($1,$2)', [INS.polA, INS.polB])
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(INS.polA);
    } finally { client.release(); }
  });

  it('ownerB cannot read ownerA policy', async () => {
    const client = await insPool.connect();
    try {
      const ctxB: RLSContext = { userId: INS.ownerB, tenantId: '', isOwner: false, ownerId: INS.ownerB };
      const { rows } = await withOwnerRLS(client, ctxB, c =>
        c.query('SELECT id FROM fin_insurance_policies WHERE id = $1', [INS.polA])
      );
      expect(rows).toHaveLength(0);
    } finally { client.release(); }
  });

  it('ownerA sees only their own premium', async () => {
    const client = await insPool.connect();
    try {
      const ctxA: RLSContext = { userId: INS.ownerA, tenantId: '', isOwner: false, ownerId: INS.ownerA };
      const { rows } = await withOwnerRLS(client, ctxA, c =>
        c.query('SELECT id FROM fin_insurance_premiums WHERE id IN ($1,$2)', [INS.premA, INS.premB])
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(INS.premA);
    } finally { client.release(); }
  });

  it('ownerA sees only their own claim', async () => {
    const client = await insPool.connect();
    try {
      const ctxA: RLSContext = { userId: INS.ownerA, tenantId: '', isOwner: false, ownerId: INS.ownerA };
      const { rows } = await withOwnerRLS(client, ctxA, c =>
        c.query('SELECT id FROM fin_insurance_claims WHERE id IN ($1,$2)', [INS.claimA, INS.claimB])
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(INS.claimA);
    } finally { client.release(); }
  });

  it('fail-closed: no owner context returns 0 policies', async () => {
    const freshPool = new Pool({ connectionString: DB_URL_FAMILY_INS });
    const client = await freshPool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id FROM fin_insurance_policies WHERE id IN ($1,$2)', [INS.polA, INS.polB]
      );
      await client.query('COMMIT');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
      await freshPool.end();
    }
  });

  it('cross-owner INSERT on policies is rejected by WITH CHECK', async () => {
    const client = await insPool.connect();
    try {
      const ctxA: RLSContext = { userId: INS.ownerA, tenantId: '', isOwner: false, ownerId: INS.ownerA };
      await expect(
        withOwnerRLS(client, ctxA, c => c.query(`
          INSERT INTO fin_insurance_policies
            (id, owner_id, owner_entity_id, policy_number, insurer_name, policy_type,
             insured_asset_type, coverage_amount, coverage_amount_ttd,
             premium_amount, premium_amount_ttd, premium_frequency,
             start_date, expiry_date)
          VALUES ('i0000000-0000-0000-0099-000000000001', $1, $2,
                  'INS-RLS-ATTACK','Attacker','VEHICLE','VEHICLE',
                  1,1,1,1,'ANNUAL', CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year')
        `, [INS.ownerB, INS.entityA]))
      ).rejects.toThrow(/row.level security/i);
    } finally { client.release(); }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// STD-01: No DB-level FK across database boundaries
// ─────────────────────────────────────────────────────────────────────────────
// fam_personal_vehicles.ims_item_id is a logical UUID reference to
// jag_commercial.ims_items.id. If a DB-level FK existed, an INSERT referencing
// a non-existent ims_items row would throw a FK violation. This test proves the
// reference is logical-only — INSERT with any UUID value must succeed.
// ─────────────────────────────────────────────────────────────────────────────

const describeNoCrossDbFk = DB_URL_FAMILY ? describe : describe.skip;

describeNoCrossDbFk('STD-01: No cross-database FK constraints', () => {
  it('fam_personal_vehicles accepts ims_item_id that does not exist in jag_commercial', async () => {
    const famPool = new Pool({ connectionString: DB_URL_FAMILY });
    const vehicleId      = 'f0000000-0000-0000-0060-000000000001';
    const bogusImsItemId = 'f0000000-0000-0000-0061-000000000001'; // intentionally absent from jag_commercial
    const client = await famPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config(\$1, \$2, true)', ['app.current_owner_id', FAM.ownerA]);
      // A cross-DB FK would throw here. It must not.
      await client.query(`
        INSERT INTO fam_personal_vehicles
          (id, owner_id, registration_number, make, model, year, vehicle_type, fuel_type, ims_item_id)
        VALUES ($1, $2, 'RLS-TEST-VEH-01', 'RLS', 'TestCar', 2026, 'CAR', 'PETROL', $3)
        ON CONFLICT (id) DO NOTHING
      `, [vehicleId, FAM.ownerA, bogusImsItemId]);
      await client.query('COMMIT'); // must succeed — no FK violation

      // Cleanup
      await client.query('BEGIN');
      await client.query('SELECT set_config(\$1, \$2, true)', ['app.current_owner_id', FAM.ownerA]);
      await client.query(`DELETE FROM fam_personal_vehicles WHERE id = $1`, [vehicleId]);
      await client.query('COMMIT');
    } finally {
      client.release();
      await famPool.end();
    }
  });
});
