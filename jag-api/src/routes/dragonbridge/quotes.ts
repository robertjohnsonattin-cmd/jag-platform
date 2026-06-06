// GET    /api/v1/dragonbridge/quotes               — list quotes
// POST   /api/v1/dragonbridge/quotes               — create quote header
// GET    /api/v1/dragonbridge/quotes/:id            — quote detail with items + totals
// POST   /api/v1/dragonbridge/quotes/:id/items      — add item (recalculates total)
// DELETE /api/v1/dragonbridge/quotes/:id/items/:iid — remove item (recalculates total)
// PATCH  /api/v1/dragonbridge/quotes/:id/send       — DRAFT → SENT
// PATCH  /api/v1/dragonbridge/quotes/:id/accept     — SENT/DRAFT → ACCEPTED (creates order + deposit invoice)
// PATCH  /api/v1/dragonbridge/quotes/:id/expire     — → EXPIRED
// PATCH  /api/v1/dragonbridge/quotes/:id/cancel     — → CANCELLED
//
// Landed cost formula (per item):
//   supplier_cost_ttd  = qty × unit_cost_cny / fx_cny_usd × fx_usd_ttd
//   freight_share_ttd  = (supplier_cost_ttd / total_supplier_cost_ttd) × est_freight_usd × fx_usd_ttd
//   insurance_share_ttd= (supplier_cost_ttd / total_supplier_cost_ttd) × est_insurance_usd × fx_usd_ttd
//   cif_ttd            = supplier_cost_ttd + freight_share_ttd + insurance_share_ttd
//   duty_ttd           = cif_ttd × duty_rate
//   vat_ttd            = (cif_ttd + duty_ttd) × vat_pct
//   item_landed_cost   = cif_ttd + duty_ttd + vat_ttd  (pre-agency-fee, pre-margin, pre-delivery)
//
// Quote total (IMPORTER): (Σ item_landed_cost + est_local_delivery_ttd) × (1 + margin_pct/100)
// Quote total (AGENT):     Σ item_landed_cost × (1 + agency_fee_pct/100) + est_local_delivery_ttd
//   agency fee = Σ item_landed_cost × agency_fee_pct/100 (stored as est_agency_fee_ttd)
//   JAG handles full order-to-door (sourcing + freight + customs + last-mile), not just FOB.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import type { PoolClient } from 'pg';

export const dbQuotesRouter = Router();
dbQuotesRouter.use(requireAuth());

const UUIDParam  = z.object({ id: z.string().uuid() });
const ItemParams = z.object({ id: z.string().uuid(), iid: z.string().uuid() });

const CreateQuoteSchema = z.object({
  client_id:              z.string().uuid(),
  jag_role:               z.enum(['AGENT', 'IMPORTER']),
  margin_pct:             z.number().min(0).optional(),
  agency_fee_pct:         z.number().min(0).optional(),
  fx_cny_usd:             z.number().positive(),
  fx_usd_ttd:             z.number().positive(),
  est_freight_usd:        z.number().min(0).default(0),
  est_insurance_usd:      z.number().min(0).default(0),
  est_local_delivery_ttd: z.number().min(0).default(0),
  notes:                  z.string().max(2000).optional(),
  valid_until:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict().superRefine((d, ctx) => {
  if (d.jag_role === 'AGENT' && d.margin_pct !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'margin_pct is not applicable in AGENT mode.' });
  }
  if (d.jag_role === 'IMPORTER' && d.agency_fee_pct !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'agency_fee_pct is not applicable in IMPORTER mode.' });
  }
});

const AddItemSchema = z.object({
  product_id:      z.string().uuid().optional(),
  product_name:    z.string().min(1).max(200),
  hs_code:         z.string().min(1).max(10),
  unit_cost_cny:   z.number().positive(),
  duty_rate:       z.number().min(0).max(1),
  qty:             z.number().positive(),
  unit:            z.string().min(1).max(20),
  gross_volume_cbm:z.number().positive().optional(),
  notes:           z.string().max(500).optional(),
}).strict();

// ── Landed cost calculation ───────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface RawItem {
  id: string;
  product_id: string | null;
  product_name: string;
  hs_code: string;
  unit_cost_cny: string;
  duty_rate: string;
  qty: string;
  unit: string;
  gross_volume_cbm: string | null;
  notes: string | null;
}

interface CalcItem extends RawItem {
  est_duty_ttd: number;
  est_vat_ttd: number;
  est_landed_cost_ttd: number;
}

interface QuoteCtx {
  jag_role: string;
  margin_pct: string | null;
  agency_fee_pct: string | null;
  fx_cny_usd: string;
  fx_usd_ttd: string;
  est_freight_usd: string;
  est_insurance_usd: string;
  est_local_delivery_ttd: string;
  effective_margin_pct: string | null;
}

function calcItems(
  items: RawItem[],
  q: QuoteCtx,
  vatPct: number,
): { items: CalcItem[]; estAgencyFeeTtd: number; estTotalTtd: number } {
  if (items.length === 0) return { items: [], estAgencyFeeTtd: 0, estTotalTtd: 0 };

  const fxCnyUsd    = Number(q.fx_cny_usd);
  const fxUsdTtd    = Number(q.fx_usd_ttd);
  const freightUsd  = Number(q.est_freight_usd);
  const insuranceUsd= Number(q.est_insurance_usd);
  const deliveryTtd = Number(q.est_local_delivery_ttd);

  // First pass: supplier cost per item
  const withSupplierCost = items.map((item) => ({
    ...item,
    supplier_cost_ttd: Number(item.qty) * Number(item.unit_cost_cny) / fxCnyUsd * fxUsdTtd,
  }));

  const totalSupplierCostTtd = withSupplierCost.reduce((s, i) => s + i.supplier_cost_ttd, 0);
  const freightTtd   = freightUsd   * fxUsdTtd;
  const insuranceTtd = insuranceUsd * fxUsdTtd;

  // Second pass: full landed cost per item (value-based freight share within a single quote)
  const calcedItems: CalcItem[] = withSupplierCost.map((item) => {
    const share = totalSupplierCostTtd > 0
      ? item.supplier_cost_ttd / totalSupplierCostTtd
      : 1 / withSupplierCost.length;
    const cif  = item.supplier_cost_ttd + freightTtd * share + insuranceTtd * share;
    const duty = cif * Number(item.duty_rate);
    const vat  = (cif + duty) * (vatPct / 100);
    return {
      ...item,
      est_duty_ttd:        round2(duty),
      est_vat_ttd:         round2(vat),
      est_landed_cost_ttd: round2(cif + duty + vat),
    };
  });

  const totalLanded = calcedItems.reduce((s, i) => s + i.est_landed_cost_ttd, 0);

  let estAgencyFeeTtd = 0;
  let estTotalTtd: number;

  if (q.jag_role === 'IMPORTER') {
    const marginPct = Number(q.effective_margin_pct ?? q.margin_pct ?? 0);
    estTotalTtd = round2((totalLanded + deliveryTtd) * (1 + marginPct / 100));
  } else {
    // AGENT: fee = landed cost × agency_fee_pct; delivery is pass-through (no fee on delivery)
    const agencyFeePct = Number(q.agency_fee_pct ?? 5);
    estAgencyFeeTtd = round2(totalLanded * agencyFeePct / 100);
    estTotalTtd     = round2(totalLanded + estAgencyFeeTtd + deliveryTtd);
  }

  return { items: calcedItems, estAgencyFeeTtd, estTotalTtd };
}

async function recalcQuote(c: PoolClient, quoteId: string): Promise<void> {
  const [quoteRes, itemsRes, configRes] = await Promise.all([
    c.query(
      `SELECT q.jag_role, q.margin_pct, q.agency_fee_pct, q.fx_cny_usd, q.fx_usd_ttd,
              q.est_freight_usd, q.est_insurance_usd, q.est_local_delivery_ttd,
              t.default_margin_pct AS effective_margin_pct
       FROM db_quotes q
       LEFT JOIN db_clients cl ON cl.id = q.client_id
       LEFT JOIN db_pricing_tiers t ON t.id = cl.pricing_tier_id
       WHERE q.id = $1`,
      [quoteId],
    ),
    c.query(`SELECT * FROM db_quote_items WHERE quote_id = $1`, [quoteId]),
    c.query(`SELECT default_vat_pct FROM db_config LIMIT 1`),
  ]);

  const q = quoteRes.rows[0] as QuoteCtx;
  const vatPct = Number(configRes.rows[0]?.default_vat_pct ?? 12.5);
  const { items: calcedItems, estAgencyFeeTtd, estTotalTtd } = calcItems(itemsRes.rows as RawItem[], q, vatPct);

  for (const item of calcedItems) {
    await c.query(
      `UPDATE db_quote_items
       SET est_duty_ttd = $1, est_vat_ttd = $2, est_landed_cost_ttd = $3
       WHERE id = $4`,
      [item.est_duty_ttd, item.est_vat_ttd, item.est_landed_cost_ttd, item.id],
    );
  }

  await c.query(
    `UPDATE db_quotes SET est_agency_fee_ttd = $1, est_total_ttd = $2, updated_at = now() WHERE id = $3`,
    [estAgencyFeeTtd, estTotalTtd, quoteId],
  );
}

// ── GET /dragonbridge/quotes ──────────────────────────────────────────────────

dbQuotesRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const statusFilter = req.query.status as string | undefined;
  const clientFilter = req.query.client_id as string | undefined;

  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (statusFilter) conditions.push(`q.status = ${push(statusFilter)}`);
        if (clientFilter) conditions.push(`q.client_id = ${push(clientFilter)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return c.query(
          `SELECT q.id, q.jag_role, q.status, q.est_total_ttd, q.valid_until,
                  q.client_id, cl.name AS client_name, cl.client_type,
                  q.fx_cny_usd, q.fx_usd_ttd, q.created_at, q.updated_at
           FROM db_quotes q
           JOIN db_clients cl ON cl.id = q.client_id
           ${where}
           ORDER BY q.created_at DESC`,
          params,
        ).then((r) => r.rows);
      });
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /dragonbridge/quotes ─────────────────────────────────────────────────

dbQuotesRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateQuoteSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const d = parsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const clientRes = await c.query(
          `SELECT id FROM db_clients WHERE id = $1 AND is_active = true`, [d.client_id],
        );
        if (clientRes.rows.length === 0) throw Object.assign(new Error('CLIENT_NOT_FOUND'), { code: 'CLIENT_NOT_FOUND' });

        // Resolve agency_fee_pct: body override → config default
        let resolvedAgencyFeePct: number | null = null;
        if (d.jag_role === 'AGENT') {
          if (d.agency_fee_pct !== undefined) {
            resolvedAgencyFeePct = d.agency_fee_pct;
          } else {
            const configRes = await c.query(`SELECT agency_fee_pct FROM db_config LIMIT 1`);
            resolvedAgencyFeePct = Number(configRes.rows[0]?.agency_fee_pct ?? 5);
          }
        }

        return c.query(
          `INSERT INTO db_quotes
             (tenant_id, client_id, jag_role, margin_pct, agency_fee_pct,
              fx_cny_usd, fx_usd_ttd,
              est_freight_usd, est_insurance_usd, est_local_delivery_ttd,
              notes, valid_until, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING id, jag_role, status, margin_pct, agency_fee_pct,
                     fx_cny_usd, fx_usd_ttd,
                     est_freight_usd, est_insurance_usd, est_local_delivery_ttd,
                     est_agency_fee_ttd, est_total_ttd, valid_until, created_at`,
          [tenantId, d.client_id, d.jag_role, d.margin_pct ?? null, resolvedAgencyFeePct,
           d.fx_cny_usd, d.fx_usd_ttd,
           d.est_freight_usd, d.est_insurance_usd, d.est_local_delivery_ttd,
           d.notes ?? null, d.valid_until ?? null, userId],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'QUOTE_CREATED', quote_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'CLIENT_NOT_FOUND') {
      err(res, 404, 'CLIENT_NOT_FOUND', 'Client not found or inactive.'); return;
    }
    next(e);
  }
});

// ── GET /dragonbridge/quotes/:id ──────────────────────────────────────────────

dbQuotesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid quote id.'); return; }
  const { id } = paramParsed.data;

  try {
    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const [quoteRes, itemsRes] = await Promise.all([
          c.query(
            `SELECT q.id, q.jag_role, q.status, q.margin_pct, q.agency_fee_pct,
                    q.fx_cny_usd, q.fx_usd_ttd,
                    q.est_freight_usd, q.est_insurance_usd, q.est_local_delivery_ttd,
                    q.est_agency_fee_ttd, q.est_total_ttd, q.notes, q.valid_until,
                    q.client_id, cl.name AS client_name, cl.client_type,
                    cl.pricing_tier_id, t.name AS pricing_tier_name, t.default_margin_pct,
                    q.created_at, q.updated_at
             FROM db_quotes q
             JOIN db_clients cl ON cl.id = q.client_id
             LEFT JOIN db_pricing_tiers t ON t.id = cl.pricing_tier_id
             WHERE q.id = $1`,
            [id],
          ),
          c.query(
            `SELECT id, product_id, product_name, hs_code, unit_cost_cny, duty_rate,
                    qty, unit, gross_volume_cbm, est_duty_ttd, est_vat_ttd, est_landed_cost_ttd, notes
             FROM db_quote_items WHERE quote_id = $1
             ORDER BY product_name`,
            [id],
          ),
        ]);
        if (quoteRes.rows.length === 0) return null;
        return { ...quoteRes.rows[0], items: itemsRes.rows };
      });
      if (!result) { err(res, 404, 'NOT_FOUND', 'Quote not found.'); return; }
      ok(res, result);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /dragonbridge/quotes/:id/items ──────────────────────────────────────

dbQuotesRouter.post('/:id/items', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid quote id.'); return; }

  const bodyParsed = AddItemSchema.safeParse(req.body);
  if (!bodyParsed.success) { err(res, 400, 'VALIDATION_ERROR', bodyParsed.error.message); return; }

  const { id } = paramParsed.data;
  const d = bodyParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const quoteRes = await c.query(
          `SELECT status FROM db_quotes WHERE id = $1`, [id],
        );
        if (quoteRes.rows.length === 0) throw Object.assign(new Error('QUOTE_NOT_FOUND'), { code: 'QUOTE_NOT_FOUND' });
        if (!['DRAFT', 'SENT'].includes(quoteRes.rows[0].status)) {
          throw Object.assign(new Error('QUOTE_NOT_EDITABLE'), { code: 'QUOTE_NOT_EDITABLE' });
        }

        await c.query(
          `INSERT INTO db_quote_items
             (quote_id, product_id, product_name, hs_code, unit_cost_cny,
              duty_rate, qty, unit, gross_volume_cbm, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [id, d.product_id ?? null, d.product_name, d.hs_code, d.unit_cost_cny,
           d.duty_rate, d.qty, d.unit, d.gross_volume_cbm ?? null, d.notes ?? null],
        );

        await recalcQuote(c, id);

        const [quoteUpdated, items] = await Promise.all([
          c.query(`SELECT est_agency_fee_ttd, est_total_ttd FROM db_quotes WHERE id = $1`, [id]),
          c.query(
            `SELECT id, product_name, hs_code, unit_cost_cny, duty_rate, qty, unit,
                    gross_volume_cbm, est_duty_ttd, est_vat_ttd, est_landed_cost_ttd
             FROM db_quote_items WHERE quote_id = $1 ORDER BY product_name`,
            [id],
          ),
        ]);
        return {
          est_agency_fee_ttd: quoteUpdated.rows[0].est_agency_fee_ttd,
          est_total_ttd: quoteUpdated.rows[0].est_total_ttd,
          items: items.rows,
        };
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'QUOTE_ITEM_ADDED', quote_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, result, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'QUOTE_NOT_FOUND')    { err(res, 404, 'NOT_FOUND', 'Quote not found.'); return; }
      if (e.message === 'QUOTE_NOT_EDITABLE') { err(res, 409, 'QUOTE_NOT_EDITABLE', 'Quote must be DRAFT or SENT to add items.'); return; }
    }
    next(e);
  }
});

// ── DELETE /dragonbridge/quotes/:id/items/:iid ───────────────────────────────

dbQuotesRouter.delete('/:id/items/:iid', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = ItemParams.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid ids.'); return; }

  const { id, iid } = paramParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const quoteRes = await c.query(`SELECT status FROM db_quotes WHERE id = $1`, [id]);
        if (quoteRes.rows.length === 0) throw Object.assign(new Error('QUOTE_NOT_FOUND'), { code: 'QUOTE_NOT_FOUND' });
        if (!['DRAFT', 'SENT'].includes(quoteRes.rows[0].status)) {
          throw Object.assign(new Error('QUOTE_NOT_EDITABLE'), { code: 'QUOTE_NOT_EDITABLE' });
        }

        const del = await c.query(
          `DELETE FROM db_quote_items WHERE id = $1 AND quote_id = $2 RETURNING id`, [iid, id],
        );
        if (del.rowCount === 0) throw Object.assign(new Error('ITEM_NOT_FOUND'), { code: 'ITEM_NOT_FOUND' });

        await recalcQuote(c, id);
        const quoteUpdated = await c.query(
          `SELECT est_agency_fee_ttd, est_total_ttd FROM db_quotes WHERE id = $1`, [id],
        );
        return {
          est_agency_fee_ttd: quoteUpdated.rows[0].est_agency_fee_ttd,
          est_total_ttd: quoteUpdated.rows[0].est_total_ttd,
        };
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'QUOTE_ITEM_REMOVED', quote_id: id, item_id: iid, user_id: userId, tenant_id: tenantId });
      ok(res, result);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'QUOTE_NOT_FOUND')    { err(res, 404, 'NOT_FOUND', 'Quote not found.'); return; }
      if (e.message === 'QUOTE_NOT_EDITABLE') { err(res, 409, 'QUOTE_NOT_EDITABLE', 'Quote must be DRAFT or SENT to remove items.'); return; }
      if (e.message === 'ITEM_NOT_FOUND')     { err(res, 404, 'ITEM_NOT_FOUND', 'Item not found on this quote.'); return; }
    }
    next(e);
  }
});

// ── PATCH /dragonbridge/quotes/:id/send ──────────────────────────────────────

dbQuotesRouter.patch('/:id/send', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid quote id.'); return; }
  const { id } = paramParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const quoteRes = await c.query(`SELECT status FROM db_quotes WHERE id = $1`, [id]);
        if (quoteRes.rows.length === 0) throw Object.assign(new Error('QUOTE_NOT_FOUND'), { code: 'QUOTE_NOT_FOUND' });
        if (quoteRes.rows[0].status !== 'DRAFT') throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });

        const itemRes = await c.query(`SELECT count(*) FROM db_quote_items WHERE quote_id = $1`, [id]);
        if (Number(itemRes.rows[0].count) === 0) throw Object.assign(new Error('NO_ITEMS'), { code: 'NO_ITEMS' });

        return c.query(
          `UPDATE db_quotes SET status = 'SENT', updated_at = now() WHERE id = $1
           RETURNING id, status, est_total_ttd, updated_at`,
          [id],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'QUOTE_SENT', quote_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'QUOTE_NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Quote not found.'); return; }
      if (e.message === 'INVALID_STATUS')  { err(res, 409, 'INVALID_STATUS', 'Only DRAFT quotes can be sent.'); return; }
      if (e.message === 'NO_ITEMS')        { err(res, 409, 'NO_ITEMS', 'Cannot send a quote with no line items.'); return; }
    }
    next(e);
  }
});

// ── PATCH /dragonbridge/quotes/:id/accept ────────────────────────────────────
// Transitions quote to ACCEPTED, creates order + DRAFT deposit invoice atomically.

dbQuotesRouter.patch('/:id/accept', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid quote id.'); return; }
  const { id } = paramParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        await c.query('BEGIN');
        try {
          const quoteRes = await c.query(
            `SELECT q.id, q.status, q.jag_role, q.est_total_ttd, q.client_id, q.margin_pct
             FROM db_quotes q WHERE q.id = $1 FOR UPDATE`,
            [id],
          );
          if (quoteRes.rows.length === 0) throw Object.assign(new Error('QUOTE_NOT_FOUND'), { code: 'QUOTE_NOT_FOUND' });
          const quote = quoteRes.rows[0];
          if (!['DRAFT', 'SENT'].includes(quote.status)) {
            throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });
          }
          const itemRes = await c.query(`SELECT count(*) FROM db_quote_items WHERE quote_id = $1`, [id]);
          if (Number(itemRes.rows[0].count) === 0) throw Object.assign(new Error('NO_ITEMS'), { code: 'NO_ITEMS' });

          const configRes = await c.query(`SELECT deposit_pct_default FROM db_config LIMIT 1`);
          const depositPct    = Number(configRes.rows[0]?.deposit_pct_default ?? 30);
          const quotedTotal   = Number(quote.est_total_ttd);
          const depositAmount = round2(quotedTotal * depositPct / 100);

          await c.query(
            `UPDATE db_quotes SET status = 'ACCEPTED', updated_at = now() WHERE id = $1`, [id],
          );

          const orderRes = await c.query(
            `INSERT INTO db_orders
               (tenant_id, quote_id, client_id, jag_role, deposit_pct,
                deposit_amount_ttd, quoted_total_ttd, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING id, status, deposit_pct, deposit_amount_ttd, quoted_total_ttd, created_at`,
            [tenantId, id, quote.client_id, quote.jag_role, depositPct,
             depositAmount, quotedTotal, userId],
          );
          const order = orderRes.rows[0];

          const invoiceRes = await c.query(
            `INSERT INTO db_invoices
               (tenant_id, order_id, invoice_type, amount_ttd, balance_due_ttd,
                idempotency_key, created_by)
             VALUES ($1,$2,'DEPOSIT',$3,$3,gen_random_uuid(),$4)
             RETURNING id, invoice_type, status, amount_ttd, balance_due_ttd`,
            [tenantId, order.id, depositAmount, userId],
          );

          await c.query('COMMIT');
          return { quote_id: id, order: order, deposit_invoice: invoiceRes.rows[0] };
        } catch (err2) {
          await c.query('ROLLBACK');
          throw err2;
        }
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'QUOTE_ACCEPTED', quote_id: id, order_id: result.order.id, user_id: userId, tenant_id: tenantId });
      ok(res, result, 201);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'QUOTE_NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Quote not found.'); return; }
      if (e.message === 'INVALID_STATUS')  { err(res, 409, 'INVALID_STATUS', 'Only DRAFT or SENT quotes can be accepted.'); return; }
      if (e.message === 'NO_ITEMS')        { err(res, 409, 'NO_ITEMS', 'Cannot accept a quote with no line items.'); return; }
    }
    next(e);
  }
});

// ── PATCH /dragonbridge/quotes/:id/expire ────────────────────────────────────

dbQuotesRouter.patch('/:id/expire', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid quote id.'); return; }
  const { id } = paramParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const quoteRes = await c.query(`SELECT status FROM db_quotes WHERE id = $1`, [id]);
        if (quoteRes.rows.length === 0) throw Object.assign(new Error('QUOTE_NOT_FOUND'), { code: 'QUOTE_NOT_FOUND' });
        if (!['DRAFT', 'SENT'].includes(quoteRes.rows[0].status)) {
          throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });
        }
        return c.query(
          `UPDATE db_quotes SET status = 'EXPIRED', updated_at = now() WHERE id = $1
           RETURNING id, status, updated_at`,
          [id],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'QUOTE_EXPIRED', quote_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'QUOTE_NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Quote not found.'); return; }
      if (e.message === 'INVALID_STATUS')  { err(res, 409, 'INVALID_STATUS', 'Only DRAFT or SENT quotes can be expired.'); return; }
    }
    next(e);
  }
});

// ── PATCH /dragonbridge/quotes/:id/cancel ────────────────────────────────────

dbQuotesRouter.patch('/:id/cancel', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid quote id.'); return; }
  const { id } = paramParsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const quoteRes = await c.query(`SELECT status FROM db_quotes WHERE id = $1`, [id]);
        if (quoteRes.rows.length === 0) throw Object.assign(new Error('QUOTE_NOT_FOUND'), { code: 'QUOTE_NOT_FOUND' });
        if (!['DRAFT', 'SENT'].includes(quoteRes.rows[0].status)) {
          throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });
        }
        return c.query(
          `UPDATE db_quotes SET status = 'CANCELLED', updated_at = now() WHERE id = $1
           RETURNING id, status, updated_at`,
          [id],
        ).then((r) => r.rows[0]);
      });
      logger.info({ entity: 'DRAGONBRIDGE', action: 'QUOTE_CANCELLED', quote_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'QUOTE_NOT_FOUND') { err(res, 404, 'NOT_FOUND', 'Quote not found.'); return; }
      if (e.message === 'INVALID_STATUS')  { err(res, 409, 'INVALID_STATUS', 'Only DRAFT or SENT quotes can be cancelled.'); return; }
    }
    next(e);
  }
});
