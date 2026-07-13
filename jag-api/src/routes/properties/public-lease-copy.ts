// Public, no-Keycloak page backing the tenant's signed-lease download link
// sent by WhatsApp once both parties sign (see routes/internal/documenso-webhook.ts).
// GET /api/v1/public/lease-copy/:token → { tenantName, propertyName, unitNumber, downloadUrl }
//
// downloadUrl is a freshly-generated MinIO presigned GET (short TTL) — regenerated
// on every request rather than stored, so the link never goes stale even if the
// tenant opens the WhatsApp message days later. Same "public route has no
// req.rlsCtx, must scope via withOwnerRLS to the single platform owner" pattern
// as public-apply.ts / viewings.ts's public booking router.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { ok, err } from '../../lib/response';
import { getPresignedGetUrl, BUCKET_SIGNED_DOCUMENTS } from '../../lib/minio';

export const publicLeaseCopyRouter = Router();

const PUBLIC_LISTING_OWNER_ID =
  process.env['NOTIFY_OWNER_USER_ID'] ?? '95ca3f77-60ba-4a0f-af70-2832b247b525';

const TokenParam = z.object({ token: z.string().uuid() });

publicLeaseCopyRouter.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = TokenParam.safeParse(req.params);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid link.'); return; }
    const { token } = parsed.data;

    const row = await withOwnerRLS(propertiesPool, PUBLIC_LISTING_OWNER_ID, async client => {
      const { rows } = await client.query(
        `SELECT la.signed_pdf_object_key,
                CASE WHEN pt.is_company AND pt.company_name IS NOT NULL THEN pt.company_name
                     ELSE TRIM(CONCAT(pt.first_name, ' ', COALESCE(pt.last_name, ''))) END AS tenant_name,
                p.name AS property_name, u.unit_number
         FROM   prop_lease_agreements la
         JOIN   prop_property_tenants pt ON pt.id = la.tenant_id
         JOIN   prop_properties p ON p.id = la.property_id
         LEFT JOIN prop_units u ON u.id = la.unit_id
         WHERE  la.signed_copy_token = $1 AND la.signature_status = 'SIGNED'`,
        [token],
      );
      return rows[0] ?? null;
    });
    if (!row || !row.signed_pdf_object_key) { err(res, 404, 'NOT_FOUND', 'This link is invalid or has expired.'); return; }

    const downloadUrl = await getPresignedGetUrl(BUCKET_SIGNED_DOCUMENTS, row.signed_pdf_object_key, 3600);
    ok(res, {
      tenantName: row.tenant_name,
      propertyName: row.property_name,
      unitNumber: row.unit_number,
      downloadUrl,
    }, 200);
  } catch (e) { next(e); }
});
