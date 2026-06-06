// GET   /api/v1/dragonbridge/reconciliations       — list reconciliations (filter: status)
// GET   /api/v1/dragonbridge/reconciliations/:id   — reconciliation detail
// PATCH /api/v1/dragonbridge/reconciliations/:id/approve
//         PENDING_REVIEW → APPROVED → auto-generates FINAL invoice

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const dbReconciliationsRouter = Router();
dbReconciliationsRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

// ── GET /dragonbridge/reconciliations ─────────────────────────────────────────

dbReconciliationsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const statusFilter = req.query.status as string | undefined;

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where = statusFilter ? `WHERE r.status = ${push(statusFilter)}` : '';
        return c.query(
          `SELECT r.id, r.order_id, r.status, r.quoted_total_ttd, r.actual_total_ttd,
                  r.variance_ttd, r.variance_pct, r.approved_at,
                  cl.name AS client_name, o.jag_role, r.created_at
           FROM db_landed_cost_reconciliations r
           JOIN db_orders o ON o.id = r.order_id
           JOIN db_clients cl ON cl.id = o.client_id
           ${where}
           ORDER BY r.created_at DESC`,
          params,
        ).then((r) => r.rows);
      });
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── GET /dragonbridge/reconciliations/:id ─────────────────────────────────────

dbReconciliationsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid reconciliation id.'); return; }
  const { id } = paramParsed.data;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT r.id, r.order_id, r.status,
                  r.quoted_total_ttd,
                  r.actual_supplier_cost_ttd, r.actual_freight_ttd, r.actual_insurance_ttd,
                  r.actual_duty_ttd, r.actual_vat_ttd, r.actual_local_delivery_ttd,
                  r.actual_margin_ttd, r.actual_total_ttd,
                  r.variance_ttd, r.variance_pct,
                  r.approved_by, r.approved_at, r.notes, r.created_at,
                  cl.name AS client_name, o.jag_role, o.quoted_total_ttd AS order_quoted_total
           FROM db_landed_cost_reconciliations r
           JOIN db_orders o ON o.id = r.order_id
           JOIN db_clients cl ON cl.id = o.client_id
           WHERE r.id = $1`,
          [id],
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Reconciliation not found.'); return; }
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── PATCH /dragonbridge/reconciliations/:id/approve ───────────────────────────
// Robert manually approves a PENDING_REVIEW reconciliation.
// On approval: status → APPROVED, FINAL invoice is auto-generated (DRAFT).
// Client pays variance — JAG never absorbs it by default.

dbReconciliationsRouter.patch('/:id/approve', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid reconciliation id.'); return; }
  const { id } = paramParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        await c.query('BEGIN');
        try {
          const reconRes = await c.query(
            `SELECT r.id, r.status, r.order_id, r.actual_total_ttd
             FROM db_landed_cost_reconciliations r
             WHERE r.id = $1 FOR UPDATE`,
            [id],
          );
          if (reconRes.rows.length === 0) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
          if (reconRes.rows[0].status !== 'PENDING_REVIEW') {
            throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });
          }

          const recon   = reconRes.rows[0];
          const orderId = recon.order_id;

          // Prevent duplicate FINAL invoice
          const existingInvoice = await c.query(
            `SELECT id FROM db_invoices WHERE order_id = $1 AND invoice_type = 'FINAL'`, [orderId],
          );
          if (existingInvoice.rows.length > 0) {
            throw Object.assign(new Error('INVOICE_EXISTS'), { code: 'INVOICE_EXISTS' });
          }

          // Approve the reconciliation
          await c.query(
            `UPDATE db_landed_cost_reconciliations
             SET status = 'APPROVED', approved_by = $1, approved_at = now(), updated_at = now()
             WHERE id = $2`,
            [userId, id],
          );

          // Generate FINAL invoice
          const orderRes = await c.query(
            `SELECT deposit_amount_ttd, deposit_paid_at FROM db_orders WHERE id = $1`, [orderId],
          );
          const order = orderRes.rows[0];
          const actualTotalTtd  = Number(recon.actual_total_ttd);
          const depositOffset   = order.deposit_paid_at ? Number(order.deposit_amount_ttd) : 0;
          const balanceDue      = Math.max(0, actualTotalTtd - depositOffset);

          const invoiceRes = await c.query(
            `INSERT INTO db_invoices
               (tenant_id, order_id, invoice_type, amount_ttd, deposit_offset_ttd,
                balance_due_ttd, idempotency_key, created_by)
             VALUES ($1,$2,'FINAL',$3,$4,$5,gen_random_uuid(),$6)
             RETURNING id, invoice_type, status, amount_ttd, deposit_offset_ttd, balance_due_ttd`,
            [tenantId, orderId, actualTotalTtd, depositOffset, balanceDue, userId],
          );

          await c.query('COMMIT');
          return {
            reconciliation_id: id,
            status: 'APPROVED',
            final_invoice: invoiceRes.rows[0],
          };
        } catch (err2) {
          await c.query('ROLLBACK');
          throw err2;
        }
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'RECONCILIATION_APPROVED', reconciliation_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, result);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'NOT_FOUND')      { err(res, 404, 'NOT_FOUND', 'Reconciliation not found.'); return; }
      if (e.message === 'INVALID_STATUS') { err(res, 409, 'INVALID_STATUS', 'Only PENDING_REVIEW reconciliations can be approved.'); return; }
      if (e.message === 'INVOICE_EXISTS') { err(res, 409, 'INVOICE_EXISTS', 'A final invoice already exists for this order.'); return; }
    }
    next(e);
  }
});
