// GET /api/v1/properties/units
//
// Flat, cross-property unit list. Every other unit route is nested under
// /:propertyId/units, so there was no way to see all 25 units in one screen —
// the listing backlog could only be worked property-by-property.
//
// MOUNTING HAZARD: this path is a single segment, so `GET /:id` inside
// properties.ts will capture it, fail its UUID parse and return 422 — exactly
// how `GET /properties/leases` stayed dead for six sessions. This router MUST
// be mounted in index.ts ABOVE `propertiesRouter.use('/', propRoutes)`.
// Do not move this handler into properties.ts.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { ok, err } from '../../lib/response';

export const unitsListRouter = Router();

const ListUnitsQuery = z.object({
  property_id:    z.string().uuid().optional(),
  listing_status: z.enum(['VACANT', 'LISTED', 'OCCUPIED', 'MAINTENANCE']).optional(),
  is_rented:      z.enum(['true', 'false']).optional(),
}).strict();

unitsListRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));

    const parsed = ListUnitsQuery.safeParse(req.query);
    if (!parsed.success) {
      return void res.status(422).json(err('Invalid unit filter.', 'VALIDATION_ERROR'));
    }
    const q = parsed.data;

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const conds: string[] = [];
      const vals: unknown[] = [];
      if (q.property_id)    { vals.push(q.property_id);            conds.push(`u.property_id = $${vals.length}`); }
      if (q.listing_status) { vals.push(q.listing_status);         conds.push(`u.listing_status = $${vals.length}`); }
      if (q.is_rented)      { vals.push(q.is_rented === 'true');   conds.push(`u.is_rented = $${vals.length}`); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const { rows: r } = await client.query(
        // Columns match GET /:propertyId/units exactly so both feed the same
        // `Unit` type on the frontend. property_id / property_name and
        // photo_count are the additions this flat view needs — the property is
        // not known from context here, and listing readiness is the whole point
        // of the screen.
        `SELECT u.id, u.property_id, u.unit_number, u.floor, u.bedrooms, u.bathrooms,
                u.floor_area_sqft, u.is_rented, u.notes, u.created_at,
                u.listing_status, u.listing_description, u.rent_amount,
                u.wasa_included, u.electricity_included, u.internet_included,
                u.suggested_rent_recommended_ttd, u.booking_slug, u.listed_at,
                p.name        AS property_name,
                p.city        AS property_city,
                la.id         AS lease_id,
                la.monthly_rent,
                la.currency,
                la.end_date   AS lease_end_date,
                pt.first_name AS tenant_first_name,
                pt.last_name  AS tenant_last_name,
                pt.company_name,
                pt.is_company,
                pt.phone      AS tenant_phone,
                (SELECT count(*) FROM prop_unit_photos ph WHERE ph.unit_id = u.id)::int
                              AS photo_count
         FROM   prop_units u
         JOIN   prop_properties p ON p.id = u.property_id
         LEFT   JOIN prop_lease_agreements la
           ON   la.unit_id = u.id AND la.status = 'ACTIVE'
         LEFT   JOIN prop_property_tenants pt ON pt.id = la.tenant_id
         ${where}
         ORDER  BY p.name, u.floor NULLS LAST, u.unit_number
         LIMIT  500`,
        vals,
      );
      return r;
    });

    res.json(ok(rows));
  } catch (e) { next(e); }
});
