// Credit Card Management
//
// GET    /api/v1/finance/credit-cards        list active cards
// POST   /api/v1/finance/credit-cards        add a card
// PATCH  /api/v1/finance/credit-cards/:id    rename / update
// DELETE /api/v1/finance/credit-cards/:id    deactivate (soft delete)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { familyPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const creditCardsRouter = Router();

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateCardSchema = z.object({
  card_name: z.string().min(1).max(100),
  last_four: z.string().regex(/^\d{4}$/).optional(),
  card_type: z.string().max(20).optional(),
}).strict();

const UpdateCardSchema = z.object({
  card_name: z.string().min(1).max(100).optional(),
  last_four: z.string().regex(/^\d{4}$/).optional(),
  card_type: z.string().max(20).optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'At least one field required.' });

// ── GET /credit-cards ──────────────────────────────────────────────────────────

creditCardsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await familyPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, card_name, last_four, card_type, is_active, created_at
           FROM   fin_credit_cards
           WHERE  is_active = true
           ORDER  BY card_name`,
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /credit-cards ─────────────────────────────────────────────────────────

creditCardsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateCardSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const b = parsed.data;
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO fin_credit_cards (owner_id, card_name, last_four, card_type)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [ownerId, b.card_name, b.last_four ?? null, b.card_type ?? null],
        ).then(r => r.rows[0]),
      );
      logger.info({ entity: 'CREDIT_CARD', action: 'CREATED', user_id: ownerId, record_id: rec.id });
      ok(res, rec, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── PATCH /credit-cards/:id ────────────────────────────────────────────────────

creditCardsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paramParsed = UUIDParam.safeParse(req.params);
    if (!paramParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const bodyParsed = UpdateCardSchema.safeParse(req.body);
    if (!bodyParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }
    const { id } = paramParsed.data;
    const b = bodyParsed.data;

    const client = await familyPool.connect();
    try {
      const rec = await withOwnerRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const sets = ['updated_at = now()'];
        if (b.card_name !== undefined) sets.push(`card_name = ${push(b.card_name)}`);
        if (b.last_four !== undefined) sets.push(`last_four = ${push(b.last_four)}`);
        if (b.card_type !== undefined) sets.push(`card_type = ${push(b.card_type)}`);
        params.push(id);
        return c.query(
          `UPDATE fin_credit_cards SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null);
      });
      if (!rec) { err(res, 404, 'CARD_NOT_FOUND', 'Credit card not found.'); return; }
      ok(res, rec);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /credit-cards/:id ───────────────────────────────────────────────────

creditCardsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = UUIDParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'ID must be a valid UUID.'); return; }
    const { ownerId } = req.rlsCtx;

    const client = await familyPool.connect();
    try {
      await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `UPDATE fin_credit_cards SET is_active = false, updated_at = now() WHERE id = $1`,
          [parsed.data.id],
        ),
      );
      logger.info({ entity: 'CREDIT_CARD', action: 'DEACTIVATED', user_id: ownerId, record_id: parsed.data.id });
      ok(res, { deactivated: true });
    } finally { client.release(); }
  } catch (e) { next(e); }
});
