// Internal webhook — Documenso signing-completion receiver.
//
// Documenso POSTs here whenever a document's status changes (opened, signed,
// completed). We resolve the document back to whichever JAG record it belongs
// to (a lease Agreement or a handover condition-report checklist — both store
// documenso_document_id), pull the signed PDF, store it in MinIO, and update
// signature status.
//
// NOT under /api/v1/ and NOT behind Keycloak. Protected by DOCUMENSO_WEBHOOK_SECRET
// via the X-Documenso-Secret header (Documenso supports a proper per-webhook secret
// header, unlike DocuSeal's self-hosted webhook UI which only offered a plain URL
// field — no token-in-path workaround needed here).
// Configure in Documenso: Settings → Webhooks → URL = https://api.jagcorporate.com/internal/documenso-webhook,
// Secret = <DOCUMENSO_WEBHOOK_SECRET>, trigger = "document.completed" (confirmed via the
// live Webhooks UI trigger dropdown 2026-07-07 — lowercase dot notation, NOT the
// SCREAMING_SNAKE_CASE "DOCUMENT_COMPLETED" the prose docs implied).
//
// NOTE: payload shape (`{ event, data: { id, status, completedAt } }`) follows
// Documenso's documented webhook contract but hasn't been exercised against a
// real webhook delivery yet — verify on the first end-to-end signing test.

import { Router, type Request, type Response } from 'express';
import { randomUUID, timingSafeEqual } from 'crypto';
import { propertiesPool } from '../../db/index';
import { withOwnerRLS } from '../../middleware/rls';
import { logger } from '../../lib/logger';
import { getSubmission, downloadSignedPdf } from '../../lib/documenso';
import { minioClient, ensureBucket, mediaObjectKey, BUCKET_SIGNED_DOCUMENTS } from '../../lib/minio';
import { sendTemplate } from '../../lib/whatsapp';

export const documensoWebhookRouter = Router();

const WEBHOOK_SECRET = process.env['DOCUMENSO_WEBHOOK_SECRET'] ?? '';
// jag_properties is single-owner (Robert) — same fallback constant lib/notifications.ts uses.
const OWNER_ID = process.env['NOTIFY_OWNER_USER_ID'] ?? '95ca3f77-60ba-4a0f-af70-2832b247b525';

interface DocumensoWebhookPayload {
  event?: string;
  data?: { id?: number | string; status?: string };
}

function secretMatches(provided: string): boolean {
  if (!WEBHOOK_SECRET) return true;
  const a = Buffer.from(provided);
  const b = Buffer.from(WEBHOOK_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

documensoWebhookRouter.post('/', (req: Request, res: Response): void => {
  const provided = req.header('X-Documenso-Secret') ?? '';
  if (!secretMatches(provided)) { res.status(401).end(); return; }

  // Always ack fast; do the lookup + PDF fetch fire-and-forget so Documenso's
  // webhook delivery is never blocked or retried by us.
  res.status(200).end();

  const payload = (req.body ?? {}) as DocumensoWebhookPayload;
  const eventType = payload.event ?? '';
  const documentId = String(payload.data?.id ?? '');
  if (!documentId) {
    // Previously a silent return — which masked a body-parser bug (Documenso's
    // ~400kb PDF-embedded payload exceeded express.json()'s 100kb limit, so
    // req.body arrived empty and every completed signature was dropped). Log it
    // so an empty/unparsed body is visible rather than looking like success.
    logger.warn({ entity: 'DOCUMENSO', action: 'WEBHOOK_EMPTY_BODY', event_type: eventType });
    return;
  }

  const isCompleted = eventType === 'document.completed' || payload.data?.status === 'COMPLETED';
  if (!isCompleted) {
    logger.info({ entity: 'DOCUMENSO', action: 'WEBHOOK_IGNORED', event_type: eventType, document_id: documentId });
    return;
  }

  void (async () => {
    try {
      // Is this a Tenancy Agreement submission?
      const lease = await withOwnerRLS(propertiesPool, OWNER_ID, async c =>
        c.query<{ id: string }>(
          `SELECT id FROM prop_lease_agreements WHERE documenso_document_id = $1`,
          [documentId],
        ).then(r => r.rows[0] ?? null),
      );

      if (lease) {
        const { status } = await getSubmission(documentId);
        if (status === 'COMPLETED') {
          const pdf = await downloadSignedPdf(documentId);
          await ensureBucket(BUCKET_SIGNED_DOCUMENTS);
          const key = mediaObjectKey(OWNER_ID, 'lease-agreements', lease.id, 'signed-agreement.pdf');
          await minioClient.putObject(BUCKET_SIGNED_DOCUMENTS, key, pdf, pdf.length, { 'Content-Type': 'application/pdf' });

          const copyToken = randomUUID();
          await withOwnerRLS(propertiesPool, OWNER_ID, async c =>
            c.query(
              `UPDATE prop_lease_agreements
               SET    signature_status = 'SIGNED', signed_pdf_object_key = $1,
                      agreement_signed_at = NOW(), signed_copy_token = $2
               WHERE  id = $3`,
              [key, copyToken, lease.id],
            ),
          );
          const tenant = await withOwnerRLS(propertiesPool, OWNER_ID, async c =>
            c.query(
              `SELECT pt.phone AS tenant_phone,
                      CASE WHEN pt.is_company AND pt.company_name IS NOT NULL THEN pt.company_name
                           ELSE TRIM(CONCAT(pt.first_name, ' ', COALESCE(pt.last_name, ''))) END AS tenant_name,
                      p.name AS property_name, u.unit_number
               FROM   prop_lease_agreements la
               JOIN   prop_property_tenants pt ON pt.id = la.tenant_id
               JOIN   prop_properties p ON p.id = la.property_id
               LEFT JOIN prop_units u ON u.id = la.unit_id
               WHERE  la.id = $1`,
              [lease.id],
            ).then(r => r.rows[0] ?? null),
          );
          logger.info({ entity: 'DOCUMENSO', action: 'LEASE_SIGNED', lease_id: lease.id, document_id: documentId });

          // Hand the tenant a self-serve download link the moment both parties
          // have signed — previously nothing pushed the signed copy to them at
          // all; staff had to notice and send it manually. Links to a public,
          // token-gated page (same pattern as /apply and /book) rather than the
          // auth-gated download route, since the tenant has no Keycloak login.
          if (tenant?.tenant_phone) {
            sendTemplate({
              to: tenant.tenant_phone,
              templateName: 'jag_onb_lease_signed_copy',
              components: [
                { type: 'body', parameters: [
                  { type: 'text', text: tenant.tenant_name || 'Tenant' },
                  { type: 'text', text: String(tenant.property_name ?? '') },
                  { type: 'text', text: String(tenant.unit_number ?? '') },
                ]},
                { type: 'button', sub_type: 'url', index: '0', parameters: [
                  { type: 'text', text: copyToken },
                ]},
              ],
            }).catch(e => logger.warn({ entity: 'DOCUMENSO', action: 'SIGNED_COPY_WA_FAILED', error_message: e instanceof Error ? e.message : String(e) }));
          }
        }
        return;
      }

      // Is this a handover condition-report submission?
      const handover = await withOwnerRLS(propertiesPool, OWNER_ID, async c =>
        c.query<{ id: string }>(
          `SELECT id FROM prop_handover_checklists WHERE documenso_document_id = $1`,
          [documentId],
        ).then(r => r.rows[0] ?? null),
      );

      if (handover) {
        const { status } = await getSubmission(documentId);
        if (status === 'COMPLETED') {
          const pdf = await downloadSignedPdf(documentId);
          await ensureBucket(BUCKET_SIGNED_DOCUMENTS);
          const key = mediaObjectKey(OWNER_ID, 'handover-checklists', handover.id, 'signed-condition-report.pdf');
          await minioClient.putObject(BUCKET_SIGNED_DOCUMENTS, key, pdf, pdf.length, { 'Content-Type': 'application/pdf' });

          await withOwnerRLS(propertiesPool, OWNER_ID, async c =>
            c.query(
              `UPDATE prop_handover_checklists
               SET    tenant_signed = true, manager_signed = true,
                      tenant_signed_at = NOW(), manager_signed_at = NOW(),
                      signed_pdf_object_key = $1
               WHERE  id = $2`,
              [key, handover.id],
            ),
          );
          logger.info({ entity: 'DOCUMENSO', action: 'HANDOVER_SIGNED', handover_id: handover.id, document_id: documentId });
        }
        return;
      }

      logger.warn({ entity: 'DOCUMENSO', action: 'WEBHOOK_NO_MATCH', document_id: documentId });
    } catch (e) {
      logger.warn({ entity: 'DOCUMENSO', action: 'WEBHOOK_HANDLE_FAILED', error: e instanceof Error ? e.message : String(e) });
    }
  })();
});
