// GET   /api/v1/dragonbridge/orders                          — list orders
// GET   /api/v1/dragonbridge/orders/:id                      — order detail
// PATCH /api/v1/dragonbridge/orders/:id/status               — update order status
// POST  /api/v1/dragonbridge/orders/:id/deposit              — record deposit payment (idempotency)
// GET   /api/v1/dragonbridge/orders/:id/delivery             — get delivery
// POST  /api/v1/dragonbridge/orders/:id/delivery             — create delivery record
// PATCH /api/v1/dragonbridge/orders/:id/delivery/dispatch    — mark OUT_FOR_DELIVERY
// PATCH /api/v1/dragonbridge/orders/:id/delivery/deliver     — mark DELIVERED
// GET   /api/v1/dragonbridge/orders/:id/invoices             — list invoices for order
// POST  /api/v1/dragonbridge/orders/:id/invoices             — generate FINAL or AGENCY_FEE invoice
// PATCH /api/v1/dragonbridge/invoices/:invoiceId/issue       — DRAFT → ISSUED
// PATCH /api/v1/dragonbridge/invoices/:invoiceId/pay         — ISSUED → PAID

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const dbOrdersRouter = Router();
dbOrdersRouter.use(requireAuth());

const UUIDParam        = z.object({ id: z.string().uuid() });
const InvoiceParam     = z.object({ invoiceId: z.string().uuid() });

const ORDER_STATUSES = ['CONFIRMED','IN_PRODUCTION','READY_TO_SHIP','IN_TRANSIT','CUSTOMS','DELIVERED','CANCELLED'] as const;

const UpdateStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  notes:  z.string().max(500).optional(),
}).strict();

const DepositSchema = z.object({
  idempotency_key: z.string().uuid(),
  paid_at:         z.string().datetime().optional(),
  notes:           z.string().max(500).optional(),
}).strict();

const CreateDeliverySchema = z.object({
  delivery_address: z.string().min(1).max(1000),
  contact_name:     z.string().max(100).optional(),
  contact_phone:    z.string().max(50).optional(),
  cost_ttd:         z.number().min(0).default(0),
  scheduled_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:            z.string().max(500).optional(),
  idempotency_key:  z.string().uuid(),
}).strict();

const CreateInvoiceSchema = z.object({
  invoice_type:    z.enum(['FINAL', 'AGENCY_FEE']),
  idempotency_key: z.string().uuid(),
  notes:           z.string().max(500).optional(),
}).strict();

const PayInvoiceSchema = z.object({
  payment_method: z.string().min(1).max(50),
  paid_at:        z.string().datetime().optional(),
  notes:          z.string().max(500).optional(),
}).strict();

// ── GET /dragonbridge/orders ──────────────────────────────────────────────────

dbOrdersRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const statusFilter = req.query.status as string | undefined;
  const clientFilter = req.query.client_id as string | undefined;

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (statusFilter) conditions.push(`o.status = ${push(statusFilter)}`);
        if (clientFilter) conditions.push(`o.client_id = ${push(clientFilter)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT o.id, o.jag_role, o.status, o.quoted_total_ttd,
                  o.deposit_pct, o.deposit_amount_ttd, o.deposit_paid_at,
                  o.client_id, cl.name AS client_name, cl.client_type,
                  o.quote_id, o.created_at, o.updated_at
           FROM db_orders o
           JOIN db_clients cl ON cl.id = o.client_id
           ${where}
           ORDER BY o.created_at DESC`,
          params,
        ).then((r) => r.rows);
      });
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── GET /dragonbridge/orders/:id ──────────────────────────────────────────────

dbOrdersRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid order id.'); return; }
  const { id } = paramParsed.data;

  try {
    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const [orderRes, shipmentRes, reconRes, deliveryRes, invoiceRes] = await Promise.all([
          c.query(
            `SELECT o.id, o.jag_role, o.status, o.quoted_total_ttd,
                    o.deposit_pct, o.deposit_amount_ttd, o.deposit_paid_at, o.notes,
                    o.client_id, cl.name AS client_name, cl.client_type, o.quote_id,
                    o.created_at, o.updated_at
             FROM db_orders o
             JOIN db_clients cl ON cl.id = o.client_id
             WHERE o.id = $1`,
            [id],
          ),
          c.query(
            `SELECT s.id, s.container_ref, s.vessel_name, s.eta, s.ata, s.status,
                    os.freight_share_pct
             FROM db_order_shipments os
             JOIN db_shipments s ON s.id = os.shipment_id
             WHERE os.order_id = $1`,
            [id],
          ),
          c.query(
            `SELECT id, status, quoted_total_ttd, actual_total_ttd, variance_ttd, variance_pct
             FROM db_landed_cost_reconciliations WHERE order_id = $1`,
            [id],
          ),
          c.query(
            `SELECT id, status, cost_ttd, scheduled_date, delivered_at
             FROM db_local_deliveries WHERE order_id = $1`,
            [id],
          ),
          c.query(
            `SELECT id, invoice_type, status, amount_ttd, deposit_offset_ttd, balance_due_ttd,
                    issued_at, due_date, paid_at
             FROM db_invoices WHERE order_id = $1 ORDER BY created_at`,
            [id],
          ),
        ]);
        if (orderRes.rows.length === 0) return null;
        return {
          ...orderRes.rows[0],
          shipment:       shipmentRes.rows[0]    ?? null,
          reconciliation: reconRes.rows[0]       ?? null,
          delivery:       deliveryRes.rows[0]    ?? null,
          invoices:       invoiceRes.rows,
        };
      });
      if (!result) { err(res, 404, 'NOT_FOUND', 'Order not found.'); return; }
      ok(res, result);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── PATCH /dragonbridge/orders/:id/status ────────────────────────────────────

dbOrdersRouter.patch('/:id/status', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid order id.'); return; }

  const bodyParsed = UpdateStatusSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const { status, notes } = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const orderRes = await c.query(`SELECT status FROM db_orders WHERE id = $1`, [id]);
        if (orderRes.rows.length === 0) throw Object.assign(new Error('ORDER_NOT_FOUND'), { code: 'ORDER_NOT_FOUND' });
        if (orderRes.rows[0].status === 'DELIVERED' || orderRes.rows[0].status === 'CANCELLED') {
          throw Object.assign(new Error('ORDER_TERMINAL'), { code: 'ORDER_TERMINAL' });
        }
        const params: unknown[] = [status, id];
        const noteSet = notes !== undefined ? `, notes = $3` : '';
        if (notes !== undefined) params.splice(1, 0, notes);
        return c.query(
          `UPDATE db_orders SET status = $1, updated_at = now()
           ${notes !== undefined ? ', notes = $2' : ''}
           WHERE id = ${notes !== undefined ? '$3' : '$2'}
           RETURNING id, status, updated_at`,
          notes !== undefined ? [status, notes, id] : [status, id],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'ORDER_STATUS_UPDATED', order_id: id, status, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'ORDER_NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Order not found.'); return; }
      if (e.message === 'ORDER_TERMINAL')  { err(res, 409, 'ORDER_TERMINAL', 'Order is in a terminal state and cannot be updated.'); return; }
    }
    next(e);
  }
});

// ── POST /dragonbridge/orders/:id/deposit ────────────────────────────────────

dbOrdersRouter.post('/:id/deposit', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid order id.'); return; }

  const bodyParsed = DepositSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const { idempotency_key, paid_at, notes } = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Idempotency check
        const existing = await c.query(
          `SELECT id, deposit_paid_at FROM db_orders WHERE deposit_idempotency_key = $1`, [idempotency_key],
        );
        if (existing.rows.length > 0) return existing.rows[0];

        const orderRes = await c.query(
          `SELECT id, deposit_paid_at FROM db_orders WHERE id = $1`, [id],
        );
        if (orderRes.rows.length === 0) throw Object.assign(new Error('ORDER_NOT_FOUND'), { code: 'ORDER_NOT_FOUND' });
        if (orderRes.rows[0].deposit_paid_at) throw Object.assign(new Error('DEPOSIT_ALREADY_PAID'), { code: 'DEPOSIT_ALREADY_PAID' });

        return c.query(
          `UPDATE db_orders
           SET deposit_paid_at = $1, deposit_idempotency_key = $2, updated_at = now()
           WHERE id = $3
           RETURNING id, deposit_amount_ttd, deposit_paid_at`,
          [paid_at ?? new Date().toISOString(), idempotency_key, id],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'DEPOSIT_RECORDED', order_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'ORDER_NOT_FOUND')      { err(res, 404, 'NOT_FOUND', 'Order not found.'); return; }
      if (e.message === 'DEPOSIT_ALREADY_PAID') { err(res, 409, 'DEPOSIT_ALREADY_PAID', 'Deposit has already been recorded for this order.'); return; }
    }
    next(e);
  }
});

// ── GET /dragonbridge/orders/:id/delivery ────────────────────────────────────

dbOrdersRouter.get('/:id/delivery', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid order id.'); return; }
  const { id } = paramParsed.data;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, delivery_address, contact_name, contact_phone, cost_ttd,
                  status, scheduled_date, delivered_at, notes
           FROM db_local_deliveries WHERE order_id = $1`,
          [id],
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'No delivery record for this order.'); return; }
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /dragonbridge/orders/:id/delivery ───────────────────────────────────
// Gate: balance must be collected before delivery can be dispatched (enforced at dispatch).
// Creating the delivery record is allowed once customs are cleared.

dbOrdersRouter.post('/:id/delivery', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid order id.'); return; }

  const bodyParsed = CreateDeliverySchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const d = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Idempotency check
        const existing = await c.query(
          `SELECT id FROM db_local_deliveries WHERE idempotency_key = $1`, [d.idempotency_key],
        );
        if (existing.rows.length > 0) return existing.rows[0];

        const orderRes = await c.query(`SELECT id FROM db_orders WHERE id = $1`, [id]);
        if (orderRes.rows.length === 0) throw Object.assign(new Error('ORDER_NOT_FOUND'), { code: 'ORDER_NOT_FOUND' });

        const dupRes = await c.query(`SELECT id FROM db_local_deliveries WHERE order_id = $1`, [id]);
        if (dupRes.rows.length > 0) throw Object.assign(new Error('DELIVERY_EXISTS'), { code: 'DELIVERY_EXISTS' });

        return c.query(
          `INSERT INTO db_local_deliveries
             (tenant_id, order_id, delivery_address, contact_name, contact_phone,
              cost_ttd, scheduled_date, notes, idempotency_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id, delivery_address, cost_ttd, status, scheduled_date`,
          [tenantId, id, d.delivery_address, d.contact_name ?? null, d.contact_phone ?? null,
           d.cost_ttd, d.scheduled_date ?? null, d.notes ?? null, d.idempotency_key, userId],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'DELIVERY_CREATED', order_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'ORDER_NOT_FOUND')  { err(res, 404, 'NOT_FOUND', 'Order not found.'); return; }
      if (e.message === 'DELIVERY_EXISTS')  { err(res, 409, 'DELIVERY_EXISTS', 'A delivery record already exists for this order.'); return; }
    }
    next(e);
  }
});

// ── PATCH /dragonbridge/orders/:id/delivery/dispatch ─────────────────────────
// Gate: balance invoice must be PAID before dispatch is allowed.

dbOrdersRouter.patch('/:id/delivery/dispatch', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid order id.'); return; }
  const { id } = paramParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const deliveryRes = await c.query(
          `SELECT id, status FROM db_local_deliveries WHERE order_id = $1`, [id],
        );
        if (deliveryRes.rows.length === 0) throw Object.assign(new Error('NO_DELIVERY'), { code: 'NO_DELIVERY' });
        if (deliveryRes.rows[0].status !== 'SCHEDULED') {
          throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });
        }

        // Enforce balance collection: final invoice must be PAID
        const finalInvoiceRes = await c.query(
          `SELECT id, status FROM db_invoices WHERE order_id = $1 AND invoice_type = 'FINAL'`, [id],
        );
        if (finalInvoiceRes.rows.length === 0 || finalInvoiceRes.rows[0].status !== 'PAID') {
          throw Object.assign(new Error('BALANCE_NOT_PAID'), { code: 'BALANCE_NOT_PAID' });
        }

        return c.query(
          `UPDATE db_local_deliveries SET status = 'OUT_FOR_DELIVERY', updated_at = now()
           WHERE order_id = $1 RETURNING id, status, updated_at`,
          [id],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'DELIVERY_DISPATCHED', order_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'NO_DELIVERY')      { err(res, 404, 'NOT_FOUND', 'No delivery record for this order.'); return; }
      if (e.message === 'INVALID_STATUS')   { err(res, 409, 'INVALID_STATUS', 'Delivery must be in SCHEDULED status to dispatch.'); return; }
      if (e.message === 'BALANCE_NOT_PAID') { err(res, 409, 'BALANCE_NOT_PAID', 'Final invoice must be paid before dispatching delivery.'); return; }
    }
    next(e);
  }
});

// ── PATCH /dragonbridge/orders/:id/delivery/deliver ──────────────────────────

dbOrdersRouter.patch('/:id/delivery/deliver', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid order id.'); return; }
  const { id } = paramParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const deliveryRes = await c.query(
          `SELECT id, status FROM db_local_deliveries WHERE order_id = $1`, [id],
        );
        if (deliveryRes.rows.length === 0) throw Object.assign(new Error('NO_DELIVERY'), { code: 'NO_DELIVERY' });
        if (deliveryRes.rows[0].status !== 'OUT_FOR_DELIVERY') {
          throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });
        }
        await c.query(
          `UPDATE db_local_deliveries
           SET status = 'DELIVERED', delivered_at = now(), updated_at = now()
           WHERE order_id = $1`,
          [id],
        );
        await c.query(
          `UPDATE db_orders SET status = 'DELIVERED', updated_at = now() WHERE id = $1`, [id],
        );
        return c.query(
          `SELECT id, status, delivered_at FROM db_local_deliveries WHERE order_id = $1`, [id],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'DELIVERY_COMPLETED', order_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'NO_DELIVERY')    { err(res, 404, 'NOT_FOUND', 'No delivery record for this order.'); return; }
      if (e.message === 'INVALID_STATUS') { err(res, 409, 'INVALID_STATUS', 'Delivery must be OUT_FOR_DELIVERY to mark as delivered.'); return; }
    }
    next(e);
  }
});

// ── GET /dragonbridge/orders/:id/invoices ────────────────────────────────────

dbOrdersRouter.get('/:id/invoices', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid order id.'); return; }
  const { id } = paramParsed.data;

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, invoice_type, status, amount_ttd, deposit_offset_ttd,
                  balance_due_ttd, issued_at, due_date, paid_at, payment_method
           FROM db_invoices WHERE order_id = $1 ORDER BY created_at`,
          [id],
        ).then((r) => r.rows),
      );
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /dragonbridge/orders/:id/invoices ───────────────────────────────────
// Generates FINAL or AGENCY_FEE invoice. DEPOSIT is auto-generated on quote accept.
// FINAL: amount = reconciliation actual_total_ttd; deposit offset applied; balance = amount - deposit.
// AGENCY_FEE: AGENT mode only; amount = est_agency_fee_ttd from the quote.

dbOrdersRouter.post('/:id/invoices', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid order id.'); return; }

  const bodyParsed = CreateInvoiceSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const { invoice_type, idempotency_key, notes } = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Idempotency check
        const existing = await c.query(
          `SELECT id FROM db_invoices WHERE idempotency_key = $1`, [idempotency_key],
        );
        if (existing.rows.length > 0) return existing.rows[0];

        const orderRes = await c.query(
          `SELECT o.id, o.jag_role, o.deposit_amount_ttd, o.deposit_paid_at,
                  q.est_agency_fee_ttd
           FROM db_orders o
           JOIN db_quotes q ON q.id = o.quote_id
           WHERE o.id = $1`,
          [id],
        );
        if (orderRes.rows.length === 0) throw Object.assign(new Error('ORDER_NOT_FOUND'), { code: 'ORDER_NOT_FOUND' });
        const order = orderRes.rows[0];

        // Prevent duplicate invoice type
        const dupRes = await c.query(
          `SELECT id FROM db_invoices WHERE order_id = $1 AND invoice_type = $2`, [id, invoice_type],
        );
        if (dupRes.rows.length > 0) throw Object.assign(new Error('INVOICE_EXISTS'), { code: 'INVOICE_EXISTS' });

        let amountTtd: number;
        let depositOffsetTtd = 0;

        if (invoice_type === 'FINAL') {
          const reconRes = await c.query(
            `SELECT actual_total_ttd, status FROM db_landed_cost_reconciliations WHERE order_id = $1`, [id],
          );
          if (reconRes.rows.length === 0) throw Object.assign(new Error('NO_RECONCILIATION'), { code: 'NO_RECONCILIATION' });
          if (!['AUTO_CLOSED', 'APPROVED'].includes(reconRes.rows[0].status)) {
            throw Object.assign(new Error('RECON_NOT_READY'), { code: 'RECON_NOT_READY' });
          }
          amountTtd     = Number(reconRes.rows[0].actual_total_ttd);
          depositOffsetTtd = order.deposit_paid_at ? Number(order.deposit_amount_ttd) : 0;
        } else {
          // AGENCY_FEE — AGENT mode only
          if (order.jag_role !== 'AGENT') throw Object.assign(new Error('NOT_AGENT_MODE'), { code: 'NOT_AGENT_MODE' });
          if (!order.est_agency_fee_ttd)  throw Object.assign(new Error('NO_AGENCY_FEE'), { code: 'NO_AGENCY_FEE' });
          amountTtd = Number(order.est_agency_fee_ttd);
        }

        const balanceDue = Math.max(0, amountTtd - depositOffsetTtd);

        return c.query(
          `INSERT INTO db_invoices
             (tenant_id, order_id, invoice_type, amount_ttd, deposit_offset_ttd,
              balance_due_ttd, notes, idempotency_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id, invoice_type, status, amount_ttd, deposit_offset_ttd,
                     balance_due_ttd, created_at`,
          [tenantId, id, invoice_type, amountTtd, depositOffsetTtd, balanceDue,
           notes ?? null, idempotency_key, userId],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'INVOICE_CREATED', order_id: id, type: invoice_type, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'ORDER_NOT_FOUND')   { err(res, 404, 'NOT_FOUND', 'Order not found.'); return; }
      if (e.message === 'INVOICE_EXISTS')    { err(res, 409, 'INVOICE_EXISTS', `A ${invoice_type} invoice already exists for this order.`); return; }
      if (e.message === 'NO_RECONCILIATION') { err(res, 409, 'NO_RECONCILIATION', 'No reconciliation exists for this order.'); return; }
      if (e.message === 'RECON_NOT_READY')   { err(res, 409, 'RECON_NOT_READY', 'Reconciliation must be AUTO_CLOSED or APPROVED before generating a final invoice.'); return; }
      if (e.message === 'NOT_AGENT_MODE')    { err(res, 409, 'NOT_AGENT_MODE', 'AGENCY_FEE invoices are only valid for AGENT-mode orders.'); return; }
      if (e.message === 'NO_AGENCY_FEE')     { err(res, 409, 'NO_AGENCY_FEE', 'No agency fee was set on the quote for this order.'); return; }
    }
    next(e);
  }
});

// ── PATCH /dragonbridge/invoices/:invoiceId/issue ────────────────────────────

dbOrdersRouter.patch('/invoices/:invoiceId/issue', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = InvoiceParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid invoice id.'); return; }
  const { invoiceId } = paramParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const invRes = await c.query(`SELECT status FROM db_invoices WHERE id = $1`, [invoiceId]);
        if (invRes.rows.length === 0) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
        if (invRes.rows[0].status !== 'DRAFT') throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });
        return c.query(
          `UPDATE db_invoices SET status = 'ISSUED', issued_at = now(), updated_at = now()
           WHERE id = $1 RETURNING id, status, issued_at`,
          [invoiceId],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'INVOICE_ISSUED', invoice_id: invoiceId, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'NOT_FOUND')     { err(res, 404, 'NOT_FOUND', 'Invoice not found.'); return; }
      if (e.message === 'INVALID_STATUS'){ err(res, 409, 'INVALID_STATUS', 'Only DRAFT invoices can be issued.'); return; }
    }
    next(e);
  }
});

// ── PATCH /dragonbridge/invoices/:invoiceId/pay ──────────────────────────────

dbOrdersRouter.patch('/invoices/:invoiceId/pay', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = InvoiceParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid invoice id.'); return; }

  const bodyParsed = PayInvoiceSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { invoiceId } = paramParsed.data;
  const { payment_method, paid_at, notes } = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const invRes = await c.query(`SELECT status FROM db_invoices WHERE id = $1`, [invoiceId]);
        if (invRes.rows.length === 0) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
        if (invRes.rows[0].status !== 'ISSUED') throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });
        return c.query(
          `UPDATE db_invoices
           SET status = 'PAID', paid_at = $1, payment_method = $2, updated_at = now()
           WHERE id = $3
           RETURNING id, status, paid_at, payment_method`,
          [paid_at ?? new Date().toISOString(), payment_method, invoiceId],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'INVOICE_PAID', invoice_id: invoiceId, user_id: userId, tenant_id: tenantId, payment_method });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'NOT_FOUND')     { err(res, 404, 'NOT_FOUND', 'Invoice not found.'); return; }
      if (e.message === 'INVALID_STATUS'){ err(res, 409, 'INVALID_STATUS', 'Only ISSUED invoices can be marked as paid.'); return; }
    }
    next(e);
  }
});
