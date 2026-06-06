// GET  /api/v1/properties
// GET  /api/v1/properties/review-queue          ← must be before /:id
// PATCH /api/v1/properties/review-queue/:id
// GET  /api/v1/properties/:id
// GET  /api/v1/properties/:id/leases
// GET  /api/v1/properties/:id/rent-payments
// POST /api/v1/properties/:id/rent-payments

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const propertiesRouter = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const UUIDParam       = z.object({ id: z.string().uuid() });
const PropertyParam   = z.object({ propertyId: z.string().uuid() });

const PropertiesQuerySchema = z.object({
  is_rented: z.enum(['true', 'false']).optional(),
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const RentPaymentsQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const PaymentMethodEnum = z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'WIPAY', 'OTHER']);

const CreatePaymentSchema = z.object({
  lease_id:       z.string().uuid(),
  payment_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_month:   z.number().int().min(1).max(12),
  period_year:    z.number().int().min(2020).max(2100),
  amount_due:     z.number().positive(),
  amount_paid:    z.number().min(0),
  payment_method: PaymentMethodEnum,
  receipt_number: z.string().max(100).optional(),
  notes:          z.string().max(1000).optional(),
  late_fee_charged: z.number().min(0).default(0),
  idempotency_key: z.string().uuid(),
}).strict();

const ResolveReviewSchema = z.object({
  action:           z.enum(['RESOLVED', 'DISMISSED']),
  resolution_notes: z.string().max(1000).optional(),
}).strict();

// ── Shared audit helper ───────────────────────────────────────────────────────

async function auditLog(ownerId: string, entity: string, action: string, recordId: string, newValues: unknown): Promise<void> {
  const client = await corePool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', ownerId]);
    // Properties has no multi-tenant context — use null for tenant_id in audit log.
    await client.query(
      `INSERT INTO audit_log (user_id, entity, action, record_id, new_values, source)
       VALUES ($1, $2, $3, $4, $5, 'API')`,
      [ownerId, entity, action, recordId, JSON.stringify(newValues)],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    logger.warn({ entity: 'PROPERTIES', action: 'AUDIT_LOG_FAILED', error_message: (e as Error).message });
  } finally { client.release(); }
}

// ── GET /properties ────────────────────────────────────────────────────────────

propertiesRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PropertiesQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { is_rented, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const client = await propertiesPool.connect();
    try {
      const { rows, total } = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = ['p.is_active = true'];
        if (is_rented !== undefined) conditions.push(`p.is_rented = ${push(is_rented === 'true')}`);
        const where = conditions.join(' AND ');

        const countResult = await c.query<{ count: string }>(
          `SELECT count(*) FROM prop_properties p WHERE ${where}`, params,
        );
        const dataResult = await c.query(
          `SELECT p.id, p.property_code, p.name, p.address_line1, p.city,
                  p.property_type, p.tenure_type, p.bedrooms, p.bathrooms,
                  p.is_rented, p.current_valuation, p.valuation_date,
                  p.last_modified_at, p.created_at
           FROM   prop_properties p
           WHERE  ${where}
           ORDER  BY p.name ASC
           LIMIT  ${push(limit)} OFFSET ${push(offset)}`,
          params,
        );
        return { rows: dataResult.rows, total: Number(countResult.rows[0].count) };
      });

      logger.info({ entity: 'PROPERTIES', action: 'LIST', user_id: req.rlsCtx.userId, count: rows.length });
      ok(res, { properties: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /properties/review-queue ──────────────────────────────────────────────
// MUST be registered before /:id to avoid routing conflict.

propertiesRouter.get('/review-queue', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, source, raw_payload, received_at, status, resolution_notes, resolved_at
           FROM   prop_pending_review_queue
           WHERE  status = 'PENDING'
           ORDER  BY received_at ASC`,
        ).then(r => r.rows),
      );
      logger.info({ entity: 'PROPERTIES', action: 'REVIEW_QUEUE_LIST', user_id: req.rlsCtx.userId, count: rows.length });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /properties/review-queue/:id ────────────────────────────────────────

propertiesRouter.patch('/review-queue/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Review queue ID must be a valid UUID.'); return; }

    const bodyParsed = ResolveReviewSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = idParsed.data;
    const { action, resolution_notes } = bodyParsed.data;
    const { userId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const updated = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE prop_pending_review_queue
           SET    status           = $1,
                  resolution_notes = $2,
                  resolved_at      = now(),
                  resolved_by      = $3,
                  updated_at       = now()
           WHERE  id = $4
             AND  status = 'PENDING'
           RETURNING *`,
          [action, resolution_notes ?? null, userId, id],
        ).then(r => r.rows[0] ?? null),
      );

      if (!updated) { err(res, 404, 'REVIEW_ITEM_NOT_FOUND', 'Review item not found or already resolved.'); return; }

      logger.info({ entity: 'PROPERTIES', action: 'REVIEW_RESOLVED', user_id: userId, record_id: id });
      await auditLog(userId, 'PendingReviewItem', action, id, { action, resolution_notes });
      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /properties/:id ────────────────────────────────────────────────────────

propertiesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const client = await propertiesPool.connect();
    try {
      const property = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const [propResult, leaseResult, mortgageResult] = await Promise.all([
          c.query(`SELECT * FROM prop_properties WHERE id = $1`, [idParsed.data.id]),
          c.query(
            `SELECT la.id, la.lease_type, la.start_date, la.end_date, la.monthly_rent,
                    la.currency, la.security_deposit, la.payment_due_day, la.status,
                    pt.first_name, pt.last_name, pt.company_name, pt.is_company, pt.email, pt.phone
             FROM   prop_lease_agreements la
             JOIN   prop_property_tenants pt ON pt.id = la.tenant_id
             WHERE  la.property_id = $1 AND la.status = 'ACTIVE'`,
            [idParsed.data.id],
          ),
          c.query(
            `SELECT id, lender_name, mortgage_type, outstanding_balance, interest_rate_percent,
                    monthly_payment, status, maturity_date
             FROM   prop_mortgage_register WHERE property_id = $1 AND status = 'ACTIVE'`,
            [idParsed.data.id],
          ),
        ]);
        if (propResult.rows.length === 0) return null;
        return { ...propResult.rows[0], active_leases: leaseResult.rows, mortgages: mortgageResult.rows };
      });

      if (!property) { err(res, 404, 'PROPERTY_NOT_FOUND', 'Property not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'PROPERTY_GET', user_id: req.rlsCtx.userId, record_id: idParsed.data.id });
      ok(res, property);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /properties/:propertyId/leases ────────────────────────────────────────

propertiesRouter.get('/:propertyId/leases', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PropertyParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT la.*, pt.first_name, pt.last_name, pt.company_name, pt.is_company, pt.email, pt.phone
           FROM   prop_lease_agreements la
           JOIN   prop_property_tenants pt ON pt.id = la.tenant_id
           WHERE  la.property_id = $1
           ORDER  BY la.start_date DESC`,
          [parsed.data.propertyId],
        ).then(r => r.rows),
      );
      logger.info({ entity: 'PROPERTIES', action: 'LEASES_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /properties/:propertyId/rent-payments ─────────────────────────────────

propertiesRouter.get('/:propertyId/rent-payments', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = PropertyParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const queryParsed = RentPaymentsQuerySchema.safeParse(req.query);
    if (!queryParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { page, limit } = queryParsed.data;
    const offset = (page - 1) * limit;

    const client = await propertiesPool.connect();
    try {
      const { rows, total } = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const countResult = await c.query<{ count: string }>(
          `SELECT count(*) FROM prop_rent_payments rp
           JOIN prop_lease_agreements la ON la.id = rp.lease_id
           WHERE la.property_id = $1`,
          [paramParsed.data.propertyId],
        );
        const dataResult = await c.query(
          `SELECT rp.id, rp.payment_date, rp.period_month, rp.period_year,
                  rp.amount_due, rp.amount_paid, rp.payment_method,
                  rp.receipt_number, rp.wipay_reference, rp.is_late,
                  rp.late_fee_charged, rp.notes, rp.created_at
           FROM   prop_rent_payments rp
           JOIN   prop_lease_agreements la ON la.id = rp.lease_id
           WHERE  la.property_id = $1
           ORDER  BY rp.payment_date DESC
           LIMIT  $2 OFFSET $3`,
          [paramParsed.data.propertyId, limit, offset],
        );
        return { rows: dataResult.rows, total: Number(countResult.rows[0].count) };
      });

      logger.info({ entity: 'PROPERTIES', action: 'PAYMENTS_LIST', user_id: req.rlsCtx.userId });
      ok(res, { payments: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /properties/:propertyId/rent-payments ────────────────────────────────

propertiesRouter.post('/:propertyId/rent-payments', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = PropertyParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const bodyParsed = CreatePaymentSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const { payment, created } = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM prop_rent_payments WHERE idempotency_key = $1`, [body.idempotency_key],
        );
        if (existing.rows.length > 0) {
          const dup = await c.query(`SELECT * FROM prop_rent_payments WHERE id = $1`, [existing.rows[0].id]);
          return { payment: dup.rows[0], created: false };
        }

        const isLate = body.amount_paid < body.amount_due;
        const result = await c.query(
          `INSERT INTO prop_rent_payments
             (owner_id, lease_id, payment_date, period_month, period_year,
              amount_due, amount_paid, payment_method, receipt_number,
              is_late, late_fee_charged, notes, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING *`,
          [
            ownerId, body.lease_id, body.payment_date, body.period_month, body.period_year,
            body.amount_due, body.amount_paid, body.payment_method,
            body.receipt_number ?? null, isLate, body.late_fee_charged,
            body.notes ?? null, body.idempotency_key,
          ],
        );
        return { payment: result.rows[0], created: true };
      });

      logger.info({ entity: 'PROPERTIES', action: created ? 'PAYMENT_RECORDED' : 'PAYMENT_DUPLICATE', user_id: ownerId, record_id: payment.id });
      if (created) await auditLog(ownerId, 'RentPayment', 'CREATE', payment.id, body);
      ok(res, payment, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
