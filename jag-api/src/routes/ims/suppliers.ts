// GET    /api/v1/ims/suppliers
// POST   /api/v1/ims/suppliers
// PATCH  /api/v1/ims/suppliers/:id
//
// GET    /api/v1/ims/purchase-orders
// GET    /api/v1/ims/purchase-orders/:id
// POST   /api/v1/ims/purchase-orders
// PATCH  /api/v1/ims/purchase-orders/:id/status
// POST   /api/v1/ims/purchase-orders/:id/receive

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const imsSuppliersRouter = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateSupplierSchema = z.object({
  name:                z.string().min(1).max(200),
  contact_name:        z.string().max(200).optional(),
  phone:               z.string().max(50).optional(),
  email:               z.string().email().optional(),
  address:             z.string().max(500).optional(),
  country_code:        z.string().length(2).default('TT'),
  payment_terms_days:  z.number().int().min(0).max(365).default(30),
  notes:               z.string().max(2000).optional(),
}).strict();

const PatchSupplierSchema = z.object({
  name:                z.string().min(1).max(200).optional(),
  contact_name:        z.string().max(200).nullable().optional(),
  phone:               z.string().max(50).nullable().optional(),
  email:               z.string().email().nullable().optional(),
  address:             z.string().max(500).nullable().optional(),
  country_code:        z.string().length(2).optional(),
  payment_terms_days:  z.number().int().min(0).max(365).optional(),
  notes:               z.string().max(2000).nullable().optional(),
  is_active:           z.boolean().optional(),
}).strict().refine(o => Object.keys(o).length > 0, { message: 'At least one field required.' });

const POLineSchema = z.object({
  item_id:          z.string().uuid().optional(),
  description:      z.string().max(300).optional(),
  quantity_ordered: z.number().min(0.0001),
  unit_cost:        z.number().min(0).optional(),
  notes:            z.string().max(500).optional(),
}).strict().refine(o => o.item_id || o.description, { message: 'item_id or description is required.' });

const CreatePOSchema = z.object({
  supplier_id:            z.string().uuid(),
  order_date:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expected_delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:                  z.string().max(2000).optional(),
  lines:                  z.array(POLineSchema).min(1),
}).strict();

const POStatusSchema = z.object({
  status: z.enum(['SUBMITTED', 'CANCELLED']),
}).strict();

const ReceiveLineSchema = z.object({
  line_id:           z.string().uuid(),
  quantity_received: z.number().min(0),
}).strict();

const ReceivePOSchema = z.object({
  lines:            z.array(ReceiveLineSchema).min(1),
  receive_location_id: z.string().uuid(),
  idempotency_key:  z.string().uuid(),
  notes:            z.string().max(500).optional(),
}).strict();

const POQuerySchema = z.object({
  supplier_id: z.string().uuid().optional(),
  status:      z.string().optional(),
  page:        z.coerce.number().int().min(1).default(1),
  limit:       z.coerce.number().int().min(1).max(100).default(20),
}).strict();

// ── GET /suppliers ────────────────────────────────────────────────────────────

imsSuppliersRouter.get('/suppliers', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, name, contact_name, phone, email, country_code,
                  payment_terms_days, is_active, last_modified_at, created_at
           FROM   ims_suppliers
           WHERE  is_active = true
           ORDER  BY name ASC`,
        ).then(r => r.rows),
      );
      logger.info({ entity: 'IMS', action: 'SUPPLIERS_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /suppliers ───────────────────────────────────────────────────────────

imsSuppliersRouter.post('/suppliers', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateSupplierSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = parsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query<{ id: string }>(
          `INSERT INTO ims_suppliers
             (tenant_id, name, contact_name, phone, email, address,
              country_code, payment_terms_days, notes, last_modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id`,
          [tenantId, body.name, body.contact_name ?? null, body.phone ?? null,
           body.email ?? null, body.address ?? null, body.country_code,
           body.payment_terms_days, body.notes ?? null, userId],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'IMS', action: 'SUPPLIER_CREATED', user_id: userId, tenant_id: tenantId, record_id: row.id });
      ok(res, { id: row.id }, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /suppliers/:id ──────────────────────────────────────────────────────

imsSuppliersRouter.patch('/suppliers/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid supplier ID.'); return; }

    const bodyParsed = PatchSupplierSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = idParsed.data;
    const body   = bodyParsed.data;
    const { userId } = req.rlsCtx;

    const setCols: string[] = ['last_modified_by = $1', 'last_modified_at = now()', 'updated_at = now()'];
    const params: unknown[] = [userId];
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

    if (body.name               !== undefined) setCols.push(`name               = ${push(body.name)}`);
    if (body.contact_name       !== undefined) setCols.push(`contact_name       = ${push(body.contact_name)}`);
    if (body.phone              !== undefined) setCols.push(`phone              = ${push(body.phone)}`);
    if (body.email              !== undefined) setCols.push(`email              = ${push(body.email)}`);
    if (body.address            !== undefined) setCols.push(`address            = ${push(body.address)}`);
    if (body.country_code       !== undefined) setCols.push(`country_code       = ${push(body.country_code)}`);
    if (body.payment_terms_days !== undefined) setCols.push(`payment_terms_days = ${push(body.payment_terms_days)}`);
    if (body.notes              !== undefined) setCols.push(`notes              = ${push(body.notes)}`);
    if (body.is_active          !== undefined) setCols.push(`is_active          = ${push(body.is_active)}`);

    params.push(id);

    const client = await commercialPool.connect();
    try {
      const updated = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(`UPDATE ims_suppliers SET ${setCols.join(', ')} WHERE id = $${params.length} RETURNING id`, params)
          .then(r => r.rows[0] ?? null),
      );
      if (!updated) { err(res, 404, 'SUPPLIER_NOT_FOUND', 'Supplier not found.'); return; }
      logger.info({ entity: 'IMS', action: 'SUPPLIER_UPDATED', user_id: userId, record_id: id });
      ok(res, { id });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /purchase-orders ──────────────────────────────────────────────────────

imsSuppliersRouter.get('/purchase-orders', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = POQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { supplier_id, status, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const client = await commercialPool.connect();
    try {
      const { rows, total } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const conditions: string[] = [];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (supplier_id) conditions.push(`po.supplier_id = ${push(supplier_id)}`);
        if (status)      conditions.push(`po.status      = ${push(status)}`);

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countRes = await c.query<{ count: string }>(
          `SELECT count(*) FROM ims_purchase_orders po ${where}`, params,
        );

        const dataParams = [...params, limit, offset];
        const dataRes = await c.query(
          `SELECT po.id, po.po_number, po.status, po.order_date, po.expected_delivery_date,
                  po.notes, po.last_modified_at, po.created_at,
                  s.name AS supplier_name,
                  COUNT(pol.id)::int                                  AS line_count,
                  COALESCE(SUM(pol.quantity_ordered * pol.unit_cost)
                    FILTER (WHERE pol.unit_cost IS NOT NULL), 0)      AS total_cost
           FROM   ims_purchase_orders po
           JOIN   ims_suppliers s ON s.id = po.supplier_id
           LEFT JOIN ims_purchase_order_lines pol ON pol.po_id = po.id
           ${where}
           GROUP  BY po.id, s.name
           ORDER  BY po.created_at DESC
           LIMIT  $${dataParams.length - 1} OFFSET $${dataParams.length}`,
          dataParams,
        );

        return { rows: dataRes.rows, total: Number(countRes.rows[0].count) };
      });

      logger.info({ entity: 'IMS', action: 'PO_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId });
      ok(res, { purchase_orders: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /purchase-orders/:id ──────────────────────────────────────────────────

imsSuppliersRouter.get('/purchase-orders/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid PO ID.'); return; }

    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const [poRes, linesRes] = await Promise.all([
          c.query(
            `SELECT po.*, s.name AS supplier_name, s.payment_terms_days
             FROM   ims_purchase_orders po
             JOIN   ims_suppliers s ON s.id = po.supplier_id
             WHERE  po.id = $1`,
            [parsed.data.id],
          ),
          c.query(
            `SELECT pol.id, pol.item_id, pol.description, pol.quantity_ordered,
                    pol.quantity_received, pol.unit_cost, pol.notes,
                    i.name AS item_name, i.unit_of_measure, i.sku
             FROM   ims_purchase_order_lines pol
             LEFT JOIN ims_items i ON i.id = pol.item_id
             WHERE  pol.po_id = $1
             ORDER  BY pol.created_at ASC`,
            [parsed.data.id],
          ),
        ]);
        if (poRes.rows.length === 0) return null;
        return { ...poRes.rows[0], lines: linesRes.rows };
      });

      if (!result) { err(res, 404, 'PO_NOT_FOUND', 'Purchase order not found.'); return; }
      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /purchase-orders ─────────────────────────────────────────────────────

imsSuppliersRouter.post('/purchase-orders', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreatePOSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = parsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const po = await withTenantRLS(client, req.rlsCtx, async (c) => {
        await c.query('BEGIN');
        try {
          // Verify supplier belongs to this tenant
          const sup = await c.query('SELECT id FROM ims_suppliers WHERE id = $1 AND is_active = true', [body.supplier_id]);
          if (sup.rows.length === 0) throw Object.assign(new Error('Supplier not found.'), { code: 'SUPPLIER_NOT_FOUND', status: 404 });

          const poNumber = `PO-${new Date().getFullYear()}-${String(await c.query('SELECT nextval($1)::int AS n', ['ims_po_seq']).then(r => r.rows[0].n)).padStart(5, '0')}`;

          const poRow = await c.query<{ id: string }>(
            `INSERT INTO ims_purchase_orders
               (tenant_id, supplier_id, po_number, order_date, expected_delivery_date, notes, last_modified_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [tenantId, body.supplier_id, poNumber,
             body.order_date ?? new Date().toISOString().slice(0, 10),
             body.expected_delivery_date ?? null, body.notes ?? null, userId],
          ).then(r => r.rows[0]);

          for (const line of body.lines) {
            await c.query(
              `INSERT INTO ims_purchase_order_lines
                 (tenant_id, po_id, item_id, description, quantity_ordered, unit_cost, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [tenantId, poRow.id, line.item_id ?? null, line.description ?? null,
               line.quantity_ordered, line.unit_cost ?? null, line.notes ?? null],
            );
          }

          await c.query('COMMIT');
          return { id: poRow.id, po_number: poNumber };
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      });

      logger.info({ entity: 'IMS', action: 'PO_CREATED', user_id: userId, tenant_id: tenantId, record_id: po.id });
      ok(res, po, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /purchase-orders/:id/status ────────────────────────────────────────

imsSuppliersRouter.patch('/purchase-orders/:id/status', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed   = UUIDParam.safeParse(req.params);
    const bodyParsed = POStatusSchema.safeParse(req.body);
    if (!idParsed.success)   { err(res, 422, 'VALIDATION_ERROR', 'Invalid PO ID.'); return; }
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid status.'); return; }

    const { id }     = idParsed.data;
    const { status } = bodyParsed.data;
    const { userId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const updated = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const po = await c.query('SELECT status FROM ims_purchase_orders WHERE id = $1', [id]);
        if (po.rows.length === 0) return null;

        const current = po.rows[0].status as string;
        if (current === 'RECEIVED' || current === 'CANCELLED') {
          throw Object.assign(new Error(`Cannot change status of a ${current} purchase order.`), { code: 'INVALID_TRANSITION', status: 409 });
        }

        return c.query(
          `UPDATE ims_purchase_orders
           SET status = $1, last_modified_by = $2, last_modified_at = now(), updated_at = now()
           WHERE id = $3 RETURNING id, status`,
          [status, userId, id],
        ).then(r => r.rows[0]);
      });

      if (!updated) { err(res, 404, 'PO_NOT_FOUND', 'Purchase order not found.'); return; }
      logger.info({ entity: 'IMS', action: 'PO_STATUS_CHANGED', user_id: userId, record_id: id, new_status: status });
      ok(res, updated);
    } finally { client.release(); }
  } catch (e: unknown) {
    const cast = e as { code?: string; status?: number; message?: string };
    if (cast.code === 'INVALID_TRANSITION') { err(res, cast.status ?? 409, cast.code, cast.message ?? 'Invalid transition.'); return; }
    next(e);
  }
});

// ── POST /purchase-orders/:id/receive ─────────────────────────────────────────
// Records goods received. For each line, increments quantity_received and creates
// a RECEIVE stock movement. Updates PO status to PARTIAL or RECEIVED.

imsSuppliersRouter.post('/purchase-orders/:id/receive', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed   = UUIDParam.safeParse(req.params);
    const bodyParsed = ReceivePOSchema.safeParse(req.body);
    if (!idParsed.success)   { err(res, 422, 'VALIDATION_ERROR', 'Invalid PO ID.'); return; }
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id }     = idParsed.data;
    const body       = bodyParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        await c.query('BEGIN');
        try {
          // Check idempotency — if this key was already processed, return early
          const existing = await c.query(
            `SELECT id FROM ims_stock_movements WHERE idempotency_key = $1 LIMIT 1`,
            [body.idempotency_key],
          );
          if (existing.rows.length > 0) {
            await c.query('ROLLBACK');
            return { already_processed: true };
          }

          const po = await c.query('SELECT status FROM ims_purchase_orders WHERE id = $1', [id]);
          if (po.rows.length === 0) throw Object.assign(new Error('Purchase order not found.'), { code: 'PO_NOT_FOUND', status: 404 });

          const currentStatus = po.rows[0].status as string;
          if (currentStatus === 'CANCELLED' || currentStatus === 'RECEIVED') {
            throw Object.assign(new Error(`Cannot receive against a ${currentStatus} purchase order.`), { code: 'INVALID_TRANSITION', status: 409 });
          }

          // Fetch all lines for this PO
          const linesRes = await c.query(
            'SELECT * FROM ims_purchase_order_lines WHERE po_id = $1',
            [id],
          );
          const lineMap = new Map(linesRes.rows.map((l: { id: string }) => [l.id, l]));

          let allFullyReceived = true;

          for (const recv of body.lines) {
            const line = lineMap.get(recv.line_id) as {
              id: string; item_id: string | null; quantity_ordered: string;
              quantity_received: string; description: string | null;
            } | undefined;
            if (!line) continue;
            if (recv.quantity_received <= 0) continue;

            const newQtyReceived = Number(line.quantity_received) + recv.quantity_received;

            await c.query(
              `UPDATE ims_purchase_order_lines
               SET quantity_received = $1, updated_at = now()
               WHERE id = $2`,
              [newQtyReceived, recv.line_id],
            );

            // Create stock movement if line is linked to a catalogue item
            if (line.item_id) {
              await c.query(
                `INSERT INTO ims_stock_movements
                   (tenant_id, item_id, to_location_id, quantity, movement_type,
                    reference_type, reference_id, notes, performed_by, idempotency_key)
                 VALUES ($1,$2,$3,$4,'RECEIVE','PURCHASE_ORDER',$5,$6,$7,$8)`,
                [tenantId, line.item_id, body.receive_location_id, recv.quantity_received,
                 id, body.notes ?? null, userId, body.idempotency_key],
              );

              await c.query(
                `UPDATE ims_items
                 SET quantity_on_hand = quantity_on_hand + $1,
                     last_modified_at = now(), last_modified_by = $2, updated_at = now()
                 WHERE id = $3`,
                [recv.quantity_received, userId, line.item_id],
              );
            }

            if (newQtyReceived < Number(line.quantity_ordered)) allFullyReceived = false;
          }

          // Check remaining lines not in this receive batch
          for (const [lineId, line] of lineMap) {
            const castLine = line as { id: string; quantity_ordered: string; quantity_received: string };
            if (!body.lines.find(r => r.line_id === lineId)) {
              if (Number(castLine.quantity_received) < Number(castLine.quantity_ordered)) {
                allFullyReceived = false;
              }
            }
          }

          const newStatus = allFullyReceived ? 'RECEIVED' : 'PARTIAL';
          await c.query(
            `UPDATE ims_purchase_orders
             SET status = $1, last_modified_by = $2, last_modified_at = now(), updated_at = now()
             WHERE id = $3`,
            [newStatus, userId, id],
          );

          await c.query('COMMIT');
          return { status: newStatus, already_processed: false };
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      });

      logger.info({ entity: 'IMS', action: 'PO_RECEIVED', user_id: userId, tenant_id: tenantId, record_id: id });
      ok(res, result);
    } finally { client.release(); }
  } catch (e: unknown) {
    const cast = e as { code?: string; status?: number; message?: string };
    if (cast.code === 'PO_NOT_FOUND')      { err(res, 404, cast.code, cast.message ?? ''); return; }
    if (cast.code === 'INVALID_TRANSITION') { err(res, 409, cast.code, cast.message ?? ''); return; }
    next(e);
  }
});
