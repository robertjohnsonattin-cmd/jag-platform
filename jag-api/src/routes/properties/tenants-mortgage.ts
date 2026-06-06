// GET  /api/v1/properties/tenants
// POST /api/v1/properties/tenants
// GET  /api/v1/properties/:propertyId/mortgage
// POST /api/v1/properties/:propertyId/mortgage

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const propTenantsRouter  = Router();
export const propMortgageRouter = Router({ mergeParams: true });

const UUIDParam      = z.object({ id: z.string().uuid() });
const PropertyParam  = z.object({ propertyId: z.string().uuid() });

// ── Schemas ───────────────────────────────────────────────────────────────────

const CreateTenantSchema = z.object({
  first_name:              z.string().min(1).max(100),
  last_name:               z.string().max(100).optional(),
  company_name:            z.string().max(200).optional(),
  is_company:              z.boolean().default(false),
  phone:                   z.string().max(30).optional(),
  email:                   z.string().email().optional(),
  identification_type:     z.enum(['TT_NIC','PASSPORT','COMPANY_REG','DRIVERS_LICENCE','OTHER']).optional(),
  identification_number:   z.string().max(50).optional(),
  emergency_contact_name:  z.string().max(100).optional(),
  emergency_contact_phone: z.string().max(30).optional(),
  notes:                   z.string().max(2000).optional(),
}).strict();

const CreateMortgageSchema = z.object({
  lender_name:           z.string().min(1).max(200),
  account_reference:     z.string().max(50).optional(),  // PARTIAL only — OPSEC
  mortgage_type:         z.enum(['FIXED_RATE','VARIABLE_RATE','INTEREST_ONLY']),
  original_amount:       z.number().positive(),
  currency:              z.string().length(3).default('TTD'),
  outstanding_balance:   z.number().min(0),
  interest_rate_percent: z.number().positive(),
  start_date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maturity_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  monthly_payment:       z.number().positive(),
  payment_due_day:       z.number().int().min(1).max(28).default(1),
  notes:                 z.string().max(2000).optional(),
  idempotency_key:       z.string().uuid(),
}).strict();

async function auditLog(ownerId: string, entity: string, action: string, recordId: string, vals: unknown): Promise<void> {
  const client = await corePool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', ownerId]);
    await client.query(
      `INSERT INTO audit_log (user_id, entity, action, record_id, new_values, source) VALUES ($1,$2,$3,$4,$5,'API')`,
      [ownerId, entity, action, recordId, JSON.stringify(vals)],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); } finally { client.release(); }
}

// ── GET /properties/tenants ───────────────────────────────────────────────────
// List all property tenants (people/companies who pay rent). Supports search.

propTenantsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const search = (req.query.search as string | undefined)?.slice(0, 100);
    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (search) {
          const s = push(`%${search}%`);
          conditions.push(`(first_name ILIKE ${s} OR last_name ILIKE ${s} OR company_name ILIKE ${s} OR email ILIKE ${s})`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT id, first_name, last_name, company_name, is_company, phone, email,
                  last_modified_at, created_at
           FROM   prop_property_tenants ${where}
           ORDER  BY COALESCE(company_name, last_name, first_name) ASC`,
          params,
        ).then(r => r.rows);
      });

      logger.info({ entity: 'PROPERTIES', action: 'TENANTS_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /properties/tenants ──────────────────────────────────────────────────

propTenantsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateTenantSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = parsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const newTenant = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO prop_property_tenants
             (owner_id, first_name, last_name, company_name, is_company, phone, email,
              identification_type, identification_number, emergency_contact_name,
              emergency_contact_phone, notes, last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
           RETURNING *`,
          [ownerId, body.first_name, body.last_name ?? null, body.company_name ?? null,
           body.is_company, body.phone ?? null, body.email ?? null,
           body.identification_type ?? null, body.identification_number ?? null,
           body.emergency_contact_name ?? null, body.emergency_contact_phone ?? null,
           body.notes ?? null],
        ).then(r => r.rows[0]),
      );

      logger.info({ entity: 'PROPERTIES', action: 'TENANT_CREATED', user_id: ownerId, record_id: newTenant.id });
      await auditLog(ownerId, 'PropertyTenant', 'CREATE', newTenant.id, body);
      ok(res, newTenant, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /properties/:propertyId/mortgage ──────────────────────────────────────

propMortgageRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PropertyParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, lender_name, account_reference, mortgage_type, original_amount,
                  currency, outstanding_balance, interest_rate_percent, start_date,
                  maturity_date, monthly_payment, payment_due_day, status,
                  last_modified_at, created_at
           FROM   prop_mortgage_register
           WHERE  property_id = $1
           ORDER  BY created_at ASC`,
          [parsed.data.propertyId],
        ).then(r => r.rows),
      );

      logger.info({ entity: 'PROPERTIES', action: 'MORTGAGE_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /properties/:propertyId/mortgage ─────────────────────────────────────

propMortgageRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = PropertyParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const bodyParsed = CreateMortgageSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const { propertyId } = paramParsed.data;

    const client = await propertiesPool.connect();
    try {
      const { record, created } = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM prop_mortgage_register WHERE idempotency_key = $1`, [body.idempotency_key],
        );
        if (existing.rows.length > 0) {
          const dup = await c.query(`SELECT * FROM prop_mortgage_register WHERE id = $1`, [existing.rows[0].id]);
          return { record: dup.rows[0], created: false };
        }

        const result = await c.query(
          `INSERT INTO prop_mortgage_register
             (owner_id, property_id, lender_name, account_reference, mortgage_type,
              original_amount, currency, outstanding_balance, interest_rate_percent,
              start_date, maturity_date, monthly_payment, payment_due_day, notes, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING *`,
          [ownerId, propertyId, body.lender_name, body.account_reference ?? null,
           body.mortgage_type, body.original_amount, body.currency, body.outstanding_balance,
           body.interest_rate_percent, body.start_date, body.maturity_date ?? null,
           body.monthly_payment, body.payment_due_day, body.notes ?? null, body.idempotency_key],
        );
        return { record: result.rows[0], created: true };
      });

      logger.info({ entity: 'PROPERTIES', action: created ? 'MORTGAGE_CREATED' : 'MORTGAGE_DUPLICATE', user_id: ownerId, record_id: record.id });
      if (created) {
        // Audit — omit account_reference for OPSEC (don't log partial account numbers)
        const { account_reference: _omit, ...safeBody } = body;
        await auditLog(ownerId, 'MortgageRegister', 'CREATE', record.id, { ...safeBody, property_id: propertyId });
      }
      ok(res, record, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
