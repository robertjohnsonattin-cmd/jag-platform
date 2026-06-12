// GET  /api/v1/jabco/projects/:projectId/payment-certificates
// POST /api/v1/jabco/projects/:projectId/payment-certificates
// PATCH /api/v1/jabco/projects/:projectId/variation-orders/:voId  (approve / reject VO)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const jabcoPaymentCertsRouter = Router({ mergeParams: true });
export const jabcoVOActionRouter     = Router({ mergeParams: true });

const ProjectParam = z.object({ projectId: z.string().uuid() });
const VOParam      = z.object({ projectId: z.string().uuid(), voId: z.string().uuid() });

const CreateCertSchema = z.object({
  progress_claim_id:  z.string().uuid(),
  certificate_number: z.string().min(1).max(50),
  amount_certified:   z.number().positive(),
  issued_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  idempotency_key:    z.string().uuid(),
}).strict();

const VOActionSchema = z.object({
  action:        z.enum(['APPROVED', 'REJECTED', 'WITHDRAWN']),
  approved_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

// ── GET /projects/:projectId/payment-certificates ─────────────────────────────

jabcoPaymentCertsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ProjectParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT pc.id, pc.certificate_number,
                  pc.amount_certified, pc.vat_pct, pc.vat_amount, pc.gross_certified,
                  pc.issued_date, pc.due_date, pc.paid_date,
                  cl.claim_number, cl.period_from, cl.period_to, cl.amount_claimed,
                  pc.created_at
           FROM   jabco_payment_certificates pc
           JOIN   jabco_progress_claims cl ON cl.id = pc.progress_claim_id
           WHERE  cl.project_id = $1
           ORDER  BY pc.issued_date DESC`,
          [parsed.data.projectId],
        ).then(r => r.rows),
      );

      logger.info({ entity: 'JABCO', action: 'CERTS_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId });
      ok(res, { payment_certificates: rows });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /projects/:projectId/payment-certificates ────────────────────────────

jabcoPaymentCertsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = ProjectParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Project ID must be a valid UUID.'); return; }

    const bodyParsed = CreateCertSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const { record, created } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM jabco_payment_certificates WHERE idempotency_key = $1`, [body.idempotency_key],
        );
        if (existing.rows.length > 0) {
          const dup = await c.query(`SELECT * FROM jabco_payment_certificates WHERE id = $1`, [existing.rows[0].id]);
          return { record: dup.rows[0], created: false };
        }

        // Fetch project VAT settings via the claim.
        const projectRow = await c.query<{ vat_inclusive: boolean; vat_pct: string }>(
          `SELECT p.vat_inclusive, p.vat_pct
           FROM   jabco_progress_claims cl
           JOIN   jabco_projects p ON p.id = cl.project_id
           WHERE  cl.id = $1`,
          [body.progress_claim_id],
        ).then(r => r.rows[0] ?? null);

        const vatPct = projectRow ? parseFloat(projectRow.vat_pct) : 12.5;
        const vatInclusive = projectRow ? projectRow.vat_inclusive : false;

        // Exclusive: VAT added on top. Inclusive: VAT extracted from certified amount.
        let vatAmount: number;
        let grossCertified: number;
        if (vatInclusive) {
          vatAmount      = parseFloat((body.amount_certified * vatPct / (100 + vatPct)).toFixed(2));
          grossCertified = body.amount_certified;
        } else {
          vatAmount      = parseFloat((body.amount_certified * vatPct / 100).toFixed(2));
          grossCertified = parseFloat((body.amount_certified + vatAmount).toFixed(2));
        }

        const result = await c.query(
          `INSERT INTO jabco_payment_certificates
             (tenant_id, progress_claim_id, certificate_number, amount_certified,
              vat_pct, vat_amount, gross_certified,
              issued_date, due_date, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [tenantId, body.progress_claim_id, body.certificate_number, body.amount_certified,
           vatPct, vatAmount, grossCertified,
           body.issued_date, body.due_date ?? null, body.idempotency_key],
        );

        // Mark the claim as CERTIFIED.
        await c.query(
          `UPDATE jabco_progress_claims
           SET status = 'CERTIFIED', certified_date = $1, amount_certified = $2, updated_at = now()
           WHERE id = $3`,
          [body.issued_date, body.amount_certified, body.progress_claim_id],
        );

        return { record: result.rows[0], created: true };
      });

      logger.info({ entity: 'JABCO', action: created ? 'CERT_CREATED' : 'CERT_DUPLICATE', user_id: userId, tenant_id: tenantId, record_id: record.id });

      if (created) {
        const coreClient = await corePool.connect();
        try {
          await coreClient.query('BEGIN');
          await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId]);
          await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
          await coreClient.query(
            `INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, new_values, source)
             VALUES ($1,$2,'JabcoPaymentCertificate','CREATE',$3,$4,'API')`,
            [tenantId, userId, record.id, JSON.stringify(body)],
          );
          await coreClient.query('COMMIT');
        } catch (e) { await coreClient.query('ROLLBACK'); } finally { coreClient.release(); }
      }

      ok(res, record, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /projects/:projectId/payment-certificates/:id/pay ──────────────────
// Record client payment against a certificate.

const CertParam    = z.object({ projectId: z.string().uuid(), id: z.string().uuid() });
const PayCertSchema = z.object({
  paid_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'paid_date must be YYYY-MM-DD'),
  payment_reference: z.string().max(200).optional(),
}).strict();

jabcoPaymentCertsRouter.patch('/:id/pay', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = CertParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID in path.'); return; }

    const bodyParsed = PayCertSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = paramParsed.data;
    const { paid_date, payment_reference } = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const updated = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE jabco_payment_certificates
           SET    paid_date         = $1,
                  payment_reference = $2,
                  status            = 'PAID',
                  updated_at        = now()
           WHERE  id = $3
           RETURNING *`,
          [paid_date, payment_reference ?? null, id],
        ).then(r => r.rows[0] ?? null),
      );

      if (!updated) { err(res, 404, 'CERT_NOT_FOUND', 'Payment certificate not found.'); return; }

      logger.info({ entity: 'JABCO', action: 'CERT_PAID', user_id: userId, tenant_id: tenantId, record_id: id });
      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /projects/:projectId/variation-orders/:voId ────────────────────────
// Approve, reject, or withdraw a variation order.

jabcoVOActionRouter.patch('/:voId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = VOParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid UUID in path.'); return; }

    const bodyParsed = VOActionSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { voId } = paramParsed.data;
    const { action, approved_date } = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const updated = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE jabco_variation_orders
           SET    status        = $1,
                  approved_date = CASE WHEN $1 = 'APPROVED' THEN COALESCE($2::date, CURRENT_DATE) ELSE NULL END,
                  approved_by   = CASE WHEN $1 = 'APPROVED' THEN $3::uuid ELSE NULL END,
                  last_modified_at = now(), updated_at = now()
           WHERE  id = $4
             AND  status = 'PENDING'
           RETURNING *`,
          [action, approved_date ?? null, userId, voId],
        ).then(r => r.rows[0] ?? null),
      );

      if (!updated) { err(res, 404, 'VO_NOT_FOUND', 'Variation order not found or not in PENDING status.'); return; }

      logger.info({ entity: 'JABCO', action: `VO_${action}`, user_id: userId, tenant_id: tenantId, record_id: voId });

      const coreClient = await corePool.connect();
      try {
        await coreClient.query('BEGIN');
        await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId]);
        await coreClient.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
        await coreClient.query(
          `INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, new_values, source)
           VALUES ($1,$2,'JabcoVariationOrder',$3,$4,$5,'API')`,
          [tenantId, userId, action, voId, JSON.stringify({ action, approved_date })],
        );
        await coreClient.query('COMMIT');
      } catch (e) { await coreClient.query('ROLLBACK'); } finally { coreClient.release(); }

      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
