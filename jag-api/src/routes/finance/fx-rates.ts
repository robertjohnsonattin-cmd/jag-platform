// GET    /api/v1/finance/fx-rates
// POST   /api/v1/finance/fx-rates
// GET    /api/v1/finance/fx-rates/:currency/latest
// GET    /api/v1/finance/fx-rates/:currency          (history for a currency)
//
// fin_fx_rates is a SHARED reference table — any authenticated owner can read/write.
// RLS policy: current_owner_id must be non-null (set by withOwnerRLS).

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const fxRatesRouter = Router();

const CurrencyParam = z.object({ currency: z.string().length(3).regex(/^[A-Z]{3}$/) });

const FxRateQuerySchema = z.object({
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit:     z.coerce.number().int().min(1).max(500).default(90),
}).strict();

const CreateFxRateSchema = z.object({
  currency:    z.string().length(3).regex(/^[A-Z]{3}$/),
  rate_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rate_to_ttd: z.number().positive(),
  source:      z.string().max(100).default('MANUAL'),
}).strict();

// ── GET /fx-rates ─────────────────────────────────────────────────────────────
// Returns the latest rate for every known currency.

fxRatesRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT DISTINCT ON (currency)
                  id, currency, rate_date, rate_to_ttd, source, created_at
           FROM   fin_fx_rates
           ORDER  BY currency, rate_date DESC`,
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /fx-rates ────────────────────────────────────────────────────────────
// Upsert: on conflict (currency, rate_date) update rate_to_ttd and source.

fxRatesRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateFxRateSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fin_fx_rates (currency, rate_date, rate_to_ttd, source)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (currency, rate_date) DO UPDATE
             SET rate_to_ttd = EXCLUDED.rate_to_ttd,
                 source      = EXCLUDED.source
           RETURNING *`,
          [b.currency, b.rate_date, b.rate_to_ttd, b.source],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'FINANCE', action: 'FX_RATE_UPSERTED', user_id: ownerId, currency: b.currency, rate_date: b.rate_date });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /fx-rates/:currency/latest ────────────────────────────────────────────

fxRatesRouter.get('/:currency/latest', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CurrencyParam.safeParse({ currency: req.params.currency?.toUpperCase() });
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Currency must be a 3-letter ISO code.'); return; }

    const client = await familyPool.connect();
    try {
      const row = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, currency, rate_date, rate_to_ttd, source, created_at
           FROM   fin_fx_rates
           WHERE  currency = $1
           ORDER  BY rate_date DESC
           LIMIT  1`,
          [parsed.data.currency],
        ).then(r => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'No rate found for that currency.'); return; }
      ok(res, row);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /fx-rates/:currency ───────────────────────────────────────────────────
// Historical rates for a currency, newest first.

fxRatesRouter.get('/:currency', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const currParsed = CurrencyParam.safeParse({ currency: req.params.currency?.toUpperCase() });
    if (!currParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Currency must be a 3-letter ISO code.'); return; }

    const qParsed = FxRateQuerySchema.safeParse(req.query);
    if (!qParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }
    const { from_date, to_date, limit } = qParsed.data;
    const currency = currParsed.data.currency;

    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) => {
        const params: unknown[] = [currency];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const where: string[] = ['currency = $1'];
        if (from_date) where.push(`rate_date >= ${push(from_date)}`);
        if (to_date)   where.push(`rate_date <= ${push(to_date)}`);
        params.push(limit);
        return c.query(
          `SELECT id, currency, rate_date, rate_to_ttd, source, created_at
           FROM   fin_fx_rates
           WHERE  ${where.join(' AND ')}
           ORDER  BY rate_date DESC
           LIMIT  $${params.length}`,
          params,
        ).then(r => r.rows);
      });
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
