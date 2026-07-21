// GET    /api/v1/properties
// GET    /api/v1/properties/review-queue          ← must be before /:id
// PATCH  /api/v1/properties/review-queue/:id
// GET    /api/v1/properties/:id
// PATCH  /api/v1/properties/:id
// DELETE /api/v1/properties/:id                  (Owner only — hard delete if no financial records)
// GET    /api/v1/properties/:id/valuation-history
// POST   /api/v1/properties/:id/valuation-history — manual backfill
// GET    /api/v1/properties/:id/leases
// GET    /api/v1/properties/:id/rent-payments
// POST   /api/v1/properties/:id/rent-payments
// GET    /api/v1/properties/:id/rent-payments/:paymentId/receipt

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Readable } from 'stream';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { generateLeaseAgreementPdf, type LeaseSignField } from '../../lib/lease-pdf';
import { createSigningSubmission } from '../../lib/documenso';
import { sendTemplate } from '../../lib/whatsapp';
import { getPaymentDetails } from '../../lib/payment-config';
import { calculateFirstPeriodRent } from './rent-schedule';
import multer from 'multer';
import { minioClient, ensureBucket, getObjectStream, mediaObjectKey, BUCKET_DOCUMENTS, BUCKET_SIGNED_DOCUMENTS } from '../../lib/minio';
import PDFDocument from 'pdfkit';

const leaseUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

export const propertiesRouter = Router();

// prop_properties.is_rented is a single flag set true the moment ANY lease
// exists on the property (see send-for-signing / lease creation below) — for
// a multi-unit building that's misleading (e.g. 1 of 4 units rented still
// showed "Rented" for the whole building). Derive a 3-way status from actual
// unit occupancy when the property has units; fall back to the plain flag for
// properties with no sub-units at all.
type OccupancyRow = { is_rented: boolean; total_units: number | string; rented_units: number | string };
function occupancyStatus(row: OccupancyRow): 'VACANT' | 'PARTIALLY_RENTED' | 'RENTED' {
  const total = Number(row.total_units);
  const rented = Number(row.rented_units);
  if (total > 0) {
    if (rented === 0) return 'VACANT';
    if (rented === total) return 'RENTED';
    return 'PARTIALLY_RENTED';
  }
  return row.is_rented ? 'RENTED' : 'VACANT';
}

function pdfDocToBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const UUIDParam       = z.object({ id: z.string().uuid() });
const PropertyParam   = z.object({ propertyId: z.string().uuid() });

const PropertiesQuerySchema = z.object({
  is_rented: z.enum(['true', 'false']).optional(),
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
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
  receipt_number:  z.string().max(100).optional(),
  notes:           z.string().max(1000).optional(),
  late_fee_charged: z.number().min(0).default(0),
  proof_image_url: z.string().max(1000).optional(),
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

const CreatePropertySchema = z.object({
  name:             z.string().min(1).max(200),
  property_code:    z.string().min(1).max(20),
  address_line1:    z.string().max(300).optional(),
  address_line2:    z.string().max(300).optional(),
  city:             z.string().max(100).optional(),
  country:          z.string().max(100).default('Trinidad and Tobago'),
  property_type:    z.enum(['RESIDENTIAL', 'COMMERCIAL', 'LAND', 'MIXED', 'AGRICULTURAL']),
  tenure_type:      z.enum(['FREEHOLD', 'LEASEHOLD', 'STATE_LAND']).default('FREEHOLD'),
  bedrooms:         z.number().int().min(0).optional(),
  bathrooms:        z.number().min(0).optional(),
  lot_size_sqm:     z.number().positive().optional(),
  floor_area_sqm:   z.number().positive().optional(),
  purchase_price:   z.number().positive().optional(),
  purchase_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  current_valuation: z.number().positive().optional(),
  valuation_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:            z.string().optional(),
}).strict();

const CreateLeaseSchema = z.object({
  tenant_id:           z.string().uuid(),
  unit_id:             z.string().uuid().optional(),
  lease_type:          z.enum(['RESIDENTIAL', 'COMMERCIAL', 'SHORT_TERM', 'OTHER']).default('RESIDENTIAL'),
  start_date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  monthly_rent:        z.number().positive(),
  security_deposit:    z.number().min(0).default(0),
  payment_due_day:     z.number().int().min(1).max(28).default(1),
  currency:            z.string().length(3).default('TTD'),
  late_fee_type:       z.enum(['NONE','FIXED','PERCENT']).default('NONE'),
  late_fee_value:      z.number().min(0).default(0),
  late_fee_grace_days: z.number().int().min(0).default(0),
  notes:               z.string().optional(),
}).strict();

// ── POST /properties ──────────────────────────────────────────────────────────

propertiesRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreatePropertySchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const b = parsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const property = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO prop_properties
             (owner_id, name, property_code, address_line1, address_line2, city, country,
              property_type, tenure_type, bedrooms, bathrooms, lot_size_sqm, floor_area_sqm,
              purchase_price, purchase_date, current_valuation, valuation_date, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           RETURNING *`,
          [
            ownerId, b.name, b.property_code, b.address_line1 ?? null, b.address_line2 ?? null,
            b.city ?? null, b.country, b.property_type, b.tenure_type,
            b.bedrooms ?? null, b.bathrooms ?? null, b.lot_size_sqm ?? null, b.floor_area_sqm ?? null,
            b.purchase_price ?? null, b.purchase_date ?? null, b.current_valuation ?? null,
            b.valuation_date ?? null, b.notes ?? null,
          ],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'PROPERTIES', action: 'PROPERTY_CREATED', user_id: ownerId, record_id: property.id });
      await auditLog(ownerId, 'Property', 'CREATE', property.id, { name: b.name, property_code: b.property_code });
      ok(res, property, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

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
                  p.last_modified_at, p.created_at,
                  COALESCE(u.total_units, 0) AS total_units,
                  COALESCE(u.rented_units, 0) AS rented_units
           FROM   prop_properties p
           LEFT JOIN (
             SELECT property_id, COUNT(*) AS total_units,
                    COUNT(*) FILTER (WHERE is_rented) AS rented_units
             FROM   prop_units
             GROUP  BY property_id
           ) u ON u.property_id = p.id
           WHERE  ${where}
           ORDER  BY p.name ASC
           LIMIT  ${push(limit)} OFFSET ${push(offset)}`,
          params,
        );
        const rows = dataResult.rows.map(r => ({ ...r, occupancy_status: occupancyStatus(r) }));
        return { rows, total: Number(countResult.rows[0].count) };
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

// ── GET /properties/arrears ───────────────────────────────────────────────────
// MUST stay before GET /:id — Express matches in order; 'arrears' is not a UUID
// but /:id would capture it first and return 422.

propertiesRouter.get('/arrears', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT rp.id, rp.payment_date, rp.period_month, rp.period_year,
                  rp.amount_due, rp.amount_paid,
                  (rp.amount_due - rp.amount_paid) AS balance_owed,
                  rp.late_fee_charged, rp.is_late,
                  la.id        AS lease_id,
                  la.monthly_rent,
                  p.id         AS property_id,
                  p.name       AS property_name,
                  p.property_code,
                  COALESCE(t.company_name, CONCAT(t.first_name, ' ', COALESCE(t.last_name, ''))) AS tenant_name,
                  t.email      AS tenant_email,
                  t.phone      AS tenant_phone,
                  (CURRENT_DATE - rp.payment_date) AS days_overdue
           FROM   prop_rent_payments rp
           JOIN   prop_lease_agreements la ON la.id   = rp.lease_id
           JOIN   prop_properties p        ON p.id    = la.property_id
           JOIN   prop_property_tenants t  ON t.id    = la.tenant_id
           WHERE  rp.amount_paid < rp.amount_due
           ORDER  BY days_overdue DESC, balance_owed DESC`,
          [],
        ).then(r => r.rows),
      );
      logger.info({ entity: 'PROPERTIES', action: 'ARREARS_LIST', user_id: req.rlsCtx.userId, count: rows.length });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /properties/lease-expiry ──────────────────────────────────────────────
// MUST stay before GET /:id for the same reason as /arrears above.

propertiesRouter.get('/lease-expiry', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT la.id, la.start_date, la.end_date, la.monthly_rent, la.currency,
                  la.lease_type, la.status,
                  (la.end_date - CURRENT_DATE) AS days_remaining,
                  p.id   AS property_id,
                  p.name AS property_name,
                  p.property_code,
                  COALESCE(t.company_name, CONCAT(t.first_name, ' ', COALESCE(t.last_name, ''))) AS tenant_name,
                  t.email     AS tenant_email,
                  t.phone     AS tenant_phone
           FROM   prop_lease_agreements la
           JOIN   prop_properties       p ON p.id = la.property_id
           JOIN   prop_property_tenants t ON t.id = la.tenant_id
           WHERE  la.status = 'ACTIVE'
             AND  la.end_date  IS NOT NULL
             AND  la.end_date  <= CURRENT_DATE + INTERVAL '90 days'
           ORDER  BY la.end_date ASC`,
          [],
        ).then(r => r.rows),
      );
      logger.info({ entity: 'PROPERTIES', action: 'LEASE_EXPIRY_LIST', user_id: req.rlsCtx.userId, count: rows.length });
      ok(res, rows);
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
        const [propResult, leaseResult, mortgageResult, unitCountResult] = await Promise.all([
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
          c.query(
            `SELECT COUNT(*) AS total_units, COUNT(*) FILTER (WHERE is_rented) AS rented_units
             FROM   prop_units WHERE property_id = $1`,
            [idParsed.data.id],
          ),
        ]);
        if (propResult.rows.length === 0) return null;
        const occupancy = { total_units: unitCountResult.rows[0].total_units, rented_units: unitCountResult.rows[0].rented_units };
        return {
          ...propResult.rows[0],
          active_leases: leaseResult.rows,
          mortgages: mortgageResult.rows,
          ...occupancy,
          occupancy_status: occupancyStatus({ is_rented: propResult.rows[0].is_rented, ...occupancy }),
        };
      });

      if (!property) { err(res, 404, 'PROPERTY_NOT_FOUND', 'Property not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'PROPERTY_GET', user_id: req.rlsCtx.userId, record_id: idParsed.data.id });
      ok(res, property);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /properties/:id ─────────────────────────────────────────────────────

const UpdatePropertySchema = z.object({
  name:              z.string().min(1).max(200).optional(),
  address_line1:     z.string().max(300).optional(),
  address_line2:     z.string().max(300).optional(),
  city:              z.string().max(100).optional(),
  country:           z.string().max(100).optional(),
  current_valuation: z.number().positive().optional(),
  valuation_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:             z.string().optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'At least one field required.' });

propertiesRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const bodyParsed = UpdatePropertySchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = idParsed.data;
    const b = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const setClauses: string[] = [];
    const params: unknown[] = [];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

    if (b.name              !== undefined) setClauses.push(`name              = ${push(b.name)}`);
    if (b.address_line1     !== undefined) setClauses.push(`address_line1     = ${push(b.address_line1)}`);
    if (b.address_line2     !== undefined) setClauses.push(`address_line2     = ${push(b.address_line2)}`);
    if (b.city              !== undefined) setClauses.push(`city              = ${push(b.city)}`);
    if (b.country           !== undefined) setClauses.push(`country           = ${push(b.country)}`);
    if (b.current_valuation !== undefined) setClauses.push(`current_valuation = ${push(b.current_valuation)}`);
    if (b.valuation_date    !== undefined) setClauses.push(`valuation_date    = ${push(b.valuation_date)}`);
    if (b.notes             !== undefined) setClauses.push(`notes             = ${push(b.notes)}`);

    setClauses.push(`last_modified_at = now()`);
    setClauses.push(`last_modified_by = ${push(ownerId)}`);

    const client = await propertiesPool.connect();
    try {
      const property = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const updated = await c.query(
          `UPDATE prop_properties SET ${setClauses.join(', ')}
           WHERE id = ${push(id)} AND is_active = true
           RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null);
        if (!updated) return null;

        if (b.current_valuation !== undefined) {
          await c.query(
            `INSERT INTO prop_valuation_history
               (property_id, owner_id, as_of_date, valuation_ttd)
             VALUES ($1,$2,CURRENT_DATE,$3)`,
            [updated.id, ownerId, b.current_valuation],
          );
        }
        return updated;
      });

      if (!property) { err(res, 404, 'PROPERTY_NOT_FOUND', 'Property not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'PROPERTY_UPDATED', user_id: ownerId, record_id: id });
      await auditLog(ownerId, 'Property', 'UPDATE', id, b);
      ok(res, property);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /properties/:id/valuation-history ────────────────────────────────────

const ValuationHistoryBackfillSchema = z.object({
  as_of_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valuation_ttd: z.number().positive(),
  notes:         z.string().max(2000).optional(),
}).strict();

propertiesRouter.get('/:id/valuation-history', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT * FROM prop_valuation_history WHERE property_id = $1 ORDER BY as_of_date DESC, recorded_at DESC`,
          [parsed.data.id],
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /properties/:id/valuation-history (manual backfill) ─────────────────

propertiesRouter.post('/:id/valuation-history', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID.'); return; }

    const bodyParsed = ValuationHistoryBackfillSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const b = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const { rows: check } = await c.query(
          `SELECT id FROM prop_properties WHERE id = $1 AND is_active = true`, [idParsed.data.id]
        );
        if (!check.length) return null;

        return c.query(
          `INSERT INTO prop_valuation_history
             (property_id, owner_id, as_of_date, valuation_ttd, notes)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [idParsed.data.id, ownerId, b.as_of_date, b.valuation_ttd, b.notes ?? null],
        ).then(r => r.rows[0]);
      });
      if (!row) { err(res, 404, 'PROPERTY_NOT_FOUND', 'Property not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'VALUATION_HISTORY_BACKFILL', user_id: ownerId, record_id: idParsed.data.id });
      ok(res, row, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /properties/leases ──────────────────────────────────────────────────
// Every other lease route is nested under /:propertyId/leases, so there was no
// way to fetch "this tenant's leases" without already knowing the property --
// same blind spot deposits had before tenant_id was added there. Leases already
// carry tenant_id NOT NULL (see prop_lease_agreements schema), so this is a
// missing query, not a missing link.

const TenantLeasesQuery = z.object({ tenant_id: z.string().uuid() });

propertiesRouter.get('/leases', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = TenantLeasesQuery.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'tenant_id is required and must be a valid UUID.'); return; }

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT la.*, u.unit_number, p.name AS property_name
           FROM   prop_lease_agreements la
           JOIN   prop_properties p ON p.id = la.property_id
           LEFT   JOIN prop_units u ON u.id = la.unit_id
           WHERE  la.tenant_id = $1
           ORDER  BY la.start_date DESC`,
          [parsed.data.tenant_id],
        ).then(r => r.rows),
      );
      ok(res, rows);
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

// ── POST /properties/:propertyId/leases ──────────────────────────────────────

propertiesRouter.post('/:propertyId/leases', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = PropertyParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const bodyParsed = CreateLeaseSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const b = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;
    const { propertyId } = paramParsed.data;

    const client = await propertiesPool.connect();
    try {
      const lease = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        // Verify property belongs to this owner
        const prop = await c.query(`SELECT id FROM prop_properties WHERE id = $1 AND is_active = true`, [propertyId]);
        if (prop.rows.length === 0) throw Object.assign(new Error('Property not found.'), { status: 404, code: 'PROPERTY_NOT_FOUND' });

        const result = await c.query(
          `INSERT INTO prop_lease_agreements
             (owner_id, property_id, tenant_id, unit_id, lease_type, start_date, end_date,
              monthly_rent, security_deposit, payment_due_day, currency, status,
              late_fee_type, late_fee_value, late_fee_grace_days, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE',$12,$13,$14,$15)
           RETURNING *`,
          [
            ownerId, propertyId, b.tenant_id, b.unit_id ?? null, b.lease_type, b.start_date, b.end_date ?? null,
            b.monthly_rent, b.security_deposit, b.payment_due_day, b.currency,
            b.late_fee_type, b.late_fee_value, b.late_fee_grace_days, b.notes ?? null,
          ],
        );
        // Update property is_rented flag
        await c.query(`UPDATE prop_properties SET is_rented = true WHERE id = $1`, [propertyId]);
        // Also flip the specific unit's own is_rented flag — this was previously
        // only set on the property, so a multi-unit building's occupancy_status
        // (derived from unit-level is_rented) never reflected new leases at all.
        if (b.unit_id) {
          await c.query(`UPDATE prop_units SET is_rented = true WHERE id = $1`, [b.unit_id]);
          // Deposits taken before this lease existed (lease_id/tenant_id left NULL
          // at the time — see prop_deposits migration 052) only resolve back to a
          // tenant once linked. Backfill both now so the deposit surfaces under
          // the tenant it was actually for.
          await c.query(
            `UPDATE prop_deposits SET lease_id = $1, tenant_id = $2
             WHERE unit_id = $3 AND owner_id = $4 AND lease_id IS NULL`,
            [result.rows[0].id, b.tenant_id, b.unit_id, ownerId],
          );
          // Same backfill for maintenance tickets raised on this unit before the
          // lease was on file (see migration 054) -- e.g. reported during move-in.
          await c.query(
            `UPDATE prop_maintenance_tickets SET tenant_id = $1
             WHERE unit_id = $2 AND owner_id = $3 AND tenant_id IS NULL`,
            [b.tenant_id, b.unit_id, ownerId],
          );
          // Same backfill for ENTRY handover checklists done on this unit before
          // the lease was on file (see migration 055).
          await c.query(
            `UPDATE prop_handover_checklists SET tenant_id = $1
             WHERE unit_id = $2 AND owner_id = $3 AND tenant_id IS NULL`,
            [b.tenant_id, b.unit_id, ownerId],
          );
        }
        return result.rows[0];
      });
      logger.info({ entity: 'PROPERTIES', action: 'LEASE_CREATED', user_id: ownerId, record_id: lease.id });
      await auditLog(ownerId, 'Lease', 'CREATE', lease.id, { property_id: propertyId, tenant_id: b.tenant_id });
      ok(res, lease, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /properties/:propertyId/leases/:leaseId/agreement-pdf ────────────────
// Generates the lease agreement PDF straight from data already on file
// (Enter Once) — landlord/tenant/unit/property details are never re-typed.

propertiesRouter.get('/:propertyId/leases/:leaseId/agreement-pdf', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = z.object({ propertyId: z.string().uuid(), leaseId: z.string().uuid() }).safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid path parameters.'); return; }
    const { propertyId, leaseId } = paramParsed.data;

    const client = await propertiesPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT la.lease_type, la.start_date, la.end_date, la.monthly_rent, la.currency,
                  la.security_deposit, la.payment_due_day, la.late_fee_type, la.late_fee_value, la.late_fee_grace_days,
                  pt.first_name AS tenant_first_name, pt.last_name AS tenant_last_name,
                  pt.company_name AS tenant_company_name, pt.is_company AS tenant_is_company,
                  pt.identification_type AS tenant_identification_type, pt.identification_number AS tenant_identification_number,
                  pt.date_of_birth AS tenant_date_of_birth, pt.employer_name AS tenant_employer_name,
                  pt.employment_type AS tenant_employment_type, pt.phone AS tenant_phone, pt.email AS tenant_email,
                  pt.nationality AS tenant_nationality, pt.permanent_address AS tenant_permanent_address,
                  pt.occupation AS tenant_occupation, pt.work_address AS tenant_work_address,
                  pt.work_telephone AS tenant_work_telephone, pt.whatsapp_alt AS tenant_whatsapp_alt,
                  pt.occupants_count AS tenant_occupants_count, pt.occupants_detail AS tenant_occupants_detail,
                  pt.emergency_contact_name AS tenant_emergency_contact_name,
                  pt.emergency_contact_phone AS tenant_emergency_contact_phone,
                  pt.emergency_contact_relation AS tenant_emergency_contact_relation,
                  pt.emergency_contact_2_name AS tenant_emergency_contact_2_name,
                  pt.emergency_contact_2_phone AS tenant_emergency_contact_2_phone,
                  pt.emergency_contact_2_relation AS tenant_emergency_contact_2_relation,
                  p.name AS property_name, p.address_line1, p.address_line2, p.city,
                  u.unit_number, u.bedrooms, u.bathrooms, u.floor_area_sqft
           FROM   prop_lease_agreements la
           JOIN   prop_property_tenants pt ON pt.id = la.tenant_id
           JOIN   prop_properties p ON p.id = la.property_id
           LEFT JOIN prop_units u ON u.id = la.unit_id
           WHERE  la.id = $1 AND la.property_id = $2`,
          [leaseId, propertyId],
        ).then(r => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'LEASE_NOT_FOUND', 'Lease not found.'); return; }

      logger.info({ entity: 'PROPERTIES', action: 'LEASE_AGREEMENT_PDF', user_id: req.rlsCtx.userId, record_id: leaseId });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="lease-agreement-${leaseId}.pdf"`);
      const doc = generateLeaseAgreementPdf(row);
      doc.pipe(res);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /properties/:propertyId/leases/:leaseId/upload-signed ────────────────
// Wet-signed paper workflow: owner prints the agreement PDF, both parties sign,
// owner scans it and uploads the scan here. Stores it against the lease and marks
// it SIGNED (parallels the Documenso webhook path, but for offline signing).
propertiesRouter.post('/:propertyId/leases/:leaseId/upload-signed', leaseUpload.single('file'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = z.object({ propertyId: z.string().uuid(), leaseId: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid path parameters.'); return; }
    const { propertyId, leaseId } = parsed.data;
    const file = req.file;
    if (!file) { err(res, 422, 'VALIDATION_ERROR', 'No file provided.'); return; }

    const client = await propertiesPool.connect();
    try {
      const lease = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT id FROM prop_lease_agreements WHERE id = $1 AND property_id = $2`, [leaseId, propertyId])
          .then(r => r.rows[0] ?? null));
      if (!lease) { err(res, 404, 'LEASE_NOT_FOUND', 'Lease not found.'); return; }

      const key = mediaObjectKey(req.rlsCtx.userId, 'leases-signed', leaseId, file.originalname || `signed-lease-${leaseId}.pdf`);
      await ensureBucket(BUCKET_DOCUMENTS);
      await minioClient.putObject(BUCKET_DOCUMENTS, key, file.buffer, file.size, { 'Content-Type': file.mimetype || 'application/pdf' });

      await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE prop_lease_agreements
           SET signed_pdf_object_key = $1, signature_status = 'SIGNED', agreement_signed_at = NOW()
           WHERE id = $2`,
          [key, leaseId]));
      logger.info({ entity: 'PROPERTIES', action: 'LEASE_SIGNED_UPLOADED', user_id: req.rlsCtx.userId, record_id: leaseId });
      ok(res, { signed_pdf_object_key: key, signature_status: 'SIGNED' }, 200);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /properties/:propertyId/leases/:leaseId/signed-pdf ────────────────────
// Download the stored signed copy (from either Documenso or the wet-sign upload).
propertiesRouter.get('/:propertyId/leases/:leaseId/signed-pdf', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = z.object({ propertyId: z.string().uuid(), leaseId: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid path parameters.'); return; }
    const { propertyId, leaseId } = parsed.data;
    const client = await propertiesPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(`SELECT signed_pdf_object_key FROM prop_lease_agreements WHERE id = $1 AND property_id = $2`, [leaseId, propertyId])
          .then(r => r.rows[0] ?? null));
      if (!row || !row.signed_pdf_object_key) { err(res, 404, 'NOT_FOUND', 'No signed copy on file.'); return; }
      const key = row.signed_pdf_object_key as string;
      // Documenso webhook stores into BUCKET_SIGNED_DOCUMENTS; the wet-sign
      // upload path (above) stores into BUCKET_DOCUMENTS. Try the Documenso
      // bucket first, fall back to the wet-sign bucket for older uploads.
      let stream: Readable;
      try {
        stream = await getObjectStream(BUCKET_SIGNED_DOCUMENTS, key);
      } catch {
        stream = await getObjectStream(BUCKET_DOCUMENTS, key);
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="lease-signed-${leaseId}.pdf"`);
      stream.pipe(res);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /properties/:propertyId/leases/:leaseId/send-for-signing ────────────
// Generates the same Agreement PDF as above, but with Schedule B fields and
// both signature blocks turned into a Documenso signable document. Returns
// the landlord's own signing link (Robert signs immediately in-browser) and
// WhatsApps the tenant's signing link.

propertiesRouter.post('/:propertyId/leases/:leaseId/send-for-signing', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = z.object({ propertyId: z.string().uuid(), leaseId: z.string().uuid() }).safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid path parameters.'); return; }
    const { propertyId, leaseId } = paramParsed.data;

    const client = await propertiesPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT la.lease_type, la.start_date, la.end_date, la.monthly_rent, la.currency,
                  la.security_deposit, la.payment_due_day, la.late_fee_type, la.late_fee_value, la.late_fee_grace_days,
                  pt.first_name AS tenant_first_name, pt.last_name AS tenant_last_name,
                  pt.company_name AS tenant_company_name, pt.is_company AS tenant_is_company,
                  pt.identification_type AS tenant_identification_type, pt.identification_number AS tenant_identification_number,
                  pt.phone AS tenant_phone, pt.email AS tenant_email,
                  pt.date_of_birth AS tenant_date_of_birth, pt.employer_name AS tenant_employer_name,
                  pt.employment_type AS tenant_employment_type,
                  pt.nationality AS tenant_nationality, pt.permanent_address AS tenant_permanent_address,
                  pt.occupation AS tenant_occupation, pt.work_address AS tenant_work_address,
                  pt.work_telephone AS tenant_work_telephone, pt.whatsapp_alt AS tenant_whatsapp_alt,
                  pt.occupants_count AS tenant_occupants_count, pt.occupants_detail AS tenant_occupants_detail,
                  pt.emergency_contact_name AS tenant_emergency_contact_name,
                  pt.emergency_contact_phone AS tenant_emergency_contact_phone,
                  pt.emergency_contact_relation AS tenant_emergency_contact_relation,
                  pt.emergency_contact_2_name AS tenant_emergency_contact_2_name,
                  pt.emergency_contact_2_phone AS tenant_emergency_contact_2_phone,
                  pt.emergency_contact_2_relation AS tenant_emergency_contact_2_relation,
                  p.name AS property_name, p.address_line1, p.address_line2, p.city,
                  u.unit_number, u.bedrooms, u.bathrooms, u.floor_area_sqft
           FROM   prop_lease_agreements la
           JOIN   prop_property_tenants pt ON pt.id = la.tenant_id
           JOIN   prop_properties p ON p.id = la.property_id
           LEFT JOIN prop_units u ON u.id = la.unit_id
           WHERE  la.id = $1 AND la.property_id = $2`,
          [leaseId, propertyId],
        ).then(r => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'LEASE_NOT_FOUND', 'Lease not found.'); return; }

      const fields: LeaseSignField[] = [];
      const doc = generateLeaseAgreementPdf(row, fields);
      const pdf = await pdfDocToBuffer(doc);

      const tenantName = row.tenant_is_company && row.tenant_company_name
        ? row.tenant_company_name
        : `${row.tenant_first_name ?? ''} ${row.tenant_last_name ?? ''}`.trim();

      const { submissionId, embedUrls } = await createSigningSubmission({
        pdf,
        fileName: `lease-agreement-${leaseId}.pdf`,
        submitters: [
          { role: 'LANDLORD', name: 'Robert Johnson-Attin', email: 'robertjohnsonattin@gmail.com' },
          { role: 'TENANT', name: tenantName, email: row.tenant_email ?? undefined, phone: row.tenant_phone ?? undefined },
        ],
        fields: fields.map(f => ({
          name: f.name, type: f.type, role: f.role, required: true,
          areas: [{ page: f.page, x: f.x, y: f.y, w: f.w, h: f.h }],
        })),
      });

      await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE prop_lease_agreements SET documenso_document_id = $1, signature_status = 'SENT' WHERE id = $2`,
          [submissionId, leaseId],
        ),
      );

      if (row.tenant_phone && embedUrls['TENANT']) {
        // jag_onb_lease_ready: 4 body params + "Review & Sign" URL button.
        // Button url is https://sign.jagcorporate.com/{{1}} — pass the path only
        // (embedUrls['TENANT'] is https://sign.jagcorporate.com/sign/<token>).
        const signPath = embedUrls['TENANT'].replace(/^https?:\/\/[^/]+\//, '');
        sendTemplate({
          to: row.tenant_phone,
          templateName: 'jag_onb_lease_ready',
          components: [
            { type: 'body', parameters: [
              { type: 'text', text: tenantName || 'Tenant' },
              { type: 'text', text: String(row.property_name ?? '') },
              { type: 'text', text: String(row.unit_number ?? '') },
              { type: 'text', text: process.env.JAG_MANAGER_PHONE ?? '' },
            ]},
            { type: 'button', sub_type: 'url', index: '0', parameters: [
              { type: 'text', text: signPath },
            ]},
          ],
        }).catch(e => logger.warn({ entity: 'PROPERTIES', action: 'LEASE_SIGN_WA_FAILED', error_message: (e as Error).message }));

        // Immediately follow up with a single move-in payment request covering
        // BOTH the security deposit and the first month's rent (prorated to the
        // move-in date, e.g. move-in on the 20th only owes ~12/31 of the month) —
        // both are needed before handover, so ask for them together rather than
        // two separate asks landing at different points in the flow.
        const deposit = parseFloat(String(row.security_deposit ?? 0));
        const firstRent = calculateFirstPeriodRent(row.start_date, row.end_date, parseFloat(String(row.monthly_rent ?? 0)));
        const totalDue = Math.round((deposit + firstRent.amountDue) * 100) / 100;
        if (deposit > 0 || firstRent.amountDue > 0) {
          const pay = getPaymentDetails();
          sendTemplate({
            to: row.tenant_phone,
            templateName: 'jag_onb_movein_payment_request',
            components: [{ type: 'body', parameters: [
              { type: 'text', text: tenantName || 'Tenant' },
              { type: 'text', text: String(row.property_name ?? '') },
              { type: 'text', text: String(row.unit_number ?? '') },
              { type: 'text', text: `TTD $${deposit.toFixed(2)}` },
              { type: 'text', text: firstRent.periodStart },
              { type: 'text', text: `TTD $${firstRent.amountDue.toFixed(2)}` },
              { type: 'text', text: `TTD $${totalDue.toFixed(2)}` },
              { type: 'text', text: pay.payee },
              { type: 'text', text: pay.bank },
              { type: 'text', text: pay.acctType },
              { type: 'text', text: pay.acctNo },
              { type: 'text', text: process.env.JAG_MANAGER_PHONE ?? '' },
            ]}],
          }).catch(e => logger.warn({ entity: 'PROPERTIES', action: 'MOVEIN_PAYMENT_WA_FAILED', error_message: (e as Error).message }));
        }
      }

      logger.info({ entity: 'PROPERTIES', action: 'LEASE_SENT_FOR_SIGNING', user_id: req.rlsCtx.userId, record_id: leaseId, submission_id: submissionId });

      ok(res, { submissionId, landlordSigningUrl: embedUrls['LANDLORD'], tenantSigningUrl: embedUrls['TENANT'] }, 200);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /properties/:propertyId/leases/:leaseId ───────────────────────────
// Owner only. Hard deletes a lease and its rent payments if no blocking conditions.

propertiesRouter.delete('/:propertyId/leases/:leaseId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.rlsCtx.isOwner) { err(res, 403, 'FORBIDDEN', 'This action requires Owner role.'); return; }

    const paramParsed = z.object({ propertyId: z.string().uuid(), leaseId: z.string().uuid() }).safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid path parameters.'); return; }

    const { propertyId, leaseId } = paramParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const lease = await c.query(
          `SELECT id, unit_id FROM prop_lease_agreements WHERE id = $1 AND property_id = $2`,
          [leaseId, propertyId],
        ).then(r => r.rows[0] ?? null);
        if (!lease) throw Object.assign(new Error('Lease not found.'), { status: 404, code: 'LEASE_NOT_FOUND' });

        // Cascade rent payments — they are child records of the lease
        await c.query(`DELETE FROM prop_rent_payments WHERE lease_id = $1`, [leaseId]);
        await c.query(`DELETE FROM prop_lease_agreements WHERE id = $1`, [leaseId]);

        // This lease's own unit is now vacant regardless of other units in the property
        if (lease.unit_id) {
          await c.query(`UPDATE prop_units SET is_rented = false WHERE id = $1`, [lease.unit_id]);
        }

        // Update property-level is_rented flag if no active leases remain
        const remaining = await c.query(
          `SELECT count(*) FROM prop_lease_agreements WHERE property_id = $1 AND status = 'ACTIVE'`,
          [propertyId],
        ).then(r => Number(r.rows[0].count));
        if (remaining === 0) {
          await c.query(`UPDATE prop_properties SET is_rented = false WHERE id = $1`, [propertyId]);
        }
      });

      logger.info({ entity: 'PROPERTIES', action: 'LEASE_DELETED', user_id: ownerId, record_id: leaseId });
      await auditLog(ownerId, 'Lease', 'DELETE', leaseId, { property_id: propertyId });
      ok(res, { deleted: true, id: leaseId });
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; message: string };
    if (ex.status === 404) { err(res, 404, 'LEASE_NOT_FOUND', ex.message); return; }
    next(e);
  }
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
                  rp.late_fee_charged, rp.notes, rp.proof_image_url, rp.created_at
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
              is_late, late_fee_charged, notes, proof_image_url, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING *`,
          [
            ownerId, body.lease_id, body.payment_date, body.period_month, body.period_year,
            body.amount_due, body.amount_paid, body.payment_method,
            body.receipt_number ?? null, isLate, body.late_fee_charged,
            body.notes ?? null, body.proof_image_url ?? null, body.idempotency_key,
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

// ── GET /properties/:id/financial-summary ────────────────────────────────────
// Aggregates income and expenses for the last 12 calendar months.

propertiesRouter.get('/:id/financial-summary', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }
    const { id } = idParsed.data;

    const client = await propertiesPool.connect();
    try {
      const summary = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const prop = await c.query(`SELECT id, name, current_valuation FROM prop_properties WHERE id = $1 AND is_active = true`, [id]);
        if (prop.rows.length === 0) return null;

        const [rentRes, maintRes, utilRes, invoiceRes, mortgageRes] = await Promise.all([
          // Rent collected last 12 months
          c.query<{ total: string }>(`
            SELECT COALESCE(SUM(rp.amount_paid), 0) AS total
            FROM   prop_rent_payments rp
            JOIN   prop_lease_agreements la ON la.id = rp.lease_id
            WHERE  la.property_id = $1
              AND  rp.payment_date >= CURRENT_DATE - INTERVAL '12 months'`, [id]),
          // Maintenance actual costs last 12 months (completed)
          c.query<{ total: string }>(`
            SELECT COALESCE(SUM(actual_cost), 0) AS total
            FROM   prop_maintenance_requests
            WHERE  property_id = $1
              AND  status IN ('COMPLETED','CLOSED')
              AND  completed_date >= CURRENT_DATE - INTERVAL '12 months'`, [id]),
          // Utility bills last 12 months
          c.query<{ total: string }>(`
            SELECT COALESCE(SUM(amount + vat_amount), 0) AS total
            FROM   prop_utility_bills
            WHERE  property_id = $1
              AND  bill_date >= CURRENT_DATE - INTERVAL '12 months'`, [id]),
          // Paid vendor invoices last 12 months
          c.query<{ total: string }>(`
            SELECT COALESCE(SUM(amount + vat_amount), 0) AS total
            FROM   prop_vendor_invoices
            WHERE  property_id = $1
              AND  status = 'PAID'
              AND  paid_date >= CURRENT_DATE - INTERVAL '12 months'`, [id]),
          // Active mortgage annual cost
          c.query<{ total: string }>(`
            SELECT COALESCE(SUM(monthly_payment) * 12, 0) AS total
            FROM   prop_mortgage_register
            WHERE  property_id = $1 AND status = 'ACTIVE'`, [id]),
        ]);

        const rentIn        = Number(rentRes.rows[0].total);
        const maintOut      = Number(maintRes.rows[0].total);
        const utilOut       = Number(utilRes.rows[0].total);
        const invoiceOut    = Number(invoiceRes.rows[0].total);
        const mortgageOut   = Number(mortgageRes.rows[0].total);
        const totalExpenses = maintOut + utilOut + invoiceOut + mortgageOut;
        const netIncome     = rentIn - totalExpenses;
        const valuation     = Number(prop.rows[0].current_valuation ?? 0);
        const grossYield    = valuation > 0 ? (rentIn / valuation) * 100 : null;
        const netYield      = valuation > 0 ? (netIncome / valuation) * 100 : null;

        return {
          property_id:       id,
          period_months:     12,
          rent_collected:    rentIn,
          maintenance_cost:  maintOut,
          utility_cost:      utilOut,
          vendor_invoice_cost: invoiceOut,
          mortgage_cost:     mortgageOut,
          total_expenses:    totalExpenses,
          net_income:        netIncome,
          current_valuation: valuation,
          gross_yield_percent: grossYield,
          net_yield_percent:   netYield,
        };
      });

      if (!summary) { err(res, 404, 'PROPERTY_NOT_FOUND', 'Property not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'FINANCIAL_SUMMARY', user_id: req.rlsCtx.userId, record_id: id });
      ok(res, summary);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /properties/:propertyId/leases/:leaseId/refund-deposit ─────────────

const RefundDepositSchema = z.object({
  refunded_amount:  z.number().min(0),
  deductions:       z.number().min(0).default(0),
  refund_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:            z.string().max(2000).optional(),
  idempotency_key:  z.string().uuid(),
}).strict();

propertiesRouter.patch('/:propertyId/leases/:leaseId/refund-deposit', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = z.object({ propertyId: z.string().uuid(), leaseId: z.string().uuid() }).safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid path parameters.'); return; }

    const bodyParsed = RefundDepositSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { propertyId, leaseId } = paramParsed.data;
    const b = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const lease = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query(
          `SELECT id, security_deposit FROM prop_lease_agreements WHERE id = $1 AND property_id = $2`,
          [leaseId, propertyId],
        );
        if (existing.rows.length === 0) throw Object.assign(new Error('Lease not found.'), { status: 404, code: 'LEASE_NOT_FOUND' });

        const deposit = Number(existing.rows[0].security_deposit ?? 0);
        const depositStatus = b.refunded_amount >= deposit - b.deductions
          ? 'FULLY_REFUNDED'
          : 'PARTIALLY_REFUNDED';

        const result = await c.query(
          `UPDATE prop_lease_agreements
           SET  deposit_refunded_amount = $1,
                deposit_deductions      = $2,
                deposit_refund_date     = $3,
                deposit_refund_notes    = $4,
                deposit_status          = $5,
                last_modified_at        = now(),
                last_modified_by        = $6
           WHERE id = $7
           RETURNING *`,
          [b.refunded_amount, b.deductions, b.refund_date, b.notes ?? null, depositStatus, ownerId, leaseId],
        );
        return result.rows[0];
      });

      logger.info({ entity: 'PROPERTIES', action: 'DEPOSIT_REFUNDED', user_id: ownerId, record_id: leaseId });
      await auditLog(ownerId, 'Lease', 'DEPOSIT_REFUND', leaseId, b);
      ok(res, lease);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /properties/:id ────────────────────────────────────────────────────
// Owner only. Hard deletes the property if it has no financial records.
// Returns 409 DEPENDENCY_EXISTS with a blocking summary if records exist.

propertiesRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.rlsCtx.isOwner) { err(res, 403, 'FORBIDDEN', 'This action requires Owner role.'); return; }

    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Property ID must be a valid UUID.'); return; }

    const { id } = idParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const prop = await c.query(
          `SELECT id, name FROM prop_properties WHERE id = $1`,
          [id],
        ).then(r => r.rows[0] ?? null);
        if (!prop) throw Object.assign(new Error('Property not found.'), { status: 404, code: 'PROPERTY_NOT_FOUND' });

        const deps = await c.query<{
          leases: string; rent_payments: string; mortgages: string;
          maintenance: string; vendor_invoices: string; insurance: string;
          tax_records: string; inspections: string;
        }>(
          `SELECT
             (SELECT count(*) FROM prop_lease_agreements     WHERE property_id = $1)          AS leases,
             (SELECT count(*) FROM prop_rent_payments rp
              JOIN   prop_lease_agreements la ON la.id = rp.lease_id
              WHERE  la.property_id = $1)                                                     AS rent_payments,
             (SELECT count(*) FROM prop_mortgage_register    WHERE property_id = $1)          AS mortgages,
             (SELECT count(*) FROM prop_maintenance_requests WHERE property_id = $1)          AS maintenance,
             (SELECT count(*) FROM prop_vendor_invoices      WHERE property_id = $1)          AS vendor_invoices,
             (SELECT count(*) FROM prop_insurance            WHERE property_id = $1)          AS insurance,
             (SELECT count(*) FROM prop_property_tax         WHERE property_id = $1)          AS tax_records,
             (SELECT count(*) FROM prop_inspections          WHERE property_id = $1)          AS inspections`,
          [id],
        ).then(r => r.rows[0]);

        const blocking: Record<string, number> = {};
        for (const [k, v] of Object.entries(deps)) {
          const n = Number(v);
          if (n > 0) blocking[k] = n;
        }

        if (Object.keys(blocking).length > 0) {
          throw Object.assign(
            new Error('Property has dependent records and cannot be deleted.'),
            { status: 409, code: 'DEPENDENCY_EXISTS', blocking },
          );
        }

        await c.query(`DELETE FROM prop_properties WHERE id = $1`, [id]);
        return prop.name;
      }).then(async (name) => {
        logger.info({ entity: 'PROPERTIES', action: 'PROPERTY_DELETED', user_id: ownerId, record_id: id });
        await auditLog(ownerId, 'Property', 'DELETE', id, { name });
      });

      ok(res, { deleted: true, id });
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; blocking?: Record<string, number>; message: string };
    if (ex.status === 404) { err(res, 404, 'PROPERTY_NOT_FOUND', ex.message); return; }
    if (ex.status === 409) {
      res.status(409).json({ success: false, data: null, error: ex.message, code: ex.code, blocking: ex.blocking });
      return;
    }
    next(e);
  }
});

// ── PATCH /properties/:propertyId/rent-payments/:paymentId/charge-late-fee ───
// Charges a late fee on an existing payment and marks it as late.

const ChargeLateFeeSchema = z.object({
  amount:          z.number().positive(),
  idempotency_key: z.string().uuid(),
}).strict();

propertiesRouter.patch('/:propertyId/rent-payments/:paymentId/charge-late-fee', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = z.object({ propertyId: z.string().uuid(), paymentId: z.string().uuid() }).safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid path parameters.'); return; }

    const bodyParsed = ChargeLateFeeSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { propertyId, paymentId } = paramParsed.data;
    const { amount } = bodyParsed.data;
    const { userId: ownerId } = req.rlsCtx;

    const client = await propertiesPool.connect();
    try {
      const payment = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const result = await c.query(
          `UPDATE prop_rent_payments rp
           SET    late_fee_charged = $1, is_late = true
           FROM   prop_lease_agreements la
           WHERE  rp.id = $2
             AND  la.id = rp.lease_id
             AND  la.property_id = $3
           RETURNING rp.*`,
          [amount, paymentId, propertyId],
        );
        return result.rows[0] ?? null;
      });

      if (!payment) { err(res, 404, 'PAYMENT_NOT_FOUND', 'Rent payment not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'LATE_FEE_CHARGED', user_id: ownerId, record_id: paymentId, amount });
      await auditLog(ownerId, 'RentPayment', 'LATE_FEE_CHARGED', paymentId, { amount });
      ok(res, payment);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /properties/:propertyId/rent-payments/:paymentId/receipt ──────────────
// Returns structured receipt data for WhatsApp receipt generation on the frontend.

propertiesRouter.get('/:propertyId/rent-payments/:paymentId/receipt', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = z.object({
      propertyId: z.string().uuid(),
      paymentId:  z.string().uuid(),
    }).safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid path parameters.'); return; }

    const { propertyId, paymentId } = paramParsed.data;

    const client = await propertiesPool.connect();
    try {
      const receipt = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const result = await c.query(
          `SELECT
             rp.id,
             rp.payment_date,
             rp.period_month,
             rp.period_year,
             rp.amount_due,
             rp.amount_paid,
             rp.late_fee_charged,
             rp.payment_method,
             rp.receipt_number,
             rp.notes,
             rp.proof_image_url,
             rp.created_at,
             -- Lease details
             la.id              AS lease_id,
             la.monthly_rent    AS monthly_rent,
             -- Tenant details
             t.full_name        AS tenant_name,
             t.phone            AS tenant_phone,
             -- Property details
             p.name             AS property_name,
             p.address          AS property_address,
             -- Unit details (if any)
             u.unit_number      AS unit_number
           FROM   prop_rent_payments rp
           JOIN   prop_lease_agreements la ON la.id = rp.lease_id
           JOIN   prop_property_tenants t  ON t.id  = la.tenant_id
           JOIN   prop_properties p        ON p.id  = la.property_id
           LEFT JOIN prop_units u          ON u.id  = la.unit_id
           WHERE  rp.id = $1
             AND  la.property_id = $2`,
          [paymentId, propertyId],
        );
        return result.rows[0] ?? null;
      });

      if (!receipt) { err(res, 404, 'PAYMENT_NOT_FOUND', 'Rent payment not found.'); return; }
      logger.info({ entity: 'PROPERTIES', action: 'RECEIPT_FETCHED', user_id: req.rlsCtx.userId, record_id: paymentId });
      ok(res, receipt);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
