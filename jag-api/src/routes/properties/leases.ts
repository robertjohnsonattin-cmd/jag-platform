// GET /api/v1/properties/leases
//
// Flat, cross-property lease list. Every *other* lease route is nested under
// /:propertyId/leases, so there was no way to fetch "this tenant's leases"
// without already knowing the property.
//
// This handler previously lived inside properties.ts, declared AFTER
// `propertiesRouter.get('/:id')` — so Express matched /:id first, the UUID
// parse failed, and every call returned 422 instead of a lease list. The
// tenant Leases modal therefore rendered its empty state and had never once
// worked. Flat /properties/* routes MUST be mounted from index.ts ahead of
// propRoutes; see the comment there.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { ok, err } from '../../lib/response';

export const leasesRouter = Router();

const ListLeasesQuery = z.object({
  tenant_id:   z.string().uuid().optional(),
  property_id: z.string().uuid().optional(),
  unit_id:     z.string().uuid().optional(),
  status:      z.enum(['ACTIVE', 'EXPIRED', 'TERMINATED', 'PENDING']).optional(),
}).strict();

leasesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const parsed = ListLeasesQuery.safeParse(req.query);
    if (!parsed.success) {
      return void res.status(422).json(err('Invalid lease filter.', 'VALIDATION_ERROR'));
    }
    const q = parsed.data;

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const conds: string[] = [];
      const vals: unknown[] = [];
      if (q.tenant_id)   { vals.push(q.tenant_id);   conds.push(`la.tenant_id = $${vals.length}`); }
      if (q.property_id) { vals.push(q.property_id); conds.push(`la.property_id = $${vals.length}`); }
      if (q.unit_id)     { vals.push(q.unit_id);     conds.push(`la.unit_id = $${vals.length}`); }
      if (q.status)      { vals.push(q.status);      conds.push(`la.status = $${vals.length}`); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const { rows: r } = await client.query(
        // Tenant columns match GET /:propertyId/leases exactly so both feed the
        // same `Lease` type on the frontend; property_name/unit_number are the
        // additions this flat view needs (the property isn't known from context).
        `SELECT la.*,
                u.unit_number,
                p.name AS property_name,
                pt.first_name, pt.last_name, pt.company_name, pt.is_company,
                pt.email, pt.phone
         FROM   prop_lease_agreements la
         JOIN   prop_properties p        ON p.id  = la.property_id
         JOIN   prop_property_tenants pt ON pt.id = la.tenant_id
         LEFT   JOIN prop_units u        ON u.id  = la.unit_id
         ${where}
         ORDER  BY la.start_date DESC
         LIMIT  500`,
        vals,
      );
      return r;
    });

    res.json(ok(rows));
  } catch (e) { next(e); }
});
