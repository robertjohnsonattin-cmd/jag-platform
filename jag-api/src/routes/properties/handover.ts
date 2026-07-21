// GET    /api/v1/properties/handover/:unitId
// POST   /api/v1/properties/handover
// PATCH  /api/v1/properties/handover/:id
// GET    /api/v1/properties/handover/:id/compare
// GET    /api/v1/properties/handover/:id/signed-pdf

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { ok, err } from '../../lib/response';
import { logger } from '../../lib/logger';
import { sendTemplate } from '../../lib/whatsapp';
import { triggerAutoListing } from './listing';
import { generateConditionReportPdf, type ConditionSignField, type ConditionItem } from '../../lib/condition-report-pdf';
import { createSigningSubmission } from '../../lib/documenso';
import { getPaymentDetails } from '../../lib/payment-config';
import { getObjectStream, BUCKET_SIGNED_DOCUMENTS } from '../../lib/minio';
import PDFDocument from 'pdfkit';

export const handoverRouter = Router();

function pdfDocToBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

const IdParam     = z.object({ id: z.string().uuid() });
const UnitIdParam = z.object({ unitId: z.string().uuid() });

const ConditionItemSchema = z.object({
  item:       z.string(),
  condition:  z.string(),
  notes:      z.string().optional(),
  photo_urls: z.array(z.string()).optional(),
});

const InventoryItemSchema = z.object({
  item:      z.string(),
  qty:       z.number().int().min(0),
  condition: z.string().optional(),
  serial:    z.string().optional(),
});

const CreateHandoverSchema = z.object({
  unit_id:              z.string().uuid(),
  lease_id:             z.string().uuid().optional(),
  type:                 z.enum(['ENTRY','EXIT']),
  tec_meter_reading:    z.string().max(50).optional(),
  tec_account_number:   z.string().max(50).optional(),
  wasa_meter_reading:   z.string().max(50).optional(),
  wasa_account_number:  z.string().max(50).optional(),
  condition_items:      z.array(ConditionItemSchema).optional(),
  inventory_items:      z.array(InventoryItemSchema).optional(),
  keys_issued:          z.number().int().min(0).optional(),
  keys_returned:        z.number().int().min(0).optional(),
  gate_remotes_issued:  z.number().int().min(0).optional(),
  gate_remotes_returned: z.number().int().min(0).optional(),
  photo_urls:           z.array(z.string()).optional(),
  notes:                z.string().optional(),
}).strict();

const PatchHandoverSchema = z.object({
  tec_meter_reading:     z.string().max(50).nullable().optional(),
  wasa_meter_reading:    z.string().max(50).nullable().optional(),
  condition_items:       z.array(ConditionItemSchema).optional(),
  inventory_items:       z.array(InventoryItemSchema).optional(),
  keys_returned:         z.number().int().min(0).nullable().optional(),
  gate_remotes_returned: z.number().int().min(0).nullable().optional(),
  photo_urls:            z.array(z.string()).optional(),
  tenant_signed:         z.boolean().optional(),
  manager_signed:        z.boolean().optional(),
  notes:                 z.string().nullable().optional(),
  completed_at:          z.string().optional(),
}).strict();

// No general list route existed at all -- only /unit/:unitId, scoped by unit.
// Added for the tenant_id filter (see migration 055); tenant_id is required
// since there's no other reasonable general-purpose listing here.
const TenantHandoverQuery = z.object({ tenant_id: z.string().uuid() });

handoverRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const parsed = TenantHandoverQuery.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'tenant_id is required and must be a valid UUID.'); return; }

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: r } = await client.query(
        `SELECT h.*, u.unit_number, p.name AS property_name
         FROM prop_handover_checklists h
         LEFT JOIN prop_units u ON u.id = h.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE h.tenant_id = $1 AND h.owner_id = $2
         ORDER BY h.created_at DESC`,
        [parsed.data.tenant_id, ownerId],
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});

handoverRouter.get('/unit/:unitId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { unitId } = UnitIdParam.parse(req.params);

    const rows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: r } = await client.query(
        `SELECT * FROM prop_handover_checklists WHERE unit_id = $1 AND owner_id = $2 ORDER BY created_at DESC`,
        [unitId, ownerId],
      );
      return r;
    });
    res.json(ok(rows));
  } catch (e) { next(e); }
});

handoverRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const body = CreateHandoverSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      let tenantId: string | null = null;
      if (body.lease_id) {
        const { rows: [la] } = await client.query(`SELECT tenant_id FROM prop_lease_agreements WHERE id = $1`, [body.lease_id]);
        tenantId = la?.tenant_id ?? null;
      } else {
        const { rows: [la] } = await client.query(
          `SELECT tenant_id FROM prop_lease_agreements WHERE unit_id = $1 AND status = 'ACTIVE' LIMIT 1`,
          [body.unit_id],
        );
        tenantId = la?.tenant_id ?? null;
      }

      const { rows } = await client.query(
        `INSERT INTO prop_handover_checklists
           (owner_id, unit_id, lease_id, tenant_id, type,
            tec_meter_reading, tec_account_number, wasa_meter_reading, wasa_account_number,
            condition_items, inventory_items,
            keys_issued, keys_returned, gate_remotes_issued, gate_remotes_returned,
            photo_urls, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [ownerId, body.unit_id, body.lease_id ?? null, tenantId, body.type,
         body.tec_meter_reading ?? null, body.tec_account_number ?? null,
         body.wasa_meter_reading ?? null, body.wasa_account_number ?? null,
         JSON.stringify(body.condition_items ?? []),
         JSON.stringify(body.inventory_items ?? []),
         body.keys_issued ?? 0, body.keys_returned ?? null,
         body.gate_remotes_issued ?? 0, body.gate_remotes_returned ?? null,
         JSON.stringify(body.photo_urls ?? []),
         body.notes ?? null],
      );
      return rows[0];
    });
    res.status(201).json(ok(row));
  } catch (e) { next(e); }
});

handoverRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = PatchHandoverSchema.parse(req.body);
    if (Object.keys(body).length === 0) return void res.status(400).json(err('No fields to update', 'VALIDATION_ERROR'));

    const sets: string[] = [];
    const vals: unknown[] = [];
    const jsonFields = new Set(['condition_items', 'inventory_items', 'photo_urls']);

    for (const [k, v] of Object.entries(body)) {
      const val = jsonFields.has(k) ? JSON.stringify(v) : v;
      if (k === 'tenant_signed' && v === true) {
        vals.push(val); sets.push(`${k} = $${vals.length}`);
        sets.push(`tenant_signed_at = NOW()`);
      } else if (k === 'manager_signed' && v === true) {
        vals.push(val); sets.push(`${k} = $${vals.length}`);
        sets.push(`manager_signed_at = NOW()`);
      } else {
        vals.push(val); sets.push(`${k} = $${vals.length}`);
      }
    }
    vals.push(id); vals.push(ownerId);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_handover_checklists SET ${sets.join(', ')}
         WHERE id = $${vals.length - 1} AND owner_id = $${vals.length} RETURNING *`,
        vals,
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Checklist not found', 'NOT_FOUND'));

    // Auto-list unit when EXIT handover is signed off — fires jag_adv_new_listing to past enquirers
    if (body.completed_at && row.type === 'EXIT') {
      triggerAutoListing(ownerId, String(row.unit_id)).catch(e =>
        logger.warn({ entity: 'PROPERTIES', action: 'AUTO_LIST_FAILED', unit_id: row.unit_id, error_message: (e as Error).message }),
      );
    }

    // JAG_ONB_003 — welcome pack on ENTRY handover completion
    if (body.completed_at && row.type === 'ENTRY') {
      const lease = await withOwnerRLS(propertiesPool, ownerId, async client => {
        const { rows: [la] } = await client.query(
          `SELECT la.tenant_phone, la.tenant_name, la.rent_amount_ttd,
                  u.unit_number, p.name AS property_name
           FROM prop_lease_agreements la
           JOIN prop_units u ON u.id = la.unit_id
           LEFT JOIN prop_properties p ON p.id = u.property_id
           WHERE la.unit_id = $1 AND la.status = 'ACTIVE' LIMIT 1`,
          [row.unit_id],
        );
        return la ?? null;
      });
      if (lease?.tenant_phone) {
        const mgr   = process.env.JAG_MANAGER_NAME ?? 'Robert';
        const phone = process.env.JAG_MANAGER_PHONE ?? process.env.JAG_OWNER_PHONE ?? '';
        const pay   = getPaymentDetails();
        sendTemplate({
          to: lease.tenant_phone,
          templateName: 'jag_onb_welcome_pack',
          components: [{ type: 'body', parameters: [
            { type: 'text', text: lease.tenant_name ?? 'Tenant' },
            { type: 'text', text: lease.property_name ?? '' },
            { type: 'text', text: lease.unit_number ?? '' },
            { type: 'text', text: `TTD $${parseFloat(String(lease.rent_amount_ttd ?? 0)).toFixed(2)}` },
            { type: 'text', text: pay.payee },
            { type: 'text', text: pay.bank },
            { type: 'text', text: pay.acctType },
            { type: 'text', text: pay.acctNo },
            { type: 'text', text: mgr },
            { type: 'text', text: phone },
          ]}],
        }).catch(e => logger.warn({ entity: 'PROPERTIES', action: 'WA_WELCOME_PACK_FAILED', error_message: (e as Error).message }));
      }
    }

    res.json(ok(row));
  } catch (e) { next(e); }
});

// ── POST /handover/:id/send-for-signing ───────────────────────────────────────
// Renders the checklist's condition_items into a small signable PDF (Schedule B,
// one event = one condition column, not move-in/move-out together) and creates
// a Documenso document with just two signature fields. Both signing links are
// returned so the frontend can open the tenant's first, then the landlord's, in
// the same on-site sitting — no WhatsApp round-trip needed for this one, though
// the tenant link is also sent as a fallback in case they'd rather sign later.

handoverRouter.post('/:id/send-for-signing', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [checklist] } = await client.query(
        `SELECT hc.id, hc.type, hc.condition_items, hc.created_at, hc.unit_id, hc.lease_id,
                u.unit_number, p.address_line1, p.address_line2, p.city,
                la.tenant_id, pt.first_name AS tenant_first_name, pt.last_name AS tenant_last_name,
                pt.company_name AS tenant_company_name, pt.is_company AS tenant_is_company,
                pt.phone AS tenant_phone, pt.email AS tenant_email
         FROM   prop_handover_checklists hc
         LEFT JOIN prop_units u ON u.id = hc.unit_id
         LEFT JOIN prop_properties p ON p.id = u.property_id
         LEFT JOIN prop_lease_agreements la ON la.id = hc.lease_id
         LEFT JOIN prop_property_tenants pt ON pt.id = la.tenant_id
         WHERE  hc.id = $1 AND hc.owner_id = $2`,
        [id, ownerId],
      );
      return checklist ?? null;
    });
    if (!row) return void res.status(404).json(err('Checklist not found', 'NOT_FOUND'));

    const tenantName = row.tenant_is_company && row.tenant_company_name
      ? row.tenant_company_name
      : `${row.tenant_first_name ?? ''} ${row.tenant_last_name ?? ''}`.trim() || 'Tenant';
    const propertyAddress = [row.address_line1, row.address_line2, row.city].filter(Boolean).join(', ');

    const fields: ConditionSignField[] = [];
    const doc = generateConditionReportPdf({
      type: row.type,
      property_address: propertyAddress,
      unit_number: row.unit_number,
      tenant_name: tenantName,
      event_date: row.created_at,
      condition_items: (row.condition_items ?? []) as ConditionItem[],
    }, fields);
    const pdf = await pdfDocToBuffer(doc);

    const { submissionId, embedUrls } = await createSigningSubmission({
      pdf,
      fileName: `condition-report-${id}.pdf`,
      submitters: [
        { role: 'LANDLORD', name: 'Robert Johnson-Attin', email: 'robertjohnsonattin@gmail.com' },
        { role: 'TENANT', name: tenantName, email: row.tenant_email ?? undefined, phone: row.tenant_phone ?? undefined },
      ],
      fields: fields.map(f => ({
        name: f.name, type: f.type, role: f.role, required: true,
        areas: [{ page: f.page, x: f.x, y: f.y, w: f.w, h: f.h }],
      })),
    });

    await withOwnerRLS(propertiesPool, ownerId, async client =>
      client.query(`UPDATE prop_handover_checklists SET documenso_document_id = $1 WHERE id = $2`, [submissionId, id]),
    );

    if (row.tenant_phone && embedUrls['TENANT']) {
      // jag_condition_report_signing_request: 1 body param + "Review & Sign" URL button
      // (https://sign.jagcorporate.com/{{1}}). Pass the path only.
      const signPath = embedUrls['TENANT'].replace(/^https?:\/\/[^/]+\//, '');
      sendTemplate({
        to: row.tenant_phone,
        templateName: 'jag_condition_report_signing_request',
        components: [
          { type: 'body', parameters: [{ type: 'text', text: tenantName }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: signPath }] },
        ],
      }).catch(e => logger.warn({ entity: 'PROPERTIES', action: 'HANDOVER_SIGN_WA_FAILED', error_message: (e as Error).message }));
    }

    logger.info({ entity: 'PROPERTIES', action: 'HANDOVER_SENT_FOR_SIGNING', user_id: ownerId, record_id: id, submission_id: submissionId });

    res.json(ok({ submissionId, landlordSigningUrl: embedUrls['LANDLORD'], tenantSigningUrl: embedUrls['TENANT'] }));
  } catch (e) { next(e); }
});

handoverRouter.get('/:id/compare', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const data = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [exit_checklist] } = await client.query(
        `SELECT * FROM prop_handover_checklists WHERE id = $1 AND owner_id = $2 AND type = 'EXIT'`,
        [id, ownerId],
      );
      if (!exit_checklist) return null;
      const { rows: [entry_checklist] } = await client.query(
        `SELECT * FROM prop_handover_checklists
         WHERE unit_id = $1 AND owner_id = $2 AND type = 'ENTRY' AND lease_id = $3
         ORDER BY created_at ASC LIMIT 1`,
        [exit_checklist.unit_id, ownerId, exit_checklist.lease_id],
      );
      return { entry: entry_checklist ?? null, exit: exit_checklist };
    });
    if (!data) return void res.status(404).json(err('Exit checklist not found', 'NOT_FOUND'));
    res.json(ok(data));
  } catch (e) { next(e); }
});

// ── GET /handover/:id/signed-pdf ───────────────────────────────────────────────
// Streams the signed condition-report PDF stored by the Documenso webhook once
// both parties have completed the real e-signature (see routes/internal/
// documenso-webhook.ts) — auth-gated streaming route, so the frontend must
// fetch it with a Bearer token (api.download()), not a bare <a href>.
handoverRouter.get('/:id/signed-pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [r] } = await client.query(
        `SELECT signed_pdf_object_key FROM prop_handover_checklists WHERE id = $1 AND owner_id = $2`,
        [id, ownerId],
      );
      return r ?? null;
    });
    if (!row || !row.signed_pdf_object_key) return void res.status(404).json(err('No signed copy on file yet.', 'NOT_FOUND'));

    const stream = await getObjectStream(BUCKET_SIGNED_DOCUMENTS, row.signed_pdf_object_key as string);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="handover-signed-${id}.pdf"`);
    stream.pipe(res);
  } catch (e) { next(e); }
});
