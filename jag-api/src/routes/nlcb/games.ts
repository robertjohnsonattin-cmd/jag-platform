// GET   /api/v1/nlcb/games      — list games
// POST  /api/v1/nlcb/games      — create game
// PATCH /api/v1/nlcb/games/:id  — update game (rate, active status)

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const nlcbGamesRouter = Router();
nlcbGamesRouter.use(requireAuth());

const UUIDParam = z.object({ id: z.string().uuid() });

const CreateGameSchema = z.object({
  name:            z.string().min(1).max(100),
  draw_frequency:  z.string().min(1).max(20),
  commission_rate: z.number().min(0).max(100),
}).strict();

const UpdateGameSchema = z.object({
  name:            z.string().min(1).max(100).optional(),
  draw_frequency:  z.string().min(1).max(20).optional(),
  commission_rate: z.number().min(0).max(100).optional(),
  is_active:       z.boolean().optional(),
}).strict();

// ── GET /nlcb/games ───────────────────────────────────────────────────────────

nlcbGamesRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const rows = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, name, draw_frequency, commission_rate, is_active, created_at, last_modified_at
           FROM nlcb_games
           ORDER BY name`,
        ).then((r) => r.rows),
      );
      ok(res, rows);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── POST /nlcb/games ──────────────────────────────────────────────────────────

nlcbGamesRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = CreateGameSchema.safeParse(req.body);
  if (!parsed.success) { err(res, 400, 'VALIDATION_ERROR', parsed.error.message); return; }

  const { name, draw_frequency, commission_rate } = parsed.data;
  const { userId, tenantId } = req.rlsCtx;

  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO nlcb_games (tenant_id, name, draw_frequency, commission_rate, last_modified_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, draw_frequency, commission_rate, is_active, created_at`,
          [tenantId, name, draw_frequency, commission_rate, userId],
        ).then((r) => r.rows[0]),
      );
      logger.info({ entity: 'NLCB', action: 'GAME_CREATED', game_id: row.id, user_id: userId, tenant_id: tenantId });
      ok(res, row, 201);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── PATCH /nlcb/games/:id ─────────────────────────────────────────────────────

nlcbGamesRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const paramParsed = UUIDParam.safeParse(req.params);
  if (!paramParsed.success) { err(res, 400, 'INVALID_PARAMS', 'Invalid game id.'); return; }

  const bodyParsed = UpdateGameSchema.safeParse(req.body);
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

        if (updates.name            !== undefined) sets.push(`name = ${push(updates.name)}`);
        if (updates.draw_frequency  !== undefined) sets.push(`draw_frequency = ${push(updates.draw_frequency)}`);
        if (updates.commission_rate !== undefined) sets.push(`commission_rate = ${push(updates.commission_rate)}`);
        if (updates.is_active       !== undefined) sets.push(`is_active = ${push(updates.is_active)}`);
        sets.push(`last_modified_at = now()`);
        sets.push(`last_modified_by = ${push(userId)}`);

        const result = await c.query(
          `UPDATE nlcb_games SET ${sets.join(', ')}
           WHERE id = ${push(id)}
           RETURNING id, name, draw_frequency, commission_rate, is_active, last_modified_at`,
          params,
        );
        return result.rows[0] ?? null;
      });

      if (!row) { err(res, 404, 'NOT_FOUND', 'Game not found.'); return; }
      logger.info({ entity: 'NLCB', action: 'GAME_UPDATED', game_id: id, user_id: userId, tenant_id: tenantId });
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});
