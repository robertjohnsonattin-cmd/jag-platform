// GET   /api/v1/dragonbridge/shipments                     — list shipments
// POST  /api/v1/dragonbridge/shipments                     — create shipment
// GET   /api/v1/dragonbridge/shipments/:id                 — shipment detail (orders + customs)
// PATCH /api/v1/dragonbridge/shipments/:id                 — update shipment (status, actuals)
// POST  /api/v1/dragonbridge/shipments/:id/orders          — assign order to shipment
// POST  /api/v1/dragonbridge/shipments/:id/customs         — create customs declaration
// PATCH /api/v1/dragonbridge/shipments/:id/customs/clear   — mark cleared → creates reconciliation records

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const dbShipmentsRouter = Router();
dbShipmentsRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const SHIPMENT_STATUSES = ['BOOKING', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'CLEARED'] as const;

const CreateShipmentSchema = z.object({
  container_ref:       z.string().max(50).optional(),
  vessel_name:         z.string().max(200).optional(),
  port_of_origin:      z.string().max(100).default('SHANGHAI'),
  port_of_destination: z.string().max(100).default('PORT OF SPAIN'),
  etd:                 z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  eta:                 z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  freight_forwarder:   z.string().max(200).optional(),
  notes:               z.string().max(1000).optional(),
}).strict();

const UpdateShipmentSchema = z.object({
  status:              z.enum(SHIPMENT_STATUSES).optional(),
  container_ref:       z.string().max(50).optional(),
  vessel_name:         z.string().max(200).optional(),
  etd:                 z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  eta:                 z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  atd:                 z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ata:                 z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  actual_freight_usd:  z.number().min(0).optional(),
  actual_insurance_usd:z.number().min(0).optional(),
  freight_forwarder:   z.string().max(200).optional(),
  notes:               z.string().max(1000).optional(),
}).strict();

const AssignOrderSchema = z.object({
  order_id:         z.string().uuid(),
  freight_share_pct:z.number().gt(0).max(100).optional(),
}).strict();

const CreateCustomsSchema = z.object({
  declaration_ref: z.string().max(100).optional(),
  actual_cif_usd:  z.number().min(0),
  actual_duty_ttd: z.number().min(0),
  actual_vat_ttd:  z.number().min(0),
  customs_broker:  z.string().max(200).optional(),
  notes:           z.string().max(1000).optional(),
}).strict();

// ── GET /dragonbridge/shipments ───────────────────────────────────────────────

dbShipmentsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const statusFilter = req.query.status as string | undefined;

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where = statusFilter ? `WHERE s.status = ${push(statusFilter)}` : '';
        return c.query(
          `SELECT s.id, s.container_ref, s.vessel_name, s.port_of_origin, s.port_of_destination,
                  s.etd, s.eta, s.atd, s.ata, s.status, s.freight_forwarder,
                  s.actual_freight_usd, s.actual_insurance_usd,
                  COUNT(os.order_id) AS order_count, s.created_at
           FROM db_shipments s
           LEFT JOIN db_order_shipments os ON os.shipment_id = s.id
           ${where}
           GROUP BY s.id
           ORDER BY s.created_at DESC`,
          params,
        ).then((r) => r.rows);
      });
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /dragonbridge/shipments ──────────────────────────────────────────────

dbShipmentsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateShipmentSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO db_shipments
             (tenant_id, container_ref, vessel_name, port_of_origin, port_of_destination,
              etd, eta, freight_forwarder, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id, container_ref, vessel_name, status, etd, eta,
                     port_of_origin, port_of_destination, created_at`,
          [tenantId, d.container_ref ?? null, d.vessel_name ?? null,
           d.port_of_origin, d.port_of_destination, d.etd ?? null, d.eta ?? null,
           d.freight_forwarder ?? null, d.notes ?? null, userId],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'DRAGONBRIDGE', action: 'SHIPMENT_CREATED', shipment_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── GET /dragonbridge/shipments/:id ──────────────────────────────────────────

dbShipmentsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid shipment id.'); return; }
  const { id } = paramParsed.data;

  try {
    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const [shipRes, ordersRes, customsRes] = await Promise.all([
          c.query(
            `SELECT id, container_ref, vessel_name, port_of_origin, port_of_destination,
                    etd, eta, atd, ata, status, actual_freight_usd, actual_insurance_usd,
                    freight_forwarder, notes, created_at, updated_at
             FROM db_shipments WHERE id = $1`,
            [id],
          ),
          c.query(
            `SELECT o.id AS order_id, cl.name AS client_name, o.status AS order_status,
                    o.quoted_total_ttd, os.freight_share_pct
             FROM db_order_shipments os
             JOIN db_orders o ON o.id = os.order_id
             JOIN db_clients cl ON cl.id = o.client_id
             WHERE os.shipment_id = $1`,
            [id],
          ),
          c.query(
            `SELECT id, declaration_ref, actual_cif_usd, actual_duty_ttd,
                    actual_vat_ttd, cleared_at, customs_broker
             FROM db_customs_declarations WHERE shipment_id = $1`,
            [id],
          ),
        ]);
        if (shipRes.rows.length === 0) return null;
        return {
          ...shipRes.rows[0],
          orders:  ordersRes.rows,
          customs: customsRes.rows[0] ?? null,
        };
      });
      if (!result) { err(res, 404, 'NOT_FOUND', 'Shipment not found.'); return; }
      ok(res, result);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── PATCH /dragonbridge/shipments/:id ────────────────────────────────────────

dbShipmentsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid shipment id.'); return; }

  const bodyParsed = UpdateShipmentSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const updates = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  if (Object.keys(updates).length === 0) { err(res, 400, 'NO_FIELDS', 'No fields to update.'); return; }

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const sets: string[] = [];
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

        if (updates.status               !== undefined) sets.push(`status = ${push(updates.status)}`);
        if (updates.container_ref        !== undefined) sets.push(`container_ref = ${push(updates.container_ref)}`);
        if (updates.vessel_name          !== undefined) sets.push(`vessel_name = ${push(updates.vessel_name)}`);
        if (updates.etd                  !== undefined) sets.push(`etd = ${push(updates.etd)}`);
        if (updates.eta                  !== undefined) sets.push(`eta = ${push(updates.eta)}`);
        if (updates.atd                  !== undefined) sets.push(`atd = ${push(updates.atd)}`);
        if (updates.ata                  !== undefined) sets.push(`ata = ${push(updates.ata)}`);
        if (updates.actual_freight_usd   !== undefined) sets.push(`actual_freight_usd = ${push(updates.actual_freight_usd)}`);
        if (updates.actual_insurance_usd !== undefined) sets.push(`actual_insurance_usd = ${push(updates.actual_insurance_usd)}`);
        if (updates.freight_forwarder    !== undefined) sets.push(`freight_forwarder = ${push(updates.freight_forwarder)}`);
        if (updates.notes                !== undefined) sets.push(`notes = ${push(updates.notes)}`);
        sets.push(`updated_at = now()`);

        return c.query(
          `UPDATE db_shipments SET ${sets.join(', ')}
           WHERE id = ${push(id)}
           RETURNING id, status, container_ref, vessel_name, etd, eta, atd, ata,
                     actual_freight_usd, actual_insurance_usd, updated_at`,
          params,
        ).then((r) => r.rows[0] ?? null);
      });
      if (!row) { err(res, 404, 'NOT_FOUND', 'Shipment not found.'); return; }
      logger.info({ entity: 'DRAGONBRIDGE', action: 'SHIPMENT_UPDATED', shipment_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /dragonbridge/shipments/:id/orders ───────────────────────────────────

dbShipmentsRouter.post('/:id/orders', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid shipment id.'); return; }

  const bodyParsed = AssignOrderSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const { order_id, freight_share_pct } = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const [shipRes, orderRes] = await Promise.all([
          c.query(`SELECT status FROM db_shipments WHERE id = $1`, [id]),
          c.query(`SELECT id FROM db_orders WHERE id = $1`, [order_id]),
        ]);
        if (shipRes.rows.length === 0)  throw Object.assign(new Error('SHIPMENT_NOT_FOUND'), { code: 'SHIPMENT_NOT_FOUND' });
        if (orderRes.rows.length === 0) throw Object.assign(new Error('ORDER_NOT_FOUND'), { code: 'ORDER_NOT_FOUND' });
        if (shipRes.rows[0].status === 'CLEARED') {
          throw Object.assign(new Error('SHIPMENT_CLEARED'), { code: 'SHIPMENT_CLEARED' });
        }

        return c.query(
          `INSERT INTO db_order_shipments (order_id, shipment_id, freight_share_pct)
           VALUES ($1, $2, $3)
           ON CONFLICT (order_id, shipment_id) DO UPDATE SET freight_share_pct = EXCLUDED.freight_share_pct
           RETURNING order_id, shipment_id, freight_share_pct`,
          [order_id, id, freight_share_pct ?? null],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'ORDER_ASSIGNED_TO_SHIPMENT', shipment_id: id, order_id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'SHIPMENT_NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Shipment not found.'); return; }
      if (e.message === 'ORDER_NOT_FOUND')    { err(res, 404, 'ORDER_NOT_FOUND', 'Order not found.'); return; }
      if (e.message === 'SHIPMENT_CLEARED')   { err(res, 409, 'SHIPMENT_CLEARED', 'Cannot add orders to a cleared shipment.'); return; }
    }
    next(e);
  }
});

// ── POST /dragonbridge/shipments/:id/customs ─────────────────────────────────

dbShipmentsRouter.post('/:id/customs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid shipment id.'); return; }

  const bodyParsed = CreateCustomsSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const d = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const shipRes = await c.query(`SELECT status FROM db_shipments WHERE id = $1`, [id]);
        if (shipRes.rows.length === 0) throw Object.assign(new Error('SHIPMENT_NOT_FOUND'), { code: 'SHIPMENT_NOT_FOUND' });

        const dupRes = await c.query(`SELECT id FROM db_customs_declarations WHERE shipment_id = $1`, [id]);
        if (dupRes.rows.length > 0) throw Object.assign(new Error('CUSTOMS_EXISTS'), { code: 'CUSTOMS_EXISTS' });

        return c.query(
          `INSERT INTO db_customs_declarations
             (tenant_id, shipment_id, declaration_ref, actual_cif_usd, actual_duty_ttd,
              actual_vat_ttd, customs_broker, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id, declaration_ref, actual_cif_usd, actual_duty_ttd, actual_vat_ttd, created_at`,
          [tenantId, id, d.declaration_ref ?? null, d.actual_cif_usd, d.actual_duty_ttd,
           d.actual_vat_ttd, d.customs_broker ?? null, d.notes ?? null, userId],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'CUSTOMS_CREATED', shipment_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'SHIPMENT_NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Shipment not found.'); return; }
      if (e.message === 'CUSTOMS_EXISTS')     { err(res, 409, 'CUSTOMS_EXISTS', 'A customs declaration already exists for this shipment.'); return; }
    }
    next(e);
  }
});

// ── PATCH /dragonbridge/shipments/:id/customs/clear ──────────────────────────
// Marks customs cleared. For each order in the shipment, creates a reconciliation
// (AUTO_CLOSED or PENDING_REVIEW based on variance vs threshold).
// Freight apportionment uses db_config.freight_apportionment_method:
//   CBM   — proportional to gross_volume_cbm of quote items (falls back to VALUE if CBM absent)
//   VALUE — proportional to supplier cost TTD
//   EQUAL — equal split
// If freight_share_pct is explicitly set on db_order_shipments, it overrides the method.
// AUTO_CLOSED reconciliations automatically get a FINAL invoice generated.

dbShipmentsRouter.patch('/:id/customs/clear', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid shipment id.'); return; }
  const { id } = paramParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        await c.query('BEGIN');
        try {
          // Fetch shipment + customs
          const [shipRes, customsRes] = await Promise.all([
            c.query(
              `SELECT s.id, s.status, s.actual_freight_usd, s.actual_insurance_usd
               FROM db_shipments s WHERE s.id = $1 FOR UPDATE`,
              [id],
            ),
            c.query(
              `SELECT id, actual_cif_usd, actual_duty_ttd, actual_vat_ttd
               FROM db_customs_declarations WHERE shipment_id = $1`,
              [id],
            ),
          ]);

          if (shipRes.rows.length === 0) throw Object.assign(new Error('SHIPMENT_NOT_FOUND'), { code: 'SHIPMENT_NOT_FOUND' });
          if (customsRes.rows.length === 0) throw Object.assign(new Error('NO_CUSTOMS'), { code: 'NO_CUSTOMS' });
          if (shipRes.rows[0].status === 'CLEARED') throw Object.assign(new Error('ALREADY_CLEARED'), { code: 'ALREADY_CLEARED' });

          const shipment = shipRes.rows[0];
          const customs  = customsRes.rows[0];

          // Fetch orders in this shipment
          const ordersRes = await c.query(
            `SELECT os.order_id, os.freight_share_pct,
                    o.jag_role, o.quoted_total_ttd, o.deposit_amount_ttd, o.deposit_paid_at,
                    q.fx_cny_usd, q.fx_usd_ttd, q.est_local_delivery_ttd,
                    q.margin_pct, q.agency_fee_pct,
                    cl_tier.default_margin_pct AS tier_margin_pct
             FROM db_order_shipments os
             JOIN db_orders o ON o.id = os.order_id
             JOIN db_quotes q ON q.id = o.quote_id
             JOIN db_clients cl ON cl.id = o.client_id
             LEFT JOIN db_pricing_tiers cl_tier ON cl_tier.id = cl.pricing_tier_id
             WHERE os.shipment_id = $1`,
            [id],
          );

          if (ordersRes.rows.length === 0) throw Object.assign(new Error('NO_ORDERS'), { code: 'NO_ORDERS' });

          const configRes = await c.query(
            `SELECT variance_threshold_pct, freight_apportionment_method FROM db_config LIMIT 1`,
          );
          const varianceThreshold      = Number(configRes.rows[0]?.variance_threshold_pct ?? 5);
          const apportionmentMethod    = (configRes.rows[0]?.freight_apportionment_method as string) ?? 'CBM';

          const orderCount       = ordersRes.rows.length;
          const actualFreightUsd = Number(shipment.actual_freight_usd  ?? 0);
          const actualInsuranceUsd = Number(shipment.actual_insurance_usd ?? 0);
          const totalDutyTtd     = Number(customs.actual_duty_ttd);
          const totalVatTtd      = Number(customs.actual_vat_ttd);

          // Pre-compute per-order apportionment denominators for CBM and VALUE methods.
          // CBM: sum gross_volume_cbm × qty across all items for each order.
          // VALUE: sum supplier cost TTD for each order.
          const orderMetrics: Map<string, { cbm: number; supplierCostTtd: number }> = new Map();
          for (const order of ordersRes.rows) {
            const metricsRes = await c.query(
              `SELECT
                 COALESCE(SUM(qi.gross_volume_cbm), 0)::float       AS total_cbm,
                 COALESCE(SUM(qi.qty * qi.unit_cost_cny), 0)::float AS total_cny
               FROM db_quote_items qi
               JOIN db_quotes q ON q.id = qi.quote_id
               JOIN db_orders o ON o.quote_id = q.id
               WHERE o.id = $1`,
              [order.order_id],
            );
            const fxCnyUsd = Number(order.fx_cny_usd);
            const fxUsdTtd = Number(order.fx_usd_ttd);
            const cbm = Number(metricsRes.rows[0]?.total_cbm ?? 0);
            const supplierCostTtd = Number(metricsRes.rows[0]?.total_cny ?? 0) / fxCnyUsd * fxUsdTtd;
            orderMetrics.set(order.order_id, { cbm, supplierCostTtd });
          }

          // Determine whether all orders have CBM data (required for CBM method)
          const allHaveCbm = [...orderMetrics.values()].every((m) => m.cbm > 0);
          const effectiveMethod = apportionmentMethod === 'CBM' && !allHaveCbm ? 'VALUE' : apportionmentMethod;

          const totalCbm          = [...orderMetrics.values()].reduce((s, m) => s + m.cbm, 0);
          const totalSupplierCost = [...orderMetrics.values()].reduce((s, m) => s + m.supplierCostTtd, 0);

          const reconciliations: unknown[] = [];

          for (const order of ordersRes.rows) {
            // Existing reconciliation check (idempotent on re-run)
            const existingRecon = await c.query(
              `SELECT id FROM db_landed_cost_reconciliations WHERE order_id = $1`, [order.order_id],
            );
            if (existingRecon.rows.length > 0) continue;

            // Use explicit freight_share_pct if set; otherwise apply the configured method.
            let sharePct: number;
            if (order.freight_share_pct) {
              sharePct = Number(order.freight_share_pct) / 100;
            } else if (effectiveMethod === 'CBM') {
              const m = orderMetrics.get(order.order_id)!;
              sharePct = totalCbm > 0 ? m.cbm / totalCbm : 1 / orderCount;
            } else if (effectiveMethod === 'VALUE') {
              const m = orderMetrics.get(order.order_id)!;
              sharePct = totalSupplierCost > 0 ? m.supplierCostTtd / totalSupplierCost : 1 / orderCount;
            } else {
              sharePct = 1 / orderCount;
            }

            const fxUsdTtd = Number(order.fx_usd_ttd);

            // Reuse pre-computed supplier cost (avoids duplicate query)
            const supplierCostTtd = orderMetrics.get(order.order_id)!.supplierCostTtd;

            const freightTtd   = actualFreightUsd   * sharePct * fxUsdTtd;
            const insuranceTtd = actualInsuranceUsd * sharePct * fxUsdTtd;
            const dutyTtd      = totalDutyTtd  * sharePct;
            const vatTtd       = totalVatTtd   * sharePct;
            const deliveryTtd  = Number(order.est_local_delivery_ttd ?? 0);

            // landedCostTtd = all costs except local delivery (the base for agency fee)
            const landedCostTtd = supplierCostTtd + freightTtd + insuranceTtd + dutyTtd + vatTtd;
            const baseCost      = landedCostTtd + deliveryTtd;

            const marginPct    = Number(order.margin_pct ?? order.tier_margin_pct ?? 0);
            const agencyFeePct = Number(order.agency_fee_pct ?? 5);

            // IMPORTER: margin on full cost (landed + delivery). AGENT: fee on landed cost only.
            const marginTtd    = order.jag_role === 'IMPORTER' ? baseCost * (marginPct / 100) : 0;
            const agencyFeeTtd = order.jag_role === 'AGENT' ? landedCostTtd * (agencyFeePct / 100) : 0;

            const actualTotalTtd = Math.round((baseCost + marginTtd + agencyFeeTtd) * 100) / 100;

            const quotedTotal   = Number(order.quoted_total_ttd);
            const varianceTtd   = Math.round((actualTotalTtd - quotedTotal) * 100) / 100;
            const variancePct   = quotedTotal > 0
              ? Math.round((varianceTtd / quotedTotal) * 10000) / 100
              : 0;

            const reconStatus = Math.abs(variancePct) < varianceThreshold
              ? 'AUTO_CLOSED'
              : 'PENDING_REVIEW';

            const reconRes = await c.query(
              `INSERT INTO db_landed_cost_reconciliations
                 (tenant_id, order_id, status, quoted_total_ttd,
                  actual_supplier_cost_ttd, actual_freight_ttd, actual_insurance_ttd,
                  actual_duty_ttd, actual_vat_ttd, actual_local_delivery_ttd,
                  actual_margin_ttd, actual_agency_fee_ttd, actual_total_ttd,
                  variance_ttd, variance_pct, idempotency_key)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,gen_random_uuid())
               RETURNING id, status, actual_total_ttd, variance_ttd, variance_pct`,
              [tenantId, order.order_id, reconStatus, quotedTotal,
               Math.round(supplierCostTtd * 100) / 100,
               Math.round(freightTtd * 100) / 100,
               Math.round(insuranceTtd * 100) / 100,
               Math.round(dutyTtd * 100) / 100,
               Math.round(vatTtd * 100) / 100,
               Math.round(deliveryTtd * 100) / 100,
               Math.round(marginTtd * 100) / 100,
               Math.round(agencyFeeTtd * 100) / 100,
               actualTotalTtd, varianceTtd, variancePct],
            );
            const recon = reconRes.rows[0];

            // Auto-generate FINAL invoice for AUTO_CLOSED reconciliations
            if (reconStatus === 'AUTO_CLOSED') {
              const depositOffset = order.deposit_paid_at ? Number(order.deposit_amount_ttd) : 0;
              const balanceDue    = Math.max(0, actualTotalTtd - depositOffset);
              await c.query(
                `INSERT INTO db_invoices
                   (tenant_id, order_id, invoice_type, amount_ttd, deposit_offset_ttd,
                    balance_due_ttd, idempotency_key, created_by)
                 VALUES ($1,$2,'FINAL',$3,$4,$5,gen_random_uuid(),$6)
                 ON CONFLICT (idempotency_key) DO NOTHING`,
                [tenantId, order.order_id, actualTotalTtd, depositOffset, balanceDue, userId],
              );
            }

            reconciliations.push({ order_id: order.order_id, ...recon });
          }

          // Mark shipment and customs as cleared
          await Promise.all([
            c.query(
              `UPDATE db_shipments SET status = 'CLEARED', updated_at = now() WHERE id = $1`, [id],
            ),
            c.query(
              `UPDATE db_customs_declarations SET cleared_at = now(), updated_at = now() WHERE shipment_id = $1`, [id],
            ),
          ]);

          await c.query('COMMIT');
          return { shipment_id: id, reconciliations };
        } catch (err2) {
          await c.query('ROLLBACK');
          throw err2;
        }
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'CUSTOMS_CLEARED', shipment_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, result);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'SHIPMENT_NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Shipment not found.'); return; }
      if (e.message === 'NO_CUSTOMS')         { err(res, 409, 'NO_CUSTOMS', 'Create a customs declaration before clearing.'); return; }
      if (e.message === 'ALREADY_CLEARED')    { err(res, 409, 'ALREADY_CLEARED', 'Shipment is already cleared.'); return; }
      if (e.message === 'NO_ORDERS')          { err(res, 409, 'NO_ORDERS', 'No orders are assigned to this shipment.'); return; }
    }
    next(e);
  }
});
