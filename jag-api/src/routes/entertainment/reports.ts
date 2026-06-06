// GET /api/v1/entertainment/reports/pl — P&L by venue and date range
//
// Query params:
//   venue: BAR | CLUB (required)
//   from:  YYYY-MM-DD (required)
//   to:    YYYY-MM-DD (required)
//
// Revenue:   settled tabs within the date range (subtotal, service charge, VAT)
// Expenses:  utility bills + supplier invoices dated within the range
// Net P&L:   total_revenue - total_expenses

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { entertainmentPool } from '../../db/index';
import { ok, err } from '../../lib/response';

export const entertainmentReportsRouter = Router();
entertainmentReportsRouter.use(requireAuth());

const PLQuerySchema = z.object({
  venue: z.enum(['BAR', 'CLUB']),
  from:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// ── GET /entertainment/reports/pl ────────────────────────────────────────────

entertainmentReportsRouter.get('/pl', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = PLQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    err(res, 400, 'VALIDATION_ERROR', 'venue (BAR|CLUB), from (YYYY-MM-DD), and to (YYYY-MM-DD) are required.');
    return;
  }
  const { venue, from, to } = parsed.data;
  const { tenantId } = req.rlsCtx;

  try {
    const client = await entertainmentPool.connect();
    try {
      const result = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Revenue: tabs settled within the date range for this venue
        const revenueRes = await c.query(
          `SELECT
             COUNT(*)::int                              AS tab_count,
             COALESCE(SUM(subtotal), 0)::numeric        AS subtotal,
             COALESCE(SUM(discount_amount), 0)::numeric AS discount_total,
             COALESCE(SUM(service_charge_amount), 0)::numeric AS service_charge_total,
             COALESCE(SUM(vat_amount), 0)::numeric      AS vat_total,
             COALESCE(SUM(total), 0)::numeric           AS revenue_total
           FROM ent_tabs
           WHERE venue = $1
             AND tenant_id = $2
             AND status = 'SETTLED'
             AND settled_at::date BETWEEN $3 AND $4`,
          [venue, tenantId, from, to],
        );

        // Expenses: utility bills dated in range
        const utilitiesRes = await c.query(
          `SELECT
             COUNT(*)::int                              AS count,
             COALESCE(SUM(amount), 0)::numeric          AS amount_total,
             COALESCE(SUM(vat_amount), 0)::numeric      AS vat_total,
             COALESCE(SUM(amount + vat_amount), 0)::numeric AS gross_total
           FROM ent_utility_bills
           WHERE venue = $1
             AND tenant_id = $2
             AND bill_date BETWEEN $3 AND $4`,
          [venue, tenantId, from, to],
        );

        // Expenses: supplier invoices dated in range
        const suppliersRes = await c.query(
          `SELECT
             COUNT(*)::int                              AS count,
             COALESCE(SUM(amount), 0)::numeric          AS amount_total,
             COALESCE(SUM(vat_amount), 0)::numeric      AS vat_total,
             COALESCE(SUM(amount + vat_amount), 0)::numeric AS gross_total
           FROM ent_supplier_invoices
           WHERE venue = $1
             AND tenant_id = $2
             AND invoice_date BETWEEN $3 AND $4`,
          [venue, tenantId, from, to],
        );

        const rev = revenueRes.rows[0];
        const util = utilitiesRes.rows[0];
        const supp = suppliersRes.rows[0];

        const revenueTotal  = Number(rev.revenue_total);
        const expensesTotal = Number(util.gross_total) + Number(supp.gross_total);
        const netPL         = Math.round((revenueTotal - expensesTotal) * 100) / 100;

        return {
          venue,
          period: { from, to },
          revenue: {
            tab_count:             rev.tab_count,
            subtotal:              Number(rev.subtotal),
            discount_total:        Number(rev.discount_total),
            service_charge_total:  Number(rev.service_charge_total),
            vat_total:             Number(rev.vat_total),
            total:                 revenueTotal,
          },
          expenses: {
            utilities: {
              count:       util.count,
              net_amount:  Number(util.amount_total),
              vat:         Number(util.vat_total),
              gross:       Number(util.gross_total),
            },
            supplier_invoices: {
              count:       supp.count,
              net_amount:  Number(supp.amount_total),
              vat:         Number(supp.vat_total),
              gross:       Number(supp.gross_total),
            },
            total: Math.round(expensesTotal * 100) / 100,
          },
          net_pl: netPL,
        };
      });
      ok(res, result);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
