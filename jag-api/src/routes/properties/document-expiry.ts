// GET /api/v1/properties/document-expiry?within_days=90
//
// Portfolio-wide view of tenant KYC/identity documents that carry an expiry date
// and are already expired or expiring within the window. Joins each document to
// its tenant, and (best-effort, via the tenant's active lease) to a unit/property
// for context. Read-only; the actual edit happens in the per-tenant Docs modal.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { ok, err } from '../../lib/response';

export const documentExpiryRouter = Router();

const QuerySchema = z.object({
  within_days: z.coerce.number().int().min(1).max(3650).default(90),
});

documentExpiryRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'within_days must be an integer between 1 and 3650.'); return; }
    const { within_days } = parsed.data;

    const client = await propertiesPool.connect();
    try {
      const rows = await withOwnerRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT d.id, d.tenant_id, d.doc_type, d.label, d.file_name, d.expiry_date,
                  t.first_name, t.last_name, t.company_name, t.is_company,
                  u.unit_number, p.name AS property_name
           FROM   prop_tenant_documents d
           JOIN   prop_property_tenants t ON t.id = d.tenant_id
           LEFT   JOIN LATERAL (
                    SELECT unit_id FROM prop_lease_agreements
                    WHERE tenant_id = t.id AND status = 'ACTIVE'
                    LIMIT 1
                  ) la ON true
           LEFT   JOIN prop_units u ON u.id = la.unit_id
           LEFT   JOIN prop_properties p ON p.id = u.property_id
           WHERE  d.expiry_date IS NOT NULL
             AND  d.expiry_date <= (CURRENT_DATE + $1::int)
           ORDER  BY d.expiry_date ASC`,
          [within_days],
        ).then(r => r.rows),
      );
      ok(res, rows);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
