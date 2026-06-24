// GET    /api/v1/properties/wa-approvals          — list PENDING approvals
// POST   /api/v1/properties/wa-approvals/:id/send — approve + fire template
// POST   /api/v1/properties/wa-approvals/:id/dismiss — dismiss without sending

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { sendTemplate } from '../../lib/whatsapp';

export const waApprovalsRouter = Router();

const IdParam = z.object({ id: z.string().uuid() });

waApprovalsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const statusFilter = (req.query['status'] as string | undefined) ?? 'PENDING';

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: r } = await client.query(
        `SELECT * FROM prop_wa_pending_approvals
         WHERE owner_id = $1 AND status = $2
         ORDER BY created_at DESC LIMIT 200`,
        [ownerId, statusFilter],
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});

waApprovalsRouter.post('/:id/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const approval = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT * FROM prop_wa_pending_approvals WHERE id = $1 AND owner_id = $2 AND status = 'PENDING'`,
        [id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!approval) return void res.status(404).json(err('Pending approval not found', 'NOT_FOUND'));

    await sendTemplate({
      to: approval.to_phone,
      templateName: approval.template_name,
      components: approval.components as object[],
    });

    await withOwnerRLS(propertiesPool, ownerId, async client => {
      await client.query(
        `UPDATE prop_wa_pending_approvals SET status = 'SENT', sent_at = NOW(), sent_by = $1 WHERE id = $2`,
        [ownerId, id],
      );
    });

    logger.info({
      entity: 'PROPERTIES', action: 'WA_APPROVAL_SENT',
      record_id: id, template: approval.template_name, user_id: ownerId,
    });
    res.json(ok({ sent: true, to: approval.to_phone, template: approval.template_name }));
  } catch (e) { next(e); }
});

waApprovalsRouter.post('/:id/dismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_wa_pending_approvals SET status = 'DISMISSED' WHERE id = $1 AND owner_id = $2 AND status = 'PENDING' RETURNING *`,
        [id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Pending approval not found', 'NOT_FOUND'));
    logger.info({ entity: 'PROPERTIES', action: 'WA_APPROVAL_DISMISSED', record_id: id, user_id: ownerId });
    res.json(ok({ dismissed: true }));
  } catch (e) { next(e); }
});
