// Shared "finish a completed Documenso document" logic — used by both the
// live webhook (routes/internal/documenso-webhook.ts) and the reconciliation
// sweep (routes/internal/documenso-reconcile.ts).
//
// Why a sweep exists at all: the webhook handler acks Documenso immediately
// (200 OK) and does the PDF download + MinIO store + DB update in a
// fire-and-forget background task, so Documenso's delivery is never blocked.
// That means a container restart/redeploy landing in the narrow window
// between "webhook received" and "background task finished" silently drops
// the completion — Documenso shows the document as COMPLETED forever, but
// our copy of the signed PDF never gets saved. Hit for real 2026-07-13
// (session 44): a handover checklist's tenant finished signing seconds
// before a routine `deploy.sh` run force-recreated the api container.
// Recovered manually via a one-off script; this sweep makes that automatic.
import { randomUUID } from 'crypto';
import { propertiesPool } from '../db/index';
import { withOwnerRLS } from '../middleware/rls';
import { logger } from './logger';
import { getSubmission, downloadSignedPdf } from './documenso';
import { minioClient, ensureBucket, mediaObjectKey, BUCKET_SIGNED_DOCUMENTS } from './minio';
import { sendTemplate } from './whatsapp';

// jag_properties is single-owner (Robert) — same fallback constant lib/notifications.ts uses.
const OWNER_ID = process.env['NOTIFY_OWNER_USER_ID'] ?? '95ca3f77-60ba-4a0f-af70-2832b247b525';

export async function completeLeaseSigning(documentId: string): Promise<boolean> {
  const lease = await withOwnerRLS(propertiesPool, OWNER_ID, async c =>
    c.query<{ id: string }>(
      `SELECT id FROM prop_lease_agreements WHERE documenso_document_id = $1 AND signed_pdf_object_key IS NULL`,
      [documentId],
    ).then(r => r.rows[0] ?? null),
  );
  if (!lease) return false;

  const { status } = await getSubmission(documentId);
  if (status !== 'COMPLETED') return false;

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
  return true;
}

export async function completeHandoverSigning(documentId: string): Promise<boolean> {
  const handover = await withOwnerRLS(propertiesPool, OWNER_ID, async c =>
    c.query<{ id: string }>(
      `SELECT id FROM prop_handover_checklists WHERE documenso_document_id = $1 AND signed_pdf_object_key IS NULL`,
      [documentId],
    ).then(r => r.rows[0] ?? null),
  );
  if (!handover) return false;

  const { status } = await getSubmission(documentId);
  if (status !== 'COMPLETED') return false;

  const pdf = await downloadSignedPdf(documentId);
  await ensureBucket(BUCKET_SIGNED_DOCUMENTS);
  const key = mediaObjectKey(OWNER_ID, 'handover-checklists', handover.id, 'signed-condition-report.pdf');
  await minioClient.putObject(BUCKET_SIGNED_DOCUMENTS, key, pdf, pdf.length, { 'Content-Type': 'application/pdf' });

  await withOwnerRLS(propertiesPool, OWNER_ID, async c =>
    c.query(
      `UPDATE prop_handover_checklists
       SET    tenant_signed = true, manager_signed = true,
              tenant_signed_at = COALESCE(tenant_signed_at, NOW()),
              manager_signed_at = COALESCE(manager_signed_at, NOW()),
              signed_pdf_object_key = $1
       WHERE  id = $2`,
      [key, handover.id],
    ),
  );
  logger.info({ entity: 'DOCUMENSO', action: 'HANDOVER_SIGNED', handover_id: handover.id, document_id: documentId });
  return true;
}

/**
 * Sweeps for any document sent to Documenso (lease or handover) that shows
 * no stored signed PDF yet, re-checks its live status, and finishes the
 * completion if Documenso has it as COMPLETED. Safe to run repeatedly —
 * both complete* functions no-op once signed_pdf_object_key is set.
 */
export async function reconcilePendingDocumensoSubmissions(): Promise<{ checked: number; completed: number; errors: number }> {
  const pending = await withOwnerRLS(propertiesPool, OWNER_ID, async c => {
    const leases = await c.query<{ documenso_document_id: string }>(
      `SELECT documenso_document_id FROM prop_lease_agreements
       WHERE documenso_document_id IS NOT NULL AND signed_pdf_object_key IS NULL`,
    );
    const handovers = await c.query<{ documenso_document_id: string }>(
      `SELECT documenso_document_id FROM prop_handover_checklists
       WHERE documenso_document_id IS NOT NULL AND signed_pdf_object_key IS NULL`,
    );
    return {
      leaseDocIds: leases.rows.map(r => r.documenso_document_id),
      handoverDocIds: handovers.rows.map(r => r.documenso_document_id),
    };
  });

  let completed = 0;
  let errors = 0;
  const checked = pending.leaseDocIds.length + pending.handoverDocIds.length;

  for (const documentId of pending.leaseDocIds) {
    try {
      if (await completeLeaseSigning(documentId)) completed += 1;
    } catch (e) {
      errors += 1;
      logger.warn({ entity: 'DOCUMENSO', action: 'RECONCILE_LEASE_FAILED', document_id: documentId, error_message: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const documentId of pending.handoverDocIds) {
    try {
      if (await completeHandoverSigning(documentId)) completed += 1;
    } catch (e) {
      errors += 1;
      logger.warn({ entity: 'DOCUMENSO', action: 'RECONCILE_HANDOVER_FAILED', document_id: documentId, error_message: e instanceof Error ? e.message : String(e) });
    }
  }

  logger.info({ entity: 'DOCUMENSO', action: 'RECONCILE_SWEEP', checked, completed, errors });
  return { checked, completed, errors };
}
