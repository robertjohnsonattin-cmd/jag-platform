// GET  /api/v1/bar/tabs                        — list tabs (filter by status)
// POST /api/v1/bar/tabs                        — open new tab
// GET  /api/v1/bar/tabs/:id                    — tab detail with items + payments
// POST /api/v1/bar/tabs/:id/items              — add item to open tab (stock check)
// POST /api/v1/bar/tabs/:id/items/:itemId/void — void a tab item (restores stock)
// POST /api/v1/bar/tabs/:id/close              — close tab (compute totals)
// POST /api/v1/bar/tabs/:id/settle             — record payment; settles when fully paid (idempotency)
// POST /api/v1/bar/tabs/:id/void               — void the entire tab (restores all stock)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { entertainmentPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const barTabsRouter = Router();
barTabsRouter.use(requireAuth());

const UUIDParam    = z.object({ id: z.string().uuid() });
const TabItemParam = z.object({ id: z.string().uuid(), itemId: z.string().uuid() });
const PaymentMethodEnum = z.enum(['CASH', 'CARD', 'MEMBER_CREDIT', 'COMPLIMENTARY']);

const OpenTabSchema = z.object({
  venue:              z.enum(['BAR', 'CLUB']),  // mandatory entity tag for P&L separation
  customer_name:      z.string().min(1).max(200).optional(),
  member_id:          z.string().uuid().optional(),
  table_ref:          z.string().max(50).optional(),
  add_service_charge: z.boolean().default(false),
}).strict();

const AddItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity:   z.number().int().min(1),
  notes:      z.string().max(300).optional(),
}).strict();

const SettleSchema = z.object({
  method:          PaymentMethodEnum,
  amount:          z.number().positive(),
  reference:       z.string().max(200).optional(),
  idempotency_key: z.string().uuid(),
}).strict();

// ── GET /bar/tabs ─────────────────────────────────────────────────────────────

barTabsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const statusFilter = req.query.status as string | undefined;
    const venueFilter  = req.query.venue  as string | undefined;
    const client = await entertainmentPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (statusFilter) conditions.push(`t.status = ${push(statusFilter)}`);
        if (venueFilter)  conditions.push(`t.venue = ${push(venueFilter)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT t.id, t.tab_number, t.venue, t.customer_name, t.member_id,
                  m.first_name || ' ' || m.last_name AS member_name,
                  t.table_ref, t.status, t.discount_pct, t.subtotal, t.total,
                  t.staff_user_id, t.opened_at, t.closed_at, t.settled_at
           FROM   ent_tabs t
           LEFT JOIN ent_members m ON m.id = t.member_id
           ${where}
           ORDER  BY t.opened_at DESC`,
          params,
        ).then(r => r.rows);
      });
      logger.info({ entity: 'BAR', action: 'TABS_LIST', user_id: req.rlsCtx.userId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /bar/tabs ────────────────────────────────────────────────────────────

barTabsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = OpenTabSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = parsed.data;
    const { tenantId, userId } = req.rlsCtx;

    const client = await entertainmentPool.connect();
    try {
      const tab = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // If member_id provided, fetch their active membership tier for discount.
        let discountPct = 0;
        if (body.member_id) {
          const memberCheck = await c.query<{ id: string }>(
            `SELECT id FROM ent_members WHERE id = $1 AND status = 'ACTIVE'`,
            [body.member_id],
          );
          if (memberCheck.rows.length === 0) throw Object.assign(new Error('MEMBER_NOT_FOUND'), { httpStatus: 404 });

          const tierRow = await c.query<{ bar_discount_pct: string }>(
            `SELECT t.bar_discount_pct
             FROM   ent_memberships ms
             JOIN   ent_membership_tiers t ON t.id = ms.tier_id
             WHERE  ms.member_id = $1 AND ms.status = 'ACTIVE'
             ORDER  BY t.bar_discount_pct DESC LIMIT 1`,
            [body.member_id],
          );
          if (tierRow.rows.length > 0) discountPct = parseFloat(tierRow.rows[0].bar_discount_pct);
        }

        // Snapshot service_charge_pct from config if opted in (0 if not).
        // vat_pct is snapshotted at close time when totals are computed.
        let serviceChargePct = 0;
        if (body.add_service_charge) {
          const cfg = await c.query<{ service_charge_pct: string }>(
            `SELECT service_charge_pct FROM ent_config WHERE tenant_id = $1`, [tenantId],
          ).then(r => r.rows[0] ?? null);
          if (cfg) serviceChargePct = parseFloat(cfg.service_charge_pct);
        }

        return c.query(
          `INSERT INTO ent_tabs (tenant_id, venue, customer_name, member_id, table_ref, discount_pct, service_charge_pct, staff_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [tenantId, body.venue, body.customer_name ?? null, body.member_id ?? null,
           body.table_ref ?? null, discountPct, serviceChargePct, userId],
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: body.venue, action: 'TAB_OPENED', user_id: userId, record_id: tab.id });
      ok(res, tab, 201);
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'MEMBER_NOT_FOUND', 'Member not found or not active.'); return; }
    next(e);
  }
});

// ── GET /bar/tabs/:id ─────────────────────────────────────────────────────────

barTabsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }

    const client = await entertainmentPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const tab = await c.query(
          `SELECT t.*, m.first_name || ' ' || m.last_name AS member_name
           FROM   ent_tabs t
           LEFT JOIN ent_members m ON m.id = t.member_id
           WHERE  t.id = $1`,
          [idP.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!tab) return null;

        const items = await c.query(
          `SELECT i.id, i.product_id, p.name AS product_name, p.category,
                  i.quantity, i.unit_price, i.notes, i.voided, i.created_at
           FROM   ent_tab_items i
           JOIN   ent_products p ON p.id = i.product_id
           WHERE  i.tab_id = $1
           ORDER  BY i.created_at`,
          [idP.data.id],
        ).then(r => r.rows);

        const payments = await c.query(
          `SELECT id, method, amount, reference, created_at
           FROM   ent_tab_payments WHERE tab_id = $1 ORDER BY created_at`,
          [idP.data.id],
        ).then(r => r.rows);

        return { ...tab, items, payments };
      });

      if (!result) { err(res, 404, 'TAB_NOT_FOUND', 'Tab not found.'); return; }
      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /bar/tabs/:id/items ──────────────────────────────────────────────────

barTabsRouter.post('/:id/items', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = AddItemSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const { tenantId, userId } = req.rlsCtx;

    const client = await entertainmentPool.connect();
    try {
      const item = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Tab must be OPEN.
        const tab = await c.query<{ status: string }>(
          `SELECT status FROM ent_tabs WHERE id = $1`, [idP.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!tab)              throw Object.assign(new Error('TAB_NOT_FOUND'), { httpStatus: 404 });
        if (tab.status !== 'OPEN') throw Object.assign(new Error('TAB_NOT_OPEN'), { httpStatus: 409 });

        // Product must exist and be active; check stock.
        const product = await c.query<{ price: string; stock_qty: number | null; is_active: boolean }>(
          `SELECT price, stock_qty, is_active FROM ent_products WHERE id = $1`, [body.product_id],
        ).then(r => r.rows[0] ?? null);
        if (!product || !product.is_active) throw Object.assign(new Error('PRODUCT_NOT_FOUND'), { httpStatus: 404 });

        if (product.stock_qty !== null && product.stock_qty < body.quantity) {
          throw Object.assign(new Error('INSUFFICIENT_STOCK'), { httpStatus: 409 });
        }

        // Decrement stock if tracked.
        if (product.stock_qty !== null) {
          await c.query(
            `UPDATE ent_products SET stock_qty = stock_qty - $1, updated_at = now() WHERE id = $2`,
            [body.quantity, body.product_id],
          );
        }

        return c.query(
          `INSERT INTO ent_tab_items (tenant_id, tab_id, product_id, quantity, unit_price, notes)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [tenantId, idP.data.id, body.product_id, body.quantity,
           parseFloat(product.price), body.notes ?? null],
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: 'BAR', action: 'TAB_ITEM_ADDED', user_id: userId, record_id: item.id });
      ok(res, item, 201);
    } finally { client.release(); }
  } catch (e) {
    const httpErr = e as { httpStatus?: number; message?: string };
    if (httpErr.httpStatus === 404) { err(res, 404, httpErr.message ?? 'NOT_FOUND', 'Resource not found.'); return; }
    if (httpErr.httpStatus === 409) { err(res, 409, httpErr.message ?? 'CONFLICT', httpErr.message ?? 'Conflict.'); return; }
    next(e);
  }
});

// ── POST /bar/tabs/:id/items/:itemId/void ─────────────────────────────────────

barTabsRouter.post('/:id/items/:itemId/void', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramP = TabItemParam.safeParse(req.params);
    if (!paramP.success) { err(res, 422, 'VALIDATION_ERROR', 'IDs must be valid UUIDs.'); return; }
    const { id: tabId, itemId } = paramP.data;

    const client = await entertainmentPool.connect();
    try {
      const item = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const tab = await c.query<{ status: string }>(
          `SELECT status FROM ent_tabs WHERE id = $1`, [tabId],
        ).then(r => r.rows[0] ?? null);
        if (!tab)                  throw Object.assign(new Error('TAB_NOT_FOUND'), { httpStatus: 404 });
        if (tab.status !== 'OPEN') throw Object.assign(new Error('TAB_NOT_OPEN'), { httpStatus: 409 });

        const existing = await c.query<{ product_id: string; quantity: number; voided: boolean }>(
          `SELECT product_id, quantity, voided FROM ent_tab_items WHERE id = $1 AND tab_id = $2`,
          [itemId, tabId],
        ).then(r => r.rows[0] ?? null);
        if (!existing)         throw Object.assign(new Error('ITEM_NOT_FOUND'), { httpStatus: 404 });
        if (existing.voided)   throw Object.assign(new Error('ITEM_ALREADY_VOIDED'), { httpStatus: 409 });

        // Restore stock.
        await c.query(
          `UPDATE ent_products SET stock_qty = stock_qty + $1, updated_at = now()
           WHERE id = $2 AND stock_qty IS NOT NULL`,
          [existing.quantity, existing.product_id],
        );

        return c.query(
          `UPDATE ent_tab_items SET voided = true WHERE id = $1 RETURNING *`,
          [itemId],
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: 'BAR', action: 'TAB_ITEM_VOIDED', user_id: req.rlsCtx.userId, record_id: item.id });
      ok(res, item);
    } finally { client.release(); }
  } catch (e) {
    const httpErr = e as { httpStatus?: number; message?: string };
    if (httpErr.httpStatus === 404) { err(res, 404, httpErr.message ?? 'NOT_FOUND', 'Resource not found.'); return; }
    if (httpErr.httpStatus === 409) { err(res, 409, httpErr.message ?? 'CONFLICT', httpErr.message ?? 'Conflict.'); return; }
    next(e);
  }
});

// ── POST /bar/tabs/:id/close ──────────────────────────────────────────────────
// Transitions OPEN → CLOSED; computes subtotal and total (applying member discount).

barTabsRouter.post('/:id/close', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }

    const client = await entertainmentPool.connect();
    try {
      const tab = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query<{
          status: string; discount_pct: string;
          service_charge_pct: string; tenant_id: string;
        }>(
          `SELECT status, discount_pct, service_charge_pct, tenant_id FROM ent_tabs WHERE id = $1`,
          [idP.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!existing)                  throw Object.assign(new Error('TAB_NOT_FOUND'), { httpStatus: 404 });
        if (existing.status !== 'OPEN') throw Object.assign(new Error('TAB_NOT_OPEN'), { httpStatus: 409 });

        // Snapshot current vat_pct from config at close time.
        const cfg = await c.query<{ vat_pct: string }>(
          `SELECT vat_pct FROM ent_config WHERE tenant_id = $1`, [existing.tenant_id],
        ).then(r => r.rows[0] ?? null);
        const vatPct = cfg ? parseFloat(cfg.vat_pct) : 0;

        const subtotalRow = await c.query<{ subtotal: string }>(
          `SELECT COALESCE(SUM(quantity * unit_price), 0) AS subtotal
           FROM   ent_tab_items WHERE tab_id = $1 AND voided = false`,
          [idP.data.id],
        ).then(r => r.rows[0]);

        // Calculation order:
        // 1. subtotal
        // 2. discount on subtotal (member benefit)
        // 3. service charge on discounted subtotal
        // 4. VAT on (discounted subtotal + service charge)
        const subtotal           = parseFloat(subtotalRow.subtotal);
        const discountPct        = parseFloat(existing.discount_pct);
        const serviceChargePct   = parseFloat(existing.service_charge_pct);
        const discountAmount     = parseFloat((subtotal * discountPct / 100).toFixed(2));
        const discountedSubtotal = parseFloat((subtotal - discountAmount).toFixed(2));
        const serviceChargeAmt   = parseFloat((discountedSubtotal * serviceChargePct / 100).toFixed(2));
        const vatBase            = discountedSubtotal + serviceChargeAmt;
        const vatAmount          = parseFloat((vatBase * vatPct / 100).toFixed(2));
        const total              = parseFloat((vatBase + vatAmount).toFixed(2));

        return c.query(
          `UPDATE ent_tabs
           SET status = 'CLOSED', subtotal = $1, discount_amount = $2,
               service_charge_amount = $3, vat_pct = $4, vat_amount = $5,
               total = $6, closed_at = now(), updated_at = now()
           WHERE id = $7 RETURNING *`,
          [subtotal, discountAmount, serviceChargeAmt, vatPct, vatAmount, total, idP.data.id],
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: 'BAR', action: 'TAB_CLOSED', user_id: req.rlsCtx.userId, record_id: tab.id });
      ok(res, tab);
    } finally { client.release(); }
  } catch (e) {
    const httpErr = e as { httpStatus?: number; message?: string };
    if (httpErr.httpStatus === 404) { err(res, 404, 'TAB_NOT_FOUND', 'Tab not found.'); return; }
    if (httpErr.httpStatus === 409) { err(res, 409, httpErr.message ?? 'CONFLICT', httpErr.message ?? 'Conflict.'); return; }
    next(e);
  }
});

// ── POST /bar/tabs/:id/settle ─────────────────────────────────────────────────
// Records a payment. When total payments >= tab total, status → SETTLED.
// MEMBER_CREDIT payments also debit the member's credit ledger in the same tx.

barTabsRouter.post('/:id/settle', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyP = SettleSchema.safeParse(req.body);
    if (!bodyP.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const body = bodyP.data;
    const { tenantId, userId } = req.rlsCtx;

    const client = await entertainmentPool.connect();
    try {
      const { payment, tab, created } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Idempotency check.
        const dup = await c.query<{ id: string }>(
          `SELECT id FROM ent_tab_payments WHERE idempotency_key = $1`, [body.idempotency_key],
        ).then(r => r.rows[0] ?? null);
        if (dup) {
          const existing = await c.query(`SELECT * FROM ent_tab_payments WHERE id = $1`, [dup.id]).then(r => r.rows[0]);
          const currentTab = await c.query(`SELECT * FROM ent_tabs WHERE id = $1`, [idP.data.id]).then(r => r.rows[0]);
          return { payment: existing, tab: currentTab, created: false };
        }

        const currentTab = await c.query<{ status: string; total: string; member_id: string | null }>(
          `SELECT status, total, member_id FROM ent_tabs WHERE id = $1`, [idP.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!currentTab) throw Object.assign(new Error('TAB_NOT_FOUND'), { httpStatus: 404 });
        if (!['CLOSED', 'SETTLED'].includes(currentTab.status)) {
          throw Object.assign(new Error('TAB_NOT_CLOSED'), { httpStatus: 409 });
        }
        if (currentTab.status === 'SETTLED') {
          throw Object.assign(new Error('TAB_ALREADY_SETTLED'), { httpStatus: 409 });
        }

        // For MEMBER_CREDIT: verify member has sufficient balance.
        if (body.method === 'MEMBER_CREDIT') {
          if (!currentTab.member_id) throw Object.assign(new Error('NO_MEMBER_ON_TAB'), { httpStatus: 409 });
          const balance = await c.query<{ credit_balance: string }>(
            `SELECT credit_balance FROM ent_members WHERE id = $1`, [currentTab.member_id],
          ).then(r => r.rows[0]);
          if (parseFloat(balance.credit_balance) < body.amount) {
            throw Object.assign(new Error('INSUFFICIENT_CREDIT'), { httpStatus: 409 });
          }
        }

        const newPayment = await c.query(
          `INSERT INTO ent_tab_payments (tenant_id, tab_id, method, amount, reference, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [tenantId, idP.data.id, body.method, body.amount, body.reference ?? null, body.idempotency_key],
        ).then(r => r.rows[0]);

        // Debit member credit ledger if paying with credits.
        if (body.method === 'MEMBER_CREDIT' && currentTab.member_id) {
          await c.query(
            `INSERT INTO ent_member_credits (tenant_id, member_id, amount, description, tab_payment_id, idempotency_key)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [tenantId, currentTab.member_id, -body.amount,
             `Tab #${idP.data.id} payment`, newPayment.id, body.idempotency_key + '-debit'],
          );
          await c.query(
            `UPDATE ent_members SET credit_balance = credit_balance - $1, updated_at = now() WHERE id = $2`,
            [body.amount, currentTab.member_id],
          );
        }

        // Check if fully settled.
        const paidRow = await c.query<{ paid: string }>(
          `SELECT COALESCE(SUM(amount),0) AS paid FROM ent_tab_payments WHERE tab_id = $1`,
          [idP.data.id],
        ).then(r => r.rows[0]);
        const paid  = parseFloat(paidRow.paid);
        const total = parseFloat(currentTab.total);

        let updatedTab = currentTab as Record<string, unknown>;
        if (paid >= total) {
          updatedTab = await c.query(
            `UPDATE ent_tabs SET status = 'SETTLED', settled_at = now(), updated_at = now()
             WHERE id = $1 RETURNING *`,
            [idP.data.id],
          ).then(r => r.rows[0]);
        }

        return { payment: newPayment, tab: updatedTab, created: true };
      });

      logger.info({ entity: 'BAR', action: created ? 'TAB_PAYMENT' : 'TAB_PAYMENT_DUPLICATE', user_id: userId, record_id: payment.id });
      ok(res, { payment, tab }, created ? 201 : 200);
    } finally { client.release(); }
  } catch (e) {
    const httpErr = e as { httpStatus?: number; message?: string };
    if (httpErr.httpStatus === 404) { err(res, 404, 'TAB_NOT_FOUND', 'Tab not found.'); return; }
    if (httpErr.httpStatus === 409) { err(res, 409, httpErr.message ?? 'CONFLICT', httpErr.message ?? 'Conflict.'); return; }
    next(e);
  }
});

// ── POST /bar/tabs/:id/void ───────────────────────────────────────────────────

barTabsRouter.post('/:id/void', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idP = UUIDParam.safeParse(req.params);
    if (!idP.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }

    const client = await entertainmentPool.connect();
    try {
      const tab = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const existing = await c.query<{ status: string }>(
          `SELECT status FROM ent_tabs WHERE id = $1`, [idP.data.id],
        ).then(r => r.rows[0] ?? null);
        if (!existing)                     throw Object.assign(new Error('TAB_NOT_FOUND'), { httpStatus: 404 });
        if (existing.status === 'SETTLED') throw Object.assign(new Error('TAB_ALREADY_SETTLED'), { httpStatus: 409 });
        if (existing.status === 'VOIDED')  throw Object.assign(new Error('TAB_ALREADY_VOIDED'), { httpStatus: 409 });

        // Restore all non-voided stock.
        await c.query(
          `UPDATE ent_products p
           SET stock_qty = stock_qty + i.qty, updated_at = now()
           FROM (
             SELECT product_id, SUM(quantity) AS qty
             FROM   ent_tab_items
             WHERE  tab_id = $1 AND voided = false
             GROUP  BY product_id
           ) i
           WHERE p.id = i.product_id AND p.stock_qty IS NOT NULL`,
          [idP.data.id],
        );

        return c.query(
          `UPDATE ent_tabs SET status = 'VOIDED', updated_at = now() WHERE id = $1 RETURNING *`,
          [idP.data.id],
        ).then(r => r.rows[0]);
      });
      logger.info({ entity: 'BAR', action: 'TAB_VOIDED', user_id: req.rlsCtx.userId, record_id: tab.id });
      ok(res, tab);
    } finally { client.release(); }
  } catch (e) {
    const httpErr = e as { httpStatus?: number; message?: string };
    if (httpErr.httpStatus === 404) { err(res, 404, 'TAB_NOT_FOUND', 'Tab not found.'); return; }
    if (httpErr.httpStatus === 409) { err(res, 409, httpErr.message ?? 'CONFLICT', httpErr.message ?? 'Conflict.'); return; }
    next(e);
  }
});
