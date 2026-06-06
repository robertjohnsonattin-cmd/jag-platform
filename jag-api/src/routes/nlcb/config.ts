// GET   /api/v1/nlcb/config  — get booth config (scratch win threshold)
// PATCH /api/v1/nlcb/config  — update config

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const nlcbConfigRouter = Router();
nlcbConfigRouter.use(requireAuth());

// scratch_win_threshold removed — payout limits are now per-game (max_agent_payout on nlcb_games / nlcb_scratch_games).
// Config table is kept for future booth-level settings.
const UpdateConfigSchema = z.object({
  // placeholder: add booth-level settings here as needed
}).strict();

// ── GET /nlcb/config ──────────────────────────────────────────────────────────

nlcbConfigRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const client = await commercialPool.connect();
    try {
      const row = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT tenant_id, scratch_win_threshold, updated_at FROM nlcb_config WHERE tenant_id = $1`,
          [req.rlsCtx.tenantId],
        ).then((r) => r.rows[0] ?? null),
      );
      if (!row) { err(res, 404, 'NOT_FOUND', 'Config not found.'); return; }
      ok(res, row);
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// ── PATCH /nlcb/config ────────────────────────────────────────────────────────

nlcbConfigRouter.patch('/', async (_req: Request, res: Response): Promise<void> => {
  // No updatable fields currently. Payout limits are set per-game via PATCH /nlcb/games/:id
  // and PATCH /nlcb/scratch-games/:id (max_agent_payout field).
  err(res, 400, 'NO_FIELDS', 'No config fields are currently updatable here. Update payout limits via the games endpoints.');
});
